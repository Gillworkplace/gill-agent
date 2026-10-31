# scripts/AGENT.md — 运维脚本模块

## 职责

独立于 compose 生命周期的运维脚本。当前仅 `backup.sh`（数据库备份），后续扩恢复/巡检脚本时在此登记。

## line_limit.py

- 做什么：D16 行数硬限检查门——单方法/函数（去空行注释）≤100 行、单文件 ≤1000 行；扫描 .py/.java/.ts/.vue（Python 函数级 ast 精确测量，Java/TS 方法级括号深度粗测）。
- 用法：`python scripts/line_limit.py [路径...]`（默认 agent/ web/src/ web/frontend/src/）；退出码 0=合规 / 1=超限，可作 CI 门禁。
- 约定：超限清单在根 AGENTS.md §2.5 维护，修复后从欠账清单删除。

## backup.sh

- 做什么：`pg_dump`（gill 库）→ 压缩 → 上传 MinIO `gill-backup` 桶（30 天生命周期）。
- 依赖：容器内执行（`docker exec gill-postgres-1 pg_dump` + `gill-minio-1`/mc 或 python urllib 上传），无需宿主机装 PG 客户端。
- 用法：`bash scripts/backup.sh`（可挂 cron/计划任务，建议每日一次）。
- 恢复：见 `deploy/BACKUP.md`（如有）或 docs/05-deploy.md 备份节。

## 约定

1. 脚本一律 `#!/usr/bin/env bash` + `set -euo pipefail`。
2. 密钥从环境变量/.env 读取，不得硬编码。
3. 新增脚本需在本文件登记用途、依赖、用法；破坏性操作（删除/覆盖）必须带确认或 `--yes` 开关。
