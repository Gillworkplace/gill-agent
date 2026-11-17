# 通用数字员工团队基础设施：数据与接口候选

日期：2026-11-17；版本：v0.1；状态：设计输入草案，未经技术设计批准。

本文服务于[需求分析](requirement_analysis.md)。以下字段、存储职责及 HTTP 路径用于检查需求是否完整，均非已批准的数据库、API 或架构契约；实现前由系统设计师评估，不能据此直接创建表或开工。

## 1. 边界与共同规则

- 基础设施支持开放工作目标、任意岗位、能力和产物；研发与业务团队均可使用。行业模板、固定四角色、固定业务阶段和行业专属状态不作为内核前提。
- 大模型可以动态计划、分工、拆任务、重规划、通信、检查及选用当前可用工具。能力标签描述员工特长和需求，不是按岗位限定执行范围的白名单；工具真实可用性、现有资源权限和执行结果分别记录。
- 已确认的治理规则：新增数字员工，以及员工、团队、流程 Prompt 的调整，由用户决定；员工只能提交建议。模型运行调度权不包含修改这些规则的权力。生成候选内容不代表其已经启用。
- 草稿、当前有效版本、运行采用的版本快照分别存在。当前运行是否应用新版本、如何迁移上下文仍未决定；本草案不默认热更新，也不替用户决定一律仅下次生效。
- 上下级用于拿不准问题的逐级评估，监督关系用于检查工作；两者分开。逐级升级不等于每个步骤都必须审批，未答复也不等于同意。
- 所有跨对象引用校验归属与访问权；历史执行、失败、决定和引用过的版本不能因修改定义而被覆盖。聊天不能替代任务、动作、产物和决定事实。

## 2. 类型、公共字段与版本语义

`ID` 为稳定标识，编码待设计；`Ref` 包含对象类型、ID、必要时的版本 ID；`ActorRef` 区分人类用户、员工实例、系统；`Time` 为带时区时间；`Object` 为结构化值；`List<T>` 为列表。

`OpenState` 为可扩展的平台生命周期状态，不固化行业步骤；新增状态须有可解释的转换语义，不能由模型随意写入并绕过执行约束。`kind:String` 等业务分类允许扩展。

| 适用对象 | 字段 | 类型 | 必填 | 约束 |
| --- | --- | --- | --- | --- |
| 所有业务对象 | `id`, `space_id` | `ID`, `ID` | 是 | 稳定身份；归属已有空间；从引用推导时仍须校验一致性 |
| 所有业务对象 | `created_by`, `created_at` | `ActorRef`, `Time` | 是 | 来源真实，不将员工伪装为人类账户 |
| 可修改对象 | `revision_token`, `updated_at` | `String`, `Time` | 是 | 并发修改校验；不与业务版本号混用 |
| 员工、团队、流程、目标定义 | `name`, `draft_revision_ref`, `active_revision_ref`, `lifecycle` | `String`, `Ref?`, `Ref?`, `OpenState` | 名称/状态是；引用条件必填 | 草稿与有效版本分离；未启用可无有效版本；停用保留历史 |
| 定义的每个版本 | `definition_id`, `version_no`, `parent_revision_ref`, `content_hash` | `ID`, `Int`, `Ref?`, `String` | 除父版本外是 | 同定义版本号唯一；有效或已被运行引用的版本不可原地改写 |
| 定义的每个版本 | `origin_prompt`, `change_summary`, `source_proposal_ref` | `Text`, `Text`, `Ref?` | 前两项是 | 区分用户原始要求、生成内容和员工建议；不存明文密钥 |
| 引用/归档对象 | `supersedes_ref`, `archived_at` | `Ref?`, `Time?` | 否 | 替代、停用不删除历史证据；保留周期另行设计 |

以下表继承公共字段。字段组的“是”表示组内每项必填；问号表示可空，条件必填在约束中注明。表名只是概念名。

## 3. 定义、组织与工作上下文

