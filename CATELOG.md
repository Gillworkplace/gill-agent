# CATELOG.md — 模块目录

> 各模块职责速查 + 模块级 AGENT.md 索引。开发规范见根目录 `AGENTS.md`。

## 模块总览

| 模块路径 | 职责 | 技术栈 | AGENT.md |
|---|---|---|---|
| `web/` | Java Web 网关：REST API、JWT/PAT 鉴权、WS 网关（SSE→WS 扇出）、文件预签名、管理后台接口 | Java 21 / Spring Boot 3.3 / JdbcTemplate | [web/AGENT.md](web/AGENT.md) |
| `web/frontend/` | 前端工程：登录/工作台/审批/终端/预览/文件/知识库/扩展/协作/管理全部 UI | Vue 3 + TS(strict) + Vite 5 + Pinia | [web/frontend/AGENT.md](web/frontend/AGENT.md) |
| `agent/` | Python Agent 侧：任务主循环、LLM 流式、沙箱执行、CDP 浏览器、知识库、扩展体系、风险审批、FastAPI 守护进程、CLI | Python 3.12 / asyncio / httpx / asyncpg | [agent/AGENT.md](agent/AGENT.md) |
| `deploy/` | 部署与运维：docker-compose 全栈、沙箱机一键安装、模板镜像构建、SSH 隧道、本地 MinIO | Docker / Bash | [deploy/AGENT.md](deploy/AGENT.md) |
| `docs/` | 五份核心文档：需求（含决策日志）/架构/测试用例/LLD/部署手册 | Markdown | [docs/AGENT.md](docs/AGENT.md) |
| `scripts/` | 运维脚本：数据库备份（pg_dump → MinIO） | Bash | [scripts/AGENT.md](scripts/AGENT.md) |

## agent/ 内部子模块（共用 `agent/AGENT.md`，按章节区分）

| 子模块 | 职责 |
|---|---|
| `agent/gill_core/` | 核心库：loop（任务主循环）/ llm（GLM 流式）/ kb（知识沉淀检索）/ risk（H1-H10 审批规则）/ exts（五型扩展）/ remote_sandbox（CubeSandbox 封装）/ browser（CDP）/ bus（Redis Streams）/ store（落库） |
| `agent/agentd/` | FastAPI 守护进程：SessionRuntime（懒沙箱/审批等待/presence/handoff）、cmd fast-path、SSE 事件流、sweep 孤儿清扫 |
| `agent/gill_cli/` | `gill` 命令行：chat / run / login / whoami / knowledge / doctor / version（typer） |
| `agent/*_e2e.py / *_test.py` | API 级 E2E 与压测脚本（浏览器黑盒 E2E 证据另存根目录 `gui-test-screenshots/`） |

## 其他目录（无独立 AGENT.md）

| 目录 | 说明 |
|---|---|
| `gui-test-screenshots/` | 浏览器黑盒 E2E 截图证据（t01-t16 / r1-r8 / v1-v7 三轮），只增不改 |
| `web/src/main/resources/static/` | 前端构建产物（gitignore，由 Docker 三阶段构建生成） |
| `web/src/main/resources/migration/` | Flyway DDL（V1__init.sql，14 张表） |
