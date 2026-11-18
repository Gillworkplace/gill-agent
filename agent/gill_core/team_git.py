"""受控本地 Git 版本、隔离需求工作区及真实检查后的项目基线集成。"""
from __future__ import annotations
import re
import shlex
import uuid
from .team_objects import TeamObjects
from .team_sandbox import TeamSandbox


def validate_integration(project: dict, expected_target: str) -> str:
    """
    Validate the configured branch and baseline before executing a merge.

    :param project: Authorized current project configuration.
    :param expected_target: Baseline commit referenced by the integration request.
    :returns: Authorized target branch name.
    :raises ValueError: When protection, checks or the expected baseline reject integration.
    """
    target = project.get("targetBranch") or "main"
    if target in project.get("protectedBranches", []):
        raise ValueError("目标分支受保护，不允许自主集成")
    if not project.get("checkCommand", "").strip():
        raise ValueError("项目尚未配置实际检查命令，请管理者配置后再集成")
    if not expected_target or project.get("baselineCommit") != expected_target:
        raise ValueError("目标基线已变化，请重新评估和检查")
    return target


class TeamGit:
    """Compose isolated Git operations with immutable archive storage."""

    def __init__(self, sandbox: TeamSandbox, context: dict) -> None:
        """
        Initialize a version adapter for the current execution.

        :param sandbox: Connected TeamSandbox.
        :param context: Trusted execution context with team, project and task references.
        """
        self.sandbox, self.context = sandbox, context
        self.objects = TeamObjects(context["teamId"])

    async def prepare(self) -> dict:
        """
        Restore a configured baseline into an isolated writable branch.

        :returns: Actual preparation command result.
        """
        local = self.sandbox.uses_local_directory
        exists = await self.sandbox.run("test -f /tmp/gill-project-ready" if local else "test -d .git")
        if exists["exitCode"] == 0:
            return exists
        result = await self._initialize()
        if local and result["exitCode"] == 0:
            await self.sandbox.write_transfer("/tmp/gill-project-ready", b"ready")
        return result

    async def _initialize(self) -> dict:
        project = self.context.get("project", {})
        # Install Git without cloning first, then restore the explicit immutable baseline.
        bootstrap = {"targetBranch": project.get("targetBranch") or "main", "baselineBundle": project.get("baselineBundle"),
                     "sourceHead": not project}
        prepared = await self.sandbox.prepare_git(bootstrap, self.context["taskId"])
        if prepared["exitCode"] != 0:
            return prepared
        key = project.get("baselineBundle", "")
        if key:
            data = await self.objects.read(key)
            await self.sandbox.write_transfer("/tmp/gill-base.bundle", data)
            target = project.get("targetBranch") or "main"
            baseline = project["baselineCommit"]
            return await self.sandbox.run(
                "git fetch /tmp/gill-base.bundle '+refs/heads/*:refs/remotes/base/*' && "
                "git checkout -B " + shlex.quote(target) + " " + shlex.quote(baseline) +
                " && git checkout -B " + shlex.quote("work/" + self.context["taskId"]))
        if self.sandbox.uses_local_directory:
            return prepared
        url = project.get("repositoryUrl", "")
        if url:
            if not url.startswith("https://") or "@" in url.split("://", 1)[1].split("/", 1)[0]:
                raise ValueError("代码读取源仅支持无内嵌凭据的HTTPS地址")
            target = project.get("targetBranch") or "main"
            return await self.sandbox.run(
                "git fetch -- " + shlex.quote(url) + " " + shlex.quote(target) +
                " && git checkout -B " + shlex.quote(target) + " FETCH_HEAD && git checkout -B " +
                shlex.quote("work/" + self.context["taskId"]), 180)
        target = project.get("targetBranch") or "main"
        if target != "main":
            return await self.sandbox.run("git branch " + shlex.quote(target) + " main")
        return prepared

    async def archive(self) -> dict:
        """
        Upload all reachable local references as an immutable Git bundle.

        :returns: Archive reference with bundleKey, sha256 and sizeBytes.
        """
        path = f"/tmp/gill-version-{uuid.uuid4().hex}.bundle" if self.sandbox.uses_local_directory else "/tmp/gill-version.bundle"
        result = await self.sandbox.run(f"git bundle create {path} --all", 120)
        if result["exitCode"] != 0:
            raise RuntimeError(result["stderr"])
        return await self.objects.save(await self.sandbox.read_transfer(path))

    async def save(self, summary: str) -> dict:
        """
        Save an actual source version and durable archive.

        :param summary: Human-readable commit summary.
        :returns: Actual version metadata including commit, baseRef, bundleKey and local scope.
        """
        prepared = await self.prepare()
        if prepared["exitCode"] != 0:
            return prepared
        target = self.context.get("project", {}).get("targetBranch") or "main"
        base = await self.sandbox.run("git rev-parse " + shlex.quote(target))
        if base["exitCode"] != 0:
            return base
        committed = await self.sandbox.save_version(summary)
        if committed["exitCode"] != 0:
            return committed
        head = await self.sandbox.run("git rev-parse HEAD")
        return {**await self.archive(), "commit": head["stdout"].strip(), "baseRef": base["stdout"].strip(),
                "summary": summary, "projectId": self.context.get("project", {}).get("id", ""),
                "exitCode": 0, "scope": "managed-local", "remotePublished": False}

    async def integrate(self, request: dict, source: dict) -> dict:
        """
        Merge a persisted source into the authorized local project baseline and run real checks.

        :param request: Integration request with expectedTarget and sourceRef.
        :param source: Persisted source code version reference.
        :returns: Actual check/merge/archive result with remotePublished always false.
        """
        project = self.context["project"]
        target = validate_integration(project, request["expectedTarget"])
        prepared = await self.prepare()
        if prepared["exitCode"] != 0:
            return prepared
        data = await self.objects.read(source["bundleKey"])
        await self.sandbox.write_transfer("/tmp/gill-source.bundle", data)
        checkout = await self.sandbox.run("git checkout " + shlex.quote(target) + " && git rev-parse HEAD")
        if checkout["exitCode"] != 0 or checkout["stdout"].strip() != request["expectedTarget"]:
            raise ValueError("工作区目标与请求基线不一致")
        source_ref = source["commit"]
        if not re.fullmatch(r"[0-9a-f]{40,64}", source_ref):
            raise ValueError("无效源commit")
        merged = await self.sandbox.run("git fetch /tmp/gill-source.bundle " + shlex.quote(source_ref) +
                                       " && git merge --no-commit --no-ff FETCH_HEAD", 120)
        if merged["exitCode"] != 0:
            await self.sandbox.run("git merge --abort")
            return {**merged, "state": "conflict", "remotePublished": False}
        checked = await self.sandbox.run(project["checkCommand"], 180)
        if checked["exitCode"] != 0:
            await self.sandbox.run("git merge --abort")
            return {**checked, "state": "checks_failed", "remotePublished": False}
        result = await self.sandbox.run("if git rev-parse -q --verify MERGE_HEAD >/dev/null; then "
                                       "git commit --allow-empty -m 'Integrate verified requirement'; fi; git rev-parse HEAD", 90)
        if result["exitCode"] != 0:
            return result
        head = await self.sandbox.run("git rev-parse HEAD")
        return {**await self.archive(), "commit": head["stdout"].strip(), "check": checked,
                "exitCode": 0, "state": "verified", "targetBranch": target, "remotePublished": False}
