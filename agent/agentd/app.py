"""agentd — Agent 常驻服务：会话运行时（总线命令 → gill_core 任务循环 → 事件回发）。"""
from __future__ import annotations
import asyncio
import logging
import os
import time
import uuid

from gill_core.bus import Bus
from gill_core.config import Settings
from gill_core.loop import run_task
from gill_core.sandbox import make_sandbox
from gill_core.sandbox_base import BaseSandbox
from gill_core.browser import BrowserSession

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger("agentd")

NODE = os.getenv("NODE_ID", f"agentd-{uuid.uuid4().hex[:6]}")


class SessionRuntime:
    """一个会话 = 一个命令消费循环 + 一个懒创建沙箱 + 会话历史。"""

    def __init__(self, bus: Bus, settings: Settings, sid: str):
        self.bus, self.s, self.sid = bus, settings, sid
        self.sandbox: BaseSandbox | None = None
        self._sandbox_used: float = 0.0
        self.browser: BrowserSession | None = None
        self.history: list[dict] = []
        self.session_meta: dict = {}
        self.approval_mode: str = "auto"          # auto | suggest（会话级，FR-38）
        self.pending_approvals: dict[str, dict] = {}   # cid -> {"event": Event, "result": None}
        self.present: dict = {}                    # FR-138 在线感知 uid -> 连接数
        self.op_mode: str = "free"                # free | relay（FR-135）
        self.op_holder: int | None = None
        self.running = asyncio.Lock()      # FR-37 同会话单任务
        self.stop_requested = False
        self.task: asyncio.Task | None = None
        self.always_ok_rules: set[str] = set()

    async def handle_file_sync_in(self, env: dict):
        """FR-62：MinIO 上传件 → 沙箱工作区。"""
        try:
            from gill_core import files as gfiles
            await self.ensure_sandbox()
            p = env.get("payload", {})
            import uuid as _u
            name = p.get("filename", "file.bin")
            dest = p.get("destPath") or f"/home/user/uploads/{name}"
            await gfiles.sync_in(self.sandbox, p["objectKey"], dest, emit=self._emit)
        except Exception as e:
            log.exception("file sync fail")
            await self._emit("error", {"code": "FILE-5005", "message": f"同步失败：{e}"})

    async def handle_file_export(self, env: dict):
        """FR-63：沙箱文件 → MinIO exports/。"""
        try:
            from gill_core import files as gfiles
            import uuid as _u, shlex
            await self.ensure_sandbox()
            path = env["payload"]["path"]
            key = f"exports/{self.sid}/{_u.uuid4()}-{path.rsplit('/', 1)[-1]}"
            await gfiles.export_out(self.sandbox, path, key, emit=self._emit)
        except Exception as e:
            log.exception("file export fail")
            await self._emit("error", {"code": "FILE-5005", "message": f"导出失败：{e}"})

    async def handle_file_list(self, env: dict):
        """FR-64：沙箱工作区文件树（/home/user 两层）。"""
        try:
            await self.ensure_sandbox()
            p = env.get("payload", {})
            base = p.get("path", "/home/user")
            import shlex
            r = await self.sandbox.run(
                f"cd {shlex.quote(base)} && find . -maxdepth 2 -mindepth 1 2>/dev/null | head -100 | sed 's|^\\./||' && echo ---SIZES--- && du -sh ./* 2>/dev/null | head -50", timeout=15)
            await self._emit("file_tree", {"path": base, "out": r.stdout[:4000]})
        except Exception as e:
            await self._emit("error", {"code": "FILE-5005", "message": f"列目录失败：{e}"})

    async def handle_preview_start(self, env: dict):
        """FR-42：开启投屏（浏览器懒启动）。"""
        try:
            await self.ensure_sandbox()
            r = await self.sandbox.run("start-chromium.sh", timeout=30)   # 幂等：已运行则跳过
            if r.exit_code != 0:
                await self._emit("error", {"code": "CDP-6001", "message": "Chromium 启动失败：" + r.stderr[:200]})
                return
            if self.browser is None:
                self.browser = BrowserSession(self.sandbox, self._emit,
                                              quality=env.get("payload", {}).get("quality", "mid"))
                await self.browser.connect()
            await self.browser.start_screencast(env.get("payload", {}).get("quality"))
        except Exception as e:
            log.exception("preview start fail")
            await self._emit("error", {"code": "CDP-6001", "message": f"浏览器服务不可用：{e}"})

    async def ensure_sandbox(self):
        # 空闲超过 4 分钟的旧沙箱可能已被远端回收（envd 404），先探活，失败即重建
        if self.sandbox is not None and time.time() - self._sandbox_used > 240:
            try:
                await self.sandbox.run("true", timeout=10)
            except Exception:
                log.warning("沙箱已失效（可能被回收），重建 sid=%s", self.sid)
                self.sandbox = None
        if self.sandbox is None:
            await self._emit("session_status", {"status": "sandbox_creating"})
            self.sandbox = make_sandbox(self.s)
            await self._emit("session_status", {"status": "active", "sandboxId": self.sandbox.sandbox_id
                                                if hasattr(self.sandbox, "sandbox_id") else "mock"})
        self._sandbox_used = time.time()

    async def _emit(self, type_: str, payload: dict, **kw):
        await self.bus.publish_evt(self.sid, type_, payload, **kw)

    def kb(self):
        dsn = os.getenv("DATABASE_URL_DSN")  # postgresql://user:pass@host/db
        if not dsn:
            return None
        try:
            from gill_core.kb import KnowledgeBase
            meta = self.session_meta
            return KnowledgeBase(dsn, user_id=meta["user_id"], space_id=meta["space_id"],
                                 project_tag=meta.get("project_tag"), session_id=self.sid)
        except Exception as e:
            log.warning("kb unavailable: %s", e)
            return None

    def custom_instructions(self) -> str:
        ci = (self.session_meta or {}).get("custom_instructions")
        return f"\n\n[用户个人指令]\n{ci}" if ci else ""

    async def load_exts(self):
        """FR-10x：加载 http-tools 扩展 + skill 技能（注入 system）。"""
        dsn = os.getenv("DATABASE_URL_DSN")
        if not dsn:
            return None
        meta = self.session_meta or {}
        try:
            from gill_core.exts import load_enabled
            return await load_enabled(dsn, user_id=meta.get("user_id", 0), space_id=meta.get("space_id"))
        except Exception as e:
            log.warning("exts load fail: %s", e)
            return None

    async def load_skills(self) -> str:
        """FR-103 最小版：启用中的 skill 扩展 → system 注入块。"""
        dsn = os.getenv("DATABASE_URL_DSN")
        meta = self.session_meta or {}
        if not dsn or not meta.get("user_id"):
            return ""
        try:
            import asyncpg, json as _json
            conn = await asyncpg.connect(dsn)
            try:
                rows = await conn.fetch(
                    "SELECT name, manifest FROM extensions WHERE status='enabled' AND type='skill' "
                    "AND (user_id=$1 OR (visibility='space' AND space_id=$2::uuid))",
                    meta["user_id"], meta.get("space_id"))
            finally:
                await conn.close()
            blocks = []
            for r in rows:
                m = _json.loads(r["manifest"]) if isinstance(r["manifest"], str) else r["manifest"]
                sk = m.get("skill") or {}
                if sk.get("body_md"):
                    blocks.append(f"[技能：{r['name']}] {sk.get('description','')}\n{sk['body_md'][:1500]}")
            return ("\n\n".join(blocks))[:4000]
        except Exception as e:
            log.warning("skills load fail: %s", e)
            return ""

    async def handle_user_input(self, env: dict):
        text = env["payload"].get("text", "")
        actor = env.get("actor")
        if self.running.locked():
            await self._emit("error", {"code": "TASK-3001", "message": "已有任务进行中，请先停止或等待"}, cid=env.get("cid"))
            return
        # FR-92 显式记忆/遗忘指令（优先拦截，不过 LLM）
        kb = self.kb()
        if kb is not None:
            from gill_core.kb import REMEMBER_RE, FORGET_RE
            stripped = text.strip()
            if stripped == "/handoff" or stripped.startswith("交接") and len(stripped) < 10:
                # FR-140：交接摘要（LLM 基于 history 总结 → group/user 知识 + 会话消息）
                await self.ensure_sandbox() if False else None
                summary_prompt = ("基于以下对话历史，生成交接摘要：当前目标/已完成/待办/风险/关键文件路径，"
                                  "300 字以内中文。\n\n" + "\n".join(
                                      f"{m['role']}: {str(m.get('content'))[:200]}" for m in self.history[-12:]))
                try:
                    from gill_core.llm import LLM, SYSTEM_PROMPT
                    import time as _t
                    llm = LLM(self.s)
                    parts = []
                    async for kind, payload in llm.stream([{"role": "user", "content": summary_prompt}]):
                        if kind == "delta":
                            parts.append(payload)
                    summary = "".join(parts) or "（无摘要）"
                    await kb.save(title=f"交接·{_t.strftime('%m-%d %H:%M')}", content=summary,
                                  ktype="project", source="explicit", confidence=1.0)
                    await self._emit("kb_captured", {"titles": ["交接摘要"]})
                    await self._emit("done", {"status": "done", "rounds": 0, "answer": f"交接摘要已生成并存入知识库：\n{summary[:400]}", "tokens": {}})
                except Exception as e:
                    await self._emit("done", {"status": "failed", "rounds": 0, "answer": f"交接失败：{e}", "tokens": {}})
                return
            m = REMEMBER_RE.match(stripped)
            if m:
                r = await kb.save(title=m.group(1)[:30], content=m.group(1).strip(),
                                  ktype="fact", source="explicit", confidence=1.0)
                await self._emit("kb_captured", {"ids": [r["id"]], "titles": [m.group(1)[:30]]})
                await self._emit("done", {"status": "done", "rounds": 0, "answer": "已记住。", "tokens": {}})
                return
            m = FORGET_RE.match(stripped)
            if m:
                deleted = await kb.delete_matching(m.group(1).strip())
                names = "、".join(d["title"] for d in deleted) if deleted else "（无匹配）"
                await self._emit("done", {"status": "done", "rounds": 0,
                                          "answer": f"已删除 {len(deleted)} 条：{names}", "tokens": {}})
                return
        async with self.running:
            self.stop_requested = False
            await self.ensure_sandbox()

            # ---- 持久化收集器（messages / command_audit / llm_usage）----
            import time as _time
            audit_rows: list[dict] = []
            tool_msgs: list[dict] = []
            usage_acc = {"prompt": 0, "completion": 0}
            cur_cmd: dict | None = None

            async def emit(type_, payload):
                nonlocal cur_cmd
                if type_ == "tool_call":
                    t, a = payload.get("tool"), payload.get("args")
                    tool_msgs.append({"tool": t, "args": a})
                    if t == "shell":
                        cur_cmd = {"command": a.get("command", ""), "t0": _time.time()}
                elif type_ == "tool_result":
                    ec = payload.get("exit_code", -1)
                    if tool_msgs:
                        tool_msgs[-1]["result"] = {"exit_code": ec, "denied": bool(payload.get("denied"))}
                    if cur_cmd is not None:
                        audit_rows.append({**cur_cmd, "exit_code": ec,
                                           "duration_ms": int((_time.time() - cur_cmd["t0"]) * 1000)})
                        cur_cmd = None
                    elif payload.get("denied") and payload.get("command"):
                        # 被审批拦截的命令没有 tool_call 前置（cur_cmd 为空）：合规上必须留痕
                        audit_rows.append({"command": payload["command"], "t0": _time.time(),
                                           "exit_code": ec, "duration_ms": 0,
                                           "risk_level": payload.get("risk"), "decision": "denied"})
                elif type_ == "usage":
                    usage_acc["prompt"] += payload.get("prompt", 0)
                    usage_acc["completion"] += payload.get("completion", 0)
                await self._emit(type_, payload, actor=actor)

            async def approve(command, rule):
                """FR-38：真等待用户审批（cmd 流 approval_response，120s 超时拒绝）。"""
                cid = str(uuid.uuid4())
                ev = asyncio.Event()
                self.pending_approvals[cid] = {"event": ev, "result": None}
                await self._emit("approval_request", {"cid": cid, "command": command,
                                                      "riskLevel": rule.level, "reason": rule.reason,
                                                      "ruleId": rule.id, "expiresIn": 120})
                try:
                    await asyncio.wait_for(ev.wait(), timeout=120)
                    r = self.pending_approvals.pop(cid, {}).get("result") or "deny"
                except asyncio.TimeoutError:
                    self.pending_approvals.pop(cid, None)
                    await self._emit("approval_timeout", {"cid": cid})
                    r = "deny"
                if r == "always_allow":
                    self.always_ok_rules.add(rule.id)
                return r in ("approve", "always_allow")

            result = await run_task(text, self.s, emit, self.history,
                                    approve=approve if self.approval_mode == "suggest" else None,
                                    stop_flag=lambda: self.stop_requested,
                                    sandbox=self.sandbox, kb=kb,
                                    always_ok_rules=self.always_ok_rules,
                                    exts=await self.load_exts(),
                                    system_extra=(self.custom_instructions() + "\n\n" + await self.load_skills()).strip())
            await self._emit("done", {"status": result.status, "rounds": result.rounds,
                                      "tokens": result.tokens, "answer": result.answer})

            # ---- 任务结束：批量落库（尽力而为，失败不阻断）----
            try:
                dsn = os.getenv("DATABASE_URL_DSN")
                if dsn and actor:
                    from gill_core.store import Store
                    st = Store(dsn)
                    meta = self.session_meta or {}
                    sbx_id = getattr(self.sandbox, "sandbox_id", None)
                    seq = await st.next_seq(self.sid)
                    for tm in tool_msgs:
                        await st.append_message(self.sid, seq, "tool", "", actor=actor,
                                                tool_name=tm["tool"], tool_args=tm.get("args"),
                                                tool_result=tm.get("result"))
                        seq += 1
                    if result.answer:
                        await st.append_message(self.sid, seq, "assistant", result.answer, actor=actor)
                    for ar in audit_rows:
                        await st.audit_command(self.sid, meta.get("space_id"), actor, sbx_id,
                                               ar["command"], ar["exit_code"], ar["duration_ms"],
                                               risk_level=ar.get("risk_level"), decision=ar.get("decision"))
                    await st.record_usage(actor, self.sid, self.s.zhipu_model,
                                          usage_acc["prompt"], usage_acc["completion"])
                    await st.close()
            except Exception:
                log.exception("persist fail sid=%s", self.sid)

    async def loop(self):
        await self.bus.acquire_lease(self.sid, NODE)
        log.info("session runtime up: %s", self.sid)
        try:
            while True:
                try:
                    await self.bus.renew_lease(self.sid, NODE)
                    env = await self.bus.consume_cmd(self.sid, block_ms=1000)
                except Exception as e:
                    log.exception("consume error sid=%s", self.sid)
                    await asyncio.sleep(1)
                    continue
                if env is None:
                    continue
                t = env["type"]
                if t == "user_input":
                    try:
                        await self.handle_user_input(env)
                    except Exception:
                        log.exception("task error sid=%s", self.sid)
                        await self._emit("error", {"code": "SYS-9001", "message": "任务执行异常，请重试"})
                elif t == "stop":
                    self.stop_requested = True
                elif t == "approval_response":
                    p = env.get("payload", {})
                    slot = self.pending_approvals.get(p.get("cid"))
                    if slot:
                        slot["result"] = p.get("action", "deny")
                        slot["event"].set()
                elif t == "set_approval":
                    self.approval_mode = env.get("payload", {}).get("value", "auto")
                    await self._emit("session_status", {"status": "approval_mode", "mode": self.approval_mode})
                elif t == "preview_start":
                    await self.handle_preview_start(env)
                elif t == "preview_stop":
                    if self.browser:
                        await self.browser.stop_screencast()
                elif t == "input_event":
                    if self.browser:
                        if self.op_mode == "relay" and self.op_holder is not None and env.get("actor") != self.op_holder:
                            await self._emit("error", {"code": "OP-423", "message": "接力模式下仅操作权持有者可交互"})
                        else:
                            try:
                                await self.browser.input_event(env.get("payload", {}))
                            except Exception as e:
                                log.warning("input_event err: %s", e)
                elif t == "browser_navigate":
                    if self.browser:
                        await self.browser.navigate(env["payload"].get("url", "about:blank"))
                elif t == "op_lock":               # FR-135 操作权（自由/接力）
                    p = env.get("payload", {})
                    act = p.get("action")
                    if act == "mode":
                        self.op_mode = p.get("mode", "free")
                        await self._emit("op_lock_changed", {"mode": self.op_mode, "holder": None})
                    elif act == "acquire" and self.op_mode == "relay":
                        if not self.op_holder:
                            self.op_holder = env.get("actor")
                            await self._emit("op_lock_changed", {"mode": "relay", "holder": self.op_holder})
                    elif act == "release":
                        self.op_holder = None
                        await self._emit("op_lock_changed", {"mode": self.op_mode, "holder": None})
                elif t == "space_chat":            # FR-137 成员聊天（@agent 转任务）
                    p = env.get("payload", {})
                    text = p.get("text", "")
                    if text.startswith("@agent"):
                        rest = text[5:].strip()
                        if rest:
                            await self.bus.push_cmd(self.sid, "user_input", {"text": rest}, actor=env.get("actor"))
                    else:
                        await self._emit("space_chat_msg", {"userId": env.get("actor"),
                                                            "text": text[:500]})
                elif t == "nav_follow":          # FR-139 演示模式：URL 广播（agentd 中转回 evt 流扇出所有端）
                    await self._emit("nav_follow", env.get("payload", {}))
                elif t == "file_sync_in":
                    await self.handle_file_sync_in(env)
                elif t == "file_export":
                    await self.handle_file_export(env)
                elif t == "file_list":
                    await self.handle_file_list(env)
                elif t == "session_close":
                    break
        finally:
            if self.browser:
                try:
                    await self.browser.close()
                except Exception:
                    pass
            if self.sandbox:
                try:
                    await self.sandbox.kill()
                except Exception:
                    pass
            await self.bus.release_lease(self.sid)
            log.info("session runtime down: %s", self.sid)


