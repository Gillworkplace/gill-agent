"""Completion tool contracts preserve explicit intent, evidence and replay identity."""
import unittest
from unittest.mock import AsyncMock

from gill_core.config import Settings
from gill_core.team_protocol import tool_schemas
from gill_core.team_turns import TeamTurn


class CompletionTests(unittest.IsolatedAsyncioTestCase):
    async def test_context_is_refreshed_after_shared_call_reservation(self) -> None:
        class Client:
            calls = 7
            completed = False

            async def operation(self, job: dict, operation: str, **payload: dict) -> dict:
                if operation == "context":
                    return {"task": {}, "run": {"calls": self.calls, "limits": {"maxRounds": 8}}}
                if operation == "heartbeat":
                    return {"state": "active", "taskState": "completed" if self.completed else "running"}
                if operation == "action":
                    self.calls += 1
                    return {"state": "dispatched"}
                if operation == "command":
                    self.completed = True
                    return {"state": "completed"}
                return {}

        client = Client()
        turn = TeamTurn(client, Settings(), {"id": "job", "fence": 1})

        async def model() -> tuple[str, list[dict]]:
            self.assertEqual(turn.context["run"]["calls"], 8)
            return "", [{"id": "done", "function": {"name": "complete_task", "arguments": "{}"}}]

        turn.model_request = AsyncMock(side_effect=model)
        await turn.conversation({})
        turn.model_request.assert_awaited_once()

    def setUp(self) -> None:
        self.turn = TeamTurn(None, Settings(), {"id": "job", "fence": 1})
        self.artifact = {"title": "Final report", "content": "Verified result", "unchecked": "External source"}
        self.call = {"id": "finish-call", "name": "complete_task", "arguments": {"artifact": self.artifact}}

    def test_completion_schema_accepts_optional_final_evidence(self) -> None:
        tools = {s["function"]["name"]: s["function"]["parameters"] for s in tool_schemas()}
        artifact = tools["complete_task"]["properties"]["artifact"]
        self.assertEqual(artifact["required"], tools["record_artifact"]["required"])
        self.assertEqual(artifact["properties"], tools["record_artifact"]["properties"])
        self.assertEqual(tools["complete_task"]["required"], [])

    async def test_saves_evidence_before_explicit_completion_with_stable_replay_keys(self) -> None:
        self.turn.command = AsyncMock(side_effect=[{"id": "report"}, {"state": "completed"}] * 2)
        for _ in range(2):
            result = await self.turn.dispatch(self.call)
            self.assertEqual(result["state"], "completed")
        actual = [(c.args[0], c.args[1], c.args[2]) for c in self.turn.command.call_args_list]
        expected = [("artifact.save", self.artifact, "finish-call-artifact"), ("run.complete", {}, "finish-call")]
        self.assertEqual(actual, expected * 2)

    async def test_evidence_save_failure_never_requests_completion(self) -> None:
        self.turn.command = AsyncMock(side_effect=ValueError("VERSION_CONFLICT"))
        with self.assertRaisesRegex(ValueError, "VERSION_CONFLICT"):
            await self.turn.dispatch(self.call)
        self.assertEqual(self.turn.command.await_count, 1)

    async def test_completion_rejection_remains_a_failure_after_evidence_saved(self) -> None:
        self.turn.command = AsyncMock(side_effect=[{"id": "report"}, ValueError("DEPENDENCY_UNRESOLVED")])
        with self.assertRaisesRegex(ValueError, "DEPENDENCY_UNRESOLVED"):
            await self.turn.dispatch(self.call)
        self.assertEqual(self.turn.command.await_count, 2)

    async def test_old_completion_still_uses_existing_evidence(self) -> None:
        self.turn.command = AsyncMock(return_value={"state": "completed"})
        await self.turn.dispatch({**self.call, "arguments": {}})
        self.turn.command.assert_awaited_once_with("run.complete", {}, "finish-call")

    async def test_invalid_artifact_is_rejected_before_any_command(self) -> None:
        self.turn.command = AsyncMock()
        for artifact in (None, [], "a report"):
            with self.assertRaises(ValueError):
                await self.turn.dispatch({**self.call, "arguments": {"artifact": artifact}})
        self.turn.command.assert_not_awaited()

    async def test_nested_report_cannot_override_execution_task_identity(self) -> None:
        self.turn.command = AsyncMock()
        call = {**self.call, "arguments": {"artifact": {**self.artifact, "taskId": "another-task"}}}
        with self.assertRaises(ValueError):
            await self.turn.dispatch(call)
        self.turn.command.assert_not_awaited()
