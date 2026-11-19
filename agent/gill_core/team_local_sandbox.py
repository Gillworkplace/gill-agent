"""Execute a single team's job in Docker on the CLI machine."""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import shlex
import subprocess
from dataclasses import dataclass
from pathlib import Path

from .team_sandbox import TeamSandbox


@dataclass(frozen=True)
class LocalWorker:
    """One authenticated CLI worker bound to an explicit directory and project scope."""

    directory: Path
    owner_id: int
    project_id: str
    runner_id: str

    @property
    def binding(self) -> str:
        """
        Identify the configured directory across restarts of this CLI installation.

        :returns: Short hash of runner identity and canonical directory.
        """
        return hashlib.sha256(f"{self.runner_id}\n{self.directory.resolve()}".encode()).hexdigest()[:24]

    def resolve_directory(self, relative: str) -> Path:
        """
        Resolve a selected directory inside the startup root.

        :param relative: Slash-separated path relative to the root. Empty selects the root.
        :returns: Canonical directory on this CLI host.
        :raises ValueError: If the path is invalid, a symbolic link, or outside the root.
        :raises OSError: If the directory is inaccessible or has disappeared.
        """
        if not isinstance(relative, str) or len(relative) > 4096:
            raise ValueError("无效 CLI 相对目录")
        parts = relative.split("/") if relative else []
        if any(not _visible_directory_name(part) for part in parts):
            raise ValueError("无效 CLI 相对目录")
        root = self.directory
        candidate = root.joinpath(*parts)
        try:
            resolved = candidate.resolve(strict=True)
        except RuntimeError as error:
            raise ValueError("CLI 工作目录不能是循环符号链接") from error
        if resolved != candidate or not resolved.is_dir():
            raise ValueError("CLI 工作目录必须是启动目录内的真实目录")
        return resolved

    def inspect_directory(self, relative: str) -> dict:
        """
        List selectable child directories by name on the CLI host.

        :param relative: Validated slash-separated path relative to the startup root.
        :returns: ``children`` (list of directory names), ``hasGit`` (whether a Git marker is present).
        :raises OSError: If the host cannot list the selected directory.
        :raises ValueError: If the selected directory is invalid.
        """
        path = self.resolve_directory(relative)
        marker = path / ".git"
        with os.scandir(path) as entries:
            children = sorted(entry.name for entry in entries
                              if _visible_directory_name(entry.name) and entry.is_dir(follow_symlinks=False))[:2000]
        return {"children": children, "hasGit": not marker.is_symlink() and (marker.is_dir() or marker.is_file())}

    def directory_for(self, project: dict) -> Path:
        """
        Resolve the project directory adopted by a leased job.

        :param project: Project snapshot from the gateway, or an empty dictionary.
        :returns: Canonical workspace source on the CLI host.
        :raises ValueError: If the job's project or startup root differs from this CLI.
        :raises OSError: If the adopted directory is inaccessible.
        """
        selected = project.get("localDirectory")
        if selected:
            if self.project_id or selected.get("rootId") != self.binding:
                raise ValueError("项目绑定了另一 CLI 启动目录")
            return self.resolve_directory(selected["path"])
        if project.get("id", "") != self.project_id:
            raise ValueError("领取的项目与 CLI 启动配置不一致")
        return self.resolve_directory("")


def _visible_directory_name(name: str) -> bool:
    return bool(name) and not name.startswith(".") and all(
        character not in '/\\,"' and ord(character) >= 32 and not 127 <= ord(character) <= 159
        for character in name
    )


