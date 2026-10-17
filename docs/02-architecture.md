# 总体架构与模块设计文档 — Gill Agent（企业级）

| 项 | 内容 |
|---|---|
| 文档版本 | v1.1（待评审） |
| 编写日期 | 2026-10-16 |
| 关联文档 | 《01-需求澄清》《03-测试用例设计》 |
| 变更说明 | v1.1：应用层全面无状态化（Redis 事件总线，支撑多节点横向扩展）；新增 MinIO 文件链路、RBAC 管理后台、可观测性、配额治理；中间件按 D5 单机部署 |

---

## 1. 设计原则（对应决策 D5）

1. **应用无状态**：web / agentd 不持有任何会话粘性状态；连接注册、会话路由、任务锁、限流、在线状态全部下沉 Redis；任一副本可服务任一请求/WS。
2. **事实源唯一**：PostgreSQL 是业务事实唯一持久源；Redis 只存易变态（总线/锁/限流/在线），可整体丢失后由 PG + 重连自愈。
3. **大文件不过应用内存**：浏览器↔MinIO 预签名直传；进出沙箱由 agentd 以 8MB 缓冲流式中转（沙箱在云端无法直连本地 MinIO，此跳不可避免）。
4. **实时通道分等级**：事件（不可丢，Redis Streams）与投屏帧（可丢旧，Redis Pub/Sub）物理分道，慢消费者互不拖累。
5. **中间件单机起步**：PG / Redis / MinIO 均单实例，但连接串、桶名、Topic 命名与客户端用法与托管版/集群版完全兼容，升级只换连接配置。

## 2. 总体拓扑

```mermaid
flowchart LR
    subgraph LOCAL["本机 Windows（Docker Desktop）— compose 项目 gill"]
        BR["验收浏览器"]
        LB["Nginx :80<br/>(profile: edge, 可选)"]
        subgraph APP["应用层（无状态，可 --scale 多副本）"]
            WEB1["web 副本×N<br/>Spring Boot 3 :8080"]
            AG1["agentd 副本×M<br/>FastAPI :8000"]
        end
        subgraph MW["中间件（单机）"]
            PG[("PostgreSQL 16<br/>+pgvector(知识向量)")]
            RD[("Redis 7<br/>事件总线/锁/限流/在线")]
            MINIO[("MinIO :9000/:9001<br/>对象存储")]
        end
        subgraph OBS["可观测（profile: obs, 可选）"]
            PROM["Prometheus"]
            GRAF["Grafana"]
        end
    end
    subgraph CLOUD["沙箱专用机 39.107.34.109（阿里云，4C/7.1G/69G，Ubuntu 24.04.2，实测达标）"]
        CUBE["CubeSandbox :3000"]
        SBX["沙箱×N<br/>MicroVM + Chromium"]
    end
    ZP["智谱 GLM API"]

    BR --> LB --> WEB1
    WEB1 <-. "Redis Streams(cmd/evt)<br/>+ PubSub(frame)" .-> AG1
    WEB1 --> PG & RD
    AG1 --> PG & MINIO & RD
    AG1 <-. "预签名流式中转" .-> MINIO
    AG1 <-- "E2B 兼容 API" --> CUBE
    CUBE --- SBX
    AG1 <-- HTTPS --> ZP
    PROM -. scrape .-> WEB1 & AG1
```

要点：

- 浏览器只经 Nginx（或单副本时直连 8080）访问 web；agentd/PG/Redis/MinIO 不对外暴露。
- **web 与 agentd 之间没有点对点连接**，全部经 Redis 总线（§3.1），这是多副本扩展的关键。
- 智谱 key、MinIO root、JWT 密钥仅存在于 env。
- 本地↔云端仅两条链路：`agentd → Cube:3000`（E2B API/文件/CDP）与沙箱端口代理（经 CubeProxy）。

## 3. 核心机制设计

### 3.1 Redis 实时总线（多节点扩展的基础）

| 通道 | 类型 | 键 | 方向 | 语义 |
|---|---|---|---|---|
| 命令 | Stream | `gill:cmd:{sessionId}` | web→agentd | user_input / stop / preview_start / preview_stop / file_sync_in / file_export / file_list / preview_resync 等；信封含 `cid`（correlationId）、`traceId`、`fromNode` |
| 事件 | Stream | `gill:evt:{sessionId}` | agentd→web | agent_delta / tool_call / tool_result / terminal / session_status / file_sync_progress / file_exported / done / error；同信封 |
| 投屏帧 | Pub/Sub | `gill:frame:{sessionId}` | agentd→web | 单条二进制消息 = `4B meta-len + meta(JSON) + JPEG`；best-effort 丢旧 |
| 在线状态 | Hash+TTL | `gill:presence:{userId}` | web 写 | nodeId→连接数，心跳 10s；供 ADMIN 统计在线用户 |
| 会话所有权 | String+TTL | `gill:lease:session:{id}` | agentd 写 | `SET NX PX 30000` 值=agentdNodeId+epoch，心跳续期；**保证一会话同一时刻仅一个 agentd 持有** |
| 任务锁 | String+TTL | `gill:lock:task:{sessionId}` | agentd 写 | FR-37 同会话单任务 |
| 限流 | String | `gill:rl:{userId}:{bucket}` | web 写 | INCR+EXPIRE 令牌窗（API 与登录分开配额） |

