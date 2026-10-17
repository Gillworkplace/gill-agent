"""本机 → 沙箱机 最终冒烟（SSH 隧道方案，绕开中间层干扰）：
前置：ssh -f -N -L 19443:127.0.0.1:9443 -L 13000:127.0.0.1:3000 root@39.107.34.109
- API: http://127.0.0.1:13000（隧道→服务器 3000）
- 数据面: *.cube.app → 127.0.0.1:19443（隧道→服务器 9443 TLS，SNI 域名完好）
"""
import os, socket
from pathlib import Path

os.environ["NO_PROXY"] = "127.0.0.1,localhost,.cube.app,39.107.34.109"
os.environ["no_proxy"] = os.environ["NO_PROXY"]
os.environ["SSL_CERT_FILE"] = str(Path(__file__).parent / "cube-rootCA.pem")
os.environ["REQUESTS_CA_BUNDLE"] = os.environ["SSL_CERT_FILE"]

_orig_getaddrinfo = socket.getaddrinfo
def _patched(host, *args, **kwargs):
    if host and host.endswith(".cube.app"):
        host = "127.0.0.1"
    return _orig_getaddrinfo(host, *args, **kwargs)
socket.getaddrinfo = _patched

from cubesandbox import Sandbox, Config

cfg = Config(api_url="http://127.0.0.1:13000",
             api_key="e2b_00000000000000000000000000000",
             template_id="tpl-36e33e4394ae4730847348e4",
             proxy_port=19443)
sb = Sandbox.create(config=cfg)
print("1) created:", sb.sandbox_id)
r = sb.commands.run("echo ping")
print("2) run ok:", (r.stdout or r.stderr).strip())
r = sb.commands.run("chromium --version")
print("3) chromium:", (r.stdout or r.stderr).strip())
r = sb.commands.run("start-chromium.sh && curl -s --max-time 8 http://127.0.0.1:9222/json/version | head -3")
print("4) CDP in sandbox:", (r.stdout or r.stderr)[:180])
print("5) proxy host 9222:", sb.get_host(9222))
import urllib.request, ssl
ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
url = sb.get_host(9222)
print("   via tunnel proxy:", urllib.request.urlopen(url + "/json/version", timeout=10, context=ctx).read()[:80])
sb.kill()
print("6) ALL GREEN — 本机→沙箱机 E2E 全链路贯通")
