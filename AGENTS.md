# AGENTS.md — Gill Agent 开发规则（总纲）

> 本文件是本仓库所有开发工作的**强制规范**。模块职责与结构见 `CATELOG.md`；各模块细则见对应目录下的 `AGENT.md`。历史事故教训以「⚠ 教训」标注，均为真实踩坑固化，不得绕过。

---

## 1. 项目一句话

Gill Agent 的产品目标为 **通用数字员工团队管理平台**：一个人通过多轮对话生成和管理带 Skills 的员工模板，在团队中创建实际员工并定义协作规则，由大模型灵活控制工作、沟通、执行和相互监督。当前建设通用基础设施，研发、业务及其他团队通过配置承载；不得把岗位、行业、业务阶段或员工能力固化为平台白名单。目标依据见 `docs/01-requirements.md` D18～D38；当前专题需求基线为 `docs/features/digital-employee-team/requirement_analysis.md`，有效实现契约见同目录 implementation.md，旧附录保留历史候选身份。新架构草案见 `docs/features/digital-employee-team/system_design.md` v0.3，任务/验证见同目录 `design_delivery_plan.md` v0.3；用户已明确批准P01～P06（D38），本次进入实现和验证；不得再次把这六项列为待确认，不得将计划验证写成已完成。

最新产品组织方式（D24～D28、D31）：工作台（原概览）以团队群聊为核心，团队状态与切换放在右侧；数字员工入口管理可复用模板及 Skills。团队首页只展示可进入的团队摘要，可含负责项目、人数及开放的产品/模块描述；点击进入团队详情后再管理本团队实际员工、项目库和其他内容，不在首页直接铺开员工明细。模板创建支持持续对话、草稿预览和明确保存，保留多轮来源，不把生成中的草稿当作已保存模板。实际员工仅归属一个团队，具有唯一 `teamId`；同一模板用于其他团队时创建新身份。取消独立运行记录和我的待办顶级界面，内部事实在群聊按需展开；读过 @消息不等于同意。D38/P01：当前任务固定快照，新任务三方采用模板版本；冲突留原版本并上报。

已明确的组织规则（D19/D35）：员工有上下级，团队详情以组织树展示并由用户调整和保存；拖拽需有等效的非拖拽调整方式，不固定职级或岗位能力。本版原型采用单直属上级树，不将该演示形式视为永久平台限制；监督关系单独表达。员工拿不准时向上级提交评估，仍无法解决则逐级向上，最终反馈用户；D38/P02：按任务采用的组织关系逐级升级，相关任务阻断；人工暂停独立保留。

已明确的调整权（D20，D34 局部更新）：新增实际员工、直接修改实际员工工作配置或团队/流程 Prompt 仍由用户决定，员工可建议；D34 允许员工自迭代模板 Prompt/Skills 并保留版本来源，不热改在途工作配置；D38/P01允许新任务按三方合并采用模板新版。模型动态拆任务、分工、沟通、选择方法和为既有员工执行工作，不一律视为需要用户批准的组织变更。

团队项目与版本协作（D29/D30）：每个团队有项目库，可管理多个项目、归档项目文档并保留版本，关联需求、工作分支与集成结果；多需求并行时隔离各自上下文、基线与工作空间，不跨团队串用。项目库嵌入团队，不另设项目主导航，工作台保持对话核心。D38/P06首期采用受控Git CLI和独立工作区，授权目标分支且实际检查通过才可集成，保护分支与冲突继续阻断；不把 Git 或软件项目设为所有业务任务的前提，也不把原型的版本操作演示当作真实 Git 结果。

员工知识与模板迭代（D32～D34）：知识只挂载到实际 `employeeId`，不以 `teamId` 授权，不向同队未挂载员工自动共享。知识内容对 Agent 只读，人可追加内容版本；更新共享源后，所有显式挂载该知识的员工可见新内容。员工可自迭代的是员工模板 Prompt/Skills，新版本保留修改来源和历史；不因此取得知识写权或自动改写既有实际员工及团队流程。本轮增加知识库入口，原有工作台、模板、团队入口保留；团队详情的员工知识仅为逐员工挂载管理视图，挂载及分类仍由人维护。共享源可见更新、员工工作版本和运行实际采用版本分开，采用时点与冲突策略已由D38/P01/P03确认，实现见implementation.md。

员工定向沟通（D37）：同团队员工可以互相@协作、交接和邀请核查，普通协作不受直属上级关系限制；正式不确定问题仍逐级评估。收件、响应、决定和执行分开，具体协议见系统设计§7.1。