**消费与容错**：
- agentd 启动即加入消费者组 `gill-agentd`；只处理自己持有 lease 的会话命令流；对失去 lease 的会话停止消费。**接管**：节点心跳失败后 lease 过期，其他节点 `XAUTOCLAIM` 该流的 pending 消息继续处理（fencing：命令信封 epoch < lease epoch 则拒绝执行）。
- web 副本对"本节点有订阅者"的会话启动 evt 读取协程（消费者组 `gill-web-{nodeId}`），断开订阅即停；请求-应答（如 file_list）由发起 web 节点按 `cid` 在内存 Future 上等待（≤10s 超时）。
- 帧通道重订阅后可能漏帧：web 在订阅成功时向 cmd 流发 `preview_resync`，agentd 立即补发一帧。
- Streams 用 `MAXLEN ≈ 10000` 修剪；Redis 持久化 `appendonly yes`（everysec），满足单机中间件容忍度（D5）。

### 3.2 事件信封与客户端 WebSocket

**浏览器 WS `/ws/agent?sessionId=&token=`**（文本=JSON，二进制=投屏帧）——协议与 v1.0 相同，补充：

- 新增服务端→客户端：`file_sync_progress`{objectId, pct}、`file_synced`、`file_exported`{filename, downloadUrl}、`file_tree`、`node_info`{webNodeId}（排障用）。
- 新增客户端→服务端：`file_sync_in`{uploadId, destPath}、`file_export`{path}、`file_list`{path}、`file_delete`{path}（沙箱侧）/ REST 管上传件删除。
- **审批（FR-38/BD-4）**：服务端→客户端 `approval_request`{cid, command, riskLevel: high|medium, reason, expiresIn}；客户端→服务端 `approval_response`{cid, action: approve|deny|always_allow}；120s 无响应自动 deny 并回事件 `approval_timeout`。

**投屏帧转发（web 侧）**：订阅 `gill:frame:{sessionId}` → 拆出 meta/JPEG → 文本帧 meta + 二进制帧 JPEG 发给本地订阅 WS；单副本多客户端为"本地扇出"，跨副本由发布端一次发布、各订阅副本各自扇出。

### 3.3 背压与内存（全链路汇总）

| 层 | 机制 |
|---|---|
| agentd→Redis 帧 | 发布前本地队列容量 2，丢旧保新；`Page.screencastFrameAck` 在帧成功入队后回 |
| web 帧扇出 | 每 WS 发送缓冲上限 512KB，超限丢帧并计数 `frame_drop_total`；事件发送缓冲 256 条，写满暂停读取该 evt 流（反压传导至 agentd 发布暂停） |
| 文件中转 | 8MB 缓冲流式；单用户并发同步/导出 ≤1，全局 ≤10（信号量+排队）；200MB 上限（FR-68） |
| 连接治理 | 单用户 WS≤3（Redis 计数跨副本生效）、会话≤2；全局 WS≤512/副本；**全局沙箱≤3（4C8G 下可上调至 ~6；50 为升配后目标）** |
| 进程内存 | web `-Xmx1g` 虚拟线程；agentd asyncio 单循环（base64/CRC 走 C 扩展）；PG 池 web16/agentd8；Redis 连接池 |
| 容量估算 | 沙箱机（4C8G/≥10Mbps）：3 路投屏×5fps×50KB≈6Mbps，带宽达标；升配后 50 会话≈12.5MB/s（需按带宽重新评估）；文件中转全局 10 并发×8MB 缓冲 ≈ 80MB 峰值（本地侧不受沙箱机规格影响） |

### 3.4 故障模式与自愈

| 故障 | 行为 |
|---|---|
| web 副本宕 | LB 摘除；客户端重连其他副本，历史从 PG 重放，帧经 resync 恢复；presence TTL 自动清 |
| agentd 副本宕 | lease 过期 → 其他副本 XAUTOCLAIM 接管；沙箱不销毁（connect 恢复），进行中任务的最后一条 LLM 回合丢弃、任务标记 interrupted 可重发 |
| Redis 重启（AOF） | 总线短断：web/agentd 自动重连+重建消费者组；帧通道靠 resync；锁丢失由幂等设计兜底（任务锁仅防并发，不承担一致性） |
| PG 重启 | 请求 5xx 短暂，应用指数退避重连 |
| 沙箱被回收/崩溃 | connect 失败 → 懒重建空沙箱并提示（FR-24） |
| Cube 不可达 | agentd 健康检查失败 → 新任务排队重试，存量会话标记 degraded |
| GLM 429/超时 | 退避重试 2 次 → 用户可读错误；usage 不计费 |

## 4. 模块详细设计

### 4.1 web 服务（Java 21 + Spring Boot 3.3）

**职责**：认证/RBAC、REST、WS 网关、Redis 总线收发、文件网关（预签名/配额/元数据）、管理后台、指标暴露。**不执行任何用户代码，不做大文件中转。**

