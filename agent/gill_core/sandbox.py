"""沙箱实现与工厂：MockSandbox（本地 docker）+ make_sandbox（D15 单向依赖铁律）。

依赖方向：本模块 → sandbox_base（基类）/ remote_sandbox（远程实现，工厂内延迟导入）；
remote_sandbox 只依赖 sandbox_base，不得反向 import 本模块。
"""
from __future__ import annotations
import asyncio
import os

from .sandbox_base import BaseSandbox, CmdResult  # noqa: F401  # CmdResult 供本模块与既有调用方使用


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
    if settings.sandbox == "remote":
        from .remote_sandbox import RemoteSandbox
        return RemoteSandbox(settings)
    return MockSandbox()
