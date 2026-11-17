# 通用数字员工团队基础设施：系统设计

日期：2026-11-17；版本：v0.4；状态：P01～P06已确认；产品需求验收发现六项缺陷，修复设计/实施及实际反馈见[修改记录](acceptance_fix_feedback_20261117.md)，不将开发复测代替整体产品重验。

## 1. 范围与结论

本设计采用需求分析方案 B：新增团队运行内核，复用现有技术栈与经过适配的模型、沙箱能力。流程由 Prompt 表达，模型决定计划、派工、通信、检查和下一步；内核处理真实身份、权限、持久状态、资源和执行回执。岗位、业务阶段、产物类型均开放，不配置固定研发 DAG。

有效输入为[主需求 v1.16](../../01-requirements.md) D18～D38、[专题需求 v0.9](requirement_analysis.md)、[联合评审 v0.1](requirement_review.md)和[原型 v0.7](prototype/README.md)。业务含义以需求为权威；本文件维护技术派生要求及核心跨模块契约，候选附录继续保留探索身份，不自动成为批准 API。具体原型效果尚待用户查看。

系统设计负责人：本次 Codex（依照用户调用的 system-designer 技能）。业务决定人：用户；六项运行政策已由用户确认。开发与整合由本次Codex承担，独立测试执行人未指派，见[交付与验证计划](design_delivery_plan.md)。用户已批准六项政策并要求实现，Codex承担当前开发与整合；源码实现见[实现契约](implementation.md)，实测范围见[验证记录](verification.md)。

结论：现有 Java / Python / Vue / PostgreSQL / Redis / MinIO / CubeSandbox 可作为底座，有附条件可实现路径；需要新增持久运行内核并改造旧执行器，不能沿用旧会话作为团队运行模型。恢复、并发、真实模型语义和沙箱隔离的已执行与未执行范围分项记录在verification.md，不能整体标为已验证。

## 2. 现状核实与复用边界

代码基线：e5d54db，分支 gill；以下表格保留设计阶段源码观察；实现基线de39ea3，后续实际模型/数据库/沙箱/部署结果见verification.md。

| 证据 | 当前事实 | 本次处理 |
| --- | --- | --- |
| [app.py](../../../agent/agentd/app.py) SessionRuntime、handle_user_input、loop | 每会话共享历史/沙箱，使用 asyncio.Lock；长任务在消费循环内等待，普通 stop 排在后面 | 保留旧入口兼容；新运行由持久执行实例驱动，控制入口独立 |
| [bus.py](../../../agent/gill_core/bus.py) consume_cmd、read_evt、lease 方法 | 执行前 ACK，无 pending 接管；事件一批读取返回最后一条；续期没有持有者比较 | 新运行不依赖该实现保证可靠性，采用数据库状态和持有者校验；旧缺陷按关联改造，不能宣称多副本已安全 |
| [loop.py](../../../agent/gill_core/loop.py) run_task | 无工具调用可结束一次回答；构造 system 变量，却未在 llm.stream 调用传 system 参数 | 复用模型适配接口；新轮次执行器明确传有效 Prompt 并核验，请求完成与团队交付分开 |
| [tools.py](../../../agent/gill_core/tools.py)、[kb.py](../../../agent/gill_core/kb.py) | 有 knowledge_save 和自动注入，旧知识覆盖内容后增加版本号，按 user/space 等检索 | 新团队路径使用员工挂载与追加知识版本；旧知识写入/注入不能直接接入新员工执行器 |
| [store.py](../../../agent/gill_core/store.py)、app.py | messages MAX(seq)+1，done 发出后尽力持久化 | 新状态/序号/结果在数据库事务内确认后广播；旧消息表不承担新任务事实 |
| [AgentWebSocketHandler.java](../../../web/src/main/java/com/gill/web/ws/AgentWebSocketHandler.java)、[KnowledgeController.java](../../../web/src/main/java/com/gill/web/controller/KnowledgeController.java) | 仍有入口直接 SQL；不能据 AGENT 目标目录认为三层已经实现 | 新团队入口按 Controller/Service/Repository/Entity 实现；只改关联路径 |
| [LLM](../../../agent/gill_core/llm.py)、[BaseSandbox](../../../agent/gill_core/sandbox_base.py)、[events.ts](../../../web/frontend/src/stores/events.ts) | 已有流式模型适配、沙箱接口和会话 WS 状态 | 复用适配思路，显式传入员工上下文；团队状态按 teamId 存储，终端/画面仍走非响应式 sink |
| [V1 数据定义](../../../web/src/main/resources/migration/V1__init.sql) | 有 users/spaces/sessions/messages/知识/扩展；没有员工、团队任务或动作事实模型 | 保留旧表；后续以新增 migration 扩展，迁移前核对实际数据库版本 |

旧架构文档中的“应用无状态/多副本”是目标约束，当前运行时存在进程内状态。本设计以数据库保存可恢复状态；活跃模型调用和连接仍属于短期进程资源，不承诺恢复模型内部思维过程。

