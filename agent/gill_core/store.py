"""持久化（LLD store.py）：messages（assistant/tool）/ command_audit / llm_usage。"""
from __future__ import annotations
import json
import logging

log = logging.getLogger("gill.store")


class Store:
    def __init__(self, dsn: str):
        self.dsn = dsn
        self._pool = None

    async def pool(self):
        if self._pool is None:
            import asyncpg
            self._pool = await asyncpg.create_pool(self.dsn, min_size=1, max_size=4)
        return self._pool

    async def close(self):
        if self._pool:
            await self._pool.close()

    async def next_seq(self, sid: str) -> int:
        pool = await self.pool()
        async with pool.acquire() as c:
            v = await c.fetchval("SELECT COALESCE(MAX(seq),0)+1 FROM messages WHERE session_id=$1::uuid", sid)
            return int(v or 1)

    async def append_message(self, sid: str, seq: int, role: str, content: str,
                             actor: int | None = None, tool_name: str | None = None,
                             tool_args=None, tool_result=None, trace_id: str | None = None):
        pool = await self.pool()
        async with pool.acquire() as c:
            await c.execute(
                """INSERT INTO messages(session_id, seq, role, content, actor_user_id,
                     tool_name, tool_args, tool_result, trace_id)
                   VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9)""",
                sid, seq, role, content, actor, tool_name,
                json.dumps(tool_args, ensure_ascii=False) if tool_args else None,
                json.dumps(tool_result, ensure_ascii=False) if tool_result else None, trace_id)

    async def audit_command(self, sid: str, space_id: str | None, user_id: int, sandbox_id: str | None,
                            command: str, exit_code: int, duration_ms: int,
                            risk_level: str | None = None, decision: str | None = None):
        pool = await self.pool()
        async with pool.acquire() as c:
            await c.execute(
                """INSERT INTO command_audit(session_id, space_id, user_id, sandbox_id,
                     command, exit_code, duration_ms, risk_level, decision)
                   VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8,$9)""",
                sid, space_id, user_id, sandbox_id, command[:8000], exit_code, duration_ms,
                risk_level, decision)

    async def record_usage(self, user_id: int, sid: str, model: str, prompt: int, completion: int):
        if prompt <= 0 and completion <= 0:
            return
        pool = await self.pool()
        async with pool.acquire() as c:
            await c.execute(
                "INSERT INTO llm_usage(user_id, session_id, model, prompt_tokens, completion_tokens) VALUES ($1,$2::uuid,$3,$4,$5)",
                user_id, sid, model, prompt, completion)
