# 团队基础设施实现契约

2026-11-17，v1.0。需求依据：D18～D38、专题 v0.9；六条运行政策 P01～06 已由用户批准。本文件描述本次源码实现，历史候选附录不作为另一套运行协议。实际验证范围与未通过项目见 [verification.md](verification.md)。

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
| project.save/document.save | 项目配置；文档 projectId/title/content 及版本条件；仅人 |
| message.send | teamId、text、mentions 员工 ID 列表、replyTo、可选 projectId；人/本队员工 |
| task.assign/update | employeeId、goal / taskId、state、可选 employeeId 改派；本队派工，相关任务更新须本人/快照上级或人 |
| issue.escalate/decision.respond | problem、attempts、options / decisionId、answer、resolved 或 escalate；评估者可信，无法决定逐级升级 |
| run.control | runId、pause/resume/stop，可选追加 additionalCalls/Seconds；仅人解除人工全局暂停 |
| artifact.save/check.record | taskId、title/content/unchecked/remaining / artifactId、subjectRevision、result/limitations；检查绑定确切版本，模型评估不等于真实工具检查 |
| run.complete | taskId；需要产物，无未决问题、未知外部动作或排队集成 |
| integration.request | taskId、projectId、sourceRef、expectedTarget；登记源版本、当前基线、授权分支和真实检查命令均须满足 |
| execution.reconcile | executionId、executionStopped=true、resolution succeeded/failed、evidence；仅人，记录核实依据，等待明确恢复 |

`draft.generated`、`version.record` 和 `integration.result` 由受信执行适配器提交；模型仅得到注册工具，不可提交可信 actor。人作为管理者可以显式修改版本/状态，但不会因此生成虚假的工具通过记录。

## 4. 六条政策的生效方式

1. **配置采用**：任务保存 employeeSnapshot/teamSnapshot/organization，工作项保存 projectSnapshot。新任务按模板与员工 basePrompt/baseSkills 三方比较：无冲突更新、保留个性化修改；冲突留原工作版本并 @人。模板迭代不会热改当前任务。树调整仅影响新任务。
2. **协作与升级**：只有指定 mentions 生成收件和工作项，不唤醒整队；未指定人的目标交配置接收员工。员工普通群通知不生成新任务。回复关联原消息及运行；同事可相互请求核查。正式问题阻断原任务，建立上级评估任务，逐级到人。人工全局暂停独立保留；已解决问题不自动解除它。任务改派保留旧任务并新建快照，旧调用仍在执行或未知时拒绝改派。
3. **知识**：每轮 context 从实际员工当前挂载读取共享源最新版本，保存读取审计；检查点保留已读内容。卸载后不得新读，当前任务已读资料保留。并行工作项默认只注入自身 run 的消息和产物；同队明确 @/交接仍可分享结论。
4. **派生传播**：员工迭代模板标记 originTeamId 并清空其他团队旧授权。其他团队新采用需人明确授权当前版本；未授权既有员工留原版本并提醒。模板拒绝显式知识正文引用及整段字面复制，不自动复制挂载资料；这不是语义级 DLP，改写或片段知识泄漏仍需业务审查，不能承诺自动识别所有隐含传播。
5. **上限与等待**：SDK关闭隐式自动重试，run.calls 在模型动作意图事务内累计，多槽共享上限；默认 25 次/900 秒，团队可配，另有 Worker 槽位和 64MiB 归档上限。达到限制停新派发、保留成果并 @人。等待不继续模型调用；续跑可明确追加调用/时间。用量保存供应商真实返回，无返回则 not_reported；未提供货币费用硬上限或成本估算保证。
6. **Git**：每个任务独立远程工作区与 work/taskId 分支，平台 MinIO 存不可变 bundle。项目基线为平台受控本地引用，不冒充远端推送。目标分支受保护、无检查命令、基线变化均拒绝自主集成；无冲突且实际检查 exitCode=0 才推进基线，提交结果时再次 CAS；冲突/失败保留依据并升级。首期 HTTPS 只读源不接收内嵌凭据；私有仓库认证与外部 PR/推送适配尚未实现。业务任务不要求代码仓库。

## 5. 租约、恢复与控制

内部 API `/internal/team-worker/claim` 和 `/jobs/{id}/{operation}` 使用至少 32 字符 `X-Team-Worker-Secret`，常量时间比较；不向浏览器/模型发放。执行携带 workerId 和 fence。40 秒租期，5 秒独立心跳，不与模型/工具阻塞共用一个等待点。

operation 包含 context、heartbeat、checkpoint、sandbox、command、action、action-result、finish、late-result。动作先持久意图后外部执行；响应及完整工具调用 ID 先保存检查点，逐调用保存结果。已成功动作从 receipt 回放；未知动作不盲目重放。

失租且存在 dispatched/unknown 动作转 needs_reconciliation；没有未决副作用才允许重新领取并增加 fence。旧 fence 不能修改当前事实；晚到结果仅追加未核实 lateReports，不能推进任务。人须核查外部请求是否结束及真实结果、用量，再明确记录证据；原始结果不改成伪造成功。恢复创建续任务工作项，不重放未核实动作。

暂停/停止独立提交，模型流在控制到达后取消；已发出的外部工具请求不会被假称撤销，仍等回执或标未知。finish 以真实未决 action 判定，而非信任 Worker 的 done。运行时沙箱清理器同时识别 V1 会话和 team_jobs 所属资源。沙箱 TTL 后连接可能失败，持久 bundle 仍可恢复代码；未归档临时文件及模型内部状态不保证跨资源销毁恢复。

## 6. 验证入口

Java：`TeamEngineTest`、真实 PG opt-in `TeamPersistenceTest`；Python：`agent/tests/`；前端：`web/frontend/tests/`、typecheck/build；桌面与手机真实页面证据：`gui-test-screenshots/v20261117-team-live-*`。

实际执行结果、模型资源阻塞和后续验收项单独记录，不把协议单测、浏览器导航或模型生成文字当作端到端交付成功。
