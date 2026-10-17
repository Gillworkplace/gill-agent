"""沙箱抽象：RemoteSandbox(E2B/Cube) 与 MockSandbox(本地 docker) 同构（FR-51~55）。"""
from __future__ import annotations
import asyncio
import os
from dataclasses import dataclass
from typing import Callable, Awaitable


@dataclass
class CmdResult:
    exit_code: int
    stdout: str
    stderr: str
    duration_ms: int


class BaseSandbox:
    """所有命令/文件操作均在沙箱内（web/agentd 容器零执行 —— 需求 FR-51）。"""

    async def run(self, command: str, timeout: int = 60,
                  on_stdout: Callable[[str], Awaitable[None]] | None = None,
                  on_stderr: Callable[[str], Awaitable[None]] | None = None) -> CmdResult: ...
    async def write_file(self, path: str, content: str) -> None: ...
    async def read_file(self, path: str) -> str: ...
    async def kill(self) -> None: ...


class RemoteSandbox(BaseSandbox):
    """E2B SDK → CubeSandbox（E2B_API_URL 指向沙箱机 3000）。"""

    def __init__(self, settings):
        from e2b import AsyncSandbox  # sandbox extra
        self._sb = AsyncSandbox(template=settings.cube_template_id, timeout=300)

    async def run(self, command, timeout=60, on_stdout=None, on_stderr=None):
        r = await self._sb.commands.run(command, timeout=timeout)
        return CmdResult(r.exit_code, r.stdout or "", r.stderr or "", int(r.duration * 1000))

    async def write_file(self, path, content):
        await self._sb.files.write(path, content)

    async def read_file(self, path) -> str:
        return await self._sb.files.read(path)

    async def kill(self):
        await self._sb.kill()


class MockSandbox(BaseSandbox):
    """开发/测试用：惰性创建一个持久容器，命令经 docker exec 执行（状态跨命令保留，
    对齐 FR-22；仍保证不在宿主机执行——FR-51）。"""

    IMAGE = os.getenv("GILL_MOCK_IMAGE", "python:3.12-slim")
    NAME = "gill-mock-sbx"

    async def _ensure(self):
        import subprocess
        if subprocess.run(["docker", "inspect", self.NAME], capture_output=True).returncode != 0:
            subprocess.run(["docker", "run", "-d", "--name", self.NAME,
                            "-m", "768m", "--cpus", "1", self.IMAGE, "sleep", "infinity"],
                           check=True, capture_output=True)

    async def run(self, command, timeout=60, on_stdout=None, on_stderr=None):
        await self._ensure()
        proc = await asyncio.create_subprocess_exec(
            "docker", "exec", self.NAME, "sh", "-lc", command,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        try:
            out, err = await asyncio.wait_for(proc.communicate(), timeout)
            if on_stdout and out:
                await on_stdout(out.decode("utf-8", "replace"))
            if on_stderr and err:
                await on_stderr(err.decode("utf-8", "replace"))
            return CmdResult(proc.returncode or 0, out.decode("utf-8", "replace"),
                             err.decode("utf-8", "replace"), 0)
        except asyncio.TimeoutError:
            proc.kill()
            return CmdResult(-1, "", f"timeout after {timeout}s", timeout * 1000)

    async def write_file(self, path, content):
        import shlex
        r = await self.run(f"mkdir -p $(dirname {shlex.quote(path)}) && cat > {shlex.quote(path)} <<'__EOF__'\n{content}\n__EOF__")
        assert r.exit_code == 0, r.stderr

    async def read_file(self, path) -> str:
        import shlex
        r = await self.run(f"cat {shlex.quote(path)}")
        assert r.exit_code == 0, r.stderr
        return r.stdout

    async def kill(self):
        import subprocess
        subprocess.run(["docker", "rm", "-f", self.NAME], capture_output=True)


def make_sandbox(settings) -> BaseSandbox:
    return RemoteSandbox(settings) if settings.sandbox == "remote" else MockSandbox()
