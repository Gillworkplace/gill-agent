# 团队基础设施实现契约

2026-11-18，v1.5。需求依据为 D18～D40、专题 v0.9 及六条已批准的运行政策 P01～06。D40 增加分开的群聊操作和按工作启用的派工审批。v1.5 补齐交接与当前任务收尾、未知动作的事实展示及恢复。早期修复见[修改反馈](acceptance_fix_feedback_20261117.md)。

## 1. 组件与事实边界

浏览器 → Java `TeamController → TeamService → TeamEngine/纯策略 → TeamMapper`。

Python `team_worker → team_turns → team_client` 通过内部 HTTP 协议领取和提交工作；`team_turns → LLM / TeamGit → TeamSandbox / TeamObjects` 执行外部操作。Java 不等待外部执行，模型和沙箱不持有 Java Worker 密钥、数据库或 MinIO 凭据。旧会话路径不迁移为团队数据。

新 UI 默认登录入口，四个导航为工作台、数字员工模板、团队、知识库；旧入口 `#/legacy`。工作台主区聊天，右侧团队切换/进度/阻塞/下一步/源更新时间，手机可展开状态抽屉。团队首页显示项目/人数/描述，员工树、逐人知识挂载和项目库位于详情。

当前团队 UI 每 4 秒读取 PG 投影；API 提供事件游标补查，未实现团队 WS 推送和逐 token 展示。调用已接收、模型响应、任务交付与检查通过分开表示。

## 2. 存储与事务

`V2__digital_teams.sql` 仅新增，不修改 V1 会话数据。

| 表 | 事实及约束 |
| --- | --- |
| team_workspaces | owner_user_id 主键，JSONB document、revision、updated_at；短事务按用户 FOR UPDATE 串行定义/命令保存 |
| team_requests | 用户和可信 actor 范围内 request_key 唯一；请求摘要及原始结果，重复请求不重复落地，不同内容拒绝 |
| team_events | 单调 id、owner/team/revision/kind/payload；GET 游标最多返回 200 条 |
| team_jobs | UUID 工作项、payload、checkpoint、sandbox_id、worker_id、fence、lease_until、state/result；PG SKIP LOCKED 原子领取 |
| team_actions | job_id/request_key 唯一；外部调用 input、摘要、dispatched/succeeded/failed/unknown/reconciled 与真实 result |

聚合 document 内的逻辑对象包括 teams、templates、employees、knowledge、projects/documents、workItems、tasks、runs、messages、deliveries、artifacts、decisions、drafts、checks、codeVersions、integrations。定义保存追加不可变 versions，任务采用独立快照。动态任务、消息等不是每次追加完整定义版本。

选择每用户聚合以缩小首期多对象原子性边界，队列/回执/事件独立建表以支持竞争领取和未知动作追踪。它不是无限容量设计：大量员工、聊天或历史版本会增加聚合重写和轮询成本，未做规模压测；生产扩容前应按 team/run 拆聚合、分页查询及制定归档策略。不得据此宣称任意规模可用。

## 3. 公共 HTTP 协议

均复用现有 JWT/PAT 身份，服务端由 uid 定位工作区；客户端不能指定另一个 owner。

| 方法/路径 | 用途 |
| --- | --- |
| GET /api/v1/team-workspace | document 逻辑对象 + revision、updatedAt；执行状态叠加真实 job 状态，租期过期显示未知 |
| POST /api/v1/team-workspace/commands | `{requestKey, kind, payload}`；返回对象 id/revision/state，依动作而定 |
| GET /api/v1/team-workspace/events?after=0 | 持久事件游标补查 |
| GET /api/v1/team-workspace/executions/{id} | 本用户实际执行、sandboxId、动作与回执 |
| GET /api/v1/team-workspace/object-url?key=… | 只允许本用户已登记代码版本/项目基线对象，生成 120 秒预签名 URL |

