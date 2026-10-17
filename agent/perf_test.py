"""组合E：3 并发会话压测（TC-PERF-01 口径：全完成/无5xx/无串扰）。"""
import os, json, threading, time
os.environ["no_proxy"] = "*"; os.environ["NO_PROXY"] = "*"
import requests

B = "http://localhost:8080/api/v1"

def run_user(name, results, idx):
    try:
        tok = requests.post(B+"/auth/login", json={"username": name, "password": "Pass12345"}).json().get("token")
        if not tok:
            requests.post(B+"/auth/register", json={"username": name, "password": "Pass12345"})
            tok = requests.post(B+"/auth/login", json={"username": name, "password": "Pass12345"}).json()["token"]
        H = {"Authorization": "Bearer "+tok}
        sp = requests.get(B+"/spaces", headers=H).json()
        spid = [s for s in sp if s["type"]=="personal"][0]["id"]
        sid = requests.post(f"{B}/spaces/{spid}/sessions", json={"title": f"perf{idx}"}, headers=H).json()["id"]
        from websocket import create_connection
        ws = create_connection(f"ws://localhost:8080/ws/agent?sessionId={sid}&token={tok}", timeout=240)
        out = {"done": False, "ans": "", "err": ""}
        def rd():
            while not out["done"]:
                try: e = json.loads(ws.recv())
                except Exception: break
                if e["type"] == "agent_delta": out["ans"] += e["payload"]["content"]
                elif e["type"] == "done": out["done"] = True; out["status"] = e["payload"]["status"]
                elif e["type"] == "error": out["err"] = str(e["payload"])[:100]
        threading.Thread(target=rd, daemon=True).start()
        ws.send(json.dumps({"type":"user_input","payload":{"text": f"创建 /tmp/perf{idx}.py 打印 perf-user-{idx} 并运行，告诉我输出"}}))
        t0 = time.time()
        for _ in range(240):
            if out["done"]: break
            time.sleep(1)
        results[idx] = {"ok": out["done"] and f"perf-user-{idx}" in out["ans"],
                        "elapsed": round(time.time()-t0), "err": out["err"] or out["ans"][:60]}
    except Exception as e:
        results[idx] = {"ok": False, "err": str(e)[:100]}

results = {}
threads = [threading.Thread(target=run_user, args=(f"perf{i}", results, i)) for i in range(3)]
t0 = time.time()
[t.start() for t in threads]
[t.join(timeout=280) for t in threads]
total = round(time.time()-t0)
print(f"3 并发会话压测：总耗时 {total}s")
for i in sorted(results):
    r = results[i]
    print(f"  用户{i}: {'✅' if r['ok'] else '❌'} {r.get('elapsed','?')}s {r.get('err','')[:60]}")
ok = sum(1 for r in results.values() if r["ok"])
print(f"通过率: {ok}/3")
