"""Expose frozen template instructions and files only to the adopting execution."""
from __future__ import annotations

import io
import tarfile

from .team_objects import read_template_file
from .team_sandbox import TeamSandbox

TEMPLATE_DIRECTORY = "/tmp/gill-template"


class TemplatePackage:
    """Use exact manifest paths and immutable bytes supplied by the gateway."""

    def __init__(self, files: list[dict]) -> None:
        """
        Attach the authorized manifest for one draft or employee snapshot.

        :param files: Saved manifests containing path, purpose, key and size.
        """
        self.files = {entry["path"]: entry for entry in files}
        self.loaded: dict[str, bytes] = {}

    async def read(self, path: str) -> bytes:
        """
        Read an exact path from this template revision.

        :param path: Relative path listed by the template.
        :returns: Verified bytes of the referenced file.
        :raises ValueError: If the path is not part of the saved template.
        """
        if path not in self.files:
            raise ValueError("找不到该模板文件，请使用清单中的完整相对路径")
        if path not in self.loaded:
            item = self.files[path]
            self.loaded[path] = await read_template_file(item["key"], item["size"])
        return self.loaded[path]

    async def instructions(self) -> str:
        """
        Load explicitly selected instructions and Skill files before a model request.

        :returns: Full instruction text tagged with each saved relative path.
        """
        blocks = []
        for path, item in self.files.items():
            if item["purpose"] in {"prompt", "skill"}:
                blocks.append(f"[{item['purpose']} {path}]\n" + (await self.read(path)).decode("utf-8-sig"))
        return "\n\n".join(blocks)

    async def read_for_model(self, path: str) -> dict:
        """
        Read a text reference without allocating a sandbox.

        :param path: Relative path to the referenced file.
        :returns: File path (str), content (str) and truncated (bool), or its sandbox path (str) for binary files.
        """
        data = await self.read(path)
        if not self.files[path].get("utf8", False):
            return {"path": path, "sandboxPath": f"{TEMPLATE_DIRECTORY}/{path}"}
        text = data.decode("utf-8-sig")
        return {"path": path, "content": text[:16000], "truncated": len(text) > 16000}

    async def stage(self, sandbox: TeamSandbox) -> None:
        """
        Place the saved directory outside the source repository of this execution.

        :param sandbox: Newly connected task sandbox.
        """
        if not self.files:
            return
        archive = io.BytesIO()
        with tarfile.open(fileobj=archive, mode="w") as bundle:
            for path in self.files:
                data = await self.read(path)
                entry = tarfile.TarInfo(path)
                entry.size = len(data)
                bundle.addfile(entry, io.BytesIO(data))
        remote = "/tmp/gill-template-files.tar"
        await sandbox.write_transfer(remote, archive.getvalue())
        result = await sandbox.run(f"mkdir -p {TEMPLATE_DIRECTORY} && tar -xf {remote} -C {TEMPLATE_DIRECTORY}")
        if result["exitCode"] != 0:
            raise RuntimeError("模板文件未能加载到当前沙箱")