定义修改传 `id` 与打开时的 `expectedRevision`；请求重试使用相同 requestKey 和相同内容。失败统一 `{error:{code,message}}`；错误 code 前缀包括 INVALID_INPUT、VERSION_CONFLICT、IDEMPOTENCY_CONFLICT、SCOPE_FORBIDDEN、DEPENDENCY_UNRESOLVED、ACTION_RESULT_UNKNOWN、LEASE_LOST。具体 HTTP 映射见 `TeamErrors`。

| 动作 | 核心输入与权限 |
| --- | --- |
| team.create/update | name、description、prompt、receiverId、limits；仅人 |
| team.relations | teamId、完整 relations[{id,parentId,expectedRevision}]；仅人，批次全量校验跨队/环及成员竞争 |
| template.save/revise | name、prompt、skills[{name,content}]、reason；人可保存，员工只可迭代自身采用模板 |
| template.share | id、expectedRevision、teamIds；仅人，授权当前派生版本跨团队采用 |
| template.generate | 可选 id、text、当前 draft；仅人，多轮持久消息 + 异步草稿，保存模板另行明确操作 |
| employee.create/update | teamId、templateId、name、role、parentId、prompt/skills；仅人，员工不能跨队移动 |
| knowledge.save | title、content、category；仅人追加不可变内容版本 |
| knowledge.mount/unmount | employeeId、sourceId；仅人，挂载不授予同队其他员工直接读取权限 |
| project.save/document.save | 项目配置仅人；文档projectId/title/content及版本CAS，人可维护；员工仅当前执行任务关联项目，记录作者、taskId/workItemId/runId，archive_document工具可用 |
| message.send | teamId、text、mentions、replyTo、可选 projectId，intent 为 notify（通知）、review（邀请核查）或 assign（用户正式派工）。员工的旧 requiresResponse 消息按通知保留。旧用户调用按原布尔参数路由。 |
| task.assign/update | employeeId、goal、可选 dependsOnTaskIds、已生效的同一工作 decisionId / taskId、state、可选 employeeId 改派。工作依赖默认来源任务，显式空数组为事先声明独立。运行中的条件仍经服务端校验。 |
| issue.escalate/decision.respond | problem、attempts、options / decisionId、answer、resolved 或 escalate、可选 expectedRevision。启用派工审批的主任务提交 dispatchApproval=true 可申请许可，只有用户答复时可显式 approveDispatch。决定绑定原任务版本和阻断状态，取消或获准改派使旧决定 superseded，迟到答复 409。 |
| run.control | runId、pause/resume/stop，可选追加 additionalCalls/Seconds；仅人解除人工全局暂停 |
| artifact.save/check.record | taskId、title/content/unchecked/remaining / artifactId、subjectRevision、result/limitations；检查绑定确切版本，模型评估不等于真实工具检查 |
| run.complete | taskId；需要产物，无未决问题、未知外部动作或排队集成 |
| integration.request | taskId、projectId、sourceRef、expectedTarget；登记源版本、当前基线、授权分支和真实检查命令均须满足 |
| execution.reconcile | executionId、executionStopped=true、resolution succeeded/failed、evidence；仅人，记录核实依据，等待明确恢复 |

`draft.generated`、`version.record` 和 `integration.result` 由受信执行适配器提交；模型仅得到注册工具，不可提交可信 actor。人作为管理者可以显式修改版本/状态，但不会因此生成虚假的工具通过记录。

## 4. 六条政策的生效方式

