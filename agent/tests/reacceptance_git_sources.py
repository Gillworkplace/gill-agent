"""Inspect actual isolated requirement workspaces for the acceptance coding fixtures."""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

from gill_core.config import Settings
from gill_core.team_sandbox import TeamSandbox


async def main() -> None:
    """Verify branch, saved commit, changed files and functionality of both sources."""
    fixture = json.loads(Path(sys.argv[1]).read_text())
    results = []
    for task in fixture["tasks"]:
        version = next(v for v in fixture["codeVersions"] if v["taskId"] == task["id"])
        expected = "percentage.sh" if task["goal"].startswith("需求A：") else "normalize.sh"
        other = "normalize.sh" if expected == "percentage.sh" else "percentage.sh"
        box = TeamSandbox(Settings.load(), task["sandboxId"])
        await box.connect()
        metadata = await box.run("git rev-parse HEAD && git branch --show-current && git diff --name-only 7fd1a60b01f91b314f59955a4e4d4e80d8edf11d HEAD")
        lines = metadata["stdout"].splitlines()
        assert metadata["exitCode"] == 0
        assert lines[0] == version["commit"]
        assert lines[1] == "work/" + task["id"]
        assert lines[2:] == [expected]
        command = ("test \"$(bash percentage.sh 100 120)\" = 20 && "
                   "test \"$(bash percentage.sh 100 80)\" = -20 && "
                   "! bash percentage.sh 0 120 >/dev/null 2>&1") if expected == "percentage.sh" else (
                   "test \"$(bash normalize.sh '  gill  ')\" = GILL && "
                   "test \"$(bash normalize.sh '   ')\" = ''")
        checked = await box.run("set -eu; test ! -e " + other + "; " + command)
        assert checked["exitCode"] == 0
        results.append({"taskId": task["id"], "expectedFile": expected, "metadata": metadata, "checked": checked})
    Path(sys.argv[2]).write_text(json.dumps(results, ensure_ascii=False, indent=2))
    print("Both actual source workspaces, isolation and functional results verified")


if __name__ == "__main__":
    asyncio.run(main())
