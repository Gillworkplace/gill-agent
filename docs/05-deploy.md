# 一键部署手册 — Gill Agent 中间件与全栈

> 对应需求 D13（2026-10-17 委托方要求）：**所有中间件一键部署，可选配置在脚本中提供选择或填写**。三套入口：沙箱机（install-cube.sh）、本地全栈（setup.sh + docker-compose.yml）、部署手册（本文档）。
>
> **v1.1（2026-10-18）**：web 镜像改三阶段（前端构建前置）；compose 新增 minio 9000 端口映射与 `MINIO_PUBLIC_ENDPOINT`；新增前端本地开发模式与故障速查条目。

## 0. 部署总览

团队协议 v1.4（2026-11-18）需要同时更新 Web 和 Agent。通知、核查、许可字段沿用 JSONB，数据库无需迁移。切换前核对团队在途工作；旧员工聊天调用由新网关保留为通知，正式派工使用当前工具。历史记录及已提交决定原样保留。

团队修复补记v1.3（2026-11-17）：同时重建web与agentd，使新requiresResponse/archive_document工具与网关契约一致。先停止新领取并核对在途工作，等待真实回执或保留needs_reconciliation，再替换服务；不重排未知请求。新增JSON字段有默认值，无DDL迁移；代码回退不回滚已应用决定或外部副作用，旧验收事实保留。实际本地部署与回归见[修复反馈](features/digital-employee-team/acceptance_fix_feedback_20261117.md)。

| 目标 | 机器 | 入口 | 产物 |
|---|---|---|---|
| CubeSandbox 沙箱平台 | 39.107.34.109（Ubuntu 24.04） | `deploy/cube/install-cube.sh` | Cube :3000 + 双模板 READY |
| 本地全栈（web/agentd/PG/Redis/MinIO） | 本机 Docker Desktop | `deploy/setup.sh` | http://localhost:8080 |
| gill-browser 模板镜像 | 本机构建 → ACR → 沙箱机 | `deploy/cube/build-template.sh` | CUBE_TEMPLATE_ID=gill-browser |

## 1. 沙箱机一键部署（deploy/cube/install-cube.sh）

**交互式**（逐项询问，回车取默认）：
```bash
ssh root@39.107.34.109
scp deploy/cube/install-cube.sh root@39.107.34.109:/root/   # 或 wget 分发
bash /root/install-cube.sh
```

**无人值守**（全部环境变量先给出）：
```bash
NODE_IP=39.107.34.109 MIRROR=cn SWAP_GB=4 DATA_DIR=/data/cubelet \
DATA_SIZE_GB=40 KERNEL_DEB=/root/pvm-kernel.deb bash /root/install-cube.sh --yes
```

**两段式**：首段装 PVM 内核后自动 reboot；机器重启完成后再跑 `bash install-cube.sh --stage2 --yes` 安装 Cube。

**全部可选项**（环境变量 > 交互输入 > 默认值）：

| 变量 | 默认 | 说明 |
|---|---|---|
| NODE_IP | 自动探测 | 写入 Cube 配置的对外 IP |
| MIRROR | cn | cn=国内镜像源；global=官方源 |
| SWAP_GB | 4 | 新建 swap 大小；已有则跳过 |
| DATA_DIR | /data/cubelet | cubelet 数据目录，非 XFS 自动建 loop 卷 |
| DATA_SIZE_GB | 40 | 数据卷大小（最小 20） |
| KERNEL_DEB | 自动取 GitHub 最新 | 本地路径或 URL；服务器访问不了 GitHub 时从本机中转 |
| SKIP_KERNEL | no | 已装过 PVM 内核则 yes 跳过 |
| REBOOT_CONFIRM | yes | --yes 模式下不询问直接重启 |

**装完必做**：阿里云控制台安全组放行 **3000/tcp（限源=本机公网出口 IP）**；12088 WebUI 保持不对公网。

## 2. 本地全栈一键部署（deploy/setup.sh）

**交互式**：`bash deploy/setup.sh` —— 询问：智谱 Key（必填）、模型名、E2B_API_URL、CUBE_PROXY_NODE_IP、是否用 7890 代理、ACR 凭证（可跳过）；PG/MinIO/JWT/初始管理员密码**留空自动生成随机值**写入 `.env`。

**无人值守**：`cp deploy/.env.example deploy/.env`，填好后 `bash deploy/setup.sh --yes`。

**可选 profile**：`bash deploy/setup.sh --yes --profile edge,obs`
- `edge`：Nginx 负载均衡（多副本时用）；`obs`：Prometheus+Grafana（二期默认不开）。

**全部可选项**见 `deploy/.env.example`（逐项注释）：LLM/沙箱/知识库参数/协作上限/中间件密钥（可自动）/代理开关/ACR 凭证。

**扩缩容**：
```bash
docker compose --env-file deploy/.env up -d --scale web=2 --scale agentd=2 --profile edge
```

**web 镜像构建（v1.1 三阶段）**：`web/Dockerfile` = node:20-alpine 前端构建（`npm ci --registry=https://registry.npmmirror.com`，产物输出 `src/main/resources/static/`）→ maven 打 jar → JRE 21 运行。前端构建产物**不入库**（`web/.gitignore`），仓库为纯源码。改动前端后执行：
```bash
docker compose -f deploy/docker-compose.yml up -d --build web
```

**关键 compose 配置（v1.1）**：
- minio 端口：`127.0.0.1:9000:9000`（对象 API，预签名直传/下载必须对浏览器可达）+ `127.0.0.1:9001:9001`（控制台）；
- web 环境变量 `MINIO_PUBLIC_ENDPOINT`（默认 `http://localhost:9000`）：预签名 URL 的公网出口，替换容器内网地址 `http://minio:9000`；
- agentd 沙箱通路依赖宿主机 SSH 常驻隧道（80→数据面、13000→Cube API），推荐自动重连循环：
  ```bash
  while true; do ssh -N -o ServerAliveInterval=20 -o ExitOnForwardFailure=yes \
    -L 80:127.0.0.1:80 -L 13000:127.0.0.1:3000 root@39.107.34.109; sleep 5; done
  ```