工作台信息闭环（D36）：@我 决策上下文须能查看具体问题、已有尝试与各级意见、候选与已知代价、影响及所需决定；交付证据绑定对象/版本，区分实际检查、未验证和剩余问题。右侧显示目标、进展、阻塞、下一步及更新时间，未知/过期不伪作空闲或成功；不新增独立运行或待办页。打开卡片、看证据或收到回复不等于动作已经执行或运行已经恢复。

联合评审状态：静态原型的内部产品评估只证明已演示交互的一致性，不代表需求和技术整体可开发。R-01～R-04的政策已由D38/P01～06确认；程序、隔离、Git与真实模型的实际验证范围以verification.md为准，独立语义验收仍未完成。

当前实现底座为 Java web 网关 + Python agent 守护进程 + Vue 3 前端 + CubeSandbox（E2B 兼容）云端沙箱，已有任务对话、命令执行、CDP 画面同步、文件/知识库/扩展/协作空间。旧能力与新team_*路径分别验证，不以旧会话结果代替新团队验收。

D39授权按产品验收修复F01～F06；当前实现契约v1.2、系统设计v0.4，修改与实际回归见`docs/features/digital-employee-team/acceptance_fix_feedback_20261117.md`。旧验收结论保持原版本范围，程序回归通过不等于整体产品或模型质量已验收。

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

1. **分层架构（强制，D14/D15）**：Controller → Service → Repository 三层，职责清晰不得跨层：
   - **Controller**（`controller/`）：参数校验、鉴权上下文（uid/role）、统一错误包装（`AuthController.err` 结构）、结果序列化——**不写业务逻辑、不出现任何 SQL/数据访问**；
   - **Service**（`service/`）：业务逻辑与事务边界；一个业务域一个 Service（SpaceService/FileService/KnowledgeService/ExtensionService/…）；跨表写操作必须 `@Transactional`；
   - **Repository**（`repo/`，即 Mapper 层）：数据访问唯一入口，SQL 全部收敛于此。
2. **分层依赖铁律（D15）**：**只允许上层依赖下层，禁止下层依赖上层、禁止任何循环依赖**：
   ```
   ws / controller（最上层）
        ↓ 依赖
      service
        ↓ 依赖
   repo(Mapper) → entity（纯数据载体，不依赖任何层）
   security / config：横切层，被上层引用，自身不得依赖 controller/service/repo 业务层
   ```
   - 禁止：repo import service/controller；service import controller/ws；entity 依赖任何业务层；
   - 跨业务域复用逻辑下沉到对应 Service 被上层调用，或抽公共支撑类，**不得以"互相调用"迁就实现**；
   - **同层规则（D17）**：同层模块/文件之间**默认禁止互相引用**；确需调用必须**严格单向**（A→B 则 B 永不得→A），任何形式的循环引用（含延迟 import、全限定名引用）零容忍；同层共享逻辑一律**下沉**到更底层公共模块（如 security/Hashes、gill_core/sandbox_base），这是消除循环的标准手段；
   - ⚠ 教训：`sandbox ↔ remote_sandbox` 曾靠基类/工厂互相 import 成环（已抽 sandbox_base 断开）；`JwtFilter` 曾以全限定名调 `PatController.sha256` 造成 security→controller 反向引用（已下沉 security/Hashes）——**import 扫描要包含全限定名用法**。
   - 提交前自检（应无输出）：
     ```bash
     grep -rn "import com.gill.web.controller\|com\.gill\.web\.ws" web/src/main/java/com/gill/web/{service,repo,entity}/
     grep -rn "import com.gill.web.service" web/src/main/java/com/gill/web/repo/
     ```
3. **ORM 选型（D14，禁止 JdbcTemplate）**：
   - **简单单表操作**（按主键查/增/改/删、单字段等值条件）→ **MyBatis-Plus**：BaseMapper + LambdaQueryWrapper；
   - **多条件、关联查询（JOIN）、聚合、动态 SQL、报表** → **MyBatis 原生 SQL**（XML Mapper 优先，简单场景可用 @Select 注解），**禁止**用 Wrapper 链硬拼复杂条件代替手写 SQL；
   - 存量 JdbcTemplate 代码随迭代逐步迁移至 Mapper，新代码零容忍 JdbcTemplate。
4. **资源管理**：MyBatis/MyBatis-Plus 由 Spring 管理 SqlSession，禁手工获取 Connection；遗留 JdbcTemplate 在迁移前仍须 try-with-resources。
   ⚠ 教训：JwtFilter 曾只关 Statement 不关 Connection，每请求泄漏 PG 连接直至池耗尽。
