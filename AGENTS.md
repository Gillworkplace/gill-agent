# AGENTS.md — Gill Agent 开发规则（总纲）

> 本文件是本仓库所有开发工作的**强制规范**。模块职责与结构见 `CATELOG.md`；各模块细则见对应目录下的 `AGENT.md`。历史事故教训以「⚠ 教训」标注，均为真实踩坑固化，不得绕过。

---

## 1. 项目一句话

Gill Agent = 多人协作开发平台：Java web 网关 + Python agent 守护进程 + Vue 3 前端 + CubeSandbox（E2B 兼容）云端沙箱，浏览器内完成任务对话、命令执行、CDP 画面同步、文件/知识库/扩展/协作空间。

**数据流**：浏览器 → web:8080（WS）→ agentd（FastAPI）→ GLM 流式 → 云端 MicroVM 沙箱 → Redis Streams（`gill:cmd:{sid}` / `gill:evt:{sid}`）回流 → WS 多端扇出。

## 2. 技术栈与版本约束

| 层 | 技术 | 版本 |
|---|---|---|
| web | Java + Spring Boot（Maven 单模块） | 21 / 3.3 |
| 前端 | Vue + TypeScript(strict) + Vite + Pinia + xterm | 3.4 / 5.x / 5.x / 2.x |
| agent | Python（uv 管理） | 3.12 |
| 中间件 | PostgreSQL(pgvector) / Redis / MinIO | 16 / 7 / latest |
| 沙箱 | CubeSandbox（E2B SDK 兼容），远程 39.107.34.109 | — |

不得擅自升级大版本或引入重量级框架（ORM、微服务框架、消息队列等）——现有选型对应决策 D5（无状态应用层+单机中间件），变更需先改 `docs/01-requirements.md` 决策日志。

## 3. Java 开发规范（web/）

1. **分层架构（强制，D14）**：Controller → Service → Repository 三层，职责清晰不得跨层：
   - **Controller**（`controller/`）：参数校验、鉴权上下文（uid/role）、统一错误包装（`AuthController.err` 结构）、结果序列化——**不写业务逻辑、不出现任何 SQL/数据访问**；
   - **Service**（`service/`）：业务逻辑与事务边界；一个业务域一个 Service（SpaceService/FileService/KnowledgeService/ExtensionService/…）；跨表写操作必须 `@Transactional`；
   - **Repository**（`repo/`，即 Mapper 层）：数据访问唯一入口，SQL 全部收敛于此。
2. **ORM 选型（D14，禁止 JdbcTemplate）**：
   - **简单单表操作**（按主键查/增/改/删、单字段等值条件）→ **MyBatis-Plus**：BaseMapper + LambdaQueryWrapper；
   - **多条件、关联查询（JOIN）、聚合、动态 SQL、报表** → **MyBatis 原生 SQL**（XML Mapper 优先，简单场景可用 @Select 注解），**禁止**用 Wrapper 链硬拼复杂条件代替手写 SQL；
   - 存量 JdbcTemplate 代码随迭代逐步迁移至 Mapper，新代码零容忍 JdbcTemplate。
3. **资源管理**：MyBatis/MyBatis-Plus 由 Spring 管理 SqlSession，禁手工获取 Connection；遗留 JdbcTemplate 在迁移前仍须 try-with-resources。
   ⚠ 教训：JwtFilter 曾只关 Statement 不关 Connection，每请求泄漏 PG 连接直至池耗尽。
4. **异常边界**：认证逻辑与业务逻辑的 try/catch 必须分离；`chain.doFilter()` 不得放在认证 try 块内。
   ⚠ 教训：控制器异常曾被 JWT 过滤器捕获后伪装成「登录已过期 401」，排查成本极高。
5. **SQL 书写**（MyBatis 侧）：XML 中 `#{}` 预编译占位（禁 `${}` 拼接，动态排序等白名单场景除外并注释说明）；PG 强转写法 `#{id}::uuid`；`text[]` 聚合用 `array_to_string`；复杂查询必须带索引核对（对照 V1__init.sql）。
6. **新增 REST 端点**：路径统一 `/api/v1` 前缀；错误返回 `{"error":{"code":"XXX-4001","message":"..."}}` 结构；入参校验前置（缺参返回 400，不得让异常穿透）。
7. **WS 网关（AgentWebSocketHandler）**：SSE 泵一会话一泵；末连接断开必须 `Stream.close()` 关闭 body 流（`cancel(future)` 无效，future 在响应头到达即完成）。
   ⚠ 教训：僵尸泵与新泵并存导致每条事件 N 倍投递（双审批卡/消息重复的根因）。
8. **命名**：类 PascalCase（XxxController/XxxService/XxxMapper）、方法 camelCase、常量 UPPER_SNAKE；Mapper XML 与 Mapper 接口同名（XxxMapper.xml → resources/mapper/）；不使用 Lombok（现状手写 record/getter）。

## 4. Python 开发规范（agent/）

1. **类型注解**：所有函数签名带类型（`str | None` 新式联合）；模块顶部 `"""docstring"""` 一句话职责。
2. **asyncio 铁律**：任务循环（run_task）内**禁止阻塞等待用户输入**——用户应答类消息（approval_response / presence / space_chat）必须走 FastAPI 端点 fast-path 直写 `pending_approvals`，否则死锁。
   ⚠ 教训：审批等待曾放循环内消费 cmd 流，自身阻塞自身。
