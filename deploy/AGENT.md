# deploy/AGENT.md — 部署与运维模块

## 职责

一键拉起全套环境：本地全栈 compose（web/agentd/PG/Redis/MinIO）、沙箱机（39.107.34.109）CubeSandbox 安装与模板镜像、SSH 隧道、本地 MinIO 镜像修复。

## 结构

```
deploy/
 ├─ docker-compose.yml          # 全栈：postgres(pgvector)/redis/minio(+init)/agentd/web
 ├─ .env                        # 密钥与参数（不入库）：ZHIPU_API_KEY/POSTGRES_PASSWORD/INIT_ADMIN_*/CUBE_*
 ├─ setup.sh                    # 交互式初始化（读 .env / 生成随机密钥）
 ├─ tunnel.sh                   # 沙箱通路 SSH 隧道管理（80→数据面 / 13000→Cube API）
 ├─ minio-local/                # 本地 MinIO 镜像修复（Dockerfile + 说明）
 └─ cube/                       # 沙箱机侧
     ├─ install-cube.sh         # 两段式一键安装（PVM 内核→reboot→stage2）
     ├─ build-template.sh       # gill-agent-sandbox 模板构建→推 ACR→create-from-image
     └─ gill-agent-sandbox/     # 模板 Dockerfile（Chromium+CJK+socat 9223）+ start-chromium.sh
```

## 关键事实（踩坑固化）

1. **隧道是硬依赖**：agentd 经 `host.docker.internal:13000`（转发远端 3000）访问 Cube API；隧道断=沙箱全挂。断线用自动重连循环拉起（见 docs/05-deploy.md §2）。
2. **minio 9000 必须映射** `127.0.0.1:9000:9000` + web 设 `MINIO_PUBLIC_ENDPOINT`——否则浏览器直传/下载必失败。
3. 沙箱机 PVM 内核用 6.6.69（6.6.117 在阿里云引导失败）；aegis 占 cgroup v1 需禁用。
4. 模板镜像启动必须 `--cmd sleep --arg infinity` + `--enable-inject-envd`（镜像默认 CMD 秒退会丢 envd）。
5. CDP 访问公式：`http://<host>/sandbox/<sid>/9223/<path>` + `Host: localhost`。
6. Clash TUN 劫持非标端口 TLS——访问沙箱机一律直连（NO_PROXY 已配 39.107.34.109）。

## 常用命令

```bash
cd deploy
docker compose up -d --build web agentd   # 重建服务（改代码后）
docker compose ps && docker logs -f gill-agentd-1
bash tunnel.sh                            # 沙箱隧道管理
# 沙箱泄漏手清（服务器上）
curl -X DELETE http://127.0.0.1:3000/sandboxes/<id>
# 备份
bash scripts/backup.sh
```