1. **配置采用**：任务保存 employeeSnapshot/teamSnapshot/organization，工作项保存 projectSnapshot。新任务按模板与员工 basePrompt/baseSkills 三方比较：无冲突更新、保留个性化修改；冲突留原工作版本并 @人。模板迭代不会热改当前任务。树调整仅影响新任务。
2. **协作与升级**：通知保留接收者及 delivery=notified，不调度；核查邀请只调度指定员工收集意见，正式工作通过显式派工调度。用户未指定接收人的正式目标交配置接收员工。正式问题阻断原任务及依赖后继，当前有效上级和核查协作可提供意见，核查来源已有待决时也会拦住其正式派工。独立任务不受影响，旧数据依赖回退 parentTaskId。所有层级均校验上级是否存在、本队、启用且无环，失效转用户并说明配置异常。答复只恢复关联等待任务，人工全局暂停独立保留。允许改派时保留原任务，新建快照并令旧决定失效。
3. **知识**：检索返回授权源数与匹配状态，在已授权源内按词匹配排序，零匹配不冒充零挂载。每轮 context 从实际员工当前挂载读取共享源最新版本，保存读取审计；检查点保留已读内容。卸载后不得新读，当前任务已读资料保留。并行工作项默认只注入自身 run 的消息和产物；同队明确 @/交接仍可分享结论。
4. **派生传播**：员工迭代模板标记 originTeamId 并清空其他团队旧授权。其他团队新采用需人明确授权当前版本；未授权既有员工留原版本并提醒。模板拒绝显式知识正文引用及整段字面复制，不自动复制挂载资料；这不是语义级 DLP，改写或片段知识泄漏仍需业务审查，不能承诺自动识别所有隐含传播。
5. **上限与等待**：SDK关闭隐式自动重试，run.calls 在模型动作意图事务内累计，多槽共享上限；默认 25 次/900 秒，团队可配，另有 Worker 槽位和 64MiB 归档上限。达到限制停新派发、保留成果并 @人。等待不继续模型调用；续跑可明确追加调用/时间。用量保存供应商真实返回，无返回则 not_reported；未提供货币费用硬上限或成本估算保证。
6. **Git**：每个任务独立远程工作区与 work/taskId 分支，平台 MinIO 存不可变 bundle。项目基线为平台受控本地引用，不冒充远端推送。目标分支受保护、无检查命令、基线变化均拒绝自主集成；无冲突且实际检查 exitCode=0 才推进基线，提交结果时再次 CAS；冲突/失败保留依据并升级。首期 HTTPS 只读源不接收内嵌凭据；私有仓库认证与外部 PR/推送适配尚未实现。业务任务不要求代码仓库。

## 5. 租约、恢复与控制

内部 API `/internal/team-worker/claim` 和 `/jobs/{id}/{operation}` 使用至少 32 字符 `X-Team-Worker-Secret`，常量时间比较；不向浏览器/模型发放。执行携带 workerId 和 fence。40 秒租期，5 秒独立心跳，不与模型/工具阻塞共用一个等待点。

operation 包含 context、heartbeat、checkpoint、sandbox、command、action、action-result、finish、late-result。动作先持久意图后外部执行；响应及完整工具调用 ID 先保存检查点，逐调用保存结果。已成功动作从 receipt 回放；未知动作不盲目重放。

失租且存在 dispatched/unknown 动作转 needs_reconciliation。运行、任务和关联集成都展示待核实事实。没有未决副作用才允许重新领取并增加 fence。旧 fence 不能修改当前事实，晚到结果保存为核实依据。人核查外部请求是否结束及真实结果和用量后，可明确记录结论。任务仍为暂停，明确恢复后才调度新代次。已核实的旧集成记录原样保留，项目基线保持原值。需要继续集成时，用户或员工明确发出新集成请求，由当前目标与实际检查决定是否应用。真实集成结果须由对应的执行实例记录，单独的集成工作保留源任务已完成的事实。

任务generation（默认1）区别于配置revision和租约fence。决定明确或任务显式重排后使用新generation，旧工作不能再发模型/工具或改当前任务，仍可落已发请求的真实回执。PG领取校验当前generation，且同任务turn不能并发、不能绕过旧未决动作。每用户聚合锁内检查当前代次是否已有queued/running/paused/needs_reconciliation工作；暂停中答复只保留queued意图，人工恢复后补齐缺失工作，重复恢复不重派。保存事务也补齐已就绪任务，不把queued标签当作已有执行。旧paused代次不自动重放；正常人工暂停的原代次继续用原检查点恢复。

