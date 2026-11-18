"""Exercise a real remote side effect whose worker disappears before reporting."""
from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
import sys
import time
import uuid

import httpx

from acceptance_completion_probe import Fixture
from gill_core.team_client import TeamClient
from gill_core.team_git import TeamGit
from gill_core.team_sandbox import TeamSandbox
from gill_core.team_turns import TeamTurn


def store(path: Path, value: dict) -> None:
    path.touch(mode=0o600, exist_ok=False)
    path.write_text(json.dumps(value, ensure_ascii=False))


async def git_work(fixture: Fixture) -> tuple[TeamTurn, str, dict]:
    team = fixture.turn.context["teamId"]
    employee = fixture.turn.context["employee"]["id"]
    await fixture.turn.op("finish", state="stopped", result={"fixture": "replaced by project task"})
    project = await fixture.command("project.save", {"teamId": team, "name": "带断连的受控 Git",
        "targetBranch": "main", "checkCommand": "test \"$(cat proof.txt)\" = 'verified cloud work'"})
    task = await fixture.command("task.assign", {"employeeId": employee, "projectId": project["id"], "goal": "合成 Git 归档"})
    job = await fixture.client.claim()
    assert job["payload"]["taskId"] == task["id"]
    turn = TeamTurn(fixture.client, fixture.turn.settings, job)
    turn.context = await turn.op("context")
    pulse = asyncio.create_task(turn.heartbeat())
    try:
        await turn.ensure_sandbox()
        marker = await turn.sandbox.run("printf 'verified cloud work\\n' > proof.txt")
        assert marker["exitCode"] == 0
        saved = await TeamGit(turn.sandbox, turn.context).save("归档本次云端回归")
        assert saved["exitCode"] == 0
        await turn.command("version.record", saved, "fault-source-code")
        proof = await turn.command("artifact.save", {"title": "归档前成果", "content": "测试从空仓库归档 proof.txt",
                                                      "unchecked": "使用合成测试数据"}, "fault-source-artifact")
        request = await turn.command("integration.request", {"projectId": project["id"], "sourceRef": saved["commit"],
                                                               "expectedTarget": saved["baseRef"]}, "fault-integration")
        await turn.op("finish", state="done", result={"fixture": "source ready"})
    finally:
        pulse.cancel()
    job = await fixture.client.claim()
    assert job["payload"]["integrationId"] == request["id"]
    integration = TeamTurn(fixture.client, turn.settings, job)
    integration.context = await integration.op("context")
    return integration, proof["id"], {"projectId": project["id"], "integrationId": request["id"],
                                    "sourceSandbox": turn.sandbox.sandbox_id, "baseline": saved["baseRef"]}


async def interrupt(mode: str, path: Path) -> None:
    fixture = Fixture()
    await fixture.start()
    if mode == "git":
        turn, proof, references = await git_work(fixture)
    else:
        turn, references = fixture.turn, {}
        proof = (await turn.command("artifact.save", {"title": "中断前成果", "content": "已保留实际源输入",
                                                      "unchecked": "使用合成测试数据"}, "fault-shell-artifact"))["id"]
    asyncio.create_task(turn.heartbeat())
    marker = "gill-cloud-" + uuid.uuid4().hex
    await turn.ensure_sandbox()
    intent = await turn.op("action", requestKey=marker, kind="git.integrate" if mode == "git" else "shell",
                          input={"case": mode, "externalEffect": marker})
    assert intent["state"] == "dispatched"
    if mode == "git":
        outcome = await TeamGit(turn.sandbox, turn.context).integrate(turn.context["integration"], turn.context["sourceVersion"])
        assert outcome["state"] == "verified" and outcome["check"]["exitCode"] == 0
    else:
        outcome = await turn.sandbox.run(f"printf '%s\\n' {marker} >> effect.txt; cat effect.txt")
        assert outcome["stdout"].strip() == marker
    store(path, {"token": fixture.http.headers["Authorization"].split()[1], "teamId": turn.context["teamId"],
          "taskId": turn.context["taskId"], "job": turn.job, "workerId": fixture.client.worker_id, "proof": proof,
          "sandbox": turn.sandbox.sandbox_id, "marker": marker, "mode": mode, "references": references,
          "outcome": outcome, "at": time.time()})
    print(json.dumps({"mode": mode, "taskId": turn.context["taskId"], "effectOccurred": True}), flush=True)
    os._exit(0)


