import os, json, threading, time, tempfile, subprocess
os.environ["no_proxy"] = "*"; os.environ["NO_PROXY"] = "*"
import requests

B = "http://localhost:8080/api/v1"
tok = requests.post(B + "/auth/login", json={"username": "alice", "password": "Alice12345"}).json()["token"]
H = {"Authorization": "Bearer " + tok}
spaces = requests.get(B + "/spaces", headers=H).json()
spid = [s for s in spaces if s["type"] == "personal"][0]["id"]
sid = requests.post(f"{B}/spaces/{spid}/sessions", json={"title": "file-e2e"}, headers=H).json()["id"]

up = requests.post(B + "/files/uploads", json={"filename": "demo.txt", "size": 26, "sessionId": sid}, headers=H).json()
print("1) presign:", up["uploadId"][:8])

tf = os.path.join(tempfile.gettempdir(), "demo.txt")
open(tf, "wb").write(b"hello-gill-file-content!")
subprocess.run(["docker", "cp", tf, "gill-minio-1:/tmp/demo.txt"], check=True)
r = subprocess.run(["docker", "exec", "gill-minio-1", "sh", "-c",
                    "curl -s -o /dev/null -w '%{http_code}' -X PUT --data-binary @/tmp/demo.txt '" + up["url"] + "'"],
                   capture_output=True, text=True)
print("2) PUT:", r.stdout.strip())

c = requests.post(f"{B}/files/uploads/{up['uploadId']}/complete", json={}, headers=H)
print("3) complete:", c.json())

from websocket import create_connection
ws = create_connection(f"ws://localhost:8080/ws/agent?sessionId={sid}&token={tok}", timeout=200)
events = []
def rd():
    while True:
        try:
            e = json.loads(ws.recv())
        except Exception:
            break
        events.append((e["type"], str(e["payload"])[:100]))
threading.Thread(target=rd, daemon=True).start()

ws.send(json.dumps({"type": "file_sync_in", "payload": {"objectKey": up["objectKey"], "filename": "demo.txt"}}))
time.sleep(25)
ws.send(json.dumps({"type": "user_input", "payload": {"text": "读取 /home/user/uploads/demo.txt 告诉我内容"}}))
time.sleep(55)

synced = [e for e in events if e[0] == "file_synced"]
errs = [e for e in events if e[0] == "error"]
ans = "".join(e[1] for e in events if e[0] == "agent_delta")
print("4) sync:", synced[:1] or errs[:1])
print("5) agent read:", ans[:160])

lst = requests.get(f"{B}/spaces/{spid}/files", headers=H).json()
if lst:
    dl = requests.post(f"{B}/files/{lst[0]['id']}/download-url", json={}, headers=H).json()
    print("6) download:", dl.get("filename"), "url ok:", dl.get("url", "").startswith("http"))