**前端本地开发（免构建热更新）**：
```bash
cd web/frontend && npm install --registry=https://registry.npmmirror.com && npm run dev
# Vite 5173 端口，/api 与 /ws 代理至 localhost:8080（后端容器照常运行）
```

**备份**：`bash scripts/backup.sh`（PG dump → MinIO backup 桶，30 天 ILM；恢复手册见 deploy/BACKUP.md）。

## 3. 模板镜像构建（deploy/cube/build-template.sh）

本机执行：构建 `gill-agent-sandbox`（Chromium+CJK+数据分析栈，expose 9222）→ 推 ACR → 在沙箱机 `create-from-image`。可选项：`TAG`（默认 1.0）、`--no-push`（只构建）、`ACR_*` 走 `.env`。

## 4. 故障速查

| 症状 | 处置 |
|---|---|
| 内核 DEB 下载 404/超时 | 服务器到 GitHub 不通：本机（代理）下载后 `scp` 上去，`KERNEL_DEB=/root/xxx.deb` 重跑 |
| 重启后 uname 非 pvm.host | 检查 `/etc/default/grub` GRUB_DEFAULT 指向；`grub-set-default` 修正后 reboot |
| kvm_pvm 未加载 | `modprobe kvm_pvm`；确认 `/etc/modules-load.d/kvm-pvm.conf` |
| Cube 3000 本地通、外部不通 | 安全组未放行 3000/tcp（限源 IP） |
| 构建拉基础镜像超时 | 代理未开 Allow LAN，或 NO_EXTRA 配错 |
| minio-init 失败 | `docker logs` 查看 mc 输出；确认 MINIO_ROOT_* 正确 |
| 沙箱任务报 envd 404 / process.Start 404 | 沙箱被远端回收：agentd 已内置空闲>240s 探活重建；若仍复现，服务器 `curl -X DELETE :3000/sandboxes/<id>` 清孤儿后重试 |
| 页面事件重复（双审批卡/消息双份） | WS 网关僵尸泵：确认 web 镜像为泵 Stream.close 修复版（8164450+）；`docker compose restart web` 清理存量 |
| 上传 PUT 报 DNS/网络错误 | 预签名 URL 出口未公网化：检查 `MINIO_PUBLIC_ENDPOINT` 与 minio 9000 端口映射 |
| 隧道断（13000 不通、沙箱创建失败） | 出口 IP 变化或网络抖动：确认本机 IPv4 仍为安全组白名单值；用自动重连循环拉起隧道 |
| 容器内命令含 `;` 产生 `web;C` 类目录 | Git Bash 分号未转义：命令加引号；删除垃圾目录 |

## 5. 数字员工团队运行（v1.2，2026-11-17）

新入口默认工作台，旧会话保留在 `#/legacy`。首次启动 web 自动执行 V2 新增迁移，不迁移旧会话数据。有效 API/表及状态见 [实现契约](features/digital-employee-team/implementation.md)。

- web 与 agentd 配置同一份至少32字符的 `GILL_TEAM_WORKER_SECRET`；缺省时内部 Worker 禁用，不能把页面可打开当作执行器已运行。该值不入库、不进入浏览器、模型或沙箱。
- agentd 的 `GILL_TEAM_WEB_URL=http://web:8080`、`GILL_TEAM_WORKER_SLOTS`（默认3，上限16）、`GILL_TEAM_BUNDLE_MAX_BYTES`（默认64MiB）分别控制网关、执行并发与单归档容量。需要覆盖默认值时在Compose传入环境。
- 模型使用 `ZHIPU_API_KEY`、`ZHIPU_MODEL` 和可选 `ZHIPU_BASE_URL`。本平台需有适用的标准 API 资源，不能假定其他编程产品套餐余额可用；真实429余额不足时补资源或替换合法配置，历史失败/未知请求先核查后恢复。
- MinIO凭据保留服务端；web的公网预签名端点必须可从浏览器访问，签名不通过事后替换host生成。版本操作默认仅推进平台内项目基线，不意味着远端推送。
- 新团队沙箱独立创建，记录实际sandbox_id；清理器同时识别旧sessions和team_jobs归属。构建agentd使用/app/.venv，禁止把宿主.venv或node_modules复制进镜像。
- web构建使用与本机相同的公开Maven镜像和BuildKit依赖缓存，只解析打包所需依赖；去掉全插件go-offline预下载，避免无关下载阻塞。

运行 `cd deploy && docker compose up -d --build web agentd`。仅重建源代码镜像，PG/Redis/MinIO数据卷保留。检查web/agentd日志、V2迁移、内部认证和实际队列；未知外部动作在群聊“任务与执行核实”记录依据后明确恢复，不盲重试。模型、数据库及页面的已验证范围见 [验证记录](features/digital-employee-team/verification.md)。

### 5.1 Docker虚拟盘满导致PG退出（2026-11-17实测）

症状：PG日志出现No space left on device并退出；应用连接失败不能当成模型429。先用docker system df及容器数据目录df检查，清理可重建的无用构建缓存（本次释放约15.08GB，未删除业务卷），再启动postgres并核实WAL恢复和数据库连接。最后核查未完成job/action/checkpoint，只有无未决外部动作的工作项才可重领，未知结果先核实。主机仍有空间不代表Docker虚拟盘有空间。本次虚拟盘59GB，恢复后约16GB可用。
