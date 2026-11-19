import unittest
from gill_core.team_protocol import parse_calls, build_system, tool_schemas


class ProtocolTests(unittest.TestCase):
    def test_personality_is_separate_from_organizational_definitions(self) -> None:
        context = {"team": {"prompt": "流程规则"}, "teamRole": {"name": "复核", "prompt": "岗位标准"},
                   "employee": {"name": "成员", "personality": "审慎而坦率", "prompt": "个人工作习惯"}}
        system = build_system(context)
        self.assertIn("[成员性格与工作态度]\n审慎而坦率", system)
        for value in ("岗位标准", "流程规则", "个人工作习惯"):
            self.assertIn(value, system)
        self.assertNotIn("revise_template", {tool["function"]["name"] for tool in tool_schemas()})

    def test_complete_calls_preserve_ids_and_do_not_execute_text(self):
        calls=[{"id":"call-a","function":{"name":"team_message","arguments":'{"text":"ok","mentions":[]}'}}]
        parsed=parse_calls(calls)
        self.assertEqual(parsed[0]["id"],"call-a")
        self.assertEqual(parsed[0]["arguments"]["text"],"ok")
        self.assertEqual(parse_calls([]),[])

    def test_invalid_json_and_unknown_tool_are_rejected(self):
        with self.assertRaises(ValueError):
            parse_calls([{"id":"a","function":{"name":"shell","arguments":"{"}}])
        with self.assertRaises(ValueError):
            parse_calls([{"id":"a","function":{"name":"knowledge_save","arguments":"{}"}}])

    def test_employee_instructions_and_skills_are_in_system_request(self):
        context={"employee":{"id":"a","prompt":"核对出处","skills":[{"name":"核查","content":"比较来源"}]},
                 "team":{"prompt":"不确定时逐级上报"},"peers":[],"task":{"id":"task1","goal":"整理"}}
        system=build_system(context)
        for required in ["核对出处","比较来源","不确定时逐级上报","task1"]:
            self.assertIn(required,system)
        names={s["function"]["name"] for s in tool_schemas(False)}
        self.assertIn("notify_team",names)
        self.assertIn("record_artifact",names)
        self.assertNotIn("knowledge_save",names)

    def test_template_generator_only_has_draft_tool(self):
        self.assertEqual([s["function"]["name"] for s in tool_schemas(True)],["draft_template"])

    def test_shared_budget_is_visible_without_promising_another_model_call(self) -> None:
        import json
        context = {"employee": {}, "team": {}, "task": {},
                   "run": {"calls": 8, "limits": {"maxRounds": 8, "maxSeconds": 600}, "state": "active"}}
        system = build_system(context)
        self.assertIn(json.dumps(context["run"], ensure_ascii=False), system)
        self.assertIn("共享", system)
        self.assertIn("不会为收尾自动追加", system)

    def test_document_archiving_and_notification_contracts_are_exposed(self) -> None:
        from gill_core.team_protocol import ACTION_NAMES
        tools={s["function"]["name"]:s["function"] for s in tool_schemas()}
        self.assertEqual(ACTION_NAMES.get("archive_document"),"document.save")
        self.assertIn("expectedRevision",tools["archive_document"]["parameters"]["properties"])
        self.assertNotIn("team_message",tools)
        self.assertNotIn("requiresResponse",tools["notify_team"]["parameters"]["properties"])
        self.assertIn("employeeId",tools["request_peer_review"]["parameters"]["required"])

    def test_legacy_team_without_explicit_limits_uses_platform_defaults(self) -> None:
        system = build_system({"run": {"calls": 1, "limits": None, "state": "active"}})
        self.assertIn('"maxRounds": 25', system)
        self.assertIn('"maxSeconds": 900', system)
        self.assertIn('"remainingCalls": 24', system)

    def test_handoff_request_is_not_confused_with_sender_completion(self) -> None:
        tools = {s["function"]["name"]: s["function"] for s in tool_schemas()}
        self.assertIn("不会启动核查或正式任务", tools["notify_team"]["description"])
        self.assertIn("正式向本团队员工分派", tools["assign_task"]["description"])
