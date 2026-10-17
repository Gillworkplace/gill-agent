"""agentd — Agent 常驻服务：会话运行时（总线命令 → gill_core 任务循环 → 事件回发）。"""
from __future__ import annotations
import asyncio
import logging
import os
import uuid

from gill_core.bus import Bus
from gill_core.config import Settings
from gill_core.loop import run_task
from gill_core.sandbox import BaseSandbox, make_sandbox

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger("agentd")

NODE = os.getenv("NODE_ID", f"agentd-{uuid.uuid4().hex[:6]}")


class SessionRuntime:
    """一个会话 = 一个命令消费循环 + 一个懒创建沙箱 + 会话历史。"""

    def __init__(self, bus: Bus, settings: Settings, sid: str):
        self.bus, self.s, self.sid = bus, settings, sid
        self.sandbox: BaseSandbox | None = None
        self.history: list[dict] = []
        self.running = asyncio.Lock()      # FR-37 同会话单任务
        self.stop_requested = False
        self.task: asyncio.Task | None = None

    async def ensure_sandbox(self):
        if self.sandbox is None:
            await self._emit("session_status", {"status": "sandbox_creating"})
            self.sandbox = make_sandbox(self.s)
            await self._emit("session_status", {"status": "active", "sandboxId": self.sandbox.sandbox_id
                                                if hasattr(self.sandbox, "sandbox_id") else "mock"})

    async def _emit(self, type_: str, payload: dict, **kw):
        await self.bus.publish_evt(self.sid, type_, payload, **kw)

    async def handle_user_input(self, env: dict):
        text = env["payload"].get("text", "")
        actor = env.get("actor")
        if self.running.locked():
            await self._emit("error", {"code": "TASK-3001", "message": "已有任务进行中，请先停止或等待"}, cid=env.get("cid"))
            return
        async with self.running:
            self.stop_requested = False
            await self.ensure_sandbox()

            async def emit(type_, payload):
                await self._emit(type_, payload, actor=actor)

            async def approve(command, rule):
                # CLI/简化审批：通过 cmd 流询问 web 侧（一期 agentd 内直接放行 auto 档；suggest 由 web 侧 ws 网关实现转发）
                await self._emit("approval_request", {"cid": str(uuid.uuid4()), "command": command,
                                                      "riskLevel": rule.level, "reason": rule.reason, "ruleId": rule.id})
                # 单机阶段：web 未实现审批 UI 前默认拒绝高危（安全优先）
                return False

            result = await run_task(text, self.s, emit, self.history,
                                    approve=approve if self.s.approval == "suggest" else None,
                                    stop_flag=lambda: self.stop_requested,
                                    sandbox=self.sandbox)
            await self._emit("done", {"status": result.status, "rounds": result.rounds,
                                      "tokens": result.tokens, "answer": result.answer})

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
                elif t == "session_close":
                    break
        finally:
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

    def get_runtime(self, sid: str) -> SessionRuntime:
        rt = self.runtimes.get(sid)
        if rt is None or rt.task is None or rt.task.done():
            rt = SessionRuntime(self.bus, self.settings, sid)
            rt.task = asyncio.create_task(rt.loop())
            self.runtimes[sid] = rt
        return rt

    async def main(self):
        from fastapi import FastAPI
        import uvicorn

        app = FastAPI(title="gill-agentd")

        @app.get("/healthz")
        async def healthz():
            return {"ok": True, "node": NODE, "sessions": len(self.runtimes)}

        @app.post("/internal/sessions/{sid}/start")
        async def start_session(sid: str):
            self.get_runtime(sid)
            return {"ok": True}

        @app.post("/internal/sessions/{sid}/cmd")
        async def push_cmd(sid: str, body: dict):
            await self.bus.push_cmd(sid, body["type"], body.get("payload", {}),
                                    cid=body.get("cid"), actor=body.get("actor"))
            if body["type"] == "user_input":
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