```
web/src/main/java/com/gill/web/
 ├─ controller/    # AuthController(+PAT), SessionController, MessageController,
 │                 # FileController, SpaceController(空间/成员/邀请/空间聊天),
 │                 # KnowledgeController, ExtensionController, AdminController
 ├─ ws/            # AgentWebSocketHandler, FanoutRegistry(本地订阅表), BusConsumer
 ├─ bus/           # RedisStreamsGate(cmd 发布/evt 消费), FrameSubscriber
 ├─ security/      # JwtFilter, JwtUtil, WsHandshakeAuth, RBAC(@AdminOnly/@SpaceRole)
 ├─ service/       # SessionService, SpaceService(成员/邀请/级联解散), QuotaService,
 │                 # FileService, PresenceService, KnowledgeService(检索/注入代理),
 │                 # ExtensionService(manifest 校验/发布/统计), OpLockService(操作权令牌)
 ├─ repo/ entity/  # 全部 14 张表实体（§5）
 └─ config/        # 虚拟线程, Hikari, Micrometer, CORS, 限流
```

**REST API（在 v1.0 基础上新增文件与管理）**

| 方法/路径 | 说明 |
|---|---|
| POST /api/auth/register / login、GET /api/me | 同 v1.0（登录加锁定） |
| GET/POST/DELETE /api/sessions…、GET …/messages | 同 v1.0 |
| POST /api/sessions/{id}/files/uploads | 申请上传：校验配额/大小/文件名黑名单 → 返回 `{uploadId, presignedPut(15min), objectKey}`，file_objects=PENDING |
| POST /api/sessions/{id}/files/uploads/{uid}/complete | HeadObject 核验大小/存在 → UPLOADED + 审计 |
| POST /api/sessions/{id}/files/sync-in | `{uploadId, destPath}` → cmd 总线，事件回 file_sync_progress/synced |
| POST /api/sessions/{id}/files/exports | `{path}` → cmd 总线 → file_exported{downloadUrl(30min)} |
| GET /api/sessions/{id}/files/tree | 请求-应答（cid）→ file_tree |
| DELETE /api/sessions/{id}/files/uploads/{uid} | 删除上传件（PG+MinIO+审计） |
| GET /api/admin/users、PATCH /api/admin/users/{id} | 用户查询/禁用/启用/重置密码/角色/配额（ADMIN） |
| GET /api/admin/sessions、DELETE /api/admin/sessions/{id} | 会话治理/强制终止 |
| GET /api/admin/audit、GET /api/admin/audit/export.csv | 审计查询/导出 |
| GET /api/admin/stats/overview | 在线数（presence）、活跃会话/沙箱（PG）、今日 token/费用（llm_usage）、存储用量（file_objects） |
| GET/POST /api/v1/spaces、GET /api/v1/spaces/{id} | 空间列表/创建/详情（个人空间注册即建） |
| POST /api/v1/spaces/{id}/invites、POST /api/v1/invites/{token}/accept | 邀请创建（用户名直邀/24h 链接）/接受（FR-132） |
| PATCH/DELETE /api/v1/spaces/{id}/members/{userId} | 组内角色调整/移除（@SpaceRole 校验） |
| DELETE /api/v1/spaces/{id} | 解散（级联+7 天导出宽限任务） |
| GET/POST /api/v1/spaces/{id}/chat | 空间成员聊天（30 天保留，分页） |
| GET/POST/PATCH/DELETE /api/v1/knowledge | 知识条目 CRUD（scope 过滤）；GET /knowledge/search=混合检索 |
| POST /api/v1/knowledge/export、/import | 导出 JSON/MD、导入（merge 策略） |
| GET/POST/PATCH/DELETE /api/v1/extensions | 扩展 CRUD（manifest 上传/校验） |
| POST /api/v1/extensions/{id}/publish、/test | 发布到空间（ADMIN 审）/测试运行（脱敏摘要） |
| GET /api/v1/extensions/{id}/tools、/calls | 工具清单/调用统计 |
| POST /api/v1/sessions/{id}/oplock | 操作权 申请/释放（relay 模式） |
| GET /api/v1/me/pats、POST/DELETE | PAT 管理（创建仅展示一次） |
| GET /actuator/prometheus、/actuator/health | 指标/健康 |

**关键服务**：
- `QuotaService`：存储配额=PG SUM(file_objects.size)+本次；token 日配额=llm_usage 当日 SUM（写入时 agentd 校验，web 在任务下发时预检）。
- `PresenceService`：登录/WS 建立/断开维护 presence；ADMIN 统计读它。
- `FileService`：MinIO 预签名（MinIO Java SDK）；对象键 `uploads/{userId}/{uuid}/{safeName}`、`exports/{sessionId}/{uuid}-{safeName}`。

### 4.2 agent 服务（agentd + `gill` CLI，Python 3.12）

