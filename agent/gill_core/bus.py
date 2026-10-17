"""Redis 实时总线（简化实现，多副本就绪）：
- cmd 流：gill:cmd:{sid}（web→agentd，消费者组）
- evt 流：gill:evt:{sid}（agentd→web）
- lease：gill:lease:{sid}（会话所有权，单副本阶段简化为直接持有）
信封：{type, cid, ts, actor, payload}
"""
from __future__ import annotations
import asyncio
import json
import time
import uuid
import logging

log = logging.getLogger("gill.bus")

MAXLEN = 10_000


def envelope(type_: str, payload: dict, cid: str | None = None, actor: str | None = None) -> dict:
    return {"type": type_, "cid": cid, "ts": time.time(), "actor": actor, "payload": payload}


class Bus:
    def __init__(self, url: str):
        import redis.asyncio as aioredis
        self.r = aioredis.from_url(url, decode_responses=True)
        self.group_created: set[str] = set()

    # ---- cmd（agentd 消费） ----
    async def _ensure_group(self, sid: str):
        key = f"gill:cmd:{sid}"
        if key not in self.group_created:
            try:
                await self.r.xgroup_create(key, "agentd", id="0", mkstream=True)
            except Exception:
                pass  # BUSYGROUP
            self.group_created.add(key)

    async def push_cmd(self, sid: str, type_: str, payload: dict, cid: str | None = None, actor: str | None = None):
        await self.r.xadd(f"gill:cmd:{sid}", {"v": json.dumps(envelope(type_, payload, cid, actor), ensure_ascii=False)})

    async def consume_cmd(self, sid: str, block_ms: int = 1000):
        """读一条待处理命令（不含 pending 重链——单副本阶段够用；XAUTOCLAIM 见 TODO SCALE）。"""
        await self._ensure_group(sid)
        resp = await self.r.xreadgroup("agentd", f"c-{sid}", {f"gill:cmd:{sid}": ">"}, count=1, block=block_ms)
        if not resp:
            return None
        _, entries = resp[0]
        if not entries:
            return None
        entry_id, fields = entries[0]
        await self.r.xack(f"gill:cmd:{sid}", "agentd", entry_id)
        env = json.loads(fields["v"])
        return env

    # ---- evt（agentd 发布 / web 消费） ----
    async def publish_evt(self, sid: str, type_: str, payload: dict, cid: str | None = None, actor: str | None = None):
        await self.r.xadd(f"gill:evt:{sid}", {"v": json.dumps(envelope(type_, payload, cid, actor), ensure_ascii=False)}, maxlen=MAXLEN)

    async def read_evt(self, sid: str, last_id: str = "$", block_ms: int = 1000):
        """web 侧消费：返回 (next_id, envelope | None)。"""
        key = f"gill:evt:{sid}"
        resp = await self.r.xread({key: last_id}, count=10, block=block_ms)
        if not resp:
            return last_id, None
        _, entries = resp[0]
        if not entries:
            return last_id, None
        entry_id, fields = entries[-1]
        return entry_id, json.loads(fields["v"])

    # ---- lease ----
    async def acquire_lease(self, sid: str, node: str) -> bool:
        return bool(await self.r.set(f"gill:lease:{sid}", node, nx=True, px=30_000))

    async def renew_lease(self, sid: str, node: str):
        # 简化续期：仅当仍持有
        await self.r.set(f"gill:lease:{sid}", node, xx=True, px=30_000)

    async def release_lease(self, sid: str):
        await self.r.delete(f"gill:lease:{sid}")

    async def close(self):
        await self.r.aclose()
