"""扩展运行时（FR-101~109）：HTTP 工具 + 脚本工具 + MCP 服务器 + 密钥解密。

manifest（extensions.manifest JSONB）：
http-tools:   {"tools": [{"name","desc","method","url","params","auth":{"value"},"network"}]}
script-tools: {"tools": [{"name","desc","code","params"}]}
mcp:          {"mcp": {"url": "http://host/mcp", "headers": {...}}}   ← 加载时拉取工具清单合成 tools
技能(skill)由 agentd 侧直接注入 system，不经本模块。
密钥（auth.value / headers.Authorization）以 "gsec:{nonce_b64}:{ct_b64}" 自包含密文存储，此处解密。
"""
from __future__ import annotations
import base64
import json
import logging
import time
from urllib.parse import urlparse

log = logging.getLogger("gill.exts")

_MCP_CACHE: dict[str, tuple[float, list[dict]]] = {}   # url -> (expires, tools)
_MCP_TTL = 60


# ---------- 密钥解密（AES-GCM，共享密钥 env EXT_SECRET，与 web 侧加密对称） ----------
def decrypt_secret(token: str) -> str:
    if not token.startswith("gsec:"):
        return token
    import os
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    key = bytes.fromhex(os.getenv("EXT_SECRET", "") or "0" * 64)
    _, nonce_b64, ct_b64 = token.split(":", 2)
    nonce, ct = base64.b64decode(nonce_b64), base64.b64decode(ct_b64)
    return AESGCM(key).decrypt(nonce, ct, None).decode()


def _decrypt_manifest_secrets(m: dict) -> dict:
    def walk(v):
        if isinstance(v, dict):
            return {k: (decrypt_secret(x) if k in ("value", "Authorization", "X-Api-Key") and isinstance(x, str) else walk(x))
                    for k, x in v.items()}
        if isinstance(v, list):
            return [walk(x) for x in v]
        return v
    return walk(m)


# ---------- MCP（Streamable HTTP JSON-RPC） ----------
async def _mcp_call(url: str, headers: dict, method: str, params: dict) -> dict:
    import httpx
    body = {"jsonrpc": "2.0", "id": int(time.time() * 1000) % 100000, "method": method, "params": params}
    async with httpx.AsyncClient(trust_env=False, timeout=25) as c:
        r = await c.post(url, json=body, headers={"Content-Type": "application/json", **headers})
        r.raise_for_status()
        return r.json()


async def _mcp_list_tools(url: str, headers: dict) -> list[dict]:
    now = time.time()
    cached = _MCP_CACHE.get(url)
    if cached and cached[0] > now:
        return cached[1]
    await _mcp_call(url, headers, "initialize",
                    {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "gill", "version": "1.0"}})
    resp = await _mcp_call(url, headers, "tools/list", {})
    tools = resp.get("result", {}).get("tools", [])
    _MCP_CACHE[url] = (now + _MCP_TTL, tools)
    return tools


async def _mcp_invoke(url: str, headers: dict, tool: str, args: dict) -> str:
    resp = await _mcp_call(url, headers, "tools/call", {"name": tool, "arguments": args})
    result = resp.get("result", {})
    texts = [c.get("text", "") for c in result.get("content", []) if c.get("type") == "text"]
    return ("\n".join(texts) or json.dumps(result, ensure_ascii=False))[:65536]


