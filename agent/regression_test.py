"""组合H：全链路回归（03 文档 P0 抽样——覆盖六组用例，输出通过率报告）。"""
import os, json, threading, time
os.environ["no_proxy"] = "*"; os.environ["NO_PROXY"] = "*"
import requests

B = "http://localhost:8080/api/v1"
PASS, FAIL, RESULTS = [], [], []

def check(name, ok, detail=""):
    (PASS if ok else FAIL).append(name)
    RESULTS.append(f"{'✅' if ok else '❌'} {name} {detail}")
    print(f"{'✅' if ok else '❌'} {name} {detail}")

def login(u, p):
    return requests.post(B+"/auth/login", json={"username": u, "password": p}).json().get("token")

def mk_user(u):
    requests.post(B+"/auth/register", json={"username": u, "password": "Pass12345"})
    return login(u, "Pass12345")

def ws_task(tok, sid, text, wait=60):
    from websocket import create_connection
    ws = create_connection(f"ws://localhost:8080/ws/agent?sessionId={sid}&token={tok}", timeout=wait+60)
    out = {"done": False, "ans": "", "events": []}
    def rd():
        while not out["done"]:
            try: e = json.loads(ws.recv())
            except Exception: break
            out["events"].append((e["type"], e["payload"]))
            if e["type"] == "agent_delta": out["ans"] += str(e["payload"].get("content",""))
            elif e["type"] == "done": out["done"] = True
    threading.Thread(target=rd, daemon=True).start()
    ws.send(json.dumps({"type": "user_input", "payload": {"text": text}}))
    t0 = time.time()
    for _ in range(wait*2):
        if out["done"]: break
        time.sleep(0.5)
    out["done"] = True
    out["elapsed"] = round(time.time()-t0)
    return out

print("=" * 50)
print("全链路 P0 回归开始（等待限流窗口冷却 61s）")
time.sleep(61)

# ---- TC-AUTH ----
t1 = login("alice", "Alice12345")
check("TC-AUTH-01 登录", bool(t1))
r = requests.get(B+"/spaces", headers={"Authorization": "Bearer bad"})
check("TC-AUTH-04 伪 token 拒绝", r.status_code == 401)
tB = mk_user("iso-bob")
check("TC-AUTH-11 注册+自动空间", bool(tB) and len(requests.get(B+"/spaces", headers={"Authorization": "Bearer "+tB}).json()) == 1)

# ---- TC-ISO ----
HA = {"Authorization": "Bearer "+t1}
spA = [s for s in requests.get(B+"/spaces", headers=HA).json() if s["type"]=="personal"][0]["id"]
sA = requests.post(f"{B}/spaces/{spA}/sessions", json={"title":"iso-a"}, headers=HA).json()["id"]
r = requests.get(f"{B}/sessions/{sA}/messages", headers={"Authorization": "Bearer "+tB})
check("TC-ISO-02 越权会话访问拒绝", r.status_code == 403)

# ---- TC-CHAT（沙箱执行）----
for _try in range(2):
    out = ws_task(t1, sA, "在 /tmp/reg.py 打印 reg-pass 并运行，告诉我输出", 80)
    if "reg-pass" in out["ans"]: break
    time.sleep(10)
check("TC-CHAT-01 端到端任务", "reg-pass" in out["ans"], f"({out['elapsed']}s)")
audit = requests.get(f"{B}/admin/audit?limit=5", headers={"Authorization": "Bearer "+login("admin","admin12345")}).json()
check("TC-SB-03 审计带 sandboxId", any(a.get("sandbox_id") for a in audit))

# ---- TC-KB ----
ws_task(t1, sA, "记住：回归测试标记 kv-mark-42", 12)
sA2 = requests.post(f"{B}/spaces/{spA}/sessions", json={"title":"iso-a2"}, headers=HA).json()["id"]
out2 = ws_task(t1, sA2, "回归测试标记是什么？只回答标记值", 40)
check("TC-KB-02 跨会话知识生效", "kv-mark-42" in out2["ans"])

# ---- TC-EXT ----
exts = requests.get(f"{B}/spaces/{spA}/extensions", headers=HA).json()
has_calc = any(e["name"] == "calc-tool" for e in exts)
sA3 = requests.post(f"{B}/spaces/{spA}/sessions", json={"title":"iso-a3"}, headers=HA).json()["id"]
out3 = ws_task(t1, sA3, "调用 ext_calc-tool_add 参数 a=20 b=22，报告 result（禁止心算）", 55)
check("TC-EXT-01 脚本工具可用", has_calc and "42" in out3["ans"])

# ---- TC-COLLAB（双端）----
from websocket import create_connection as cw
w1 = cw(f"ws://localhost:8080/ws/agent?sessionId={sA3}&token={t1}", timeout=60)
w2 = cw(f"ws://localhost:8080/ws/agent?sessionId={sA3}&token={t1}", timeout=60)
got = [False, False]
def rdx(ws, i):
    try:
        while True:
            e = json.loads(ws.recv())
            if e["type"] == "session_status" and e["payload"].get("status") == "active":
                got[i] = True; return
    except Exception: pass
threading.Thread(target=rdx, args=(w1,0), daemon=True).start()
threading.Thread(target=rdx, args=(w2,1), daemon=True).start()
w1.send(json.dumps({"type":"preview_start","payload":{}}))
time.sleep(35)
check("TC-COLLAB-02 双端同步", got[0] and got[1], f"(端1={got[0]} 端2={got[1]})")

print("=" * 50)
print(f"回归结果: {len(PASS)} 通过 / {len(FAIL)} 失败 / 共 {len(RESULTS)}")
for r in RESULTS: print(" ", r)
exit(0 if not FAIL else 1)
