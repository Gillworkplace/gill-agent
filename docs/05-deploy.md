# 一键部署手册 — Gill Agent 中间件与全栈

> 对应需求 D13（2026-10-17 委托方要求）：**所有中间件一键部署，可选配置在脚本中提供选择或填写**。三套入口：沙箱机（install-cube.sh）、本地全栈（setup.sh + docker-compose.yml）、部署手册（本文档）。

## 0. 部署总览

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
