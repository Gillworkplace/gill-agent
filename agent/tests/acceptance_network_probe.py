"""Probe the public Git host from one disposable test sandbox without model calls."""
from __future__ import annotations
import asyncio
import json
import sys
from datetime import datetime, timezone
from gill_core.config import Settings
from gill_core.team_sandbox import TeamSandbox


async def main() -> None:
    """
    Record bounded public network observations and remove only this test sandbox.
    """
    box=TeamSandbox(Settings.load())
    result={"startedAt":datetime.now(timezone.utc).isoformat(),"purpose":"disposable public Git connectivity probe; not coding acceptance"}
    try:
        result["sandboxId"]=await asyncio.wait_for(box.connect(),45)
        result["git"]=await box.run("if ! command -v git >/dev/null; then printf 'Git is not installed in the template\\n'; exit 127; fi; timeout 20 git ls-remote https://github.com/octocat/Hello-World.git HEAD",25)
        result["https"]=await box.run("curl -sS -I -o /dev/null -w 'HTTP %{http_code}\\n' --connect-timeout 10 --max-time 20 https://github.com",25)
    except Exception as error:
        result["error"]={"type":type(error).__name__,"message":str(error)[:500]}
    finally:
        if box.box:
            try:
                await asyncio.wait_for(asyncio.to_thread(box.box.kill),30)
                result["cleanup"]="deleted own sandbox"
            except Exception as error:
                result["cleanup"]={"type":type(error).__name__,"message":str(error)[:200]}
        result["finishedAt"]=datetime.now(timezone.utc).isoformat()
        with open(sys.argv[1],"w") as target:
            json.dump(result,target,ensure_ascii=False,indent=2)
        print(json.dumps(result,ensure_ascii=False))


if __name__=="__main__":
    asyncio.run(main())
