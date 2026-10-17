# 低层详细设计文档（LLD） — Gill Agent

| 项 | 内容 |
|---|---|
| 文档版本 | v1.0（对应需求 v1.4 / 架构 v1.2 同步版） |
| 编写日期 | 2026-10-17 |
| 上游文档 | 《01-需求澄清 v1.4》《02-总体架构与模块设计》《03-测试用例设计》 |
| 读者/用途 | 开发实施唯一编码依据：目录结构、DDL、API/事件 Schema、模块内部设计、时序与错误矩阵 |

---

## 1. 代码仓库与目录结构

```
gill-agent/
 ├─ docs/                       # 01 需求 / 02 架构 / 03 测试 / 04 本文档
 ├─ web/                        # Java 21 + Spring Boot 3.3（Maven 单模块）
 │   ├─ pom.xml
 │   ├─ src/main/java/com/gill/web/{controller,ws,bus,security,service,repo,entity,config}
 │   ├─ src/main/resources/{application.yml,migration/}    # Flyway DDL
 │   └─ src/test/java/...
 ├─ agent/                      # Python 3.12（uv 管理）
 │   ├─ pyproject.toml          # deps: fastapi uvicorn openai e2b redis asyncpg minio
 │   │                          #       websockets typer rich structlog prometheus-client mcp
 │   ├─ gill_core/{llm,loop,kb,exts,risk,tools,sandbox,browser,files,bus,store}.py
 │   ├─ agentd/{app.py,health.py,leases.py,runtime.py}
 │   └─ gill_cli/{__main__.py,commands/,render.py,config.py,cred.py}
 ├─ frontend/                   # React 18 + Vite + TS + Ant Design 5 + zustand + xterm.js
 │   └─ src/{pages,components,stores,api,ws,theme/}
 ├─ deploy/
 │   ├─ docker-compose.yml  .env.example
 │   ├─ obs/                 # prometheus/grafana（二期启用）
 │   └─ cube/                # gill-agent-sandbox 模板 Dockerfile + ECS 部署记录
 ├─ scripts/                  # backup.sh / smoke.py / bench.py / collab-test.py
 └─ skills-official/          # 内置 5 技能源（CSV 分析/网页采集/PDF 摘要/正则/API 对接）
```

## 2. 数据库 DDL（Flyway V1__init.sql，完整版）

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY, username VARCHAR(32) UNIQUE NOT NULL,
  password_hash VARCHAR(100) NOT NULL, role VARCHAR(8) NOT NULL DEFAULT 'USER',
  status VARCHAR(8) NOT NULL DEFAULT 'ACTIVE',
  custom_instructions VARCHAR(2000),
  storage_quota_bytes BIGINT NOT NULL DEFAULT 5368709120,
  token_quota_daily BIGINT NOT NULL DEFAULT 2000000,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), last_login_at TIMESTAMPTZ);

CREATE TABLE spaces (
  id UUID PRIMARY KEY, type VARCHAR(8) NOT NULL,          -- personal|group
  name VARCHAR(64) NOT NULL, owner_user_id BIGINT NOT NULL REFERENCES users(id),
  default_approval VARCHAR(8) NOT NULL DEFAULT 'auto',
  default_op_mode VARCHAR(8) NOT NULL DEFAULT 'free',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), dissolved_at TIMESTAMPTZ);

CREATE TABLE space_members (
  space_id UUID REFERENCES spaces(id), user_id BIGINT REFERENCES users(id),
  role VARCHAR(8) NOT NULL DEFAULT 'member', joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (space_id, user_id));

CREATE TABLE invites (
  id UUID PRIMARY KEY, space_id UUID NOT NULL REFERENCES spaces(id),
  token VARCHAR(32) UNIQUE NOT NULL, created_by BIGINT NOT NULL REFERENCES users(id),
  expires_at TIMESTAMPTZ NOT NULL, revoked BOOLEAN NOT NULL DEFAULT false,
  accepted_by BIGINT REFERENCES users(id));

