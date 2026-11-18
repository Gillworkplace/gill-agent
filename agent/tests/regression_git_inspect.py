"""Inspect the merged synthetic acceptance workspace using the project sandbox adapter."""
from __future__ import annotations
import asyncio
import json
import sys
from gill_core.config import Settings
from gill_core.team_sandbox import TeamSandbox


async def main() -> None:
    """
    Verify both requirements in an existing, test-owned merged workspace.
    """
    with open(sys.argv[1]) as source:
        target=json.load(source)
    box=TeamSandbox(Settings.load(),target["sandboxId"])
    await box.connect()
    checked=await box.run("""set -eu
test -f percentage.sh
test -f normalize.sh
test "$(bash percentage.sh 100 120)" = 20
test "$(bash percentage.sh 100 80)" = -20
if bash percentage.sh 0 120 >/dev/null 2>&1; then exit 1; fi
test "$(bash normalize.sh '  gill  ')" = GILL
test "$(bash normalize.sh '   ')" = ''
""")
    metadata=await box.run("git rev-parse HEAD && git diff --name-only 7fd1a60b01f91b314f59955a4e4d4e80d8edf11d HEAD")
    result={"expectedCommit":target["commit"],"sandboxId":target["sandboxId"],"check":checked,"metadata":metadata}
    with open(sys.argv[2],"w") as output:
        json.dump(result,output,ensure_ascii=False,indent=2)
    if checked["exitCode"]!=0 or metadata["stdout"].splitlines()[0]!=target["commit"]:
        raise AssertionError("Merged workspace content or commit failed verification")
    print("Merged commit and both requirement programs verified against actual sandbox results")


asyncio.run(main())
