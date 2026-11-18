"""Replay observed model responses at the tool execution boundary."""
import json
import unittest
from unittest.mock import AsyncMock

from gill_core.config import Settings
from gill_core.team_protocol import build_system
from gill_core.team_turns import TeamTurn


def call(identifier: str, name: str, **arguments: object) -> dict:
    return {"id": identifier, "function": {"name": name, "arguments": json.dumps(arguments)}}


class ResponseBatchTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.turn = TeamTurn(None, Settings(), {"id": "fixture", "fence": 1})
        self.turn.op = AsyncMock(return_value={"state": "active"})

    async def test_work_handoff_is_rejected_before_escalation_in_same_response(self) -> None:
        self.turn.dispatch = AsyncMock(return_value={"id": "decision"})
        response = [call("notice", "team_message", text="FYI", mentions=["peer"], requiresResponse=False),
                    call("handoff", "assign_task", goal="Correct the report", employeeId="peer"),
                    call("escalate", "ask_superior", problem="Needs authorization", attempts=[], options=[])]
        await self.turn.execute_calls(response)
        self.assertEqual([c.args[0]["id"] for c in self.turn.dispatch.await_args_list], ["notice", "escalate"])
        self.assertFalse(json.loads(self.turn.history[1]["content"])["executed"])

    async def test_independent_assignment_and_evidence_can_precede_escalation(self) -> None:
        self.turn.dispatch = AsyncMock(return_value={"id": "committed"})
        response = [call("dependent", "assign_task", employeeId="peer", goal="Correct the report"),
                    call("independent", "assign_task", employeeId="peer", goal="Collect unrelated data", dependsOnTaskIds=[]),
                    call("report", "record_artifact", title="Report", content="Evidence", unchecked="External data"),
                    call("escalate", "ask_superior", problem="Needs authorization", attempts=[], options=[])]
        await self.turn.execute_calls(response)
        self.assertEqual([c.args[0]["id"] for c in self.turn.dispatch.await_args_list], ["independent", "report", "escalate"])

    async def test_handoff_in_response_without_escalation_still_dispatches(self) -> None:
        self.turn.dispatch = AsyncMock(return_value={"id": "message"})
        await self.turn.execute_calls([call("handoff", "assign_task", goal="Correct the report", employeeId="peer")])
        self.turn.dispatch.assert_awaited_once()

    async def test_ordinary_message_and_peer_review_use_different_intents(self) -> None:
        self.turn.command = AsyncMock(return_value={"id": "message"})
        await self.turn.dispatch({"id": "notice", "name": "notify_team",
                                  "arguments": {"text": "Please acknowledge", "mentions": ["peer"]}})
        await self.turn.dispatch({"id": "review", "name": "request_peer_review",
                                  "arguments": {"text": "Check the source", "employeeId": "peer"}})
        notice, review = (item.args[1] for item in self.turn.command.await_args_list)
        self.assertEqual(notice["intent"], "notify")
        self.assertEqual(review["intent"], "review")
        self.assertEqual(review["mentions"], ["peer"])

    async def test_legacy_message_keeps_the_idempotent_wire_payload(self) -> None:
        self.turn.command = AsyncMock(return_value={"id": "message", "intent": "notify"})
        payload = {"text": "Please acknowledge", "requiresResponse": True, "mentions": ["peer"]}
        await self.turn.dispatch({"id": "legacy", "name": "team_message", "arguments": {**payload, "intent": "review"}})
        self.turn.command.assert_awaited_once_with("message.send", payload, "legacy")

    async def test_escalation_saves_its_explicit_report_before_opening_the_decision(self) -> None:
        self.turn.command = AsyncMock(side_effect=[{"id": "report", "revision": 1}, {"id": "decision"}])
        inputs = {"problem": "Which option should we apply?", "attempts": [], "options": ["A", "B"]}
        evidence = {"title": "Evidence", "content": "Verified input and options", "unchecked": "External source"}
        result = await self.turn.dispatch({"id": "question", "name": "ask_superior",
                                           "arguments": {**inputs, "evidence": evidence}})
        commands = [item.args for item in self.turn.command.await_args_list]
        self.assertEqual(commands, [("artifact.save", evidence, "question-artifact"),
                                    ("issue.escalate", {**inputs, "attempts": ["已归档依据：Evidence（report，v1）"]}, "question")])
        self.assertEqual(result["evidenceArtifactId"], "report")

    async def test_explicit_handoff_can_be_completed_using_one_model_response(self) -> None:
        self.turn.command = AsyncMock(side_effect=[{"id": "report"}, {"id": "child"}, {"state": "completed"}])
        report = {"title": "Report", "content": "Verified result", "unchecked": "Synthetic"}
        handoff = {"employeeId": "peer", "goal": "Apply the approved correction", "decisionId": "approved"}
        result = await self.turn.dispatch({"id": "final", "name": "complete_task",
                                           "arguments": {"artifact": report, "assign": handoff}})
        self.assertEqual([item.args for item in self.turn.command.await_args_list], [
            ("artifact.save", report, "final-artifact"),
            ("task.assign", handoff, "final-handoff"),
            ("run.complete", {}, "final"),
        ])
        self.assertEqual(result["handoff"]["id"], "child")

    async def test_failed_review_handoff_leaves_original_task_unfinished(self) -> None:
        self.turn.command = AsyncMock(side_effect=[{"id": "report"}, ValueError("review was not sent")])
        report = {"title": "Report", "content": "Verified result", "unchecked": "Synthetic"}
        handoff = {"employeeId": "peer", "text": "Check saved revision 2"}
        with self.assertRaisesRegex(ValueError, "review was not sent"):
            await self.turn.dispatch({"id": "final", "name": "complete_task",
                                      "arguments": {"artifact": report, "review": handoff}})
        self.assertEqual([item.args[0] for item in self.turn.command.await_args_list], ["artifact.save", "message.send"])

    async def test_failed_completion_reports_the_handoff_that_already_happened(self) -> None:
        self.turn.command = AsyncMock(side_effect=[{"id": "child"}, ValueError("missing evidence")])
        result = await self.turn.dispatch({"id": "final", "name": "complete_task", "arguments": {
            "assign": {"employeeId": "peer", "goal": "Apply correction"}}})
        self.assertEqual(result["handoff"]["id"], "child")
        self.assertEqual(result["completion"], "unconfirmed")
        self.assertIn("missing evidence", result["error"])

    async def test_new_report_is_preserved_even_if_combined_completion_follows_escalation(self) -> None:
        self.turn.command = AsyncMock(return_value={"id": "committed"})
        report = {"title": "Report", "content": "Evidence", "unchecked": "External data"}
        response = [call("escalate", "ask_superior", problem="Needs authorization", attempts=[], options=[]),
                    call("finish", "complete_task", artifact=report)]
        await self.turn.execute_calls(response)
        self.assertEqual([c.args[0] for c in self.turn.command.await_args_list], ["artifact.save", "issue.escalate"])
        self.assertEqual(self.turn.command.await_args_list[0].args[1], report)
        result = json.loads(self.turn.history[0]["content"])
        self.assertEqual(result["artifactId"], "committed")
        self.assertFalse(result["completionApplied"])

    async def test_review_receipt_uses_review_identity_and_not_artifact_identity(self) -> None:
        self.turn.command = AsyncMock(return_value={"id": "review-ref"})
        output = await self.turn.dispatch({"id": "a", "name": "record_review", "arguments": {"artifactId": "source", "subjectRevision": 2}})
        self.assertEqual(output, {"reviewId": "review-ref", "artifactId": "source", "subjectRevision": 2})

    def test_last_reserved_round_is_visible_as_zero_followup_calls(self) -> None:
        system = build_system({"run": {"calls": 8, "limits": {"maxRounds": 8}}})
        self.assertIn('"remainingCalls": 0', system)