CREATE TABLE space_chat (
  id BIGSERIAL PRIMARY KEY, space_id UUID NOT NULL REFERENCES spaces(id),
  user_id BIGINT NOT NULL REFERENCES users(id), content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX ON space_chat (space_id, created_at DESC);

CREATE TABLE pats (
  id UUID PRIMARY KEY, user_id BIGINT NOT NULL REFERENCES users(id),
  name VARCHAR(64) NOT NULL, token_hash VARCHAR(64) UNIQUE NOT NULL,  -- sha256(gpat_...)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), last_used_at TIMESTAMPTZ,
  revoked BOOLEAN NOT NULL DEFAULT false);

CREATE TABLE sessions (
  id UUID PRIMARY KEY, space_id UUID NOT NULL REFERENCES spaces(id),
  user_id BIGINT NOT NULL REFERENCES users(id),           -- 创建者
  title VARCHAR(50), project_tag VARCHAR(50),
  status VARCHAR(12) NOT NULL DEFAULT 'created',          -- created|sandbox_creating|active|idle|closing|closed|error|interrupted|archived
  sandbox_id VARCHAR(64), node_owner VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT now(), closed_at TIMESTAMPTZ);
CREATE INDEX ON sessions (space_id, status);

CREATE TABLE messages (
  id BIGSERIAL PRIMARY KEY, session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  seq INT NOT NULL, role VARCHAR(12) NOT NULL,            -- user|assistant|tool|system|handoff
  content TEXT, actor_user_id BIGINT REFERENCES users(id),
  tool_name VARCHAR(48), tool_args JSONB, tool_result JSONB,
  trace_id VARCHAR(32), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (session_id, seq));

CREATE TABLE command_audit (
  id BIGSERIAL PRIMARY KEY, session_id UUID REFERENCES sessions(id),
  space_id UUID, user_id BIGINT NOT NULL,                 -- actor
  sandbox_id VARCHAR(64), command TEXT NOT NULL,
  risk_level VARCHAR(8), rule_id VARCHAR(8),
  decision VARCHAR(12), decision_by BIGINT,
  exit_code INT, duration_ms INT, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX ON command_audit (space_id, created_at DESC);

CREATE TABLE file_objects (
  id UUID PRIMARY KEY, space_id UUID NOT NULL REFERENCES spaces(id),
  user_id BIGINT NOT NULL, session_id UUID,
  direction VARCHAR(8) NOT NULL,                          -- upload|export
  object_key TEXT NOT NULL, filename VARCHAR(255) NOT NULL,
  size_bytes BIGINT NOT NULL, status VARCHAR(10) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), expired_at TIMESTAMPTZ);
CREATE INDEX ON file_objects (space_id, created_at DESC);

