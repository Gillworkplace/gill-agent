"""团队执行进程：有限并发领取持久工作项，控制与模型调用互不阻塞。"""
from __future__ import annotations
import asyncio
import logging
import os
import uuid
import httpx
from .config import Settings
from .team_client import TeamClient
from .team_local_sandbox import LocalWorker
from .team_turns import TeamTurn

log = logging.getLogger(__name__)


async def run_team_workers(settings: Settings, local: LocalWorker | None = None,
                           server: str | None = None, slots: int | None = None) -> None:
    """
    Start configured execution slots against the Java transaction gateway.

    :param settings: Existing project model and sandbox configuration.
    :param local: Explicit CLI project and directory binding, if running on the operator's machine.
    :param server: Gateway URL supplied by the logged-in CLI.
    :param slots: Explicit local concurrency limit.
    """
    secret = os.getenv("GILL_TEAM_WORKER_SECRET", "")
    if len(secret) < 32:
        log.info("team workers disabled: service credential not configured")
        return
    slots = max(1, min(slots or int(os.getenv("GILL_TEAM_WORKER_SLOTS", "3")), 16))
    base = server or os.getenv("GILL_TEAM_WEB_URL", "http://web:8080")
    process = uuid.uuid4().hex[:12]
    await asyncio.gather(*[_slot(settings, base, secret, f"team-{process}-{i}", local) for i in range(slots)])


async def _slot(settings: Settings, base: str, secret: str, identifier: str, local: LocalWorker | None) -> None:
    client = TeamClient(base, secret, identifier)
    try:
        while True:
            try:
                job = await client.claim(local)
                if job:
                    if local:
                        log.info("CLI job workspace: %s", local.directory / ".gill" / "workspaces" / job["id"] / "workspace")
                    await TeamTurn(client, settings, job, local).run()
                else:
                    await asyncio.sleep(2)
            except asyncio.CancelledError:
                raise
            except httpx.HTTPStatusError as error:
                if local and error.response.status_code in {401, 403, 409, 422}:
                    raise
                log.warning("team worker rejected status=%s", error.response.status_code)
                await asyncio.sleep(5)
            except Exception as error:
                log.warning("team worker unavailable type=%s", type(error).__name__)
                await asyncio.sleep(5)
    finally:
        await client.close()