```
agent/
 ├─ gill_core/
 │   ├─ llm.py       # AsyncOpenAI(base_url=智谱, chat+embedding-3)；usage 回写
 │   ├─ loop.py      # Agent 循环（轮次预算/中断/审批钩子/**知识注入点/扩展工具路由**）
 │   ├─ kb.py        # 知识库管线：沉淀判定辅助/混合检索(pgvector)/去重阈值/注入模板
 │   ├─ exts.py      # 扩展运行时：manifest 加载/HTTP 工具 curl 模板化/脚本工具 venv 缓存/
 │   │               # MCP client 生命周期(自动发现/探活)/命名空间与冲突检测
 │   ├─ risk.py      # 敏感命令规则库（高危/中危分级，suggest 档审批判定）
 │   ├─ tools.py     # 内置工具注册：shell/file_*/browser_*/knowledge_*/workspace_files/…
 │   ├─ sandbox.py   # E2B 会话管理（懒创建/connect 复用/空闲 TTL/信号量）
 │   ├─ browser.py   # CDP 客户端（控制+投屏+交互回注+自适应降质+oplock 感知）
 │   ├─ files.py     # MinIO 流式中转（sync-in/export，8MB 缓冲）
 │   ├─ bus.py       # redis-py asyncio：cmd 消费/evt 消费/帧发布/lease 心跳/presence
 │   └─ store.py     # asyncpg：messages/command_audit/llm_usage/file_objects/knowledge/extensions
 ├─ agentd/          # FastAPI: /healthz /metrics；lease 管理器；会话运行时注册表
 └─ cli/             # gill 命令树（chat/run/session/file/knowledge/skill/tool/config/…）
     ├─ commands/    # 各子命令实现（调 Web REST/WS API，BD-11）
     ├─ render.py    # rich 渲染层（流式 md/表格/spinner/审批交互）
     └─ config.py    # 三层配置合并（env>项目>全局）
```

**Agent 循环（同 v1.0 伪代码），新增文件类与知识/扩展工具：**任务开始前经 `kb.py` 混合检索组装 `[用户/团队知识库]` 注入块（top-8/2000 token，检索优先级 session>project>group>user）；工具面 = 内置工具 + 用户已启用扩展（`ext_*`/`mcp_*` 命名空间，`exts.py` 动态合入 Schema）；轮次结束后解析知识引用回写 hit_count。

| 工具 | 说明 |
|---|---|
| workspace_files() | 列出本会话已上传文件（读 file_objects UPLOADED） |
| materialize(filename, dest?) | 按需把上传件流式同步进沙箱后返回沙箱内路径 |
| export_file(path) | 沙箱文件导出到 MinIO，返回下载 URL（供模型告知用户） |

**沙箱/CDP 设计**：同 v1.0（懒创建、`set_timeout(1800)`、Chromium 9222 经 CubeProxy、startScreencast jpeg/60q/1280×800、ack、meta+帧、坐标换算回注、自适应 everyNth/quality）。

**审批档位（FR-38/BD-4，一期实现）**：会话级 `auto`/`suggest` 两档，前端会话头部可切换（默认 auto）。`suggest` 档下 `loop.py` 在每次 shell 工具执行前调用 `risk.py` 判定，规则库两级（正则+路径模式，配置文件可扩展）：高危=rm -rf、sudo/su、`curl|sh` 管道执行、写 `/etc|/usr|/bin` 等系统路径、SSH/防火墙变更；中危=包管理安装卸载、外网数据提交、批量文件删除。命中即挂起该工具调用，经总线发 `approval_request`（§3.2），等待 `approval_response`：approve / deny / **always_allow**（会话内存记录规则指纹，同类命令本会话免批）；120s 超时自动 deny。CLI 形态下为终端 y/n 交互（rich prompt，同超时）。全部审批动作（命令、风险级别、决策、决策人、延迟 ms）写 command_audit；auto 档不拦截但仍全量审计。

**agentd 持久化职责**：messages（含 tool 调用与结果）、command_audit（命令全文/exit/时长/sandboxId）、llm_usage（tokens/model）、file_objects 状态推进——均为"事件发生地直写 PG"，web 不重复写（单一写入者原则）。

### 4.3 管理后台前端

路由 `/admin`（ADMIN 可见）：用户管理（搜索/禁用/重置密码/配额编辑）、会话治理（筛选/终止）、审计检索（时间/用户/类型/关键词 + CSV 导出）、总览仪表（在线、活跃沙箱、今日 token 与费用、存储用量、节点列表）。实现为同一 React 应用的 admin 区块（复用鉴权与请求层）。

### 4.4 工作台前端（用户侧）

在 v1.0 布局（会话列表/对话流/终端/浏览器预览）上新增**文件区**（右侧或底部 Tab）：
- 上传：选择文件 → 申请预签名 → 浏览器 `PUT` 直传 MinIO（进度条用 XHR upload progress）→ complete → 列表刷新；
- 文件树：上传件 + 沙箱工作区目录（file_tree）统一展示；同步/导出/删除按钮；导出完成弹下载链接；
- 下载走预签名 GET（浏览器直下）。

### 4.5 沙箱层（CubeSandbox @ 39.107.34.109，4C/7.1G/69G）

**部署基线（2026-10-17 实测达标）**：阿里云沙箱专用机 `root@39.107.34.109`，4 vCPU / 7.1GiB（可用 6.6G）/ 磁盘空闲 64G / Ubuntu 24.04.2 + kernel 6.8（PVM DEB 路径）/ 无 `/dev/kvm`→PVM / 全新机器无存量服务与端口冲突 / 出网正常（入向实测 75Mbps）、本机 RTT 39ms。PVM 换内核重启无存量业务风险；单盘 69G（`/data/cubelet` XFS）无需数据盘；安全组 3000/tcp 限源；模板 `gill-browser`（Chromium+CJK、expose 9222/49999）。**扩展性**：Cube v0.6+ 原生支持 K8s 多节点与跨节点暂停/恢复，沙箱层扩容与本地应用层独立（加 Cube 节点即可），`E2B_API_URL` 不变。

