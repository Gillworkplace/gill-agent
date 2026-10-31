# agent/AGENT.md — Python Agent 模块

## 职责

Agent 全部智能与执行侧能力：LLM 任务主循环（流式+工具分发+审批门）、CubeSandbox 远程沙箱、CDP 浏览器、知识沉淀检索、五型扩展、风险规则、Redis 总线读写、落库；FastAPI 守护进程（会话运行时）；CLI。

## 子模块结构

```
agent/
 ├─ pyproject.toml              # uv 管理；fastapi/uvicorn/openai/e2b/redis/asyncpg/minio/httpx/typer
 ├─ gill_core/                  # ── 核心库 ──
 │   ├─ config.py               # Settings（cube_*/zhipu_*/e2b_api_key 等环境变量）
 │   ├─ llm.py                  # GLM 流式 + SYSTEM_PROMPT（含「如实汇报」硬规则）
 │   ├─ loop.py                 # run_task 主循环：kb 注入→流式→工具分发→审批门→落库
 │   ├─ risk.py                 # H1-H10 高危 / M1-M8 中危 规则
 │   ├─ sandbox.py / remote_sandbox.py   # MockSandbox / 官方 SDK 封装（含 DNS patch）
 │   ├─ browser.py              # CDP over httpx-ws；ack fire-and-forget（不等响应防死锁）
 │   ├─ kb.py                   # 沉淀(5条上限/90天降权)/混合检索/注入块
 │   ├─ exts.py                 # 五型扩展加载；AES-GCM 解密（EXT_SECRET；Java 侧无 AAD）
 │   ├─ files.py / bus.py / store.py     # MinIO 中转 / Redis Streams / messages·audit·usage 落库
 ├─ agentd/app.py               # ── 守护进程 ── SessionRuntime + FastAPI + sweep
 ├─ gill_cli/main.py            # ── CLI ── typer（chat/run/login/whoami/knowledge/doctor/version）
 └─ *_e2e.py / *_test.py        # API 级 E2E/压测（remote_smoke_final/file_e2e/perf/scale/regression/four_task）
```

## 关键约束（违反即事故）

1. **审批单发射器**：`approval_request` 仅由 `SessionRuntime.approve()` 发射（uuid cid 注册 pending_approvals）；`loop.py` 审批门只调回调不得 emit。
2. **fast-path 铁律**：任务循环内不得消费等待用户应答类 cmd（approval_response/presence/space_chat）——必须由 FastAPI 端点直写，否则死锁。
3. **拦截审计**：denied/超时命令必须落 `command_audit`（decision='denied'+risk_level）——tool_result 事件携带 `{command, risk}`，收集器无前置 tool_call 时补行。
4. **沙箱探活**：空闲 >240s 先 `run("true")` 探活，envd 404（远端回收）即重建——不得持死引用继续用。
5. **CDP Host 头**：DevTools DNS rebinding 防护必须 `Host: localhost`；ack 不等响应。
6. **密钥**：`ZHIPU_API_KEY` 仅环境变量（deploy/.env），任何文件不得硬编码。

## 常用命令

```bash
# 容器内语法自检（改完必跑）
python -c "import ast; ast.parse(open('agentd/app.py',encoding='utf-8').read())"
# 重建镜像（在 deploy/ 下）
docker compose up -d --build agentd
# CLI 本地安装
pip install -e agent/ && gill doctor
# API 级 E2E
docker exec gill-agentd-1 python /app/four_task_e2e.py   # 或本机直跑
```
