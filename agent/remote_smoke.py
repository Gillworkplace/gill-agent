"""本机 → 沙箱机 远端直连冒烟（不经代理）：创建沙箱/命令执行/chromium/CDP。"""
import os
# 强制直连（本机 shell 有全局 http_proxy，访问沙箱机绝不能走代理 —— 用户明确要求）
os.environ["NO_PROXY"] = "39.107.34.109,.cube.app,localhost,127.0.0.1"
os.environ["no_proxy"] = os.environ["NO_PROXY"]
os.environ["E2B_API_URL"] = "http://39.107.34.109:3000"
os.environ["E2B_API_KEY"] = "e2b_00000000000000000000000000000"
os.environ["CUBE_REMOTE_PROXY_BASE"] = "https://39.107.34.109"
os.environ["CUBE_REMOTE_PROXY_VERIFY_SSL"] = "false"

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent / "e2b-dev-sidecar"))
import dev_sidecar
dev_sidecar.setup_dev_sidecar()

from e2b import Sandbox
import time

TPL = os.environ.get("CUBE_TEMPLATE_ID", "tpl-36e33e4394ae4730847348e4")
sb = Sandbox.create(template=TPL, timeout=600)
print("1) created:", sb.sandbox_id)
for i in range(6):
    try:
        r = sb.commands.run("echo ping"); print("2) envd ok:", r.stdout.strip()); break
    except Exception as e:
        print("   retry", i, str(e)[:110]); time.sleep(5)
r = sb.commands.run("chromium --version"); print("3) chromium:", (r.stdout or r.stderr).strip())
r = sb.commands.run("start-chromium.sh && curl -s --max-time 8 http://127.0.0.1:9222/json/version | head -3")
print("4) CDP:", (r.stdout or r.stderr)[:200])
# 经 CubeProxy 数据面访问沙箱 9222（agentd 投屏将走的路径）
port = sb.commands.run("curl -s --max-time 5 http://127.0.0.1:49999/health >/dev/null; echo $?").stdout.strip()
host = sb.get_host(9222)
print("5) proxy host for 9222:", host)
import urllib.request, ssl
ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
try:
    req = urllib.request.Request(host.replace("https://", "https://") + "/json/version")
    print("   via proxy:", urllib.request.urlopen(req, timeout=10, context=ctx).read()[:80])
except Exception as e:
    print("   via proxy err:", str(e)[:120])
sb.kill(); print("6) killed OK")