CREATE TABLE knowledge_items (
  id UUID PRIMARY KEY, user_id BIGINT NOT NULL,           -- 创建者
  space_id UUID,                                          -- scope=user 时=个人空间id；group=协作空间id
  scope VARCHAR(8) NOT NULL,                              -- session|project|group|user
  project_tag VARCHAR(50), session_id UUID,
  type VARCHAR(12) NOT NULL,                              -- preference|fact|correction|project|snippet
  title VARCHAR(128) NOT NULL, content TEXT NOT NULL, tags TEXT[] DEFAULT '{}',
  source VARCHAR(8) NOT NULL,                             -- auto|explicit
  source_msg_id BIGINT, embedding vector(1024),
  confidence REAL NOT NULL DEFAULT 0.8, hit_count INT NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ, pinned BOOLEAN NOT NULL DEFAULT false,
  status VARCHAR(8) NOT NULL DEFAULT 'active',
  version INT NOT NULL DEFAULT 1, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX ON knowledge_items USING hnsw (embedding vector_cosine_ops);
CREATE INDEX ON knowledge_items (space_id, scope, status);

CREATE TABLE extensions (
  id UUID PRIMARY KEY, user_id BIGINT NOT NULL,           -- 安装者
  space_id UUID,                                          -- visibility=space 时归属空间（private 时=个人空间id）
  visibility VARCHAR(8) NOT NULL DEFAULT 'private',
  name VARCHAR(32) NOT NULL, version VARCHAR(16) NOT NULL,
  type VARCHAR(16) NOT NULL,                              -- http-tools|script-tools|skill|mcp|prompt
  manifest JSONB NOT NULL, status VARCHAR(8) NOT NULL DEFAULT 'enabled',
  call_count_7d INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (space_id, name));

CREATE TABLE extension_secrets (
  id UUID PRIMARY KEY, user_id BIGINT NOT NULL,
  name VARCHAR(64) NOT NULL, cipher BYTEA NOT NULL,        -- AES-256-GCM(KB_MASTER_KEY)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (user_id, name));

CREATE TABLE llm_usage (
  id BIGSERIAL PRIMARY KEY, user_id BIGINT NOT NULL, session_id UUID,
  model VARCHAR(32) NOT NULL, prompt_tokens INT NOT NULL, completion_tokens INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE INDEX ON llm_usage (user_id, created_at DESC);
-- 定时清理：space_chat>30d；file_objects expired；解散空间 dissolved_at+7d 级联
```

## 3. REST API 全量端点（/api/v1，OpenAPI 同步生成）

| 域 | 端点 | 说明 |
|---|---|---|
| auth | POST /auth/register、/auth/login；GET /me；PATCH /me/password、/me/instructions | JWT；锁定 5/15min |
| pat | GET/POST /me/pats；DELETE /me/pats/{id} | 创建返回明文仅一次 |
| space | GET /spaces（含个人+所属）；POST /spaces；GET/PATCH/DELETE /spaces/{id}；GET /spaces/{id}/members | 解散=级联+宽限 |
| invite | POST /spaces/{id}/invites {username?}；DELETE /invites/{token}；POST /invites/{token}/accept | 直邀即时生效 |
| member | PATCH/DELETE /spaces/{id}/members/{userId} | @SpaceRole(admin+) |
| chat | GET /spaces/{id}/chat?before=；POST /spaces/{id}/chat {content} | @agent 前缀由 web 标记 is_agent_mention |
| session | GET/POST /spaces/{id}/sessions；GET/PATCH/DELETE /sessions/{id}；GET /sessions/{id}/messages?before=&limit= | 创建带 project_tag? |
| ws | GET /ws/agent?sessionId&token（Upgrade） | §4 事件协议 |
| file | POST /sessions/{id}/files/uploads；POST …/uploads/{uid}/complete；POST …/files/sync-in、/exports、file_list(cid 走 WS)、DELETE …/uploads/{uid}；GET /spaces/{id}/files（空间文件库） | 预签名/审计如 01 |
| kb | GET/POST /spaces/{id}/knowledge；PATCH/DELETE /knowledge/{id}；POST /knowledge/{id}/pin；GET /spaces/{id}/knowledge/search?q=；POST /spaces/{id}/knowledge/export、/import | 检索=混合（web 转发 agentd /internal/kb/search） |
| ext | GET/POST /spaces/{id}/extensions；PATCH/DELETE /extensions/{id}；POST /extensions/{id}/publish、/test；GET /extensions/{id}/tools、/calls | manifest 校验在 web（schema）+agentd（运行时）双层 |
| oplock | POST /sessions/{id}/oplock {action: acquire|release} | relay 模式限定 |
| admin | GET /admin/users…；PATCH /admin/users/{id}；GET /admin/users/{id}/sessions；DELETE /admin/sessions/{id}；GET /admin/audit、/admin/audit/export.csv；GET /admin/stats；GET/PATCH /admin/config | 简化后台（D11） |

## 4. WebSocket 事件协议（全量）

信封：`{type, cid?, seq, ts, traceId, actor?, payload}`；二进制帧=投屏 JPEG（前置 screencast_meta 文本帧）。重连：客户端带 `Last-Event-Seq`，服务端从 evt 流按 seq 增量重放（≤1000 条窗口，超出引导 REST 拉历史）。

| 方向 | type | payload |
|---|---|---|
| C→S | user_input | {text, mention?:bool}（@agent 转入） |
| C→S | stop | {} |
| C→S | preview_start/preview_stop | {quality?: high|mid|low} |
| C→S | input_event | {kind, x?, y?, button?, key?, text?}（relay 模式服务端校验 oplock 持有者） |
| C→S | file_sync_in / file_export / file_list / file_delete | {uploadId?, path?…} |
| C→S | approval_response | {cid, action: approve|deny|always_allow} |
| C→S | op_lock | {action: acquire|release|mode, mode?: free|relay} |
| C→S | nav_push | {fileTreePath?, previewUrl?, termScroll?}（演示模式发起者） |
| C→S | typing | {}（节流 3s，仅协作空间转发） |
| S→C | agent_delta / tool_call / tool_result / terminal | 同 02 §3.2 |
| S→C | screencast_meta / (binary) frame | 帧元数据/JPEG |
| S→C | approval_request / approval_timeout | {cid, command, riskLevel, reason, ruleId, expiresIn} |
| S→C | kb_captured | {ids:[…], summary}（轻提示条数据） |
| S→C | file_sync_progress / file_synced / file_exported / file_tree | 同 01 §11.6 |
| S→C | session_status / done / error / pong | {status} / {reason, code} |
| S→C | presence_join / presence_leave | {userId, name, avatarSeed} |
| S→C | op_lock_changed | {holder?, mode, reason: release|timeout|kick} |
| S→C | member_typing | {userId} |
| S→C | nav_follow | {fileTreePath?, previewUrl?, termScroll?}（演示跟随端） |
| S→C | space_chat_msg | {id, userId, name, content, isAgentMention}（侧栏实时） |

## 5. web 模块详细设计（Java）

### 5.1 线程模型

- Tomcat 虚拟线程处理 REST/WS 升级；每 WS 会话注册到 `FanoutRegistry`（sessionId→Set<Session>，副本本地）；
- `BusConsumer`（每会话一个虚拟线程，仅本地有订阅者时启动）：XREADGROUP evt 流 → FanoutRegistry 扇出（事件队列 256/帧队列 2 丢旧，同 02 §3.3）；
- `FrameSubscriber`：Redis Pub/Sub 订阅有本地订阅者的 `gill:frame:{sid}`，拆 meta/JPEG 分发；
- 定时任务（虚拟线程池 4）：空闲会话关闭、file_objects 过期、space_chat 30d、解散宽限清理、邀请过期。

### 5.2 关键服务

| 类 | 职责要点 |
|---|---|
| SpaceService | 创建空间（个人随注册）、成员/邀请校验链（@SpaceRole AOP）、解散状态机（dissolving→只读 7d→清理，可取消）；权限判定统一入口 `require(spaceId, userId, minRole)` |
| OpLockService | `SET gill:oplock:{sid} <uid> NX`（relay）；acquire/release/模式切换广播 op_lock_changed；无操作 2min/掉线 30s 释放（presence 回调+定时扫描兜底）；input_event 网关在此校验持有者 |
| KnowledgeService | CRUD/置顶/导入导出；**检索代理**：组包 {query, scopes, spaceIds} → agentd 内部 HTTP `/internal/kb/search`（agentd 持 pgvector+embedding 逻辑），web 不实现向量检索 |
| ExtensionService | manifest JSON Schema 校验（附录 C 规则）→ 落库；publish=复制 visibility=space 记录+ADMIN 审批位；test=经 cmd 总线请求 agentd 试跑（cid 应答，30s 超时）；密钥：SecretVault（AES-GCM），只存 cipher |
| SessionService | 会话状态机（01 §11.3.4）；创建时绑定 space；关闭=cmd 总线 session_close + 沙箱销毁指令 |
| PresenceService | 双层键：`presence:{spaceId}:{sessionId}` hash（uid→nodeId，TTL 30s 心跳 10s）；供在线头像/ADMIN 总览/OpLock 掉线判定 |
| QuotaService | 存储配额（space 维度汇总 file_objects）、token 日配额预检 |
| FileService | 预签名/对象键（uploads/{spaceId}/{uuid}/{safe}、exports/{sessionId}/{uuid}-{safe}）；complete 魔数复核（前 512B，黑名单表驱动） |

### 5.3 鉴权链

JwtFilter（REST）→ @AdminOnly / @SpaceRole 注解（HandlerInterceptor 解析 spaceId 参数注入上下文）→ WsHandshakeAuth（token 或 PAT → user + 校验 space 成员资格）。PAT=sha256 哈希比对，命中更新 last_used_at。

## 6. agentd 模块详细设计（Python）

### 6.1 loop.py 主流程（含新核心）

```python
async def run_task(ctx, task_text, emit):
    kb_block = await kb.build_injection(ctx)            # ① 混合检索→注入块（≤8条/2000tok）
    sys = SYSTEM_PROMPT + kb_block + ctx.custom_instructions + (GILL.md if project)
    tools = builtin_tools(ctx) + await exts.tool_schemas(ctx)   # ② 扩展工具动态合入
    msgs = ctx.history + [{"role":"user","content":task_text,"actor":ctx.actor}]
    for round in range(MAX_ROUNDS):
        async for delta in llm.stream(sys, msgs, tools):   # ③ 流式
            emit("agent_delta", delta)
        if not tool_calls: break
        for call in tool_calls:
            if is_shell(call) and ctx.approval=="suggest":
                if risk := risk.assess(call):               # ④ 审批钩子
                    decision = await approval_flow(ctx, call, risk, emit)
                    if decision.denied: continue
            result = await dispatch(ctx, call, emit)        # ⑤ shell/file/browser/knowledge/ext_*/mcp_*
            emit("tool_result", result); msgs.append(tool_msg(call, result))
    await kb.resolve_hits(ctx, msgs)                       # ⑥ 引用回写 hit_count
    await store.persist(ctx, msgs)                         # ⑦ messages/audit/usage
```

### 6.2 kb.py 管线

- `build_injection`：query=任务文本+近3轮摘要+project_tag；SQL：`(hnsw 余弦 top20 WHERE space_id/scope IN … AND status='active') UNION (ILIKE/tags 命中 top20)` → 排序 pinned>scope 权重>confidence>hit_count>相似度，过滤 90 天未命中（pinned 豁免）→ 截 top8/2000tok → 模板渲染（01 §11.10.3）；
- `capture`（knowledge_save 工具入口）：同 scope+type 余弦检索 max>0.92 → UPDATE version+1 保留旧版（knowledge_versions 表不建，messages 溯源）；否则 INSERT+embedding（智谱 embedding-3，1024 维；失败→embedding NULL+补算队列）；单任务自动沉淀>5 拒绝；
- `resolve_hits`：正则解析回复中 `[知识#id]` 引用标注 → 批量 UPDATE hit_count+1/last_used_at。

### 6.3 exts.py 运行时

- 加载：会话启动时查 `extensions WHERE space_id IN (个人空间, 会话空间) AND status='enabled'` → 解析 manifest → 工具 Schema 注入（`ext_{name}_{tool}` / `mcp_{server}_{tool}`）；
- HTTP 工具执行：模板渲染→`sandbox.commands.run(f"curl -sS -m {t} -H 'Authorization: …' '{url}'", …)`（鉴权头经密钥引用解密后注入命令环境变量，不落参数）；域名白名单前置校验（urllib 解析 host ∈ network）；响应 64KB 截断；
- 脚本工具：首次 `python -m venv … && pip install -r requirements`（venv 缓存于沙箱 `/home/user/.venv-ext/{name}`，沙箱生命周期内复用）；`run(params)` 调用，结果 JSON/文本回传；
- MCP：mcp python sdk AsyncClient（SSE/HTTP）维持连接池；60s 探活（list_tools），失败摘除+标记；调用 30s 超时、结果截断；stdio 型（P1）：沙箱内 `npx/uvx` 拉起+stdin 桥接进程；
- 冲突：注册时 name 与内置/其他扩展撞 → 该工具禁用+事件提示（EXT-8103）。

### 6.4 bus.py / runtime.py

- 消费：每持有 lease 的会话独立 task：XREADGROUP `gill-agentd`（block 1s）→ 校验 lease epoch→ 分发 handler（user_input→run_task 等）；
- 发布：evt 流 XADD（MAXLEN 10000）；帧 Pub/Sub 单消息=`4B meta-len + meta + jpeg`；
- lease：`SET NX PX 30000 {node}:{epoch}` 心跳 10s；接管=XAUTOCLAIM pending + epoch+1；
- 内部 HTTP（FastAPI）：/internal/kb/search、/internal/ext/test、/healthz、/metrics（供 web 请求-应答与健康）。

## 7. 协作运行时（跨 web/agentd）

- **扇出**：agentd 不感知观察者；web 副本 FanoutRegistry 本地多客户端共享同一 evt/帧消费（每副本每会话一路消费）→ N 观察者≈1 倍总线流量；
- **oplock 状态机**：`free ⇄ relay`；relay 下 idle(held)→released（手动/2min 无 input_event/掉线 30s）；acquire 冲突→排队首位提示；
- **nav_follow**：发起者 nav_push（节流 200ms）→ web 广播跟随端；演示会话标记 demo_by，结束广播恢复；
- **handoff**：`/handoff` 斜杠命令→loop 生成摘要→ messages(role=handoff) + knowledge_items(scope=group, type=project, title="交接·MM-DD") 双写。

## 8. CLI 设计（gill_cli）

| 命令 | 调用 | 实现 |
|---|---|---|
| login/logout/whoami | POST /auth/login 或 --token PAT → credentials | httpx；chmod 600 |
| chat | WS /ws/agent（同协议） | render.stream_md；审批 prompt y/n/a；--web 打印 URL |
| run | WS + 首条 user_input + 等待 done | --json 输出 gill.run.v1；--yes=suggest 自动 deny 高危 |
| session/file/knowledge/skill/tool | 对应 REST | 表格/树渲染；--json 直通 |
| config | 本地 toml | env>项目>全局合并 |
| doctor | 逐项探测：/actuator/health、PAT whoami、沙箱 create+kill、代理 | ✔/✘+建议 |

## 9. 前端设计（frontend/src）

- 路由：/login /register /app/s/:id /app/knowledge /app/extensions /app/settings /admin/*（懒加载）；
- stores（zustand）：authStore/spaceStore（含切换器）/sessionStore/chatStore（消息流+合并渲染）/previewStore（帧+指示灯）/kbStore/extStore/collabStore（在线/操作权/演示态）；
- ws/SocketClient：单例，指数退避重连，Last-Event-Seq 增量，事件→store dispatch 总表；帧走独立二进制处理（createImageBitmap）；
- theme/tokens.css：01 §11.14.1 全 token CSS 变量 + antd ConfigProvider 主题映射（亮/暗/系统三态）；
- 关键组件：SessionSidebar（空间切换+会话列表）、ChatStream（消息/工具卡/审批卡/知识提示条）、TerminalPanel、PreviewPanel（操作条+oplock 蒙灰）、FilePanel（库/工作区双层）、KnowledgePage、ExtensionCenter、MemberChat（侧栏）、SpaceSettings。

## 10. 关键时序

### 10.1 扩展 HTTP 工具调用

```mermaid
sequenceDiagram
    participant U as 浏览器
    participant W as web
    participant A as agentd
    participant S as 沙箱
    participant T as 内部API
    U->>W: 对话"查工单T-1024"
    W->>A: cmd user_input
    A->>A: LLM 选择 ext_ticket_query_ticket
    A->>A: 域名白名单✓ 密钥解密
    A->>S: curl(模板化, -m 30)
    S->>T: GET /api/tickets/T-1024
    T-->>S: 200 JSON
    S-->>A: 响应(≤64KB)
    A-->>W: tool_call/tool_result ——>>U（工具卡片）
    A->>A: 继续轮次→自然语言答复
```

### 10.2 接力模式切换

```mermaid
sequenceDiagram
    participant B as 成员B(申请)
    participant W as web
    participant R as Redis
    participant Others as 其他成员
    B->>W: op_lock {mode: relay}
    W->>R: SETNX oplock:{sid}=B
    W-->>Others: op_lock_changed{holder:B,mode:relay}(预览蒙灰)
    Note over B: B 操作浏览器(input_event)…2min 无操作
    R-->>W: TTL 过期/扫描释放
    W-->>Others: op_lock_changed{holder:null,reason:timeout}
    Other->>W: acquire → 获得令牌
```

### 10.3 知识注入与回写（文本）：run_task ①检索→②注入 system→轮次中 Agent 引用 `[知识#id]`→⑥ resolve_hits 批量回写 hit_count/last_used_at→⑦ 落库；提示条事件 kb_captured 紧随沉淀发生。

## 11. 错误处理与重试矩阵

| 故障 | 策略 | 用户感知 |
|---|---|---|
| LLM 429/超时 | 指数退避×2 → fail | TASK 错误+可重发 |
| 沙箱创建失败 | 重试×3 → session error | "沙箱启动失败，稍后重试" |
| embedding 失败 | 关键词降级+补算队列 | 无感知（检索质量略降） |
| 扩展调用失败 | 不重试（幂等未知），错误文本回模型 | Agent 解释+建议 |
| MCP 探活失败 | 摘除+标红，60s 再试 | 扩展中心状态 |
| MinIO 5xx | 同步任务重试×2 | file_sync failed 事件 |
| web↔agentd 总线断 | 自动重连+消费者组重建 | 断线横幅 |
| oplock Redis 抖动 | 自由模式兜底（回退不阻塞观看） | 短暂提示 |

## 12. 单元/集成测试重点（对齐 03 文档）

- web TU：SpaceService 权限矩阵全枚举、OpLockService 状态机表驱动、manifest 校验 20 用例（含附录 C 边界）、魔数检测、JWT/PAT、FanoutRegistry 背压；
- agent TU：loop 预算/审批/中断（mock llm+sandbox）、kb 去重阈值/预算截断/引用解析、exts 域名白名单/模板注入/截断、risk 规则库全条目、bus epoch fencing；
- 集成：docker compose 起本地栈 + mock Cube（sandbox.py 抽象 MockSandbox）跑通 chat/file/kb/ext 主链；协作用 collab-test.py（4 ws 客户端脚本）。

## 13. 开发规范与 CI

- Java：Google Style + Spotless；构造器注入；DTO/Entity 分离（MapStruct）；Flyway 禁改历史迁移。
- Python：ruff + mypy（core 包全量类型）；asyncio 全异步（禁同步 IO 于事件循环）；uv 锁定依赖。
- 前端：ESLint+Prettier；组件 ≤300 行；store 禁放派生数据。
- CI（本地脚本先行，git hooks）：spotless/ruff/mypy/eslint → 单测 → compose 冒烟（smoke.py）→ 镜像构建推送 ACR。
- 分支：main 保护；feature/* → PR 自检清单（对应 03 用例编号）。