class AgentDaemon:
    def __init__(self):
        self.settings = Settings.load()
        self.bus = Bus(os.getenv("REDIS_URL", "redis://localhost:6379"))
        self.runtimes: dict[str, SessionRuntime] = {}

    def get_runtime(self, sid: str, meta: dict | None = None) -> SessionRuntime:
        rt = self.runtimes.get(sid)
        if rt is None or rt.task is None or rt.task.done():
            rt = SessionRuntime(self.bus, self.settings, sid)
            rt.session_meta = meta or {}
            rt.task = asyncio.create_task(rt.loop())
            self.runtimes[sid] = rt
        elif meta:
            rt.session_meta = meta
        return rt

    async def sweep(self):
        """孤儿沙箱清扫（FR-23 兜底）：每 5 分钟对照 PG 会话表，直接经 Cube API kill
        无主/已关闭/超时空闲的沙箱——不依赖 cmd 流（泄漏根治）。"""
        import httpx, asyncpg, datetime
        dsn = os.getenv("DATABASE_URL_DSN")
        while True:
            await asyncio.sleep(300)
            try:
                s = Settings()
                api, key = s.cube_api_url, s.e2b_api_key
                async with httpx.AsyncClient(trust_env=False, timeout=20) as c:
                    r = await c.get(api + "/sandboxes", headers={"X-API-Key": key})
                    r.raise_for_status()
                    sandboxes = r.json()
                if not sandboxes or not dsn:
                    continue
                conn = await asyncpg.connect(dsn)
                try:
                    rows = await conn.fetch(
                        "SELECT id::text, status, last_active_at FROM sessions WHERE sandbox_id IS NOT NULL")
                finally:
                    await conn.close()
                by_sid = {r_["id"]: r_ for r_ in rows}
                killed = 0
                async with httpx.AsyncClient(trust_env=False, timeout=20) as c:
                    for sb in sandboxes:
                        sid = sb.get("sandboxID")
                        row = by_sid.get(sid)
                        orphan = row is None
                        closed = row is not None and row["status"] in ("closed", "closing", "archived")
                        idle = row is not None and row["last_active_at"] is not None and \
                               (datetime.datetime.now(datetime.timezone.utc) - row["last_active_at"]).total_seconds() > 1800
                        if orphan or closed or idle:
                            try:
                                await c.delete(f"{api}/sandboxes/{sid}", headers={"X-API-Key": key})
                                killed += 1
                            except Exception:
                                pass
                if killed:
                    log.info("sweep: killed %d orphan/closed/idle sandboxes", killed)
            except Exception as e:
                log.warning("sweep fail: %s", e)

    async def main(self):
        from fastapi import FastAPI
        import uvicorn

        asyncio.create_task(self.sweep())
        app = FastAPI(title="gill-agentd")

        @app.get("/healthz")
        async def healthz():
            return {"ok": True, "node": NODE, "sessions": len(self.runtimes)}

        @app.post("/internal/sessions/{sid}/start")
        async def start_session(sid: str, body: dict | None = None):
            self.get_runtime(sid, (body or {}).get("meta"))
            return {"ok": True}

        @app.post("/internal/sessions/{sid}/cmd")
        async def push_cmd(sid: str, body: dict):
            t = body["type"]
            # 快速通道：审批响应/档位切换 直接作用于 runtime（避免被任务循环阻塞造成死锁）
            if t in ("approval_response", "set_approval", "presence_join", "presence_leave"):
                rt = self.runtimes.get(sid)
                if rt:
                    if t == "approval_response":
                        p = body.get("payload", {})
                        slot = rt.pending_approvals.get(p.get("cid"))
                        if slot:
                            slot["result"] = p.get("action", "deny")
                            slot["event"].set()
                    elif t == "set_approval":
                        rt.approval_mode = body.get("payload", {}).get("value", "auto")
                        await rt.bus.publish_evt(sid, "session_status", {"status": "approval_mode", "mode": rt.approval_mode})
                    else:   # presence_join / presence_leave
                        p = body.get("payload", {})
                        uid = p.get("userId")
                        if t == "presence_join" and uid is not None:
                            rt.present[uid] = rt.present.get(uid, 0) + 1
                        elif t == "presence_leave" and uid is not None:
                            rt.present[uid] = max(0, rt.present.get(uid, 0) - 1)
                            if rt.present[uid] == 0:
                                rt.present.pop(uid, None)
                        await rt.bus.publish_evt(sid, "presence_update", {"members": list(rt.present.keys())})
                    return {"ok": True}
            await self.bus.push_cmd(sid, t, body.get("payload", {}),
                                    cid=body.get("cid"), actor=body.get("actor"))
            if t == "user_input":
                self.get_runtime(sid)
            return {"ok": True}

        # 开发期便捷：SSE 订阅事件流（生产 web 走 Bus.read_evt）
        from fastapi.responses import StreamingResponse

        @app.get("/internal/sessions/{sid}/events")
        async def events(sid: str, last_id: str = "$"):
            async def gen():
                cur = last_id
                while True:
                    cur, env = await self.bus.read_evt(sid, cur, block_ms=15000)
                    if env:
                        yield f"data: {__import__('json').dumps(env, ensure_ascii=False)}\n\n"
                    else:
                        yield ": keepalive\n\n"
            return StreamingResponse(gen(), media_type="text/event-stream")

        port = int(os.getenv("AGENTD_PORT", "8000"))
        log.info("agentd %s listening :%s (redis=%s)", NODE, port, os.getenv("REDIS_URL"))
        config = uvicorn.Config(app, host="0.0.0.0", port=port, log_level="warning")
        server = uvicorn.Server(config)
        await server.serve()


def main():
    asyncio.run(AgentDaemon().main())


if __name__ == "__main__":
    main()
