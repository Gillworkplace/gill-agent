"""本机 → 沙箱机 远端直连冒烟（官方 cubesandbox SDK + CUBE_PROXY_NODE_IP，直连不走代理）。"""
import os
os.environ["NO_PROXY"] = "39.107.34.109,.cube.app,localhost,127.0.0.1"
os.environ["no_proxy"] = os.environ["NO_PROXY"]
os.environ["CUBE_API_URL"] = "http://39.107.34.109:3000"
os.environ["CUBE_API_KEY"] = "e2b_00000000000000000000000000000"
os.environ["CUBE_TEMPLATE_ID"] = "tpl-36e33e4394ae4730847348e4"
os.environ["CUBE_PROXY_NODE_IP"] = "39.107.34.109"

from cubesandbox import Sandbox, Config

cfg = Config(api_url="http://39.107.34.109:3000",
             api_key="e2b_00000000000000000000000000000",
             template_id="tpl-36e33e4394ae4730847348e4",
             proxy_node_ip="39.107.34.109")
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
print("6) killed OK")
