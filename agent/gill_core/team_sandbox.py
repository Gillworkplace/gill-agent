"""每个执行实例独立的远程沙箱及受控工作区版本操作。"""
from __future__ import annotations
import asyncio
import os
import shlex
from pathlib import PurePosixPath
from .config import Settings


class TeamSandbox:
    """Own one durable remote resource reference without sharing session history."""

    def __init__(self, settings: Settings, sandbox_id: str = "") -> None:
        """
        Initialize an unconnected sandbox reference.

        :param settings: Existing project sandbox configuration.
        :param sandbox_id: Previously recorded sandbox ID to reconnect.
        """
        self.settings, self.sandbox_id = settings, sandbox_id
        self.box = None

    async def connect(self) -> str:
        """
        Connect or create this execution's isolated resource.

        :returns: Actual remote sandbox ID.
        """
        from cubesandbox import Sandbox, Config
        config = Config(api_url=os.getenv("CUBE_API_URL", self.settings.cube_api_url),
                        api_key=self.settings.e2b_api_key,
                        template_id=os.getenv("CUBE_TEMPLATE_ID", self.settings.cube_template_id),
                        proxy_node_ip=os.getenv("CUBE_PROXY_NODE_IP", self.settings.cube_ip),
                        proxy_port=int(os.getenv("CUBE_PROXY_PORT_HTTP", "80")))
        if self.sandbox_id:
            self.box = await asyncio.to_thread(Sandbox.connect, self.sandbox_id, config=config)
        else:
            self.box = await asyncio.to_thread(Sandbox.create, config=config)
        self.sandbox_id = self.box.sandbox_id
        await asyncio.to_thread(self.box.set_timeout, self.settings.sandbox_idle_ttl)
        return self.sandbox_id

    async def run(self, command: str, timeout: int = 60) -> dict:
        """
        Execute only inside the isolated remote workspace.

        :param command: Shell command text.
        :param timeout: Maximum command duration in seconds.
        :returns: Result containing exitCode (int), stdout (str), stderr (str).
        """
        command = "mkdir -p /workspace && cd /workspace && " + command
        result = await asyncio.to_thread(self.box.commands.run, command, timeout=min(max(timeout, 1), 300))
        return {"exitCode": result.exit_code, "stdout": (result.stdout or "")[-30000:],
                "stderr": (result.stderr or "")[-8000:], "sandboxId": self.sandbox_id}

    def path(self, path: str) -> str:
        """
        Validate a file API path inside the writable workspace.

        :param path: Absolute or relative file path.
        :returns: Normalized absolute workspace path.
        :raises ValueError: When traversal or paths outside the workspace are requested.
        """
        value = PurePosixPath(path if path.startswith("/") else "/workspace/" + path)
        if ".." in value.parts or not str(value).startswith("/workspace/"):
            raise ValueError("File path must remain inside /workspace")
        return str(value)

    async def write(self, path: str, content: str) -> dict:
        """
        Write a workspace text file.

        :param path: Workspace file path.
        :param content: Text to write.
        :returns: Result with path (str) and bytes (int).
        """
        target = self.path(path)
        parent = str(PurePosixPath(target).parent)
        result = await self.run("mkdir -p " + shlex.quote(parent))
        if result["exitCode"] != 0:
            raise RuntimeError(result["stderr"])
        await asyncio.to_thread(self.box.files.write, target, content)
        return {"path": target, "bytes": len(content.encode())}

    async def read(self, path: str) -> dict:
        """
        Read a workspace text file.

        :param path: Workspace file path.
        :returns: Result with path (str) and content (str).
        """
        target = self.path(path)
        content = await asyncio.to_thread(self.box.files.read, target)
        return {"path": target, "content": str(content)[-60000:]}

    async def prepare_git(self, project: dict, task_id: str) -> dict:
        """
        Initialize an isolated Git working branch using the configured read source.

        :param project: Authorized project configuration.
        :param task_id: Current task identifier used for branch isolation.
        :returns: Shell result with exitCode, stdout and stderr.
        """
        install = ("command -v git >/dev/null || "
                   "(if [ \"$(id -u)\" = 0 ]; then apt-get update -qq && apt-get install -y -qq git; "
                   "else sudo apt-get update -qq && sudo apt-get install -y -qq git; fi)")
        result = await self.run(install, 180)
        if result["exitCode"] != 0:
            return result
        url = project.get("repositoryUrl", "")
        if url and (not url.startswith("https://") or "@" in url.split("://", 1)[1].split("/", 1)[0]):
            raise ValueError("Only HTTPS read repositories without embedded credentials are accepted")
        if url:
            setup = "test -d /workspace/.git || git clone -- " + shlex.quote(url) + " /workspace"
        else:
            setup = "test -d /workspace/.git || (git init -b main && GIT_AUTHOR_DATE=2000-01-01T00:00:00Z GIT_COMMITTER_DATE=2000-01-01T00:00:00Z git -c user.name=Gill -c user.email=gill@local commit --allow-empty -m 'Initial workspace')"
        result = await self.run(setup, 180)
        if result["exitCode"] != 0:
            return result
        return await self.run("git config user.name Gill && git config user.email gill@local && "
                              "git checkout -B " + shlex.quote("work/" + task_id) + " && git rev-parse HEAD")

    async def save_version(self, summary: str) -> dict:
        """
        Commit the current task worktree and return exact local references.

        :param summary: Commit summary.
        :returns: Actual command result and commit output.
        """
        return await self.run("git add -A && (git diff --cached --quiet || git commit -m " +
                              shlex.quote(summary) + ") && git rev-parse HEAD && git status --porcelain", 90)