async def recover(path: Path, settle: bool) -> None:
    from gill_core.config import Settings

    data = json.loads(path.read_text())
    delay = 42 - (time.time() - data["at"])
    if delay > 0:
        await asyncio.sleep(delay)
    origin = os.environ["ACCEPTANCE_URL"]
    client = TeamClient(origin, os.environ["GILL_TEAM_WORKER_SECRET"], data["workerId"])
    async with httpx.AsyncClient(base_url=origin, headers={"Authorization": "Bearer " + data["token"]}, trust_env=False) as web:
        assert not (await client.claim()).get("id"), "unverified work was claimed again"
        heartbeat = await client.http.post("jobs/" + data["job"]["id"] + "/heartbeat",
            json={"workerId": data["workerId"], "fence": data["job"]["fence"]})
        assert heartbeat.status_code == 409
        state = (await web.get("/api/v1/team-workspace")).json()
        assert state["tasks"][data["taskId"]]["state"] == "needs_reconciliation"
        assert state["artifacts"][data["proof"]]["revision"] == 1
        sandbox = TeamSandbox(Settings.load(), data["sandbox"])
        await sandbox.connect()
        if data["mode"] == "git":
            assert (await sandbox.run("git rev-parse HEAD"))["stdout"].strip() == data["outcome"]["commit"]
            assert (await sandbox.run("cat proof.txt"))["stdout"].strip() == "verified cloud work"
            project = state["projects"][data["references"]["projectId"]]
            assert project["baselineCommit"] == data["references"]["baseline"]
            if settle:
                old = state["integrations"][data["references"]["integrationId"]]
                repeat = await web.post("/api/v1/team-workspace/commands", json={"kind": "integration.request",
                    "requestKey": uuid.uuid4().hex, "payload": {"taskId": data["taskId"], "projectId": project["id"],
                        "sourceRef": old["sourceRef"], "expectedTarget": project["baselineCommit"]}})
                assert repeat.json()["error"]["code"] == "ACTION_RESULT_UNKNOWN"
        else:
            assert (await sandbox.run("cat effect.txt"))["stdout"].splitlines() == [data["marker"]]
        if settle:
            result = await web.post("/api/v1/team-workspace/commands", json={"kind": "execution.reconcile",
                "requestKey": uuid.uuid4().hex, "payload": {"executionId": data["job"]["id"], "executionStopped": True,
                    "resolution": "succeeded", "evidence": "独立连接原云沙箱，核对了实际输出和产物。旧 Worker 进程已退出。"}})
            result.raise_for_status()
            assert not (await client.claim()).get("id")
            after = (await web.get("/api/v1/team-workspace")).json()
            if data["mode"] == "git":
                actual = after["integrations"][data["references"]["integrationId"]]["state"]
                assert actual == "reconciled", "integration remains " + actual + " after a confirmed lost receipt"
                assert after["projects"][data["references"]["projectId"]]["baselineCommit"] == data["references"]["baseline"]
            assert after["tasks"][data["taskId"]]["state"] == "paused"
        print(json.dumps({"mode": data["mode"], "job": data["job"]["id"], "task": data["taskId"],
                          "effectVerified": True, "noRetry": True, "settled": settle, "expiredLease": heartbeat.status_code}))
    await client.close()


async def verify_explicit_git_retry(path: Path) -> None:
    """
    Explicitly request a new checked integration after the old result was reconciled.

    :param path: Synthetic cloud integration fixture with its real source/version references.
    """
    from gill_core.config import Settings

    data = json.loads(path.read_text())
    refs = data["references"]
    origin = os.environ["ACCEPTANCE_URL"]
    client = TeamClient(origin, os.environ["GILL_TEAM_WORKER_SECRET"], "cloud-explicit-retry")
    async with httpx.AsyncClient(base_url=origin, headers={"Authorization": "Bearer " + data["token"]}, trust_env=False) as web:
        async def command(kind: str, payload: dict) -> dict:
            response = await web.post("/api/v1/team-workspace/commands",
                json={"kind": kind, "requestKey": uuid.uuid4().hex, "payload": payload})
            response.raise_for_status()
            return response.json()

        initial = (await web.get("/api/v1/team-workspace")).json()
        old = initial["integrations"][refs["integrationId"]]
        assert old["state"] == "reconciled" and old["id"] == refs["integrationId"]
        assert initial["projects"][refs["projectId"]]["baselineCommit"] == refs["baseline"]
        assert not (await client.claim()).get("id")
        await command("run.complete", {"taskId": data["taskId"]})
        retry = await command("integration.request", {"taskId": data["taskId"], "projectId": refs["projectId"],
            "sourceRef": old["sourceRef"], "expectedTarget": refs["baseline"]})
        job = await client.claim()
        assert job["payload"]["integrationId"] == retry["id"] and job["id"] != data["job"]["id"]
        turn = TeamTurn(client, Settings.load(), job)
        await turn.run()
        after = (await web.get("/api/v1/team-workspace")).json()
        result = after["integrations"][retry["id"]]
        assert result["state"] == "integrated" and result["result"]["check"]["exitCode"] == 0
        assert after["projects"][refs["projectId"]]["baselineCommit"] == result["result"]["commit"]
        task = after["tasks"][data["taskId"]]
        assert task["state"] == after["runs"][task["runId"]]["state"] == "completed"
        assert after["integrations"][old["id"]]["state"] == "reconciled"
        print(json.dumps({"case": "AC24-explicit-cloud-git-retry", "old": old["id"], "new": retry["id"],
                          "baseline": result["result"]["commit"], "sandbox": task["sandboxId"], "passed": True}))
    await client.close()


if __name__ == "__main__":
    phase, fixture_path = sys.argv[1:3]
    if phase in {"shell", "git"}:
        asyncio.run(interrupt(phase, Path(fixture_path)))
    elif phase == "retry":
        asyncio.run(verify_explicit_git_retry(Path(fixture_path)))
    else:
        asyncio.run(recover(Path(fixture_path), settle=phase == "settle"))
