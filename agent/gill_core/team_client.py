"""带服务身份与执行租约的团队事务客户端。"""
from __future__ import annotations
import asyncio
import json
import httpx


class TeamClient:
    """Keep privileged HTTP credentials outside model and sandbox contexts."""

    def __init__(self, base_url: str, secret: str, worker_id: str) -> None:
        """
        Initialize the internal protocol client.

        :param base_url: Java gateway base URL.
        :param secret: Internal service credential.
        :param worker_id: Stable worker process identifier.
        """
        self.worker_id = worker_id
        self.http = httpx.AsyncClient(base_url=base_url.rstrip("/") + "/internal/team-worker/",
                                      headers={"X-Team-Worker-Secret": secret}, timeout=20, trust_env=False)

    async def claim(self) -> dict:
        """
        Claim one durable work item.

        :returns: Work item fields, or an empty dictionary when no item is eligible.
        """
        response = await self.http.post("claim", json={"workerId": self.worker_id})
        response.raise_for_status()
        result = response.json()
        for key in ("payload", "checkpoint"):
            if isinstance(result.get(key), str):
                result[key] = json.loads(result[key])
        return result

    async def operation(self, job: dict, operation: str, **payload) -> dict:
        """
        Submit a fenced job operation.

        :param job: Leased work item containing id and fence.
        :param operation: Registered internal operation name.
        :param payload: Operation-specific fields, excluding trusted worker identity.
        :returns: Committed response dictionary.
        :raises httpx.HTTPStatusError: When the server rejects identity, state or arguments.
        """
        body = {**payload, "workerId": self.worker_id, "fence": job["fence"]}
        for attempt in range(2):
            try:
                response = await self.http.post(f"jobs/{job['id']}/{operation}", json=body)
                self._check(response)
                return response.json()
            except httpx.TransportError:
                if attempt:
                    raise
                await asyncio.sleep(0.2)
        raise RuntimeError("Unreachable retry state")

    def _check(self, response: httpx.Response) -> None:
        if response.is_success:
            return
        try:
            data = response.json()
        except ValueError:
            data = {}
        error = data.get("error", {}) if isinstance(data, dict) else {}
        message = error.get("message") if isinstance(error, dict) else None
        if isinstance(message, str):
            raise httpx.HTTPStatusError(f"HTTP {response.status_code}: {message[:900]}",
                                        request=response.request, response=response)
        response.raise_for_status()

    async def close(self) -> None:
        """Close HTTP connections."""
        await self.http.aclose()
