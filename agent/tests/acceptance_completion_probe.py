"""Verify final-report completion against an isolated real gateway without model calls."""
from __future__ import annotations

import asyncio
import json
import os
import secrets
from pathlib import Path

import httpx

from gill_core.config import Settings
from gill_core.team_client import TeamClient
from gill_core.team_turns import TeamTurn


class Fixture:
    """Own one disposable acceptance account and its single leased task."""

    async def start(self) -> None:
        self.http = httpx.AsyncClient(base_url="http://127.0.0.1:18080", trust_env=False)
        username = "completion_" + secrets.token_hex(8)
        password = secrets.token_hex(16)
        response = await self.http.post("/api/v1/auth/register", json={"username": username, "password": password})
        response.raise_for_status()
        response = await self.http.post("/api/v1/auth/login", json={"username": username, "password": password})
        response.raise_for_status()
        self.http.headers["Authorization"] = "Bearer " + response.json()["token"]
        team = await self.command("team.create", {"name": "收尾协议验证", "prompt": "按实际证据工作"})
        template = await self.command("template.save", {"name": "验证模板", "prompt": "保留未验证范围", "skills": []})
        employee = await self.command("employee.create", {"teamId": team["id"], "templateId": template["id"], "name": "验证员工", "parentId": "user"})
        task = await self.command("task.assign", {"employeeId": employee["id"], "goal": "提交合成验证报告并完成"})
        self.client = TeamClient("http://127.0.0.1:18080", os.environ["GILL_TEAM_WORKER_SECRET"], "completion-probe")
        self.job = await self.client.claim()
        assert self.job.get("payload", {}).get("taskId") == task["id"], "isolated queue required"
        self.turn = TeamTurn(self.client, Settings(), self.job)
        self.turn.context = await self.turn.op("context")
        self.task_id = task["id"]
        self.run_id = self.turn.context["run"]["id"]

    async def command(self, kind: str, payload: dict) -> dict:
        response = await self.http.post("/api/v1/team-workspace/commands", json={
            "requestKey": secrets.token_hex(16), "kind": kind, "payload": payload})
        response.raise_for_status()
        return response.json()

    async def state(self) -> dict:
        response = await self.http.get("/api/v1/team-workspace")
        response.raise_for_status()
        return response.json()

    async def close(self) -> None:
        await self.turn.op("finish", state="done", result={"syntheticProtocolProbe": True})
        await self.client.close()
        await self.http.aclose()


def completion(identifier: str = "final-report", **artifact: str) -> dict:
    """Build a synthetic model tool call.

    :param identifier: Stable persisted model tool call ID.
    :param artifact: Overrides for the synthetic final report.
    :returns: Parsed call with id (str), name (str) and arguments (dict).
    """
    return {"id": identifier, "name": "complete_task", "arguments": {"artifact": {
        "title": "合成最终报告", "content": "仅验证收尾协议，不代表真实业务核验。",
        "unchecked": "未验证真实业务", **artifact}}}


async def run_case(mode: str) -> dict:
    """Verify a real persisted completion and its important failure boundaries.

    :param mode: One of replay, invalid, pause or unknown.
    :returns: Sanitized observed task state and artifact count.
    """
    fixture = Fixture()
    await fixture.start()
    try:
        call = completion()
        if mode == "invalid":
            call = completion(unchecked="")
        elif mode == "unknown":
            await fixture.turn.op("action", kind="shell", requestKey="unknown-action", input={"command": "not executed by fixture"})
        elif mode == "pause":
            original = fixture.turn.command

            async def pause_after_save(kind: str, arguments: dict, identifier: str) -> dict:
                result = await original(kind, arguments, identifier)
                if kind == "artifact.save":
                    await fixture.command("run.control", {"runId": fixture.run_id, "operation": "pause"})
                return result

            fixture.turn.command = pause_after_save
        rejected = None
        try:
            await fixture.turn.dispatch(call)
        except httpx.HTTPStatusError as error:
            rejected = error.response.json()["error"]["message"]
        state = await fixture.state()
        artifacts = list(state["artifacts"].values())
        if mode == "replay":
            assert rejected is None and state["tasks"][fixture.task_id]["state"] == "completed"
            await fixture.turn.dispatch(call)
            state = await fixture.state()
            assert len(state["artifacts"]) == 1 and next(iter(state["artifacts"].values()))["revision"] == 1
            assert len([m for m in state["messages"].values() if m["kind"] == "task-completed"]) == 1
        elif mode == "invalid":
            assert rejected and "INVALID_INPUT" in rejected and len(artifacts) == 0
            assert state["tasks"][fixture.task_id]["state"] != "completed"
        elif mode == "unknown":
            assert rejected and "ACTION_RESULT_UNKNOWN" in rejected and len(artifacts) == 1
            assert state["tasks"][fixture.task_id]["state"] != "completed"
            await fixture.turn.op("action-result", requestKey="unknown-action", state="failed", result={"notExecuted": True})
        elif mode == "pause":
            assert rejected and "PAUSED" in rejected and len(artifacts) == 1
            assert state["tasks"][fixture.task_id]["state"] != "completed"
            fixture.turn.command = original
            await fixture.command("run.control", {"runId": fixture.run_id, "operation": "resume"})
            await fixture.turn.dispatch(call)
            state = await fixture.state()
            assert state["tasks"][fixture.task_id]["state"] == "completed"
            assert len(state["artifacts"]) == 1 and next(iter(state["artifacts"].values()))["revision"] == 1
        return {"mode": mode, "passed": True, "taskId": fixture.task_id,
                "state": state["tasks"][fixture.task_id]["state"], "artifactCount": len(state["artifacts"]),
                "initialRejection": rejected, "modelCalls": state["runs"][fixture.run_id]["calls"]}
    finally:
        await fixture.close()


async def main() -> None:
    """Run the explicitly isolated protocol verification and save sanitized observations."""
    results = [await run_case(mode) for mode in ("replay", "invalid", "pause", "unknown")]
    Path("/tmp/gill-completion-protocol.json").write_text(json.dumps(results, ensure_ascii=False, indent=2))
    print(json.dumps(results, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(main())