**资源规划（验收口径 3 并发稳定/最低 2）**

| 项 | 取值 | 说明 |
|---|---|---|
| 模板资源 | cpu 1 / mem 768MB | `create-from-image --cpu 1 --memory 768`；Chromium 加 `--disable-dev-shm-usage`（容器内 /dev/shm 受限） |
| 全局沙箱上限 | 3（env 可调，本机规格上限约 6） | agentd 信号量；升配后调 50 |
| 空闲回收 TTL | 15min | 释放 RAM/CPU（沙箱重建 <1s，体验影响小） |
| 平台组件 | 官方脚本默认（底座 RSS 约 1G） | 7.1G 内存：底座 1G + 3×768M ≈ 3.3G，富余 |
| swap | **安装时新建 4G**（当前无 swap） | 峰值兜底 |
| 带宽 | 入向实测 75Mbps；出向安装后实测 | 3 路投屏 ≈6Mbps；不足启用降帧策略（2fps/quality 40） |
| 模板构建 | 一次性约 5-10min | **本地构建 → 推送 ACR `registry.cn-guangzhou.aliyuncs.com/gill-gplatform/gill-agent-sandbox:1.0` → Cube `create-from-image` 从该镜像创建模板**（国内直连不走代理；私有仓库需先在沙箱机 `docker login`）；基础镜像（python:3.12-slim 等）在本地经代理 7890 拉取 |

**升配路径（恢复 50 并发）**：升配/换购更大规格 → 调大模板 cpu/mem 与全局上限 env → 无需重新部署或改代码。

## 5. 数据模型（PostgreSQL 16 + pgvector）

```sql
-- 空间体系（v1.4）
spaces(id UUID PK, type VARCHAR(8),              -- personal|group（personal 注册即建）
       name VARCHAR(64), owner_user_id FK,
       default_approval VARCHAR(8) DEFAULT 'auto', default_op_mode VARCHAR(8) DEFAULT 'free',
       created_at, dissolved_at NULL)
space_members(space_id, user_id, role VARCHAR(8), -- owner|admin|member
       joined_at, PRIMARY KEY(space_id, user_id))
invites(id UUID PK, space_id FK, token VARCHAR(32) UNIQUE, created_by FK,
       expires_at, revoked BOOL DEFAULT false, accepted_by FK NULL)
space_chat(id BIGSERIAL PK, space_id FK, user_id FK, content TEXT, created_at)  -- 保留30天

users(id BIGSERIAL PK, username UNIQUE, password_hash,
      role VARCHAR(8) DEFAULT 'USER', status VARCHAR(8) DEFAULT 'ACTIVE',
      custom_instructions VARCHAR(2000), storage_quota_bytes BIGINT DEFAULT 5368709120,
      token_quota_daily BIGINT DEFAULT 2000000, created_at, last_login_at)
pats(id UUID PK, user_id FK, name VARCHAR(64), token_hash UNIQUE,   -- gpat_ 前缀，只存哈希
     created_at, last_used_at, revoked BOOL DEFAULT false)

sessions(id UUID PK, space_id FK, user_id FK AS 创建者/actor 溯源, title, project_tag VARCHAR(50) NULL,
         status, sandbox_id VARCHAR(64) NULL, node_owner VARCHAR(64) NULL,
         created_at, last_active_at, closed_at)
messages(id BIGSERIAL PK, session_id FK, seq INT, role, content TEXT, actor_user_id NULL,
         tool_name, tool_args JSONB, tool_result JSONB, trace_id, created_at, UNIQUE(session_id, seq))
command_audit(id BIGSERIAL PK, session_id FK, space_id FK, user_id FK AS actor, sandbox_id,
         command TEXT, risk_level NULL, rule_id NULL, decision NULL, decision_by NULL,
         exit_code INT, duration_ms INT, created_at)
file_objects(id UUID PK, space_id FK, user_id FK, session_id FK NULL, direction,
         object_key TEXT, filename VARCHAR(255), size_bytes BIGINT, status, created_at, expired_at NULL)

-- 知识库（pgvector）
CREATE EXTENSION IF NOT EXISTS vector;
knowledge_items(id UUID PK, user_id FK AS 创建者, space_id FK NULL,      -- scope 绑定
       scope VARCHAR(8),                    -- session|project|group|user
       project_tag VARCHAR(50) NULL, session_id UUID NULL,
       type VARCHAR(12), title VARCHAR(128), content TEXT, tags TEXT[],
       source VARCHAR(8), source_msg_id BIGINT NULL,
       embedding vector(1024),              -- 智谱 embedding-3
       confidence REAL, hit_count INT DEFAULT 0, last_used_at NULL,
       pinned BOOL DEFAULT false, status VARCHAR(8) DEFAULT 'active',
       version INT DEFAULT 1, created_at, updated_at)
CREATE INDEX ON knowledge_items USING hnsw(embedding vector_cosine_ops);
CREATE INDEX ON knowledge_items(space_id, scope, status);

-- 扩展体系
extensions(id UUID PK, user_id FK AS 安装者, space_id FK NULL,           -- visibility=space 时
       visibility VARCHAR(8) DEFAULT 'private',                          -- private|space
       name VARCHAR(32), version VARCHAR(16), type VARCHAR(16),          -- http-tools|script-tools|skill|mcp|prompt
       manifest JSONB, status VARCHAR(8) DEFAULT 'enabled',
       call_count_7d INT DEFAULT 0, created_at, updated_at, UNIQUE(space_id, name))
extension_secrets(id UUID PK, user_id FK, name VARCHAR(64),              -- 密钥引用，AES-GCM
       cipher BYTEA, created_at, UNIQUE(user_id, name))
llm_usage(id BIGSERIAL PK, user_id FK, session_id FK, model,
         prompt_tokens INT, completion_tokens INT, created_at)
-- 索引: sessions(space_id,status), messages(session_id,seq), command_audit(space_id,created_at),
--       file_objects(space_id), knowledge_items 索引如上, extensions(space_id,status), llm_usage(user_id,created_at)
```

