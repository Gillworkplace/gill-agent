"""沙箱抽象基类（D15 分层依赖铁律）：基类与实现分离，断开 sandbox ↔ remote_sandbox 循环引用。

依赖方向（单向）：remote_sandbox / sandbox（实现+工厂）→ 本模块；本模块不依赖任何 gill_core 模块。
"""
from __future__ import annotations
from dataclasses import dataclass
from typing import Awaitable, Callable


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
