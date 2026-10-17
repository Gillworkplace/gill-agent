"""扩展运行时（FR-101~109）：HTTP 工具 + 脚本工具 + 技能注入（由 agentd 侧处理）。

manifest（extensions.manifest JSONB）格式：
http-tools:  {"tools": [{"name", "desc", "method", "url", "params", "auth", "network"}]}
script-tools: {"tools": [{"name", "desc", "code"(python 源码), "params": {k: {"type","desc"}}}]}
"""
from __future__ import annotations
import json
import logging
from urllib.parse import urlparse

log = logging.getLogger("gill.exts")


async def load_enabled(pg_dsn: str, user_id: int, space_id: str | None):
    """查用户启用的 http-tools + script-tools 扩展 → 返回 [(ext_name, manifest)]。"""
    import asyncpg, json as _json
    conn = await asyncpg.connect(pg_dsn)
    try:
        rows = await conn.fetch(
            "SELECT name, manifest FROM extensions WHERE status='enabled' "
            "AND (user_id=$1 OR (visibility='space' AND space_id=$2::uuid)) "
            "AND type IN ('http-tools','script-tools')",
            user_id, space_id)
        out = []
        for r in rows:
            m = r["manifest"]
            out.append((r["name"], _json.loads(m) if isinstance(m, str) else m))
        return out
    finally:
        await conn.close()


def tool_schemas(exts) -> list[dict]:
    """扩展（http + script）→ LLM 工具 schema（命名空间 ext_{ext}_{tool}，FR-108）。"""
    out = []
    for ext_name, m in exts:
        for t in (m.get("tools") or []):
            props = {k: {"type": v.get("type", "string"), "description": v.get("desc", "")}
                     for k, v in (t.get("params") or {}).items()}
            out.append({"type": "function", "function": {
                "name": f"ext_{ext_name}_{t['name']}",
                "description": t.get("desc", t["name"]),
                "parameters": {"type": "object", "properties": props}}})
    return out


async def execute_script(sandbox, exts, tool_name: str, args: dict, emit=None) -> str:
    """FR-102：脚本工具——用户提供的 Python 在沙箱内执行（json 参数经 argv 传入）。"""
    import shlex, json as _json
    for ext_name, m in exts:
        for t in (m.get("tools") or []):
            if f"ext_{ext_name}_{t['name']}" != tool_name:
                continue
            code = t.get("code") or ""
            if not code or len(code) > 64_000:
                return _json.dumps({"error": "脚本为空或超限（64KB）"}, ensure_ascii=False)
            path = f"/home/user/.gill-ext/{ext_name}_{t['name']}.py"
            import base64
            b64 = base64.b64encode(code.encode()).decode()
            argv = shlex.quote(_json.dumps(args, ensure_ascii=False))
            sh = (f"mkdir -p /home/user/.gill-ext && printf %s {shlex.quote(b64)} | base64 -d > {shlex.quote(path)} "
                  f"&& python3 {shlex.quote(path)} {argv}")
            r = await sandbox.run(sh, timeout=60)
            if emit:
                await emit("tool_result", {"tool": tool_name, "exit_code": r.exit_code})
            return (r.stdout or r.stderr or "")[:65536] or _json.dumps({"ok": True, "exit": r.exit_code})
    return _json.dumps({"error": f"unknown script tool {tool_name}"}, ensure_ascii=False)


async def execute_http(sandbox, exts, tool_name: str, args: dict, emit=None) -> str:
    """在沙箱内 curl 执行扩展工具（FR-101：域名白名单管控）。"""
    for ext_name, m in exts:
        for t in (m.get("tools") or []):
            full = f"ext_{ext_name}_{t['name']}"
            if full != tool_name:
                continue
            # 域名白名单（FR-107）
            host = urlparse(t["url"]).hostname or ""
            allowed = t.get("network") or m.get("network") or []
            if host not in allowed:
                return json.dumps({"error": f"域名 {host} 未在扩展白名单 {allowed} 中，请在扩展配置 network 声明"}, ensure_ascii=False)
            # URL 模板渲染
            url = t["url"]
            for k, v in args.items():
                url = url.replace("{" + k + "}", str(v))
            cmd = ["curl", "-sS", "-m", "30", "-X", t.get("method", "GET"), url]
            auth = t.get("auth") or {}
            if auth.get("type") == "header":
                cmd += ["-H", f"{auth.get('name', 'Authorization')}: {auth['value']}"]
            if t.get("method", "GET") not in ("GET",):
                cmd += ["-H", "Content-Type: application/json", "-d", json.dumps(args)]
            sh = " ".join(f"'{c}'" if " " in str(c) or '"' in str(c) else str(c) for c in cmd)
            r = await sandbox.run(sh, timeout=35)
            body = (r.stdout or r.stderr or "")[:65536]
            if emit:
                await emit("tool_result", {"tool": tool_name, "exit_code": r.exit_code})
            return body[:65536] if r.exit_code == 0 else json.dumps(
                {"error": f"curl exit {r.exit_code}", "body": body[:2000]}, ensure_ascii=False)
    return json.dumps({"error": f"unknown extension tool {tool_name}"})