**写入者划分**：web=users/spaces/members/invites/pats/file_objects(PENDING→UPLOADED)/knowledge(CRUD)/extensions(配置)/space_chat；agentd=messages/command_audit/llm_usage/file_objects(SYNCED)/knowledge(hit 回写、自动沉淀)；清理任务=file_objects 过期、space_chat 30 天、解散空间宽限清理。

## 6. 中间件选型与单机→集群路径

| 中间件 | 一期（单机） | 用途 | 升级路径（仅换配置） |
|---|---|---|---|
| PostgreSQL 16 | 单实例 | 唯一事实源 | RDS/自建主从（连接串） |
| Redis 7 | 单实例 + AOF everysec | 总线/锁/限流/在线 | Redis Cluster / 云 Redis（`cluster-enabled` 客户端兼容；总线键按 sessionId 天然分片） |
| MinIO | 单机单盘 | 对象存储（uploads/exports/backup 三桶） | 分布式 4 节点纠删码（S3 API 不变） |
| Nginx | compose profile `edge`（单机可省） | LB/WS 代理 | 任意 L7 LB/SLB |
| Prometheus+Grafana | compose profile `obs` | 指标/看板 | 独立监控集群 / VM/云监控 |

## 7. 关键时序

### 7.1 一次对话回合（经总线）

```mermaid
sequenceDiagram
    participant U as 浏览器
    participant W as web副本(任一)
    participant R as Redis
    participant A as agentd(lease持有者)
    participant L as GLM
    participant S as 沙箱
    U->>W: WS user_input
    W->>R: XADD cmd:{sid}(cid,traceId)
    R->>A: XREADGROUP(持有lease的会话)
    A->>L: chat(stream, tools)
    A->>R: XADD evt:{sid} agent_delta*/tool_call
    R->>W: 消费(本地有订阅者) ──W转发──>>U
    A->>S: commands.run(...)/files.*
    A->>R: XADD evt terminal*/tool_result
    A->>A: 直写 PG: messages/command_audit/llm_usage
    A->>R: XADD evt done
```

### 7.2 文件上传与同步进沙箱

```mermaid
sequenceDiagram
    participant U as 浏览器
    participant W as web
    participant M as MinIO
    participant A as agentd
    participant S as 沙箱
    U->>W: POST uploads{filename,size}
    W->>W: 配额/黑名单/文件名净化 → file_objects=PENDING
    W-->>U: {uploadId, presignedPut(15min)}
    U->>M: PUT 直传(不过web内存)
    U->>W: complete → HeadObject核验 → UPLOADED(+审计)
    U->>W: sync-in{uploadId} ── XADD cmd ──>> A
    A->>M: 流式GET(8MB缓冲)
    A->>S: files.write 分段写入
    A-->>U: evt file_sync_progress*/synced(经总线+web)
```

### 7.3 导出下载

沙箱 `files.read` 流式 → agentd putObject MinIO（exports/，7 天 ILM）→ evt `file_exported{objectKey}` → web 生成预签名 GET(30min) → 浏览器直下；file_objects 记录 export + 审计。

### 7.4 投屏（v1.0 基础上改走总线）

agentd 发布 `gill:frame:{sid}`（meta+JPEG 单消息）→ 各持有订阅者的 web 副本收到 → 本地扇出给 WS（文本 meta + 二进制帧）；重订阅/新副本上线发 `preview_resync` 补帧。

## 8. 可观测性设计

| 维度 | 实现 |
|---|---|
| 日志 | web: Logback JSON（level/ts/traceId/userId/sessionId/node）；agentd: structlog 同字段；stdout → docker driver |
| 追踪 | web Filter 生成 traceId（或透传 X-Request-Id）→ cmd 信封 → agentd contextvar 贯穿该会话所有日志与 PG 记录（messages.trace_id）；一期不接分布式追踪后端，字段就绪 |
| 指标 | web(Micrometer)/agentd(prometheus_client)：`ws_connections`、`sessions_active`、`bus_cmd_lag`、`evt_consume_lag`、`frame_drop_total`、`frame_fps`、`task_duration_seconds`(histogram)、`tool_duration{tool}`、`llm_tokens_total{dir,model}`、`sandbox_active`、`sandbox_create_seconds`、`file_sync_bytes_total`、`file_sync_duration_seconds`、`quota_reject_total`、`http_server_requests`、JVM/进程基础指标 |
| 告警 | Grafana 看板 + 阈值（示例：frame_drop 突增、cmd_lag>5s、错误率>2%）——一期看板化，推送通道二期 |
| 审计 | command_audit + 登录/文件事件入 audit（who/when/what/结果），ADMIN 可查可导出 |