class LocalDockerSandbox(TeamSandbox):
    """Keep the selected checkout read-only and persist separate execution directories."""

    uses_local_directory = True

    def __init__(self, directory: Path, job_id: str, previous: str, runner_id: str) -> None:
        """
        Bind this execution to the explicit CLI directory and runner.

        :param directory: Source directory selected by the operator on this machine.
        :param job_id: Identifier allocated by the gateway.
        :param previous: Previously persisted execution resource ID, if any.
        :param runner_id: Stable identity of this CLI installation.
        """
        self.source = directory.resolve(strict=True)
        if not self.source.is_dir() or not re.fullmatch(r"[a-z0-9-]{1,64}", job_id):
            raise ValueError("无效 CLI 工作目录或执行标识")
        if any(character in str(self.source) for character in (',', '"', '\n', '\r')):
            raise ValueError("CLI 工作目录包含 Docker 挂载不支持的字符")
        binding = hashlib.sha256(f"{runner_id}\n{self.source}".encode()).hexdigest()[:24]
        self.sandbox_id, self.previous = f"cli-{binding}-{job_id}", previous
        self.root = self.source / ".gill" / "workspaces" / job_id
        self.workspace = self.root / "workspace"
        self.transfers = self.root / "transfers"
        self.image = os.getenv("GILL_LOCAL_EXECUTOR_IMAGE", "gill-local-executor:latest")

    async def connect(self) -> str:
        """
        Allocate or reattach to the stable on-disk execution directory.

        :returns: CLI resource ID scoped to the host, directory and job.
        :raises ValueError: If a previous job belongs to a different resource.
        """
        if self.previous and self.previous != self.sandbox_id:
            raise ValueError("原执行绑定了另一台 CLI 或目录，请在原 CLI 工作目录恢复")
        for path in (self.workspace, self.transfers):
            if path.resolve() != path:
                raise ValueError("执行工作目录不能是符号链接")
            if self.previous and not path.is_dir():
                raise ValueError("原 CLI 工作区已不存在")
            path.mkdir(parents=True, exist_ok=True)
        return self.sandbox_id

    def _docker(self, command: str, timeout: int, source: bool = False,
                data: bytes | None = None) -> subprocess.CompletedProcess[bytes]:
        args = ["docker", "run", "--rm", "-i", "--init", "--cap-drop", "ALL",
                "--security-opt", "no-new-privileges", "--pids-limit", "256", "--memory", "2g", "--cpus", "2",
                "--user", f"{os.getuid()}:{os.getgid()}", "--env", "HOME=/tmp", "--workdir", "/workspace",
                "--mount", f"type=bind,src={self.workspace},dst=/workspace",
                "--mount", f"type=bind,src={self.transfers},dst=/tmp"]
        if source:
            args.extend(["--network", "none", "--mount", f"type=bind,src={self.source},dst=/gill-source,readonly"])
        limit = min(max(timeout, 1), 300)
        args.extend(["--entrypoint", "timeout", self.image, "-k", "3", str(limit), "sh", "-c", command])
        return subprocess.run(args, input=data if data is not None else b"", capture_output=True, timeout=limit + 15)

    async def _run(self, command: str, timeout: int, source: bool = False) -> dict:
        result = await asyncio.to_thread(self._docker, command, timeout, source)
        receipt = {"exitCode": result.returncode, "stdout": result.stdout.decode(errors="replace")[-30000:],
                   "stderr": result.stderr.decode(errors="replace")[-8000:], "sandboxId": self.sandbox_id}
        with (self.root / "commands.jsonl").open("a", encoding="utf-8") as history:
            history.write(json.dumps({"command": command, **receipt}, ensure_ascii=False) + "\n")
        return receipt

    async def run(self, command: str, timeout: int = 60) -> dict:
        """
        Run a bounded shell command with this workspace mounted in a disposable container.

        :param command: Shell command to run inside the container.
        :param timeout: Maximum command duration in seconds.
        :returns: Command exit code, output and local resource ID.
        """
        return await self._run(command, timeout)

    async def write_transfer(self, path: str, data: bytes) -> None:
        """
        Transfer file bytes within Docker so host code never follows workload paths.

        :param path: Container transfer path.
        :param data: Bytes to write.
        """
        quoted = shlex.quote(path)
        result = await asyncio.to_thread(self._docker, f"rm -f -- {quoted} && cat > {quoted}", 120, False, data)
        if result.returncode:
            raise RuntimeError(result.stderr.decode(errors="replace")[-500:])

    async def read_transfer(self, path: str) -> bytes:
        """
        Read a bounded container artifact without following paths on the host.

        :param path: Container transfer path.
        :returns: Artifact bytes.
        """
        maximum = int(os.getenv("GILL_TEAM_BUNDLE_MAX_BYTES", str(64 * 1024 * 1024)))
        result = await asyncio.to_thread(self._docker, f"head -c {maximum + 1} -- {shlex.quote(path)}", 120)
        if result.returncode or len(result.stdout) > maximum:
            raise RuntimeError("无法读取 CLI 工作区归档，或归档超过大小限制")
        return result.stdout

    async def write(self, path: str, content: str) -> dict:
        """
        Write a file inside this execution's Docker workspace.

        :param path: Workspace-relative file path.
        :param content: Text to write.
        :returns: Written path and UTF-8 size.
        """
        target = self.path(path)
        created = await self.run("mkdir -p -- " + shlex.quote(str(Path(target).parent)))
        if created["exitCode"]:
            raise RuntimeError(created["stderr"])
        data = content.encode()
        await self.write_transfer(target, data)
        return {"path": target, "bytes": len(data)}

    async def read(self, path: str) -> dict:
        """
        Read a text file from this execution's Docker workspace.

        :param path: Workspace-relative file path.
        :returns: Validated path and text content.
        """
        target = self.path(path)
        result = await self.run("tail -c 30000 -- " + shlex.quote(target))
        if result["exitCode"]:
            raise RuntimeError(result["stderr"])
        return {"path": target, "content": result["stdout"]}

    async def prepare_git(self, project: dict, task_id: str) -> dict:
        """
        Initialize a task branch from the chosen directory or a saved project baseline.

        :param project: Target branch and existing baseline reference.
        :param task_id: Task identity for the writable Git branch.
        :returns: Actual Git command receipt.
        """
        target = shlex.quote(project.get("targetBranch") or "main")
        branch = shlex.quote("work/" + task_id)
        init = f"git check-ref-format --branch {target} >/dev/null && git init -q -b {target} && "
        init += "git config user.name Gill && git config user.email gill@local && "
        commit = ("git add -A && GIT_AUTHOR_DATE=2000-01-01T00:00:00Z GIT_COMMITTER_DATE=2000-01-01T00:00:00Z "
                  "git commit -q --allow-empty -m 'Initial workspace'")
        finish = f" && git checkout -q -B {branch} && git rev-parse HEAD"
        if project.get("baselineBundle"):
            return await self.run(init + commit + finish, 180)
        source_ref = "HEAD" if project.get("sourceHead") else target
        setup = (f"if [ -e /gill-source/.git ]; then git -c safe.directory=/gill-source fetch -q -- /gill-source {source_ref} "
                 f"&& git checkout -q -B {target} FETCH_HEAD; "
                 "else tar --exclude='./.gill' -C /gill-source -cf /tmp/gill-source.tar . "
                 "&& tar -xf /tmp/gill-source.tar && " + commit + "; fi")
        return await self._run(init + setup + finish, 180, source=True)