| 概念 | 字段 | 类型 | 必填 | 版本与业务约束 |
| --- | --- | --- | --- | --- |
| 员工定义 | 公共定义字段 | 见 §2 | 是 | 可复用身份，不等同团队席位或正在执行的进程 |
| 员工版本 | `work_prompt`, `responsibility_description` | `Text`, `Text` | 是 | 指令与职责可开放描述，不内置岗位枚举 |
| 员工版本 | `capability_descriptions`, `input_expectations`, `output_expectations` | `List<Text>`, `Text?`, `Text?` | 能力列表是，可为空 | 能力不授予账号或权限，也不禁止员工处理其他开放任务 |
| 员工版本 | `generation_ref`, `validation_findings` | `Ref?`, `List<Object>` | 检查列表是，可为空 | 可追溯平台生成与用户调整；检查不宣称能力已真实验证 |
| 团队版本 | `team_prompt`, `seat_revision_refs`, `relationship_revision_refs` | `Text`, `List<Ref>`, `List<Ref>` | 是 | 岗位、数量及协作方式开放；有效快照引用确定版本 |
| 团队席位 | `team_revision_ref`, `seat_key`, `employee_revision_ref` | `Ref`, `String`, `Ref` | 是 | 席位键在团队版本内唯一；复用某员工定义不等同共享运行上下文 |
| 团队席位 | `display_title`, `responsibility_scope`, `context_overrides` | `String?`, `Text`, `Object?` | 职责是 | 团队内具体分工；覆盖工作指令的内容仍受用户决定规则约束 |
| 上下级关系 | `team_revision_ref`, `subordinate_seat_ref`, `superior_seat_ref` | `Ref`, `Ref`, `Ref` | 是 | 同团队有效席位，不自指、不成环；是否允许多个上级待定 |
| 上下级关系 | `scope_description`, `source_revision_ref` | `Text`, `Ref` | 是 | 明确评估范围和关系来源；不因职位名称推断层级 |
| 监督关系 | `team_revision_ref`, `reviewer_seat_ref`, `subject_seat_ref` | `Ref`, `Ref`, `Ref` | 是 | 与上下级分别表达；相互监督可双向，不套用上下级无环约束 |
| 监督关系 | `review_scope`, `authority_description` | `Text`, `Text?` | 范围是 | 阻断、改派、裁决权限仍需明确；关系本身不自动扩权 |
| 工作目标版本 | `objective_prompt`, `desired_outcomes`, `constraints` | `Text`, `List<Text>`, `Text?` | 前两项是 | 工作对象不限定“软件项目”；期望结果可继续澄清和版本化 |
| 工作目标版本 | `context_version_refs`, `acceptance_description` | `List<Ref>`, `Text?` | 引用列表是，可为空 | 验收描述不限代码/测试，不默认平台替用户决定接受权 |
| 上下文版本 | `kind`, `content_ref`, `content_hash`, `provenance` | `String`, `Ref`, `String?`, `Object` | 除哈希外是 | 文本、资料、链接、数据、代码基线等均可；可固定内容时记录哈希 |
| 上下文版本 | `availability`, `observed_at`, `supersedes_ref` | `OpenState`, `Time?`, `Ref?` | 可用性是 | 区分已取得、未读取、失效或无权访问；外部链接不代表内容已取到 |
| 流程版本 | `workflow_prompt`, `interpretation_summary`, `validation_findings` | `Text`, `Text?`, `List<Object>` | Prompt/检查列表是 | Prompt 为协作规则来源；解释摘要不取代原文，不强制转成固定 DAG |
| 流程版本 | `referenced_definition_versions`, `context_refs` | `List<Ref>`, `List<Ref>` | 是，可为空 | 允许开放任务、反复检查和动态计划；不把临时计划写回有效流程 Prompt |
| 生成操作 | `requested_by`, `request_prompt`, `input_refs`, `model_config_ref`, `state`, `candidate_refs` | `ActorRef`, `Text`, `List<Ref>`, `Ref?`, `OpenState`, `List<Ref>` | 除模型配置引用外是 | 追溯生成请求、候选及失败；新增员工的生成请求来自用户，结果不自动转为有效员工 |