## 3. 技术派生要求

设计师维护下列要求；均为设计选择或从有效需求推导，未冒充用户原话。

| 编号 | 来源 | 技术要求 | 验证依据 |
| --- | --- | --- | --- |
| TR-01 | DET02/10/16、D26/32 | 每个实际员工唯一 team_id；客户端、模型和后台引用均校验归属；模型不得提交可信 actor | 拒绝跨队派工、产物/知识越权和伪造身份 |
| TR-02 | DET01/03/08、AC29 | 定义追加不可变版本，运行采用独立快照，引用具体 Prompt/Skill/组织/知识版本 | 修改定义不覆盖历史，能查每轮实际采用内容 |
| TR-03 | DET04/11、N-11 | 任务、执行实例、工作区分离；独立需求不共享历史和可写空间 | 两需求并发改同名文件互不覆盖 |
| TR-04 | DET05/07/11、AC32 | 动作先存意图，后记真实回执；结果未知与失败区分 | 工具执行后崩溃不重复盲执行，不虚报成功 |
| TR-05 | DET06/09、AC31 | 控制不等待模型循环；收到决定/暂停请求与实际生效分开 | 模型阻塞期间可写控制请求，恢复只针对有效上下文 |
| TR-06 | DET06/13、AC33 | PostgreSQL 为事实源；通知可重复/丢失后补查，投影带来源和观测时间 | Redis 清空/WS 重连后从持久游标补齐 |
| TR-07 | DET01/12/16 | Agent 只能迭代允许的模板；不能写知识、创建员工或改团队流程 | 所有入口共享服务端校验，Prompt 绕过无效 |
| TR-08 | N-09、R-04 | 持久用量、预算预留、无进展检测及控制回执 | 并发不能重复花同一预留；停止/未知消费可见 |
| TR-09 | AGENTS D15/D17 | 单向依赖，无同层独立业务组件互调或循环 | 编译/import及实际调用审查；关键函数单职责、有效代码不超过100行 |
| TR-10 | DET14/15、Q06/08/09 | 新旧数据/接口兼容；版本工具为可选适配，真实集成独立记录 | 无仓库业务目标可运行；旧 CLI/会话回归 |

时效与容量：不沿用旧会话规模作为团队容量保证。不用统一百分比代表开放工作目标；可展示已知任务计数及其范围，任务重规划后分母可变。并发槽、租期、轮次上下文预算和快照过期阈值是部署配置，需由代表场景测量后确定；涉及费用和停止后果的取舍见 P05，不预填性能达标。

## 4. 部署与依赖结构

维持现有部署单元，不新增微服务、消息中间件或 Agent 框架。

~~~mermaid
flowchart TB
  UI["Vue 工作台 / 模板 / 团队 / 知识库"] --> WEB["Java HTTP / WS 入口"]
  WEB --> APP["团队应用服务：命令事务 / 查询"]
  WORKER["Python 团队运行协调器"] --> CLIENT["内部命令客户端"]
  CLIENT --> INTERNAL["Java 内部 Worker 入口"]
  INTERNAL --> APP
  APP --> POLICY["纯策略与校验：身份 / 版本 / 状态"]
  APP --> REPO["Repository / Mapper"]
  REPO --> ENTITY["Entity"]
  REPO --> PG[("PostgreSQL 事实 / 工作项 / 事件")]
  APP --> STORE["对象存储适配器"]
  STORE --> MINIO[("MinIO")]
  NOTIFY["提交后通知转发器"] --> PG
  NOTIFY --> REDIS[("Redis 唤醒 / 实时通知")]
  REDIS --> WEB
  REDIS --> WORKER
  WORKER --> TURN["模型轮次执行器 / 动作路由器"]
  TURN --> ADAPTER["LLM / 工具 / 沙箱适配器"]
  ADAPTER --> EXTERNAL["模型服务 / CubeSandbox / 外部工具"]
~~~

图表达调用/数据方向；通知是已提交事件的传送，不回调业务服务形成隐式循环。Java 业务状态仅经团队应用服务写入，Python 不直接写新业务表；避免两个语言各维护一套状态机。worker 通过内部入口提交模型动作、领取工作、保存检查点及回执，同样接受授权和状态验证。

拟定目录：
- Java controller 与 ws：仅协议、用户上下文、参数校验和错误映射；新增 TeamApplicationService / TeamQueryService 为同层独立入口，互不调用。
- service 下的团队编排调用更低层 policy、repo、对象存储适配器；policy 仅计算决策与约束，不访问网络或反调 service。复杂 SQL 放 MyBatis XML，简单 CRUD 使用 MyBatis-Plus。
- Python agentd：HTTP 控制接入、worker 生命周期装配；gill_core 下 team_runtime 作为编排层，依赖更低层的 team_protocol、team_client、turn_executor、context、tool/sandbox/llm 适配。低层不得导入运行协调器或 agentd；旧 loop 不作为新协调器基类。
- Vue：新增团队领域的 api/types/store/view；保留旧会话 store。团队消息与摘要按 teamId 管理；内部运行详情从群聊展开，不新增运行记录/待办主导航。

