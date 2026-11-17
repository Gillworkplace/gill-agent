import unittest
from gill_core.team_protocol import parse_calls, build_system, tool_schemas

class ProtocolTests(unittest.TestCase):
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
        self.assertIn("team_message",names)
        self.assertIn("record_artifact",names)
        self.assertNotIn("knowledge_save",names)

    def test_template_generator_only_has_draft_tool(self):
        self.assertEqual([s["function"]["name"] for s in tool_schemas(True)],["draft_template"])

    def test_document_archiving_and_notification_contracts_are_exposed(self) -> None:
        from gill_core.team_protocol import ACTION_NAMES
        tools={s["function"]["name"]:s["function"] for s in tool_schemas()}
        self.assertEqual(ACTION_NAMES.get("archive_document"),"document.save")
        self.assertIn("expectedRevision",tools["archive_document"]["parameters"]["properties"])
        self.assertIn("requiresResponse",tools["team_message"]["parameters"]["required"])
        self.assertEqual(tools["team_message"]["parameters"]["properties"]["requiresResponse"]["type"],"boolean")