## 4. 运行、任务、通信与真实动作

| 概念 | 字段 | 类型 | 必填 | 版本与业务约束 |
| --- | --- | --- | --- | --- |
| 流程运行 | `goal_revision_ref`, `team_revision_ref`, `workflow_revision_ref` | `Ref`, `Ref`, `Ref` | 是 | 启动时采用明确版本；不能仅保存会变化的“最新”指针 |
| 流程运行 | `manager_user_ref` | `ActorRef(user)` | 是 | 明确最终接收升级事项的人类管理者并校验空间访问权；可由发起上下文解析并保存，不从 `created_by` 或空间成员列表任意猜测 |
| 流程运行 | `effective_snapshot_ref`, `state`, `current_plan_ref` | `Ref`, `OpenState`, `Ref?` | 前两项是 | 快照含有效员工/组织/规则引用；运行中计划可调整，规则变更另走用户决定 |
| 流程运行 | `budget_context`, `blocker_refs`, `started_at`, `ended_at` | `Object?`, `List<Ref>`, `Time?`, `Time?` | 阻塞列表是，可为空 | 限额、等待规则待定；运行结束、结果验证、用户接受分别识别 |
| 运行计划版本 | `run_ref`, `plan_content`, `basis_refs`, `supersedes_ref` | `Ref`, `Object`, `List<Ref>`, `Ref?` | 除替代引用外是 | 记录模型动态安排及依据；内容不限定业务步骤或固定员工顺序 |
| 员工运行实例 | `run_ref`, `seat_revision_ref`, `employee_revision_ref` | `Ref`, `Ref`, `Ref` | 是 | 实际执行身份，与可复用定义、团队席位分开 |
| 员工运行实例 | `state`, `context_refs`, `execution_context_ref` | `OpenState`, `List<Ref>`, `Ref?` | 前两项是 | 沙箱/工作区映射及并行实例数待设计，不预设一员工一沙箱 |
| 任务 | `run_ref`, `objective`, `assignee_ref`, `state` | `Ref`, `Text`, `Ref?`, `OpenState` | 除分派引用外是 | 任务可先创建再分派；类型开放，允许模型拆分、交接与重规划 |
| 任务 | `input_version_refs`, `dependency_refs`, `expected_outputs`, `blocker_refs` | `List<Ref>`, `List<Ref>`, `Text?`, `List<Ref>` | 列表是，可为空 | 依赖引用明确对象；相互等待可被发现，不能静默标完成 |
| 任务安排记录 | `task_ref`, `operation`, `before_ref`, `after_ref`, `reason` | `Ref`, `String`, `Ref?`, `Ref`, `Text` | 除前态外是 | 记录分派、改派、拆分及计划调整；不自动成为修改员工/流程的权力 |
| 通信消息 | `run_ref`, `sender`, `recipient_refs`, `content`, `related_refs` | `Ref`, `ActorRef`, `List<Ref>`, `Text`, `List<Ref>` | 是；关联列表可为空 | 可向员工、用户或团队发送；发送者由认证/执行上下文确定，不信任自报身份 |
| 通信消息 | `message_kind`, `delivery_state`, `reply_to_ref`, `correlation_id` | `String`, `OpenState`, `Ref?`, `ID?` | 前两项是 | 已发送、已送达、已响应分开；普通聊天不隐式授予决定权 |
| 执行动作/尝试 | `run_ref`, `task_ref`, `actor`, `operation`, `input_refs` | `Ref`, `Ref?`, `ActorRef`, `String`, `List<Ref>` | 除任务引用外是 | 工具动作、通信或其他开放动作；不按岗位给工具白名单 |
| 执行动作/尝试 | `execution_state`, `correlation_id`, `idempotency_key`, `external_operation_ref` | `OpenState`, `ID`, `String?`, `Ref?` | 前两项是 | 必须可区分未执行/执行中/成功/失败/取消/`unknown`；未知不等于失败 |
| 执行动作/尝试 | `result_refs`, `error_fact`, `started_at`, `ended_at`, `reconciles_ref` | `List<Ref>`, `Object?`, `Time?`, `Time?`, `Ref?` | 结果列表是，可为空 | 恢复先核对外部状态；补查通过新事实解释旧 unknown，不抹掉历史 |
| 运行事件 | `run_ref`, `sequence`, `event_type`, `actor`, `entity_refs`, `occurred_at` | `Ref`, `Int`, `String`, `ActorRef`, `List<Ref>`, `Time` | 是 | 运行内可排序、去重、续读；不要求保存模型私有思维过程 |