## 9. 部署方案

### 9.1 仓库结构

```
gill-agent/
 ├─ docs/                     # 三份文档
 ├─ web/                      # Java 服务(pom + src + Dockerfile)
 ├─ agent/                    # gill_core/agentd/cli + Dockerfile
 ├─ frontend/                 # React(工作台+admin) → 产物拷入 web 静态目录
 ├─ deploy/
 │   ├─ docker-compose.yml    # web/agentd/pg/redis/minio(+edge/obs profile)
 │   ├─ .env.example
 │   ├─ obs/                  # prometheus/grafana 配置与看板
 │   └─ cube/                 # gill-browser 模板 Dockerfile、ECS 部署脚本与记录
 └─ scripts/                  # backup.sh(PG→MinIO)、冒烟/压测脚本
```

### 9.2 本地 compose（核心摘录）

```yaml
services:
  postgres: { image: pgvector/pgvector:pg16, volumes: [pgdata:/var/lib/postgresql/data] }
  redis:    { image: redis:7-alpine, command: redis-server --appendonly yes }
  minio:
    image: minio/minio:RELEASE.2025-*
    command: server /data --console-address ":9001"
    ports: ["9000:9000", "127.0.0.1:9001:9001"]   # Console 仅本机
    volumes: [miniodata:/data]
  minio-init:   # 建桶 uploads/exports/backup + exports 7天过期
    image: minio/mc
    depends_on: [minio]
    entrypoint: >
      sh -c "mc alias set g http://minio:9000 $$MINIO_ROOT_USER $$MINIO_ROOT_PASSWORD &&
             mc mb -p g/gill-files g/gill-backup &&
             mc ilm rule add g/gill-files --prefix exports/ --expire-days 7"
  agentd:
    build: ../agent
    environment: &agentd_env
      - ZHIPU_API_KEY=*** / ZHIPU_BASE_URL=... / ZHIPU_MODEL=glm-4.6
      - ZHIPU_EMBED_MODEL=embedding-3 / KB_INJECT_MAX=8 / KB_DEDUP_SIM=0.92
      - SPACE_MEMBER_MAX=50 / SESSION_VIEWERS_MAX=10
      - E2B_API_URL=http://39.107.34.109:3000 / E2B_API_KEY=*** / CUBE_TEMPLATE_ID=gill-browser
      - CUBE_PROXY_NODE_IP=39.107.34.109
      - REDIS_URL=redis://redis:6379
      - DATABASE_URL=postgresql://gill:***@postgres:5432/gill
      - MINIO_ENDPOINT=http://minio:9000 / MINIO_ROOT_USER/… / MINIO_BUCKET=gill-files
      - HTTP_PROXY=http://host.docker.internal:7890
      - NO_PROXY=localhost,127.0.0.1,postgres,redis,minio,agentd,web,39.107.34.109
    deploy: { replicas: 1 }          # 扩展: --scale agentd=2（lease 保证互不争抢）
  web:
    build: ../web
    ports: ["8080:8080"]
    environment:
      - REDIS_URL=redis://redis:6379
      - DATABASE_URL=jdbc:postgresql://postgres:5432/gill
      - MINIO_ENDPOINT=http://minio:9000 / MINIO_BUCKET=gill-files
      - JWT_SECRET=*** / INIT_ADMIN_USERNAME=admin / INIT_ADMIN_PASSWORD=***
      - AGENTD_SCALE_HINT=1
    deploy: { replicas: 1 }          # 扩展: --scale web=2 + 启用 edge profile
  nginx: { profiles: [edge], image: nginx:stable, ports: ["80:80"] }   # upstream web; WS upgrade
  prometheus: { profiles: [obs], ... }
  grafana:    { profiles: [obs], ... }
```

**代理约定**：构建期 `--build-arg HTTP_PROXY=http://host.docker.internal:7890 ...`；**NO_PROXY 必含**内网服务名、沙箱机地址（39.107.34.109）与 `registry.cn-guangzhou.aliyuncs.com`（ACR 国内直连，推送/拉取不走代理）；代理软件开启 Allow LAN（F5）。

**扩容操作（验收 NFR-09/BD-5）**：`docker compose up -d --scale web=2 --scale agentd=2 --profile edge` → Nginx 分发，无需会话粘性；回收缩容同理（副本 SIGTERM 走优雅停机 FR-84）。

### 9.3 沙箱机（39.107.34.109，一次性）

