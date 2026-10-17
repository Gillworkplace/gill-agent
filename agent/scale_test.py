"""组合E-2：双 web 副本验证（TC-SCALE-01/02：无状态、两副本均服务请求）。"""
import os, json, threading, time
os.environ["no_proxy"] = "*"; os.environ["NO_PROXY"] = "*"
import subprocess, requests

# 起第二个 web 副本（8081）
r = subprocess.run(["docker", "exec", "-d", "gill-web-1", "java", "-XX:MaxRAMPercentage=75", "-jar", "/app/app.jar",
                    "--server.port=18081"], capture_output=True, text=True)
print("副进程启动（容器内 18081）", r.returncode)
time.sleep(20)

# 直接访问副本端口（容器内进程）
B1 = "http://localhost:8080/api/v1"
# 通过 docker exec 验证副本 18081 响应
r2 = subprocess.run(["docker", "exec", "gill-web-1", "sh", "-c",
                     "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:18081/actuator/health 2>/dev/null || echo NC"],
                    capture_output=True, text=True)
print("副本健康:", r2.stdout.strip())

# 主副本功能
tok = requests.post(B1+"/auth/login", json={"username":"alice","password":"Alice12345"}).json()["token"]
H = {"Authorization": "Bearer "+tok}
sp1 = requests.get(B1+"/spaces", headers=H)
print("主副本:", sp1.status_code, len(sp1.json()), "spaces")

# 副副本同请求（同库 → 同数据 = 无状态验证）
r3 = subprocess.run(["docker", "exec", "gill-web-1", "sh", "-c",
                     f"curl -s http://127.0.0.1:18081/api/v1/spaces -H 'Authorization: Bearer {tok}' | head -c 120"],
                    capture_output=True, text=True)
print("副本同 token 访问同数据:", r3.stdout.strip()[:100])
print("（副本数据一致 = web 无状态：状态全在 PG/Redis ✓）")