## 5. 产物、监督、升级与用户决定

| 概念 | 字段 | 类型 | 必填 | 版本与业务约束 |
| --- | --- | --- | --- | --- |
| 产物版本 | `artifact_id`, `version_no`, `kind`, `content_ref` | `ID`, `Int`, `String`, `Ref` | 是 | 任意工作产物，不限定文档/代码；引用某次确定内容而非只用可移动名称 |
| 产物版本 | `run_ref`, `producer_ref`, `input_version_refs`, `content_hash` | `Ref`, `ActorRef`, `List<Ref>`, `String?` | 除哈希外是 | 记录来源和依赖；文件、外部对象或结构化内容均可，完整性按介质设计 |
| 验证证据 | `target_version_refs`, `source_action_ref`, `method`, `observed_result` | `List<Ref>`, `Ref?`, `String`, `OpenState` | 除动作引用外是 | 说明观察方式；人工提供、工具验证、模型判断和未验证需可区分 |
| 验证证据 | `raw_content_ref`, `execution_context_ref`, `observed_at`, `limitations` | `Ref`, `Ref?`, `Time`, `Text?` | 原始依据/时间是 | 证据对应具体版本；失败、无法取得和未验证不能被互评改成成功 |
| 评审记录 | `run_ref`, `reviewer`, `target_version_refs`, `criteria_refs`, `evidence_refs` | `Ref`, `ActorRef`, `List<Ref>`, `List<Ref>`, `List<Ref>` | 是；后两列表可为空但须说明依据 | 监督不限产物，还可针对任务、动作和流程执行事实 |
| 评审记录 | `verdict`, `assessment`, `issue_refs`, `supersedes_review_ref` | `OpenState`, `Text`, `List<Ref>`, `Ref?` | 除替代引用外是 | 例：需修改/可接受/受阻/无法判断；不跨版本自动继承通过结论 |
| 问题 | `run_ref`, `description`, `affected_version_refs`, `source_refs` | `Ref`, `Text`, `List<Ref>`, `List<Ref>` | 是 | 任意工作缺口、分歧或错误；不只表示代码缺陷 |
| 问题 | `state`, `responsible_ref`, `resolution_refs`, `recheck_refs` | `OpenState`, `Ref?`, `List<Ref>`, `List<Ref>` | 除责任引用外是 | 提出、处理、声称解决与复核解决分别记录，不删原始问题 |
| 升级事项 | `run_ref`, `raised_by`, `question`, `uncertainty_reason`, `basis_refs` | `Ref`, `ActorRef`, `Text`, `Text`, `List<Ref>` | 是 | 拿不准方案沿上下级评估；不限岗位或业务阶段 |
| 升级事项 | `hierarchy_revision_ref`, `current_handler`, `state`, `dependent_task_refs` | `Ref`, `ActorRef?`, `OpenState`, `List<Ref>` | 除处理者外是 | 查清当前层级；正常逐级评估最终反馈运行的 `manager_user_ref` 已明确。缺失或成环等配置异常显式暴露，修正与异常路由待定 |
| 升级评估记录 | `escalation_ref`, `sequence`, `from_actor`, `to_actor`, `assessment`, `outcome` | `Ref`, `Int`, `ActorRef`, `ActorRef`, `Text`, `OpenState` | 是 | 逐级追加；区分可解决、需补证、继续向上、等待；未回复不构成通过 |
| 决定 | `subject_ref`, `decided_by`, `decision_content`, `basis_refs`, `scope`, `decided_at` | `Ref`, `ActorRef`, `Text`, `List<Ref>`, `Text`, `Time` | 是 | 来源与适用范围可查；上级评估与用户决定分别识别，不覆盖真实执行事实 |
| 决定 | `resulting_action_refs`, `resumption_refs` | `List<Ref>`, `List<Ref>` | 是，可为空 | 决定已作出不等于已执行或已恢复；哪些任务等待/恢复仍需规则明确 |
| 变更建议单 | `kind`, `target_ref`, `base_revision_ref`, `proposed_content`, `reason`, `proposed_by` | `String`, `Ref?`, `Ref?`, `Object`, `Text`, `ActorRef` | 除新增对象的引用外是 | 员工可提出新增员工、指令或流程调整建议；建议本身不改变有效定义 |
| 变更建议单 | `state`, `impact_refs`, `user_decision_ref`, `applied_revision_ref` | `OpenState`, `List<Ref>`, `Ref?`, `Ref?` | 状态/影响列表是 | 仅用户可决定采用并应用；员工不能自行批准或应用建议，用户可决定自己提出的具体变更；批准、应用、当前运行采用分别识别 |
| 变更应用事实 | `proposal_ref`, `user_actor`, `expected_base_ref`, `result_revision_ref`, `application_scope` | `Ref`, `ActorRef`, `Ref?`, `Ref`, `Text` | 除新增对象基线外是 | 基线过期时显式冲突；运行热更新未定，不能把“应用配置”解释为自动改写运行快照 |