5. **异常边界**：认证逻辑与业务逻辑的 try/catch 必须分离；`chain.doFilter()` 不得放在认证 try 块内。
   ⚠ 教训：控制器异常曾被 JWT 过滤器捕获后伪装成「登录已过期 401」，排查成本极高。
6. **SQL 书写**（MyBatis 侧）：XML 中 `#{}` 预编译占位（禁 `${}` 拼接，动态排序等白名单场景除外并注释说明）；PG 强转写法 `#{id}::uuid`；`text[]` 聚合用 `array_to_string`；复杂查询必须带索引核对（对照 V1__init.sql）。
7. **新增 REST 端点**：路径统一 `/api/v1` 前缀；错误返回 `{"error":{"code":"XXX-4001","message":"..."}}` 结构；入参校验前置（缺参返回 400，不得让异常穿透）。
8. **WS 网关（AgentWebSocketHandler）**：SSE 泵一会话一泵；末连接断开必须 `Stream.close()` 关闭 body 流（`cancel(future)` 无效，future 在响应头到达即完成）。
   ⚠ 教训：僵尸泵与新泵并存导致每条事件 N 倍投递（双审批卡/消息重复的根因）。
9. **命名**：类 PascalCase（XxxController/XxxService/XxxMapper）、方法 camelCase、常量 UPPER_SNAKE；Mapper XML 与 Mapper 接口同名（XxxMapper.xml → resources/mapper/）；不使用 Lombok（现状手写 record/getter）。

## 4. Python 开发规范（agent/）

1. **类型注解**：所有函数签名带类型（`str | None` 新式联合）；模块顶部 `"""docstring"""` 一句话职责。
2. **模块分层依赖铁律（D15）**：只允许上层依赖下层，禁止反向与循环依赖：
   ```
   gill_cli（CLI 入口，最上层）┐
   agentd（守护进程入口）       ├─→ gill_core
                              │     ├─ loop.py（编排层，gill_core 内最上层）
                              │     └─ config/llm/risk/kb/exts/tools/sandbox/remote_sandbox/browser/files/bus/store（基础能力层）
   ```
   - `gill_core` **不得** import `agentd` / `gill_cli`；`agentd` 与 `gill_cli` 互不依赖、互不感知；
   - `gill_core` 内部：基础能力模块**不得** import `loop`（只有 loop 编排它们）；基础模块之间按单向依赖（如 exts→sandbox、kb→store），新增 import 前先画方向；
   - **同层规则（D17）**：同层模块默认不互相引用；确需调用必须单向（如 sandbox→remote_sandbox 是允许的工厂方向，remote_sandbox 只准依赖 sandbox_base）；成环即抽 base/公共模块下沉（参考 sandbox_base.py 的产生）；
   - 消除循环依赖的手段是下沉公共逻辑到更底层模块或抽 `common`，**不是**互相 import；
   - 提交前自检（应无输出）：
     ```bash
     grep -rn "agentd\|gill_cli" agent/gill_core/ --include=*.py | grep import
     grep -rn "gill_cli" agent/agentd/ --include=*.py; grep -rn "agentd" agent/gill_cli/ --include=*.py
     grep -rln "from .loop\|from gill_core.loop" agent/gill_core/ --include=*.py | grep -v "loop.py"
     ```
3. **asyncio 铁律**：任务循环（run_task）内**禁止阻塞等待用户输入**——用户应答类消息（approval_response / presence / space_chat）必须走 FastAPI 端点 fast-path 直写 `pending_approvals`，否则死锁。
   ⚠ 教训：审批等待曾放循环内消费 cmd 流，自身阻塞自身。
4. **事件发射唯一性**：`approval_request` 仅由 `SessionRuntime.approve()` 发射（uuid cid）；`loop.py` 审批门只调用回调，不得再 emit。
   ⚠ 教训：双发射（tool_call_id 作 cid）造成前端双卡且首卡点击静默失效。
5. **外部 IO**：HTTP 一律 httpx/async（禁 requests）；DB 经 asyncpg pool（`store.py` 统一入口）；旧会话沙箱经 `remote_sandbox.py`，新团队沙箱经 `team_sandbox.py` 唯一适配边界；编排和工具不得绕过适配器直连 SDK。
6. **日志**：标准 logging，模块名作 logger；生产路径禁止 print；警告要带 sid 等上下文。
7. **依赖**：新依赖先入 `pyproject.toml` 并说明用途；容器内需代理时用 `host.docker.internal:7890` 且更新 NO_PROXY 白名单。
8. **CI 前**：`python -c "import ast; ast.parse(...)"` 全量语法检查（改动文件）后再提交镜像构建。

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
