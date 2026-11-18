"""Verify effective request snapshots and recover a real lost model receipt."""
from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
import json
import os
from pathlib import Path
import sys
import time
from unittest.mock import patch
import uuid

import httpx

from acceptance_completion_probe import Fixture
from gill_core.llm import LLM
from gill_core.team_client import TeamClient
from gill_core.team_turns import TeamTurn


async def actual_request(turn: TeamTurn) -> tuple[dict, dict]:
    """
    Observe arguments at the real SDK boundary without replacing the vendor call.

    :param turn: Current leased execution and its authorized source snapshots.
    :returns: Captured request facts and provider receipt with token usage.
    """
    intent = await turn.op("action", requestKey="trace-vendor-action", kind="model",
                           input={"model": turn.settings.zhipu_model, "case": "effective-snapshot"})
    assert intent["state"] == "dispatched"
    turn.context = await turn.op("context")
    turn.read_knowledge.update({source["id"]: source for source in turn.context["knowledge"]})
    turn.history = [{"role": "user", "content": "这是合成平台请求检验，只回复已收到，无需调用工具。"}]
    facts = {}
    original = LLM.stream

    async def observe(self: LLM, messages: list[dict], tools: list[dict] | None, system: str) -> AsyncIterator:
        facts["system"] = system
        facts["tools"] = [item["function"]["name"] for item in tools or []]
        async for item in original(self, messages, tools, system=system):
            yield item

    with patch.object(LLM, "stream", observe):
        text, calls = await turn.model_request()
    receipt = {"answer": text, "toolCalls": calls, "usage": turn.last_usage}
    assert receipt["answer"] and receipt["usage"].get("prompt", 0) > 0
    return facts, receipt


async def start(path: Path) -> None:
    fixture = Fixture()
    await fixture.start()
    team, employee = fixture.turn.context["team"], fixture.turn.context["employee"]
    changed_team = await fixture.command("team.update", {"id": team["id"], "expectedRevision": team["revision"],
                                                          "name": team["name"], "prompt": "TraceTeamRevisionTwo"})
    await fixture.command("template.save", {"id": employee["templateId"], "expectedRevision": 1, "name": "验证模板",
        "prompt": employee["prompt"], "skills": [{"name": "TraceSkillTwo", "content": "可核查的合成新版技能"}]})
    await fixture.command("employee.update", {"id": employee["id"], "expectedRevision": employee["revision"],
                                               "prompt": employee["prompt"] + " TraceEmployeeTwo"})
    source = await fixture.command("knowledge.save", {"title": "TraceKnowledge", "content": "TraceSourceVersionOne"})
    await fixture.command("knowledge.mount", {"sourceId": source["id"], "employeeId": employee["id"]})
    pulse = asyncio.create_task(fixture.turn.heartbeat())
    try:
        before, result = await actual_request(fixture.turn)
    finally:
        pulse.cancel()
    assert all(value not in before["system"] for value in ("TraceTeamRevisionTwo", "TraceEmployeeTwo", "TraceSkillTwo"))
    assert "TraceSourceVersionOne" in before["system"] and "complete_task" in before["tools"]
    before_versions = [fixture.turn.context[name]["revision"] for name in ("team", "employee")]
    await fixture.turn.op("action-result", requestKey="trace-vendor-action", state="succeeded", result=result)
    await fixture.turn.op("finish", state="done", result={"fixture": "captured first real request"})
    await fixture.command("knowledge.save", {"id": source["id"], "expectedRevision": 1,
                                               "title": "TraceKnowledge", "content": "TraceSourceVersionTwo"})
    task = await fixture.command("task.assign", {"employeeId": employee["id"], "goal": "验证下一工作采用新版"})
    job = await fixture.client.claim()
    assert job["payload"]["taskId"] == task["id"]
    after = TeamTurn(fixture.client, fixture.turn.settings, job)
    after.context = await after.op("context")
    await after.command("artifact.save", {"title": "发请求前保存的证据", "content": "合成新版请求核对",
                                          "unchecked": "未核验真实业务"}, "before-lost-request")
    asyncio.create_task(after.heartbeat())
    sent, vendor = await actual_request(after)
    assert all(value in sent["system"] for value in ("TraceTeamRevisionTwo", "TraceEmployeeTwo", "TraceSkillTwo", "TraceSourceVersionTwo"))
    assert "TraceSourceVersionOne" not in sent["system"]
    assert after.context["team"]["revision"] == changed_team["revision"]
    assert after.context["employee"]["templateRevision"] == 2
    facts = {"oldTask": fixture.task_id, "newTask": task["id"], "oldRevisions": before_versions,
             "newRevisions": [after.context[name]["revision"] for name in ("team", "employee")],
             "oldUsage": result["usage"], "vendorUsage": vendor["usage"], "toolsCount": len(sent["tools"])}
    path.touch(mode=0o600, exist_ok=False)
    path.write_text(json.dumps({"at": time.time(), "job": job, "worker": fixture.client.worker_id,
                                "token": fixture.http.headers["Authorization"].split()[1], "facts": facts}))
    print(json.dumps(facts), flush=True)
    os._exit(0)


async def verify(path: Path) -> None:
    data = json.loads(path.read_text())
    delay = 42 - (time.time() - data["at"])
    if delay > 0:
        await asyncio.sleep(delay)
    origin = os.environ["ACCEPTANCE_URL"]
    client = TeamClient(origin, os.environ["GILL_TEAM_WORKER_SECRET"], data["worker"])
    job, facts = data["job"], data["facts"]
    assert not (await client.claim()).get("id")
    async with httpx.AsyncClient(base_url=origin, headers={"Authorization": "Bearer " + data["token"]}, trust_env=False) as web:
        execution = (await web.get("/api/v1/team-workspace/executions/" + job["id"])).json()
        assert execution["state"] == "needs_reconciliation"
        assert [a["state"] for a in execution["actions"]] == ["dispatched"]
        recorded = await web.post("/api/v1/team-workspace/commands", json={"kind": "execution.reconcile",
            "requestKey": uuid.uuid4().hex, "payload": {"executionId": job["id"], "executionStopped": True,
                "resolution": "succeeded", "evidence": "隔离请求观察器实际收到模型回复，供应商用量为 " + json.dumps(facts["vendorUsage"])}})
        recorded.raise_for_status()
        assert not (await client.claim()).get("id")
        state = (await web.get("/api/v1/team-workspace")).json()
        task = state["tasks"][facts["newTask"]]
        assert task["state"] == "paused"
        assert str(facts["vendorUsage"]["prompt"]) in task["reconciliationRecords"][0]["evidence"]
    print(json.dumps({**facts, "case": "AC07-vendor-usage-and-AC06-12-effective-request", "receivedUsage": True, "noReplay": True}))
    await client.close()


if __name__ == "__main__":
    mode, trace_file = sys.argv[1:3]
    asyncio.run((start if mode == "start" else verify)(Path(trace_file)))