## 6. 存储职责候选与现有依赖

| 候选依赖 | 职责 | 当前基础与设计边界 |
| --- | --- | --- |
| PostgreSQL / Flyway | 定义、不可变版本、运行状态、任务、决定、证据索引和事件等源事实 | 已有；具体表、索引、事务与状态更新策略待架构设计，不将概念表直接转 DDL |
| Redis Streams 等现有能力 | 命令排队、工作通知、实时推送、临时协调 | 已有但恢复语义需补齐；队列消费/通知不作为业务动作已完成的唯一证明 |
| MinIO / 现有文件能力 | 任意内容、产物、原始证据与大日志的存储候选 | 已有；版本完整性、访问隔离、保留与外部内容引用待设计 |
| Java Web / 现有 JWT、PAT、空间鉴权 | 用户管理操作、查询和事件接入 | 已有；数字员工使用独立执行身份及可追溯的用户授权来源，不能持有人类身份任意自报 |
| Python 执行器 / 模型与工具能力 | Prompt 生成、模型决策、员工执行、可用工具调用 | 已有单会话底座；多实例调度、Prompt 生效、恢复、执行回执仍需设计验证 |
| 沙箱、浏览器、知识库、扩展 | 通用执行环境、上下文与能力接入候选 | 已有；不把沙箱、研发语言或某种行业工具作为所有员工的必要条件 |

源事实与队列通知分离：先有可核验的任务/动作/决定事实，再据其产生通知；具体一致性机制由设计师评估。重复、漏发、中断恢复、外部动作结果未知必须有处理设计，不能用“模型会记住”替代。

本附录不引入新框架、数据库或消息系统。资源权限沿用真实账号和环境约束，不因能力标签制造新限制，也不因模型声称具备能力就假设工具已可用。

## 7. HTTP 接口候选概览