1. ~~购机与首检~~ **已完成（2026-10-17）**：4C/7.1G/空闲 64G/Ubuntu 24.04.2，无 /dev/kvm→PVM，端口 3000 等全空闲，出网正常（入向 75Mbps），本机 RTT 39ms，SSH 密钥可登。
2. 准备：新建 4G swap；`/data/cubelet` XFS 格式化挂载（空闲 64G 足够）。
3. PVM 内核安装（Ubuntu DEB 路径）→ 重启（新机无存量业务，失败可重装系统重试）。
4. 官方脚本安装 Cube（平台组件默认配置）。
5. 安全组/防火墙：**开放 3000/tcp（限源 IP=本机公网出口，委托方控制台操作）**；WebUI 12088 不对公网。
6. **模板镜像**：本地构建 `gill-agent-sandbox`（Chromium+CJK，基于 python:3.12-slim，基础镜像走代理 7890 拉取）→ 推送 ACR `registry.cn-guangzhou.aliyuncs.com/gill-gplatform/gill-agent-sandbox:1.0` → 沙箱机执行 `docker login`（私有仓库拉取凭证）后 `cubemastercli tpl create-from-image --image registry.cn-guangzhou.aliyuncs.com/gill-gplatform/gill-agent-sandbox:1.0 ...` 至 READY；冒烟：创建沙箱跑 `chromium --version` + CDP `/json/version`；实测出向带宽（帧流方向 ≥6Mbps）。web/agentd 应用镜像可推 `gill-gplatform/` 下其他仓留档（可选，便于迁移部署）。
7. 产出 `E2B_API_URL / E2B_API_KEY / CUBE_TEMPLATE_ID` 写入本地 `.env`。

（原阿里云 ECS 8.147.106.47 不承载任何组件，见 D7/D9。）

### 9.4 备份与恢复（FR-86）

`scripts/backup.sh`（cron 或手动）：`pg_dump | gzip | mc pipe g/gill-backup/pg/yyyy-mm-dd.sql.gz`，MinIO backup 桶 ILM 30 天；恢复=反向执行，手册写入 `deploy/BACKUP.md`，验收演练一次（TC-DR-01）。

## 10. 里程碑

| 里程碑 | 内容 | 出口标准 |
|---|---|---|
| M1 | 沙箱机购机→PVM→Cube + 双模板 READY + 资源规划生效 | TC-DEPLOY 通过（含沙箱机资源核查） |
| M2 | gill_core（对话/shell/文件工具落沙箱+审批规则库）+ CLI 骨架（chat/run/login/config/doctor） | `gill chat` 完成 demo 任务；suggest 档拦截；--json 退出码正确 |
| M3 | web：认证/RBAC(PAT)/空间体系/会话/总线/对话+终端；多端同会话同步 | TC-AUTH/TC-CHAT 基线 + TC-COLLAB-01~04 通过 |
| M4 | CDP 投屏+交互回注+**操作权（自由/接力）+协作感知+成员聊天** | TC-CDP + TC-COLLAB-05~08 通过 |
| M5 | 文件链路（MinIO）+**知识库管线**+**扩展运行时与扩展中心**+CLI 全命令树+简化后台 | TC-FILE/TC-KB/TC-EXT/TC-CLI + TC-ADMIN 基线通过 |
| M6 | 演示模式/handoff/扩展发布到空间 + 扩展性（双副本）+ 压测 + 备份演练 + 端到端验收 | TC-COLLAB-09~12 + TC-SCALE/TC-PERF/TC-DR + 全量 P0 |

## 11. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| Redis 单点故障（D5 接受） | 总线/锁短暂不可用 | AOF everysec；客户端自动重连+消费者组重建；锁仅防并发不担一致性；升级路径见 §6 |
| agentd 中转大文件占用带宽/内存 | 并发传输时资源上升 | 8MB 缓冲流式 + 全局 10 并发上限 + 200MB 单文件上限；分块协议二期 |
| 多副本下 lease/接管边界缺陷 | 命令重复执行或丢失 | fencing epoch + XAUTOCLAIM 幂等处理；TC-SCALE 专项用例（杀副本验证接管） |
| 沙箱机资源不足/带宽不足 | 沙箱 OOM/投屏卡顿 | 4C8G/70G 达官方基线；上限 3 起步（可调 6）；带宽 ≥10Mbps + 自适应降帧双保险；升配只改 env |
| PVM 换内核失败（新机） | 安装受阻 | 新机无存量业务，失败直接重装系统镜像重试（≤15min）；亦可换 Ubuntu/OpenCloudOS 镜像交叉验证 |
| CubeProxy 远端端口连通/证书 | 投屏不可用 | 按 Cube《HTTPS & Domain Resolution》配置；备选 agentd 迁 ECS（仅改 .env，因已无状态化，迁移成本=改连接串） |
| 智谱限流/额度 | 高并发任务失败 | 配额+排队+退避；压测用 mock |
| exports 桶膨胀 | 存储增长 | MinIO ILM 7 天 + 清理任务双保险 |
| 预签名 URL 泄露面 | 越权下载 | 短时效（PUT 15min/GET 30min）+ 键含 UUID 不可枚举 + 审计 |
| embedding 依赖（知识库） | 智谱 embedding 故障→无法沉淀/检索 | 沉淀降级为仅关键词入库（embedding 置空、后台补算任务）；检索自动回退关键词；任务不受阻 |
| 扩展/MCP 第三方端点不稳定 | 工具调用失败 | 30s 超时+结果截断+错误回传模型自决策；MCP 探活摘除；测试运行预检 |
| 协作扇出放大（10 观察者） | web 副本带宽/CPU 压力 | 帧一次入网副本内本地扇出；观察者上限 10；事件与帧分道（既有背压不变） |
| 知识误沉淀/膨胀 | 注入污染、检索劣化 | 沉淀上限 5 条/任务+提示条"不该记"即时删；相似度去重版本化；90 天降权；2000 条上限 |
| 空间级联解散误操作 | 数据丢失 | OWNER 二次确认+7 天只读导出宽限+审计；期间可恢复（取消解散） |
```
