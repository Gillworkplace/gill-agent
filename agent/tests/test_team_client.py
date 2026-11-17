import unittest
import httpx
from gill_core.team_client import TeamClient
from gill_core.team_turns import TeamTurn
from gill_core.config import Settings


class TeamBoundaryTests(unittest.IsolatedAsyncioTestCase):
    async def test_domain_failure_explains_the_invalid_reference_to_the_model(self):
        client=TeamClient("http://gateway", "test-only-service-credential", "test-worker")
        await client.http.aclose()
        def rejected(request):
            return httpx.Response(404,json={"error":{"code":"NOT_FOUND","message":"NOT_FOUND: artifacts/missing-id"}})
        client.http=httpx.AsyncClient(base_url="http://gateway/",transport=httpx.MockTransport(rejected))
        try:
            with self.assertRaisesRegex(httpx.HTTPStatusError,"NOT_FOUND: artifacts/missing-id"):
                await client.operation({"id":"job","fence":1},"command",kind="artifact.save")
        finally:
            await client.close()

    async def test_spaced_queries_search_authorized_sources_and_distinguish_no_mounts(self):
        turn=TeamTurn(None,Settings(),{"id":"job","fence":1})
        turn.context={"knowledge":[{"id":"source","title":"业务协作合成资料","content":"上一期成交金额100万元，本期120万元。"}]}
        result=await turn.dispatch({"id":"read","name":"search_knowledge","arguments":{"query":"业务协作合成资料 成交金额"}})
        self.assertEqual([x["id"] for x in result["sources"]],["source"])
        self.assertEqual(result["authorizedSourceCount"],1)
        turn.context={"knowledge":[]}
        empty=await turn.dispatch({"id":"read-empty","name":"search_knowledge","arguments":{"query":"成交金额"}})
        self.assertEqual(empty["sources"],[])
        self.assertEqual(empty["state"],"no_mounted_sources")