内部 Worker API 需服务身份认证，绑定 worker_id、允许的工作空间和短期执行凭证；不能沿用“内网即可信”。服务凭证留在宿主运行器，不能注入模型上下文或通用 shell。浏览器 JWT/PAT 的人员身份与 employee actor 分开。

## 5. 核心对象与数据归属

以下为逻辑存储契约，均拟新增；字段细化与可执行 DDL 留设计收敛后的 LLD。标识用 UUID，人员用户沿用旧 users；已有 space_id 只作上层授权边界，不等同团队。

| 对象组 | 必需字段与关联 | 不变量 |
| --- | --- | --- |
| 团队与组织 | team(id, space_id, revision, current_config_revision_id)；team_revision(Prompt/简介/组织关系/监督约定) | 只有用户修改有效组织/流程；组织树无跨队、自指、成环；树与监督分别存，异常引用不得静默归根 |
| 模板与草稿 | employee_template；template_revision(base_revision_id, Prompt, skill_refs, author, source_run_id, reason, hash)；template_draft(conversation_ref, revision) | 草稿不等于模板；自迭代追加版本，CAS 改 current 指针；迭代不自动覆盖实际员工 |
| 实际员工 | employee(id, team_id NOT NULL, template_id, current_work_revision_id, lifecycle)；employee_revision(有效Prompt/Skills/模板来源) | 一个 employee 行唯一团队；不以另建 execution 绕过归属；历史引用保留，停用不级联删事实 |
| 知识 | knowledge_source(owner_scope, current_revision_id)；knowledge_revision(content_ref, hash, author)；knowledge_mount(employee_id, source_id, revision) | 显式挂载唯一；仅人追加内容；新成员/同模板不自动继承；更新源指针不伪报所有在途模型已采用 |
| 项目与需求 | project(team_id)；document_revision(project_id, content_ref, version)；work_item(team_id, project_id可空, goal_revision, base_refs) | 业务目标可无project/repo；文档追加，工作项保存采用文档快照 |
| 运行与动态任务 | run(work_item_id, state, control_revision, policy_snapshot_id)；task(run_id, owner_employee_id, state, dependency_refs, revision) | run为目标的协作执行；task由模型动态增删/改派并留历史，不限制岗位或固定阶段 |
| 执行实例 | execution(task_id, employee_id, context_snapshot_id, workspace_id可空, attempt, state, lease_owner, lease_until, fence) | 同员工可有多个隔离实例，实际并发依执行槽配置；不共享可变 history |
| 上下文快照 | context_snapshot(employee_revision, team_revision, task_revision, knowledge_reads, document_refs, tool_config_revision, message_cursor, model_config_hash) | 每轮记录实际送给模型的内容引用/哈希，敏感正文按权限存；精确重放思维不作保证 |
| 通信与决定 | team_message(team_id, seq, sender_actor, visibility, reply_to, run/task_refs)；decision(problem_ref, escalation_path, current_handler, state, answer, applied_ref) | 私人执行记录不默认全发群聊；已读/回复/决定/应用是不同事实；上报保留每级意见 |
| 员工收件与响应 | message_delivery(message_id, recipient_employee_id, delivery_state, processing_state, response_refs, task_refs) | 消息/接收员工唯一；群聊可见不等于触发执行，用户@我与员工收件分开 |
| 动作与检查点 | action(execution_id, request_key, kind, target_refs, expected_revision, state, result_ref, external_ref)；checkpoint(execution_id, turn, model_messages_ref, pending_action_refs) | 动作身份来自执行凭证；回执绑定具体意图，工具输出视为不可信数据 |
| 产物与核查 | artifact_revision(team_id, task_id, content_ref, hash, base_ref)；check_result(subject_revision, method, action_ref可空, result, limitations) | 模型判断、实际工具检查和用户接受分开，旧版本通过不覆盖新版本 |
| 工作区与集成 | workspace(work_item_id, repository_binding可空, base_ref, provider_resource_ref, access_mode)；integration(source_revision, target_expected_ref, actual_result_ref, state) | 不同需求可写区隔离；同区的并行写需路径/文档所有权或独立分支后合并，不能仅隔离需求却让员工覆盖同一文件 |
| 可靠派发 | durable_work(state, not_before, lease, fence)；domain_event(team_id, seq, event_id, payload, occurred_at, publish_state) | 状态更新和事件/待工作项同事务；队列 ACK 不是完成事实 |