用户引用已完成工作，选择「正式派工」时，未另选员工则按原任务员工路由，新建关联任务；原任务保持 completed，本次运行沿用原额度和历史。引用默认仅通知。旧客户端显式 requiresResponse=true 的回复仍支持原路由。

用户可在创建工作时提交 requireDispatchApproval=true，通过工作台选择一位负责人，或由团队已配置接收人负责。规则随该工作项持久化。分析、取证、通知和核查可以先做。关联正式派工、改派及集成经过网关的许可检查，同一工作声明独立依赖也无法跳过该许可。主任务用 ask_superior(dispatchApproval=true) 发出申请，上级可以提交建议并逐级转用户。普通回复和未解决意见不放行，明确拒绝后仍保留限制。明确允许后记录决定 ID，现有依赖和人工暂停规则继续生效。普通工作可由上级在权限内解决，也可在模型识别不确定时逐级上报。

核查版本为正整数且存在于目标产物当前/历史版本；非法引用拒绝，模型评估仍与实际工具证据分开。前端当前版本区域仅展示该版本核查，旧评审在历史版本下展示，遗留非法版本记录不计作当前通过。

暂停/停止独立提交，模型流在控制到达后取消；已发出的外部工具请求不会被假称撤销，仍等回执或标未知。finish 以真实未决 action 判定，而非信任 Worker 的 done。运行时沙箱清理器同时识别 V1 会话和 team_jobs 所属资源。沙箱 TTL 后连接可能失败，持久 bundle 仍可恢复代码；未归档临时文件及模型内部状态不保证跨资源销毁恢复。

complete_task模型工具可带可选artifact（字段同record_artifact），由Python以稳定callId派生两个requestKey顺序提交artifact.save与run.complete。保存失败不提出完成；完成校验失败保留报告，重放复用原请求结果。每次模型意图预留后刷新context，将run.calls/limits/state传入system；调用上限为run所有协作员工共享，包含本次已预留请求，不承诺还有下一轮。它不是跨命令原子事务，也不会按文本或产物存在自动完成；旧空参数兼容。详见[收尾修复与验证](completion_fix_feedback_20261118.md)。

当前任务收尾还可带一项 assign 正式派工或 review 核查邀请。执行器先保存显式提交的证据，再提交交接，收到成功回执后提出完成。派工和核查保留独立身份及许可校验。若交接已提交但完成状态未确认，回执仍包含实际交接结果。重放沿用各步骤的稳定请求键。未配置限额的在途工作按平台既有默认值 25 次、900 秒装配模型请求，配置了限额的工作沿用该运行的限额。

同一模型响应明确包含 `ask_superior` 时，执行器在提交前识别依赖该决定的派工、恢复、集成和完成。证据保存、纯通知及已声明的独立派工沿用现有范围。同一响应把新报告放入 `complete_task.artifact` 时，只将提交的新报告先保存，再执行上报，保持任务待决。工具回执使用原调用 ID 和幂等请求键。跨响应的硬阻断取决于已存在的决定或另一项明确可执行的先决条件。详见[持续回归记录](closure_20261118.md)。

`ask_superior` 可带一份新报告 `evidence`。执行器先以稳定请求键保存明确提交的报告，再提交正式上报；上报尝试列表附实际产物 ID 和版本。重放使用原请求回执。已有报告可在尝试列表引用，普通问题也可直接上报。

## 6. 验证入口

Java：`TeamEngineTest`、真实 PG opt-in `TeamPersistenceTest`；Python：`agent/tests/`；前端：`web/frontend/tests/`、typecheck/build；桌面与手机真实页面证据：`gui-test-screenshots/v20261117-team-live-*`。

实际执行结果、模型资源阻塞和后续验收项单独记录，不把协议单测、浏览器导航或模型生成文字当作端到端交付成功。