3. **事件发射唯一性**：`approval_request` 仅由 `SessionRuntime.approve()` 发射（uuid cid）；`loop.py` 审批门只调用回调，不得再 emit。
   ⚠ 教训：双发射（tool_call_id 作 cid）造成前端双卡且首卡点击静默失效。
4. **外部 IO**：HTTP 一律 httpx/async（禁 requests）；DB 经 asyncpg pool（`store.py` 统一入口）；沙箱操作经 `remote_sandbox.py` 封装，不得绕过直连 SDK。
5. **日志**：标准 logging，模块名作 logger；生产路径禁止 print；警告要带 sid 等上下文。
6. **依赖**：新依赖先入 `pyproject.toml` 并说明用途；容器内需代理时用 `host.docker.internal:7890` 且更新 NO_PROXY 白名单。
7. **CI 前**：`python -c "import ast; ast.parse(...)"` 全量语法检查（改动文件）后再提交镜像构建。

## 5. 前端开发规范（web/frontend/）

1. **准入线**：`vue-tsc --noEmit` 零错误；`npm run build` 成功。禁止提交带类型错误的代码。
2. **架构**：组件只做视图与交互；跨组件状态进 Pinia store（auth/workspace/events 三 store 现状）；**高频数据（终端字节流、CDP 帧）不走 store**，经 `termSink`/`frameSink` 回调直收。
3. **会话一致性**：会话列表必须跟随当前选中空间（`currentSpaceId` 统一入口 + `gill_space` 持久化），禁止硬编码 personal 空间。
   ⚠ 教训：硬编码曾致多标签内容不一致（用户直接报告）。
4. **WS**：`sendTask` 用一次性监听发送，不得覆盖 `ws.onopen`；断线走指数退避重连。
5. **移动端**：任何 UI 改动须同时验证 ≤768px 视口（抽屉侧栏/面板全屏/无横向滚动）——D13b 一等需求。
6. **构建产物**：`web/src/main/resources/static/` 为构建产物，**gitignore 不入库**；改动前端后必须 `npm run build` 或走 Docker 三阶段重建 web 镜像才生效。
7. **禁用模式**：不得回退为单文件内联 JS（历史事故形态）；不得引入 jQuery 类命令式 DOM 操作。

## 6. Git 规范

1. **分支**：`gill` 为开发主线，直接提交；发布/大改从 `gill` 拉分支，合回走 PR。远端 `origin = github.com:Gillworkplace/gill-agent`。
2. **提交信息**（中文，沿用现有风格）：
   - 首行：一句话概要（做了什么+关键结果），≤80 字为宜；
   - 正文（可选）：`①②③` 列要点，含根因与验证方式；
   - 例：`修登录按钮无反应：index.html 三处损坏致整段脚本解析失败(ef08039起) ①...②...；已重建web镜像并浏览器实测admin登录成功`
3. **提交粒度**：一个逻辑变更一个提交（修复+其测试脚本同提交）；禁止「杂项更新」式混合提交。
4. **禁止**：`--force` 推共享分支；提交构建产物/日志/临时文件；提交任何密钥（智谱 key 只在 `deploy/.env`，该文件不入库）。
5. **推送**：完成一组工作即 `git push origin gill`；推送前 `git status` 确认无意外文件。
6. **⚠ 教训**：Git Bash 下未加引号的分号会拆命令并产生 `web;C` 类垃圾目录——复杂命令一律加引号。

## 7. 测试与验收规范

1. **双层 E2E（决策 D13c）**：API 级（`agent/*_e2e.py`）+ **浏览器黑盒**（真实 GUI 交互+截图证据）缺一不可；API 全绿不代表 UI 可用。
   ⚠ 教训：六面板无入口、登录按钮死键等 8 类缺陷在 API 全绿状态下潜伏多日。
2. **改动必测**：改 web/agentd → 重建对应镜像后回归；改前端 → `npm run build` + 浏览器冒烟（登录→发任务→看流式）。
3. **审批链路**：任何涉及审批的改动，必须实测 suggest 档 rm 命令的「单卡→批准→真实执行→审计留痕（decision=denied/approved）」全链。
4. **回归基线**：登录/注册、任务流式+终端、审批批准/拒绝/超时、文件列表/预览、空间切换+多标签一致、移动端 390×844。
5. **证据**：浏览器截图存 `gui-test-screenshots/`（编号命名 t/r/v 系列），提交信息引用编号。

## 8. 部署与运维约定

1. 本地全栈：`cd deploy && docker compose up -d --build <svc>`；改动静态前端必须 `--build`（产物打进 jar）。
2. 沙箱通路依赖宿主机 SSH 常驻隧道（80/13000，`deploy/tunnel.sh` 或自动重连循环）；沙箱机安全组限源 `223.73.52.185`。
3. 沙箱泄漏处置：服务器 `curl -X DELETE :3000/sandboxes/<id>`；agentd sweep 每 5 分钟自动对照 PG 清孤儿。
4. 敏感信息：`ZHIPU_API_KEY` 只在 `deploy/.env`；`EXT_SECRET` 双端一致（64 hex）；两者均不入库。
5. 详细运维见 `docs/05-deploy.md` §4 故障速查（每条均来自真实事故）。

## 9. 文档同步义务

改架构/接口/部署方式，必须同步更新 `docs/`（01 需求决策日志、02 架构、04 LLD、05 部署）并升版本号——文档与代码不一致视同未完成。
