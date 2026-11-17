import asyncio
import unittest
import httpx
from unittest.mock import patch
from gill_core.config import Settings
from gill_core.team_turns import TeamTurn

class ControlTests(unittest.IsolatedAsyncioTestCase):
    async def test_integration_replay_preserves_verified_result_state(self):
        class Client:
            def __init__(self): self.commands=[]
            async def operation(self,job,operation,**payload):
                if operation=="action":return {"state":"succeeded","result":{"state":"verified","commit":"a"*40}}
                if operation=="command":self.commands.append(payload);return {}
                raise AssertionError(operation)
        client=Client();turn=TeamTurn(client,Settings(),{"id":"job","fence":1})
        turn.context={"integration":{"id":"integration"},"sourceVersion":{}}
        await turn.integration()
        self.assertEqual(len(client.commands),1)
        self.assertEqual(client.commands[0]["payload"]["result"]["state"],"verified")
    async def test_saved_version_receipt_replays_registration_without_reexecuting_git(self):
        class Client:
            def __init__(self): self.commands=[]
            async def operation(self,job,operation,**payload):
                if operation=="action":return {"state":"succeeded","commit":"a"*40,"baseRef":"b"*40,"bundleKey":"teams/t/versions/saved.bundle"}
                if operation=="command":self.commands.append(payload);return {"id":"registered"}
                raise AssertionError(operation)
        client=Client();turn=TeamTurn(client,Settings(),{"id":"job","fence":1})
        await turn.dispatch({"id":"save-call","name":"save_version","arguments":{"summary":"saved"}})
        self.assertEqual(client.commands[0]["kind"],"version.record")

    async def test_late_receipt_retains_evidence_without_applying_stale_fence(self):
        class Client:
            def __init__(self): self.calls=[]
            async def operation(self,job,operation,**payload):
                self.calls.append(operation)
                if operation=="action-result":
                    response=httpx.Response(400,json={"error":{"code":"LEASE_LOST"}},request=httpx.Request("POST","http://gateway/"))
                    raise httpx.HTTPStatusError("LEASE_LOST",request=response.request,response=response)
                return {"state":"recorded-not-applied"}
        client=Client();turn=TeamTurn(client,Settings(),{"id":"job","fence":1})
        with self.assertRaises(httpx.HTTPStatusError):
            await turn.op("action-result",requestKey="call",state="succeeded",result={"stdout":"real result"})
        self.assertEqual(client.calls,["action-result","late-result"])
        self.assertTrue(turn.lost)

    async def test_pause_cancels_model_stream_without_waiting_for_next_chunk(self):
        started=asyncio.Event()
        class Client:
            async def close(self): assert getattr(self,"max_retries",2)==0
        class SlowLLM:
            def __init__(self,settings): self.client=Client()
            async def stream(self,messages,tools,system):
                started.set()
                await asyncio.Event().wait()
                yield "delta","never"
        turn=TeamTurn(None,Settings(),{"id":"job","fence":1})
        turn.context={"employee":{},"team":{},"task":{}}
        with patch("gill_core.team_turns.LLM",SlowLLM):
            request=asyncio.create_task(turn.model_request())
            await started.wait()
            turn.control={"state":"pause_requested"}
            self.assertEqual(await asyncio.wait_for(request,0.6),("",[]))
            self.assertTrue(turn.model_cancelled)

    async def test_checkpoint_persists_read_knowledge_for_unmount_resume(self):
        class Client:
            async def operation(self,job,operation,**payload): self.payload=payload;return {}
        client=Client();turn=TeamTurn(client,Settings(),{"id":"job","fence":1})
        turn.read_knowledge={"source":{"id":"source","revision":1,"content":"already read"}}
        await turn.save_checkpoint([])
        self.assertEqual(client.payload["checkpoint"]["knowledge"][0]["content"],"already read")
