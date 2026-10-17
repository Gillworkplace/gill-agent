"""本机 → 沙箱机 远端直连冒烟 v3：
- getaddrinfo 补丁实现 *.cube.app → 39.107.34.109（保留域名 SNI，解决 443 TLS 挂起）
- 信任服务器 mkcert rootCA（SSL_CERT_FILE）
- 全程直连（NO_PROXY）
"""
import os, socket, ssl
from pathlib import Path

SBX_IP = "39.107.34.109"
os.environ["NO_PROXY"] = f"{SBX_IP},.cube.app,localhost,127.0.0.1"
os.environ["no_proxy"] = os.environ["NO_PROXY"]
ca = str(Path(__file__).parent / "cube-rootCA.pem")
os.environ["SSL_CERT_FILE"] = ca
os.environ["REQUESTS_CA_BUNDLE"] = ca

_orig_getaddrinfo = socket.getaddrinfo
def _patched(host, *args, **kwargs):
    if host and host.endswith(".cube.app"):
        host = SBX_IP
    return _orig_getaddrinfo(host, *args, **kwargs)
socket.getaddrinfo = _patched

from cubesandbox import Sandbox, Config

cfg = Config(api_url=f"http://{SBX_IP}:3000",
             api_key="e2b_00000000000000000000000000000",
             template_id="tpl-36e33e4394ae4730847348e4")
sb = Sandbox.create(config=cfg)
print("1) created:", sb.sandbox_id)
r = sb.commands.run("echo ping")
print("2) run ok:", (r.stdout or r.stderr).strip())
r = sb.commands.run("chromium --version")
print("3) chromium:", (r.stdout or r.stderr).strip())
r = sb.commands.run("start-chromium.sh && curl -s --max-time 8 http://127.0.0.1:9222/json/version | head -3")
print("4) CDP:", (r.stdout or r.stderr)[:200])
print("5) proxy host 9222:", sb.get_host(9222))
sb.kill()
print("6) killed OK — 本机→沙箱机 全链路贯通")