async def load_enabled(pg_dsn: str, user_id: int, space_id: str | None):
    """加载 http-tools / script-tools / mcp 扩展 → [(ext_name, manifest)]。
    MCP 类型在加载期拉取远端工具清单，合成为统一 tools 结构（_mcp_src 标记执行路径）。"""
    import asyncpg
    conn = await asyncpg.connect(pg_dsn)
    try:
        rows = await conn.fetch(
            "SELECT name, manifest FROM extensions WHERE status='enabled' "
            "AND (user_id=$1 OR (visibility='space' AND space_id=$2::uuid)) "
            "AND type IN ('http-tools','script-tools','mcp')",
            user_id, space_id)
    finally:
        await conn.close()
    out = []
    for r in rows:
        m = r["manifest"]
        m = json.loads(m) if isinstance(m, str) else m
        m = _decrypt_manifest_secrets(m)
        if "mcp" in m:
            cfg = m["mcp"]
            try:
                remote = await _mcp_list_tools(cfg["url"], cfg.get("headers") or {})
                tools = []
                for t in remote:
                    sch = t.get("inputSchema") or {"type": "object", "properties": {}}
                    tools.append({"name": t["name"], "desc": t.get("description", ""),
                                  "params": sch.get("properties", {}),
                                  "_mcp_src": {"url": cfg["url"], "headers": cfg.get("headers") or {}}})
                m = {"tools": tools}
                log.info("mcp %s: %d tools", r["name"], len(tools))
            except Exception as e:
                log.warning("mcp %s unreachable: %s", r["name"], e)
                continue   # 离线标红（跳过加载，工具面摘除）
        out.append((r["name"], m))
    return out


def tool_schemas(exts) -> list[dict]:
    out = []
    for ext_name, m in exts:
        for t in (m.get("tools") or []):
            props = {k: ({"type": v.get("type", "string"), "description": v.get("description", v.get("desc", ""))}
                         if isinstance(v, dict) else {"type": "string"})
                     for k, v in (t.get("params") or {}).items()}
            out.append({"type": "function", "function": {
                "name": f"ext_{ext_name}_{t['name']}",
                "description": t.get("desc", t["name"]),
                "parameters": {"type": "object", "properties": props}}})
    return out


# ---------- 执行 ----------
async def execute_script(sandbox, exts, tool_name: str, args: dict, emit=None) -> str:
    import shlex
    for ext_name, m in exts:
        for t in (m.get("tools") or []):
            if f"ext_{ext_name}_{t['name']}" != tool_name:
                continue
            code = t.get("code") or ""
            if not code or len(code) > 64_000:
                return json.dumps({"error": "脚本为空或超限（64KB）"}, ensure_ascii=False)
            path = f"/home/user/.gill-ext/{ext_name}_{t['name']}.py"
            b64 = base64.b64encode(code.encode()).decode()
            argv = shlex.quote(json.dumps(args, ensure_ascii=False))
            sh = (f"mkdir -p /home/user/.gill-ext && printf %s {shlex.quote(b64)} | base64 -d > {shlex.quote(path)} "
                  f"&& python3 {shlex.quote(path)} {argv}")
            r = await sandbox.run(sh, timeout=60)
            if emit:
                await emit("tool_result", {"tool": tool_name, "exit_code": r.exit_code})
            return (r.stdout or r.stderr or "")[:65536] or json.dumps({"ok": True, "exit": r.exit_code})
    return json.dumps({"error": f"unknown script tool {tool_name}"}, ensure_ascii=False)


async def execute_mcp(exts, tool_name: str, args: dict, emit=None) -> str:
    for ext_name, m in exts:
        for t in (m.get("tools") or []):
            if f"ext_{ext_name}_{t['name']}" == tool_name and t.get("_mcp_src"):
                try:
                    out = await _mcp_invoke(t["_mcp_src"]["url"], t["_mcp_src"]["headers"], t["name"], args)
                    if emit:
                        await emit("tool_result", {"tool": tool_name, "exit_code": 0})
                    return out
                except Exception as e:
                    if emit:
                        await emit("tool_result", {"tool": tool_name, "exit_code": -1})
                    return json.dumps({"error": f"MCP 调用失败：{e}"}, ensure_ascii=False)
    return json.dumps({"error": f"unknown mcp tool {tool_name}"}, ensure_ascii=False)


async def execute_http(sandbox, exts, tool_name: str, args: dict, emit=None) -> str:
    import shlex
    for ext_name, m in exts:
        for t in (m.get("tools") or []):
            full = f"ext_{ext_name}_{t['name']}"
            if full != tool_name:
                continue
            host = urlparse(t["url"]).hostname or ""
            allowed = t.get("network") or m.get("network") or []
            if host not in allowed:
                return json.dumps({"error": f"域名 {host} 未在扩展白名单 {allowed} 中，请在扩展配置 network 声明"}, ensure_ascii=False)
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