所有路径以 `/api/v1/spaces/{spaceId}` 为前缀，下表用 `P` 简写。已有 JWT/PAT 人类鉴权和空间归属继续有效；员工与内部执行器的认证方式、授权委托与路由形式待设计，不能用请求体中的 `actor` 冒充用户。以下路径仅为设计输入，尚不是对外承诺。

共同输入输出：写入的 `actor/space_id/time` 由服务校验或生成；返回资源 ID、版本/并发令牌和操作状态。异步返回 `operation_ref` 只表示受理；是否已完成以执行事实查询为准。列表支持游标分页。

并发语义候选：`K` 表示请求幂等键，同空间/主体/操作下同键同内容返回同结果，内容变化显式冲突；`V` 表示 `expected_revision` 或 `If-Match`，过期拒绝覆盖；`A` 表示按动作 ID 幂等与状态前置条件处理。具体头名、作用域、保存期及错误码由接口设计定稿；版本/幂等冲突候选返回 409，拒绝越权沿用现有鉴权错误结构。

| Method | 候选路径 | 作用 | 最小入参 → 输出 | 幂等/版本语义 |
| --- | --- | --- | --- | --- |
| POST | `P/employee-generations` | 用户发起平台生成员工候选 | 用户 Prompt、上下文引用 → 操作/候选草稿引用 | K；生成不自动启用；员工只能提交建议 |
| GET | `P/operations/{id}` | 查询生成或其他异步操作 | ID → 受理/运行状态、候选/结果引用、失败或未知信息 | 只读；操作成功不等于配置已启用 |
| POST | `P/employees` | 用户保存新增员工草稿 | 候选引用或定义内容 → 员工/草稿版本 | K；用户操作，不能由员工直接新增 |
| GET | `P/employees`、`P/employees/{id}` | 员工列表、定义和生效状态 | 游标/ID → 定义、版本引用 | 只读，不泄露密钥 |
| POST | `P/employees/{id}/revisions` | 用户更新员工工作 Prompt 草稿 | 基线、修改 Prompt/内容 → 新草稿版本 | K+V；不覆盖旧版本、不自动启用 |
| GET | `P/employees/{id}/revisions`、`P/employees/{id}/revisions/{revisionId}` | 查看历史及确定版本 | ID/游标 → 版本、来源、变更摘要 | 只读；历史引用稳定 |
| POST | `P/employees/{id}/deactivation` | 用户停用员工定义 | 原因、当前版本 → 状态/影响范围 | K+V；不删除旧运行，存量运行处理待定 |
| POST / GET | `P/teams` | 用户保存团队草稿/列团队 | 团队 Prompt、席位引用或游标 → 草稿/列表 | 写入 K；不固化岗位或数量 |
| GET | `P/teams/{id}`、`P/teams/{id}/revisions` | 查看团队及历史组织快照 | ID/游标 → 版本、席位、关系 | 只读 |
| POST | `P/teams/{id}/revisions` | 用户调整团队 Prompt 与组织草稿 | 基线、Prompt、席位 → 新版本 | K+V；配置变更不等于运行调度 |
| POST | `P/teams/{id}/relationship-revisions` | 保存层级与监督关系候选 | 基线、两类关系 → 团队草稿/校验问题 | K+V；操作权限最终需明确，不混用两类关系 |
| POST | `P/workflow-generations` | 依据用户 Prompt 生成流程候选 | Prompt、团队/上下文引用 → 操作/草稿 | K；不预设行业阶段 |
| POST / GET | `P/workflows` | 用户保存流程草稿/列流程 | Prompt/候选引用或游标 → 定义/列表 | 写入 K；保存不自动应用 |
| GET | `P/workflows/{id}`、`P/workflows/{id}/revisions` | 查看流程与历史 | ID/游标 → 原 Prompt、解释、版本 | 只读 |
| POST | `P/workflows/{id}/revisions` | 用户修改流程 Prompt 草稿 | 基线、修改要求 → 新草稿版本 | K+V；员工只走变更建议 |
| POST | `P/definition-validations` | 检查候选定义与关系 | 版本引用、上下文 → 歧义、缺口、关系问题 | K；检查不等于批准或能力已验证 |
| POST / GET | `P/goals` | 创建/列出通用工作目标 | 目标 Prompt、上下文引用或游标 → 目标/列表 | 写入 K；不要求代码仓库 |
| GET | `P/goals/{id}`、`P/goals/{id}/revisions` | 查看目标、约束和历史 | ID/游标 → 确定版本 | 只读 |
| POST | `P/goals/{id}/revisions` | 用户更新目标 | 基线、目标/约束 → 新版本/影响引用 | K+V；运行采用规则另行决定 |
| POST / GET | `P/contexts` | 登记/查询任意工作资料 | 内容引用、类型、来源或游标 → 上下文版本/可用性 | 写入 K；外部引用不宣称已读取 |
| POST | `P/runs` | 用户启动一次团队工作 | 目标/团队/流程的有效版本、上下文 → run/快照 | K；固定采用版本，不自动取后续最新 |
| GET | `P/runs`、`P/runs/{id}` | 运行列表与状态总览 | 游标/ID → 计划、任务、阻塞、采用版本 | 只读；状态与证据分开展示 |
| GET | `P/runs/{id}/capabilities` | 查询运行可发现的工具与实际可用性 | 运行/实例引用、游标 → 工具 schema/引用、可用性、依赖缺口 | 只读；可结合现有扩展目录和执行协议，不按岗位能力标签过滤 |
| POST | `P/runs/{id}/controls` | 用户暂停、恢复或终止 | 控制类型、状态版本、原因 → 控制动作/状态 | K+V+A；受理不等于外部动作已停止 |
| GET | `P/runs/{id}/events` | 增量事件查询/订阅 | after_cursor、limit → 事件、next_cursor | 只读；可续读去重；过期需明确重取，不静默跳到最新 |
| POST / GET | `P/runs/{id}/messages` | 用户/员工通信与查询 | 接收对象、内容、关联引用或游标 → 消息/送达状态 | 写入 K；发信身份由会话/执行上下文校验 |
| POST / GET | `P/runs/{id}/tasks` | 模型动态创建任务/查询任务 | 目标、输入/依赖、分派引用或游标 → 任务 | 写入 K；开放任务内容，不改变定义 Prompt |
| POST / GET | `P/runs/{id}/instances` | 建立/查询运行中的员工执行实例 | 既有席位/员工版本、上下文或游标 → 实例/状态 | 写入 K；执行实例不等于新增员工定义，实例并行规则待设计 |
| POST | `P/runs/{id}/plan-revisions` | 模型重规划、调整分工 | 当前计划、调整与依据 → 新计划/影响任务 | K+V；不能创建员工定义或修改有效规则 |
| POST | `P/tasks/{id}/assignments` | 按有效规则分派/交接任务 | 当前任务版本、实例/席位、原因 → 安排记录 | K+V；保留旧责任记录 |
| POST | `P/tasks/{id}/progress-records` | 员工报告任务进展、阻塞或输出 | 当前任务版本、进展、关联动作/产物 → 进展事实/任务状态 | K+V；模型声称完成与实际验证结果分别记录 |
| POST | `P/tasks/{id}/actions` | 提交开放动作执行 | 操作、输入、执行上下文 → 动作/尝试引用 | K+V；在可用工具和真实资源权限内执行 |
| GET | `P/actions/{id}` | 查询动作实际结果 | ID → 状态、输出、错误、unknown 信息 | 只读，不把受理当成功 |
| POST | `P/actions/{id}/reconciliations` | 由执行器记录结果或补查事实 | 来源、外部动作引用、观察结果/证据 → 新结果事实 | K+A；服务验证来源，未知副作用先核对再重试 |
| POST / GET | `P/runs/{id}/artifacts` | 登记/列任意交付物 | 类型、内容引用、生产者/输入版本或游标 → 产物版本 | 写入 K；上传复用现有文件通路候选 |
| POST / GET | `P/artifacts/{id}/versions` | 产物新版本/历史 | 基线、内容/来源或游标 → 不可变版本 | 写入 K+V；不原地覆盖旧证据 |
| POST / GET | `P/runs/{id}/evidence` | 记录/查实际验证依据 | 对象版本、方法、原始依据、结果或游标 → 证据 | 写入 K；保留来源与未验证范围 |
| POST / GET | `P/runs/{id}/reviews` | 员工监督与结论查询 | 对象版本、标准、证据、意见或游标 → 评审/问题 | 写入 K；不以互评覆盖失败事实 |
| POST / GET | `P/runs/{id}/issues` | 记录/查工作问题 | 描述、受影响版本、来源或游标 → 问题 | 写入 K；非代码缺陷专属 |
| POST | `P/issues/{id}/resolution-records` | 记录修正与复核 | 当前版本、修正/复核引用 → 新状态事实 | K+V；“声称修正”不等于复核通过 |
| POST / GET | `P/runs/{id}/escalations` | 员工提交不确定问题/查询 | 问题、原因、依据、相关任务或游标 → 升级事项/处理层级 | 写入 K；按有效上下级关系定位 |
| GET | `P/my-decision-items` | 查询当前用户的跨运行待办 | 类型、游标 → 升级事项、变更建议与关联运行 | 只读；按认证用户、空间访问权和当前处理者筛选 |
| POST | `P/escalations/{id}/assessments` | 当前上级评估或继续升级 | 当前版本、意见、依据、处理结果 → 追加评估/下一处理者 | K+V；校验层级，不静默跳级 |
| POST | `P/escalations/{id}/user-decisions` | 用户处理升级到自己的事项 | 当前版本、决定内容、范围 → 决定/受影响任务 | K+V；用户身份；决定不自动证明动作已执行 |
| POST / GET | `P/change-proposals` | 员工建议/用户提案与查询 | 类型、目标基线、建议内容、原因或游标 → 建议单 | 写入 K；员工提议无应用权 |
| POST | `P/change-proposals/{id}/user-decisions` | 用户采纳、修改后采纳或拒绝 | 建议版本、决定、可选修订内容 → 决定记录 | K+V；仅用户决定，不默认应用 |
| POST | `P/change-proposals/{id}/applications` | 用户应用已决定的定义变更 | 用户决定引用、目标基线、生效对象 → 新有效版本/应用事实 | K+V；仅用户；基线过期冲突；不默认热改运行快照 |