所有资源引用校验 space/team 范围与版本存在。除受控知识共享挂载外，不允许跨团队串用员工、项目、产物、工作区；原始知识与派生内容传播策略仍见 P04。复合 FK/唯一约束配合服务校验，不能仅靠前端过滤。知识源拥有者对显式挂载授权的含义沿现有用户管理边界，新增复杂多租户角色体系不在本次设计中。

MinIO 对象先写不可变键和内容哈希，再由数据库事务提交引用；失败的孤立对象由延迟清理计划处理。不能先提交“产物已保存”再尽力上传。大日志/完整工具结果存对象，结构化状态/摘要/索引存 PG。

## 6. 版本与并发策略

技术决定：版本内容只追加；current 指针更新使用 expected_revision 条件更新。过期更新返回 VERSION_CONFLICT，保留候选，用户或模型重新读取后自行处理；不静默覆盖，也不为模板自迭代新增一律人工审批。

模板源版本、员工有效工作版本、运行/轮次上下文快照三者分别记录。知识挂载表控制源可读资格，source.current_revision 指向所有挂载员工可见的新版本；每次实际读取返回并保存 knowledge_revision_id。当前可见与本轮已采用分开。

版本何时采用是业务政策 P01/P03，架构支持 explicit adoption 记录及新快照，不在数据库指针变更时自动重写在途上下文。未确定策略不能由 worker 临时猜测。回退产生新的采用记录，历史失败、外部动作和旧回执继续保留。

组织树保存短事务锁 team 行，核验 expected revision 和完整本队关系后追加版本；避免两次分别无环的改动组合成环。同团队关系变更串行，不把该锁用于模型调用。多上级语义未定，首期树的单直属上级表现不成为岗位能力限制。

## 7. 模型协作与执行协议

### 7.1 员工互相@与定向投递（D37）

员工通过message.send提交content、mentions[{type:employee,id}]、reply_to及相关run/task/work_item引用；实际发送人由执行凭证确定。界面姓名只用于展示，服务端按本团队稳定employeeId解析，校验接收资格与消息内容的可见范围。直属上级关系不限制普通协作，正式不确定问题仍通过issue.escalate保存逐级评估链。

同一事务保存群聊消息、逐接收员工delivery及待处理工作项，再由通知唤醒相关员工。每个(message_id, recipient_employee_id)只产生一条收件记录，重投沿原记录处理；多次合法新发言不能因正文相同被误去重。显示@同事不会把全团队都唤醒。接收无效/停用/跨团队返回明确结果，不按同名人员或负责人静默替换；校验全部显式接收对象后才提交，避免部分成功未说明。

v0.4执行契约：通知和请求处理由requiresResponse区分，false只保存定向收件，true创建工作；新模型工具要求显式选择，旧客户端省略兼容true。正式待决问题按任务依赖阻断，独立分支与当前上级评估分支继续；依赖、代次、旧决定失效与异常解释的实际字段以[实现契约v1.2](implementation.md)为准。原计划不是已完成证明，修复后的验证范围单独记录。

员工忙碌时保存待处理项，按适用执行边界/依赖纳入相关上下文；暂停时不因@自动恢复。处理前再次检查任务版本及归属，回复关联原消息并更新收件响应事实；已送达、已读、处理中、已响应与任务完成分别记录。员工回复可继续@同事，携带origin_message/reply_to/causation引用，结合既有资源/无进展记录识别循环，不硬编码轮流发言或固定岗位顺序。预算和等待后果仍按P02/P05。

普通未指定接收人的新目标由团队接收策略决定路由；该默认策略仍待细化，不把本次互相@确认解释为已批准任意全员广播或固定负责人。知识派生内容的传播仍按P04，@不能绕过可见范围。

### 7.2 轮次与动作协议

每个模型轮次取得：员工有效指令、团队流程、当前目标、相关任务与消息、显式可读知识和工具描述。团队内部协调可由配置指定的员工承担；“负责人”是可调整关系/分工，不是内核写死的专属模型或固定四岗位。

模型可以派工、重规划、发送消息、请求核查、报告问题、逐级上报、请求工具、登记产物和提出结束。内核暴露开放可扩展动作注册表；示例动作族为 task.assign/update、message.send、review.request/report、issue.escalate、tool.invoke、artifact.record、template.revise、run.propose_completion。它们是基础设施协议，不是工作步骤白名单；新增业务工具通过适配器注册。

一次模型输出纯文本只结束本轮，不能自动宣称 run 完成。run.propose_completion 需要关联可取得产物、已执行检查、未验证项及剩余问题；是否满足业务完成要求由有效目标/流程、监督和必要用户决定判断，平台不能用模型一句“完成”覆盖失败检查。

共同动作包（设计中的 wire contract）：

~~~json
{
  "schema_version": 1,
  "request_key": "stable-client-generated-id",
  "execution_id": "uuid",
  "kind": "artifact.record",
  "expected_revision": 7,
  "refs": [{"type": "task", "id": "uuid", "revision": 7}],
  "payload": {}
}
~~~

