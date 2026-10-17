"""远程沙箱（CubeSandbox，官方 cubesandbox SDK）—— 所有命令/文件操作的真身（FR-51~55）。

连接方式自适应：
- 进程内默认打 getaddrinfo 补丁把 *.cube.app 指到 cube_ip（保留域名 SNI）
- API 地址可用 api_url 直接指定（本机隧道场景传 http://127.0.0.1:13000）
- 数据面默认走 HTTP 80（官方 SDK proxy_port 语义）
"""
from __future__ import annotations
import os
import socket as _socket
from .config import Settings
from .sandbox import BaseSandbox, CmdResult


class RemoteSandbox(BaseSandbox):
    def __init__(self, settings: Settings, session_id: str | None = None):
        from cubesandbox import Sandbox as CubeSandbox, Config
        # 域名重定向补丁（须在 SDK 使用前全局生效一次）
        _install_dns_patch(settings.cube_ip)
        cfg = Config(api_url=settings.cube_api_url, api_key=settings.e2b_api_key,
                     template_id=settings.cube_template_id)
        self._sb = CubeSandbox.create(config=cfg)
        self._sb.set_timeout(settings.sandbox_idle_ttl)
        self.sandbox_id = self._sb.sandbox_id

    async def run(self, command, timeout=60, on_stdout=None, on_stderr=None):
        import asyncio, time
        t0 = time.time()
        r = await asyncio.to_thread(self._sb.commands.run, command, timeout=timeout)
        if on_stdout and r.stdout:
            await on_stdout(r.stdout)
        if on_stderr and r.stderr:
            await on_stderr(r.stderr)
        return CmdResult(r.exit_code, r.stdout or "", r.stderr or "",
                         int((time.time() - t0) * 1000))

    async def write_file(self, path, content):
        import asyncio
        await asyncio.to_thread(self._sb.files.write, path, content)

    async def read_file(self, path) -> str:
        import asyncio
        return await asyncio.to_thread(self._sb.files.read, path)

    async def kill(self):
        import asyncio
        await asyncio.to_thread(self._sb.kill)

    # CDP 访问公式（memory: /sandbox/<sid>/<port>/ + Host: localhost）
    def cdp_url(self, port: int = 9223) -> tuple[str, str]:
        """返回 (base_url, host_header)：经 CubeProxy 访问沙箱内 CDP 的完整路径。"""
        return (f"http://{self._api_host()}/sandbox/{self.sandbox_id}/{port}", "localhost")

    def _api_host(self) -> str:
        return os.getenv("CUBE_PUBLIC_HOST", "39.107.34.109")


_DNS_PATCHED = False
def _install_dns_patch(cube_ip: str):
    global _DNS_PATCHED
    if _DNS_PATCHED:
        return
    orig = _socket.getaddrinfo
    def patched(host, *args, **kwargs):
        if host and host.endswith(".cube.app"):
            host = cube_ip
        return orig(host, *args, **kwargs)
    _socket.getaddrinfo = patched
    _DNS_PATCHED = True