用户直接创建、调整或启用自己提出的具体配置时，允许一次明确操作同时记录用户决定和应用事实，不强制用户两次确认；内部是否拆分调用由设计决定，不能增加机械重复确认。运行中的版本采用仍按待定生效规则处理。需要自适应 API 的通用操作不等于任意写库权限，状态转换仍需校验已确认的治理规则。

## 8. 交给系统设计与产品继续明确的事项

1. 当前运行采用新员工/团队/流程版本的方式、生效边界、冲突处理及用户可见影响；不能由员工建议自动触发。
2. 组织层级是否多上级、具体关系配置及配置异常处理；正常逐级评估最终反馈用户已由 D19 明确，不能重新悬置；监督者阻断、改派与解除权限仍需细化。
3. 升级等待范围、独立任务继续条件、提醒、恢复负责人、预算与结束/接受规则；不预设固定超时与返工次数。
4. 员工实例与执行环境、上下文共享/隔离、并行任务协调、可用工具发现；不以岗位能力标签替代真实环境约束。
5. 定义/事实存储、原子状态变化、事件/队列一致性、幂等、游标保留、结果未知核对及服务中断恢复设计。
6. HTTP 资源拆分、认证委托、字段/状态注册、分页、错误码、数据保留与原有会话/CLI 兼容；本附录不授权删除旧能力。