worker 凭证在传输层提供 execution/fence；actor、team_id、空间范围由服务端反查，不相信模型输出。kind 根据已注册适配器验证载荷；未知 kind 返回 UNSUPPORTED_ACTION，缺信息返回 CLARIFICATION_REQUIRED，不把参数错误作为工具成功。

模型完整响应、tool_call_id与对应action_id在首次外部派发前持久化，request_key绑定执行实例/已提交轮次/动作序号；恢复沿用原动作身份，不能让重新生成的模型调用绕过幂等。

调用流程：校验身份/归属/版本/策略 → 同事务保存动作意图和工作项 → 外部适配器执行 → 保存真实回执和检查点 → 更新任务状态和事件 → 广播。拒绝和失败保留原因，模型可以选择其他方法；平台不根据岗位标签缩减工具能力，资源和用户权限依实际上下文检查。

Prompt 装配顺序固定且可查：平台协议和既有权限约束、有效团队流程、员工工作指令/Skills、任务要求、引用资料及工具结果。资料/工具输出不提升为平台指令；装配保留来源。技能正文和真实工具可用性分开，引用不存在的工具时记录能力缺口并由模型处理。

## 8. 持久派发、控制与恢复

### 8.1 事务与派发

Java 提交业务变更时同时提交 durable_work 和 domain_event。轮次 worker 通过内部 claim API 领取工作；Java 在短事务内用 FOR UPDATE SKIP LOCKED 选择可领工作并写租期/递增 fence。该用法适合队列式领取，不用于普通列表一致性读取，依据 [PostgreSQL 16 SELECT 文档](https://www.postgresql.org/docs/16/sql-select.html)。

Redis 只发唤醒和实时通知，丢失后 worker 定期按持久工作项补查；通知转发器读取未发布事件，发布后标记，重复发布由 event_id 去重。没有新增消息队列。PG 不可用时不接受新业务状态/动作，保留可观察错误，不能改发 Redis 当作成功。

所有 state mutation 带 request_key，在 actor/scope/操作维度建立唯一约束，并保存请求摘要。相同 key/相同摘要返回原结果；不同摘要返回 IDEMPOTENCY_CONFLICT。工作项与序号在数据库原子分配，禁止 MAX(seq)+1。事务内锁顺序固定，模型调用、网络IO和等待决定均在事务外；这是降低死锁及长锁风险的设计，依据 [PostgreSQL 锁文档](https://www.postgresql.org/docs/16/explicit-locking.html)。

### 8.2 租期、结果未知和外部副作用

领取、续期、检查点提交均比较 worker、fence、数据库时间和 control_revision。失效持有者不能推进状态。租期到期且从未开始外部副作用的工作可重新领取；存在 dispatched 未确认动作时转 needs_reconciliation，不直接复制工具调用。

业务状态成功提交一次不代表外部动作 exactly once。适配器有幂等键/查询能力时按 external_ref 对账；否则把结果记 unknown，保留命令、输入哈希、时间和日志，等待核查/明确决定，不自动重试发送、付款、推送或合并等未知副作用。旧 worker 仍可能在外部执行，数据库 fence 无法撤回已经发送的请求；需确认旧执行结束或资源被隔离后才释放相同写工作区。晚到回执作为待核查证据保存，不能直接推动新 attempt。

### 8.3 控制不阻塞

用户/上级的决定、暂停、停止和恢复请求经 Java 持久化控制记录并递增 control_revision；独立 control listener 唤醒 worker。每次模型/工具边界重新核验控制版本，不依赖串行 user_input 消费。worker 对长模型流/命令实施取消能力；无法确认取消时状态为 stopping/unknown，不能显示已停止。

run 的基础设施状态：queued、active、waiting、pause_requested、paused、stop_requested、stopped、completed、failed、needs_reconciliation。task/execution 各自持有状态，团队摘要据此投影，不能用团队的单个状态覆盖全部任务。暂停确认要求没有新增派发，活动调用已结束或已有明确处置回执；具体在途资源后果见 P05。

任务生命周期只表达 queued、running、blocked、completed、failed、cancelled，不把“产品/设计/开发/测试”设为强制状态；模型可在任意阶段追加核查或重规划。关键迁移条件如下：

| 迁移 | 条件与原子事实 | 禁止的推断 |
| --- | --- | --- |
| queued → running | 任务/执行引用有效，取得租约与当前采用快照，预算/工作区前提满足 | 排队或收到消息不能算已执行 |
| running → blocked | 保存明确阻塞引用、当前处理者与依赖；释放可释放的执行槽 | 某员工阻塞不自动暂停全队 |
| blocked → queued | 对应决定已按有效政策应用，版本/权限/依赖重新校验，保存解除记录 | answered或读过消息不自动解除 |
| execution → needs_reconciliation | 已派发动作无可靠回执或持有者失效且外部效果待核实 | 网络错误不证明外部动作未发生 |
| running → task completed | 保存本任务产物/结果及检查边界，并满足目标/有效监督条件 | 某轮LLM结束不等于本任务完成 |
| run → completed | 完成提案有确定产物/检查/剩余问题，所需决定已应用，无未核实的阻断副作用，满足有效完成政策 | 接受成果不改写历史失败或未验证记录 |
| pause_requested → paused | 新派发已禁止，所有活动执行均已结束或取得明确处置事实 | 仅保存暂停请求不能显示已暂停 |

run在仍有可推进任务时保持active并展示阻塞明细；无可推进工作且等待依赖/决定时投影waiting；unknown结果优先显式展示。terminal状态的工作重新发起须新attempt或显式重开记录，保留旧结果；执行失败的后续路线由模型和有效流程判断。

decision 记录 open、awaiting_superior、awaiting_user、answered、applied，以及各级评估。自由文本需判断是否形成具体决定；不确定时继续澄清，不能照搬原型正则为生产语义判定。answer 持久化不直接改为 applied，更不解除用户另行施加的暂停。回答/应用需核对问题原版本、目标和任务仍适用，过期决定保留原文并标为待重新评估，不套用到已经变化的方案。谁能批准哪项恢复及影响集合依 P02；依赖事实用于定位范围，不能替代政策决定。

进程重启后恢复已提交工作/检查点；模型生成到一半且未提交的 token 可丢失，前端标为未提交的流片段。未发出副作用的轮次可重算且记录新的 attempt，模型输出不保证完全一致；已经发出工具的轮次先核实工具，再续接已保存的 tool_result。模型会话不是唯一持久事实。

## 9. 工作区、项目库与版本工具

业务文档直接使用不可变 document_revision / artifact_revision 和父版本，不要求 Git。代码项目另绑定 repository_provider + repo_ref，项目与仓库使用关联表支持多个引用，不把团队等同仓库。

推荐先提供受控 Git CLI 适配接口，provider 账号、托管/导入路径由 P06 确定；不写死 GitHub。每需求保存确切基线 commit、branch_ref 和独立写工作区；新建工作区、依赖配置及沙箱资源映射保存可恢复记录。复用 CubeSandbox 的实际隔离与挂载能力需 V04 验证，不能仅改目录名就视作沙箱隔离已成立。

同需求内同时写文件：优先拆员工私有执行工作区，产物通过版本引用交接；需要共享同一写工作区时取得显式写入所有权并串行写，不能一边修改一边让核查读取不确定中间态。只读核查绑定确定快照。并发是调度资源问题，不禁止模型继续拆分任务或处理无冲突工作。

集成动作独立保存 source_revision、target_expected_commit、checks 和授权依据；执行前核对目标未移动、检查对应当前源版本。目标变化返回冲突并重新评估；推送/合并超时先查询实际 ref，不重复盲推。谁可执行、冲突可自动解决到何种程度仍由 P06 决定。代码回退不能撤销外部业务效果。

## 10. 工作台 API 与展示投影

沿用 /api/v1 前缀和既有错误外壳；下列为新团队子域契约草案，不宣称已有端点。管理资源仍通过人员鉴权，内部 worker 不能调用人类管理接口冒充用户。

| 接口族 | 核心输入 → 输出 | 重要语义 |
| --- | --- | --- |
| /teams、/teams/{id}/revisions | 用户名称/简介/流程/expected_revision → team/revision | 用户决定有效配置，冲突返回409 |
| /employee-templates、/{id}/drafts、/{id}/revisions | 多轮来源/草稿/Prompt/Skills/原版本 → 草稿或新版本 | 保存与生成分开；worker仅可走授权的template.revise |
| /teams/{id}/employees、/employees/{id}/revisions | 模板版本/人员配置/直属关系 → 实际身份或版本 | 新增身份仅用户；一个员工一个团队 |
| /knowledge-sources/{id}/revisions、/employees/{id}/knowledge-mounts | 人员内容/版本/挂载操作 → 不可变源版本或挂载记录 | worker只有显式挂载源读取能力；卸载在途影响见P03 |
| /teams/{id}/messages | text/mentions/reply_to/context_refs/request_key → 已提交message/cursor及delivery引用 | 目标消息生成待解释工作项；普通消息不一律触发全队模型 |
| /teams/{id}/decisions/{id}/answers | answer/原decision revision → answered记录 | 只有被授权处理者，未明确则保持待澄清；应用状态另查 |
| /runs/{id}/controls | pause/stop/resume/expected revision → control_ref/current state | 202表示已持久接收，实际暂停/恢复需事件回执 |
| /teams/{id}/projects、/projects/{id}/documents、/work-items | 团队/文档/目标/基线 → 当前版本与历史 | 无仓库目标同样可创建 |
| /artifacts/{id}/revisions/{rev}/evidence | 确定产物版本 → checks/未验证/剩余问题/原始引用 | 权限覆盖内容和日志下载，不只列表 |
| /teams/{id}/events?after_seq、/teams/{id}/digest | 持久游标/团队 → 有序事件页/带来源摘要 | 全量补查可用；分页不漏中间事件 |
| /employees/{id}/adoptions、/runs/{id}/adoptions | 采用目标版本/原快照/有效政策 → adoption_ref及新快照 | 人员操作和允许的自动采用分别校验；不在更新模板时隐式执行 |
| /internal/team-worker/executions/{id}/context、/knowledge/search | 执行凭证/查询/游标 → 允许读取的内容及精确版本引用 | 查挂载、归属及有效政策，索引过滤后再授权核验，禁止把全库命中先送模型 |
| /internal/team-worker/work/claim、/executions/{id}/actions、/checkpoints、/results | 服务身份/租约fence/动作包 → 领取结果/提交回执 | 可重试的数据库协议，不直通模型任意SQL/管理操作 |

动作结果外壳为 operation_id、acceptance、state、revision、result_ref、error；acceptance 与 outcome 分开。错误仍采用 error.code/message，至少包括 SCOPE_FORBIDDEN、VERSION_CONFLICT、INVALID_RELATION、POLICY_UNRESOLVED、LEASE_LOST、IDEMPOTENCY_CONFLICT、DEPENDENCY_UNRESOLVED、ACTION_RESULT_UNKNOWN、RESOURCE_UNAVAILABLE。错误不通过自然语言猜测。

WS 团队订阅与旧 /ws/agent 会话订阅分开，建议 /ws/teams。持久事件包含 schema_version、event_id、team_id、seq、type、actor_ref、run/task/execution/action 引用、occurred_at。连接校验团队成员/管理者，断连后以 after_seq 重放；重复 event_id 去重，发现序号缺口补查。逐 token 和终端帧可临时传输且不可作为完成依据，正式消息/决定/结果必须可重读。

digest 从事实组合目标、当前工作、阻塞、下一步、来源引用和 observed_at；viewed_at 单独记录。忙闲按员工是否有活动执行、排队任务和阻塞计算，同一员工同时存在多种工作时显示明细，不把它硬压成唯一“空闲”。只有完整且新鲜的源快照可声明空闲；源缺失/过期显示 unknown/stale。模型摘要保留生成时覆盖的 event seq，不能靠刷新页面续鲜。

## 11. 资源、质量与开放政策

预算预留、结算、已知及未知用量均持久化。并发动作先在事务中申请预留，完成后以模型/工具真实回执结算，未确认请求保留未知预留，不能直接退还而让并发超花。模型 token 精确可知性与取消能力需实际服务验证。没有费用单价时展示 token/时长/调用数，不编造金额。

持续无进展检测综合重复动作、同类失败、任务/产物长期无变化和员工互相等待；这只能提供疑似停滞证据，不能可靠判断所有业务无价值。处理后果和阈值由有效政策明确，避免把统一轮数变为能力上限。遗漏不确定问题、错误自信、互评误判属于模型质量验收，程序权限校验不能证明模型语义正确。

下表保留此前候选与取舍历史；本次用户已经明确批准六条具体规则，以新增§11.1为当前有效决定，不再作为待确认政策重复询问。

| 政策 | 关联 | 推荐提案与代价 | 其他可行选择/需要决定的后果 |
| --- | --- | --- | --- |
| P01 模板采用 | R01/Q04/07 | 在途任务保持采用快照；后续新任务按用户选定的跟随策略采用新模板，保留员工局部改动并遇冲突保留候选；可退回 | 固定到用户显式升级、或受控在途切换；需决定适用员工和验证失败如何回退，不能默认每次模板迭代人工审批 |
| P02 监督/升级 | R02/Q01～03 | 监督绑定任务/产物；明确阻断依赖决定的工作，独立工作按有效流程继续；沿直属上级评估，失效上级形成可见异常再交用户修复 | 全队等待或不同授权级别；需决定谁可阻断/解除/改派，以及异常路由是否可直达用户，不引入固定岗位权力 |
| P03 配置/知识变化 | Q04/10/11 | 每轮读取前查显式挂载与源版本，保留采用引用；团队/员工配置变更在明确采用点形成新快照；卸载阻止后续直接读取 | 整个任务固定知识版本或受控重建上下文；需决定卸载后已有上下文能否继续，不能声称删除模型已读记忆 |
| P04 知识派生共享 | R03/Q12 | 源直接检索按挂载；共享时显式记录来源与目标可见范围，机密资料单独配置传播约束 | 将挂载仅视为检索配置、或要求派生内容继承严格限制；严格自动分类无法仅靠Prompt保证，影响群聊/交接/模板复用，需确定业务预期 |
| P05 停止/费用 | R04/N09 | 达到用户配置预算或疑似停滞阈值后停止新派发，保留在途/未知结果，群聊通知管理者决定后续；默认不擅自丢弃成果 | 上报后在额外额度内继续等策略；需决定等待是否继续计费、未完外部动作如何处置及紧急停止范围 |
| P06 版本集成 | Q08/09 | provider可替换，按项目配置执行授权与检查；冲突/目标变化重新评估或上报，结果未知先查ref | 可采用本地受控Git或托管服务；需决定首个接入和模型可自主合并范围，不默认所有合并审批，也不默认任意员工无限合并 |

### 11.1 用户批准的有效运行政策（2026-11-17，D38）

1. 在途任务固定有效配置；新任务跟随模板新版，保留员工个性化修改；冲突保留原工作版本并向用户上报。
2. 员工可互相@和请求核查；上级可阻断、恢复、改派相关任务；独立任务继续。不确定逐级上报，失效上级向用户报告配置异常；用户另行暂停不得自动恢复。
3. 当前任务固定员工/团队指令；新检索读取最新知识源。卸载立即禁止新的读取，已读内容保留至当前任务结束。
4. 挂载控制直接检索；团队内可以分享结论和产物，跨团队传播派生内容需用户授权，模板迭代不自动复制知识正文。
5. 使用可配置资源上限；达到后停止新派发、保留成果并@用户。等待人工不继续调用模型；在途请求仍核实结果和用量。
6. 首期使用受控Git CLI与独立工作区；团队配置授权目标分支，无冲突且检查通过可自主合并，分支保护继续生效，冲突逐级上报。

后续技术细化由本次Codex负责，前端/Java事务/Python执行及本地整合均在当前实现范围。程序与集成验证自行执行，独立测试/产品语义验收尚未指定，不虚构已通过。

## 12. 重要技术决策

| 编号 | 选择及理由 | 代价与成立条件 |
| --- | --- | --- |
| ADR01 | 团队运行内核独立于旧SessionRuntime，模型决定业务过程 | 新增事实模型/协调器；旧工具需适配，不能只给会话加员工名字 |
| ADR02 | Java拥有新业务事务，Python通过内部契约执行 | 多一次内部调用；服务认证/版本契约必须验证；不出现跨语言共享表随意双写 |
| ADR03 | PG持久工作项/事件 + 现有Redis通知 | 扫描与清理要有索引、批量和保留策略；无新增队列，容量仍需测量 |
| ADR04 | 不可变内容版本 + CAS current指针 + 轮次采用快照 | 多保存历史，需要对象生命周期；采用时点属于P01/P03 |
| ADR05 | 执行实例独立历史/可写空间，外部动作显式unknown | 增加资源成本；沙箱隔离/取消/外部对账是关键技术门槛 |
| ADR06 | 模型/工具适配器注册，不引入新Agent框架或固定业务DAG | 需自己实现小型调度/恢复协议；未来替换模型不改变已存事实语义 |

这些是设计师在现有栈和授权内作出的技术选择，仍需整合核实，不意味着业务未决项已由设计决定。相比直接扩旧会话的方案，新增内核能分别承载版本、并发和恢复；相比引入完整多Agent框架，当前选择避免改变已有栈及让框架默认行为决定业务后果。

## 13. 兼容、切换与当前完成状态

新团队 API/表/事件与旧 session CLI 共存，入口由功能开关切换。不能把旧 space_chat 当员工群聊、不把旧 user知识默认挂到所有员工，也不自动把历史会话回放成可信动作记录。需要迁移时由用户指定映射并显式记录来源；具体存量规模/权限须在实施前只读盘点。

新增迁移文件而不改已执行V1；上线前核对真实schema、备份、兼容客户端和数据校验。关闭新入口可阻止新派发，但要先处理活跃任务和外部副作用；代码回退不能回退已经发生的工具动作。新表及版本历史先保留，删除需要单独数据处置授权；本设计不执行迁移或部署。

| 环节 | 本次实际状态 |
| --- | --- |
| 需求和交互 | 引用既有D18～D37；v0.7原型内部复评已通过，具体用户确认范围不扩大 |
| 技术评估/系统设计 | 完成本稿及代码核实；有附条件路径，不包含真实恢复/容量试验 |
| 开发任务 | 已形成评审用任务和整合计划，全部未就绪，不能作为开工指令 |
| 业务政策 | P01～P06已由用户明确批准，D38/§11.1维护有效规则 |
| 开发/集成/测试/验收/发布 | 均未执行；实际开发和独立测试负责人待安排 |

官方资料只用于上述存储原语核实，不证明本项目实现已经可靠。Redis通知消费需要显式确认和补查，参见 [Redis Streams 文档](https://redis.io/docs/latest/develop/data-types/streams/)；本设计的业务恢复依据来自PG事实，而非一次Stream ACK。

版本记录：v0.2（2026-11-17）同步D37/需求v0.8，补员工互相@的身份、持久收件/定向投递、忙碌/暂停/失效接收者、回复因果链与权限边界。仅设计增量，未执行通信代码或真实模型验证。
