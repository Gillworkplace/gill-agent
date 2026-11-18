"""Verify the integration adapter against a real local Git merge conflict."""
from __future__ import annotations

import asyncio
import json
import os
import shlex
import subprocess
import tempfile
from pathlib import Path
from unittest.mock import patch

from gill_core.team_git import TeamGit


class Workspace:
    """Run Git in a disposable local repository with isolated Git configuration."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self.box = self
        self.files = self

    def write(self, path: str, data: bytes) -> None:
        self.path.joinpath(Path(path).name).write_bytes(data)

    async def run(self, command: str, timeout: int = 30) -> dict:
        """
        Run a fixture or adapter command in the dedicated repository.

        :param command: Shell command from the fixture or Git integration adapter.
        :param timeout: Upper bound for command completion in seconds.
        :returns: Result with exitCode (int), stdout (str) and stderr (str).
        """
        command = command.replace("/tmp/gill-source.bundle", shlex.quote(str(self.path / "gill-source.bundle")))
        result = subprocess.run(command, shell=True, cwd=self.path, capture_output=True, text=True,
                                timeout=timeout, env={**os.environ, "GIT_CONFIG_GLOBAL": os.devnull,
                                                      "GIT_CONFIG_SYSTEM": os.devnull})
        return {"exitCode": result.returncode, "stdout": result.stdout, "stderr": result.stderr}


class SourceBundle:
    """Expose the bytes from the fixture's actual Git bundle."""

    def __init__(self, path: Path) -> None:
        self.path = path

    async def read(self, key: str) -> bytes:
        """
        Return the exact source bundle bytes in the fixture.

        :param key: Fixture bundle reference.
        :returns: Git bundle bytes.
        """
        assert key == "source-bundle"
        return self.path.read_bytes()


async def main() -> None:
    """Verify a conflicting merge preserves the target and skips the check."""
    with tempfile.TemporaryDirectory(prefix="gill-git-conflict-") as directory:
        repo = Workspace(Path(directory))
        setup = await repo.run("""set -eu
        git init -q -b main
        git config user.name 'Gill acceptance'
        git config user.email 'fixture@gill.local'
        echo common > requirements.txt
        git add requirements.txt
        git commit -qm common
        git switch -qc source
        echo source > requirements.txt
        git commit -qam source
        git rev-parse HEAD
        git bundle create source.bundle source
        git switch -q main
        echo target > requirements.txt
        git commit -qam target
        git rev-parse HEAD
        """)
        assert setup["exitCode"] == 0, setup
        source, target = setup["stdout"].strip().splitlines()
        project = {"targetBranch": "main", "baselineCommit": target, "checkCommand": "touch check-ran"}
        with patch("gill_core.team_git.TeamObjects", return_value=SourceBundle(repo.path / "source.bundle")):
            adapter = TeamGit(repo, {"teamId": "fixture", "taskId": "fixture", "project": project})
            result = await adapter.integrate({"expectedTarget": target}, {"commit": source, "bundleKey": "source-bundle"})
        current = await repo.run("git rev-parse HEAD && git diff --exit-code && git diff --cached --exit-code && test ! -e check-ran && test ! -f .git/MERGE_HEAD")
        assert result["state"] == "conflict" and result["exitCode"] != 0 and result["remotePublished"] is False
        assert current["exitCode"] == 0 and current["stdout"].strip() == target
        print(json.dumps({"case": "real-git-conflict", "source": source, "expectedTarget": target,
                          "targetPreserved": True, "checksSkipped": True, "result": result}))


if __name__ == "__main__":
    asyncio.run(main())
