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
        origin = os.getenv("ACCEPTANCE_URL", "http://127.0.0.1:18080")
        if origin not in {"http://127.0.0.1:18080", "http://127.0.0.1:18081"}:
            raise ValueError("Completion probes require a dedicated loopback instance")
        self.http = httpx.AsyncClient(base_url=origin, trust_env=False)
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
        self.client = TeamClient(origin, os.environ["GILL_TEAM_WORKER_SECRET"], "completion-probe")
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
    results.append(await escalation_batch(False))
    results.append(await escalation_batch(True))
    results.append(await bundled_decision_evidence())
    results.append(await legacy_notice_replay())
    results.append(await complete_with_assignment())
    Path("/tmp/gill-completion-protocol.json").write_text(json.dumps(results, ensure_ascii=False, indent=2))
    print(json.dumps(results, ensure_ascii=False))


async def escalation_batch(combined_report: bool) -> dict:
    """
    Replay a mixed handoff and decision response against the real gateway.

    :param combined_report: Whether the evidence was bundled with completion after escalation.
    :returns: Result with mode (str), passed (bool), taskId (str), decisionId (str),
        taskCount (int) and modelCalls (int).
    """
    fixture = Fixture()
    await fixture.start()
    try:
        context = fixture.turn.context
        peer = await fixture.command("employee.create", {"teamId": context["task"]["teamId"],
            "templateId": context["employee"]["templateId"], "name": "责任员工", "parentId": "user"})
        report = {"title": "待决依据", "content": "验证用合成资料", "unchecked": "未验证业务"}
        handoff = ("assign", "assign_task", {"employeeId": peer["id"], "goal": "请先更正"})
        decision = ("decision", "ask_superior", {"problem": "先请用户决定", "attempts": ["已核对"], "options": ["确认", "停止"]})
        calls = ([handoff, decision, ("complete", "complete_task", {"artifact": report})] if combined_report
                 else [("record", "record_artifact", report), handoff, decision])
        calls = [{"id": identifier, "function": {"name": name, "arguments": json.dumps(arguments)}}
                 for identifier, name, arguments in calls]
        await fixture.turn.execute_calls(calls)
        state = await fixture.state()
        decisions = list(state["decisions"].values())
        assert len(state["tasks"]) == 1 and state["tasks"][fixture.task_id]["state"] == "blocked"
        assert len(decisions) == 1 and decisions[0]["state"] == "open" and decisions[0]["handlerId"] == "user"
        assert len(state["artifacts"]) == 1
        assert not any(m.get("text") == "请先更正" for m in state["messages"].values())
        return {"mode": "escalation-with-combined-report" if combined_report else "escalation-batch",
                "passed": True, "taskId": fixture.task_id,
                "decisionId": decisions[0]["id"], "taskCount": 1, "modelCalls": state["runs"][fixture.run_id]["calls"]}
    finally:
        await fixture.close()


async def bundled_decision_evidence() -> dict:
    """
    Exercise a real committed decision report and its idempotent retry.

    :returns: Evidence and decision IDs (str), mode (str) and passed (bool).
    """
    fixture = Fixture()
    await fixture.start()
    try:
        evidence = {"title": "原始依据", "content": "90件，来自合成统计明细", "unchecked": "未核验真实库存"}
        call = {"id": "decision-with-evidence", "name": "ask_superior",
                "arguments": {"problem": "是否采纳核算结果？", "attempts": [], "options": ["采纳", "补证"],
                              "evidence": evidence}}
        result = await fixture.turn.dispatch(call)
        assert await fixture.turn.dispatch(call) == result
        state = await fixture.state()
        artifact = state["artifacts"][result["evidenceArtifactId"]]
        decision = state["decisions"][result["id"]]
        assert artifact["revision"] == 1 and artifact["content"] == evidence["content"]
        assert result["evidenceArtifactId"] in decision["attempts"][-1]
        assert decision["state"] == "open" and len(state["tasks"]) == len(state["artifacts"]) == 1
        return {"mode": "decision-evidence", "passed": True, "evidenceId": artifact["id"], "decisionId": decision["id"]}
    finally:
        await fixture.close()


async def legacy_notice_replay() -> dict:
    """
    Replay the old chat action without starting any work.

    :returns: Message ID (str), mode (str) and passed (bool).
    """
    fixture = Fixture()
    await fixture.start()
    try:
        employee, task = fixture.turn.context["employee"], fixture.turn.context["task"]
        recipient = await fixture.command("employee.create", {"teamId": task["teamId"],
            "templateId": employee["templateId"], "name": "收件员工"})
        call = {"id": "old-notice", "name": "team_message", "arguments": {
            "text": "请知悉并确认", "mentions": [recipient["id"]], "requiresResponse": True, "intent": "review"}}
        notice = await fixture.turn.dispatch(call)
        assert await fixture.turn.dispatch(call) == notice
        state = await fixture.state()
        assert notice["intent"] == "notify" and len(state["tasks"]) == 1
        assert [item["state"] for item in state["deliveries"].values()] == ["notified"]
        return {"mode": "legacy-notice-replay", "passed": True, "messageId": notice["id"]}
    finally:
        await fixture.close()


async def complete_with_assignment() -> dict:
    """
    Verify that a finish-and-assign retry reuses both committed results.

    :returns: Mode (str), success (bool), and stable assigned task ID (str).
    """
    fixture = Fixture()
    await fixture.start()
    try:
        employee, task = fixture.turn.context["employee"], fixture.turn.context["task"]
        peer = await fixture.command("employee.create", {"teamId": task["teamId"],
            "templateId": employee["templateId"], "name": "接手测试"})
        report = {"title": "本环节报告", "content": "交接后结束当前任务", "unchecked": "合成输入"}
        call = {"id": "compound", "name": "complete_task", "arguments": {
            "assign": {"employeeId": peer["id"], "goal": "开始后续工作"}, "artifact": report}}
        receipt = await fixture.turn.dispatch(call)
        assert await fixture.turn.dispatch(call) == receipt
        child_id = receipt["handoff"]["id"]
        state = await fixture.state()
        assert receipt["state"] == state["tasks"][fixture.task_id]["state"] == "completed"
        assert len(state["tasks"]) == 2 and len(state["artifacts"]) == 1
        assert state["tasks"][child_id]["employeeId"] == peer["id"]
        child = await fixture.client.claim()
        assert child["payload"]["taskId"] == child_id
        await fixture.client.operation(child, "finish", state="stopped", result={"fixture": "verified queued handoff"})
        return {"mode": "completion-with-assignment", "passed": True, "childTaskId": child_id}
    finally:
        await fixture.close()


if __name__ == "__main__":
    asyncio.run(main())
