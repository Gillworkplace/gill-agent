# docs/AGENT.md — 文档模块

## 职责

核心文档与专题需求共同承载需求和设计基线：任何架构/接口/部署变更必须同步到适用文档并升版本号（AGENTS.md §9）。草案、技术候选、已批准契约与已实现状态必须区分，文档与代码不一致视同未完成。

## 文档清单与版本链

| 文件 | 内容 | 当前版本 |
|---|---|---|
| `01-requirements.md` | 统一目标基线：D18～D23 通用数字员工团队基础设施、用户调整权、灵活度与逐级升级；保留旧需求供迁移评估 | v1.8 |
| `features/digital-employee-team/requirement_analysis.md` | 当前专题细化基线：功能闭环、通用模型与接口域、依赖、非功能、开放事项、追溯与验收 | v0.1 Draft |
| `features/digital-employee-team/infrastructure_contract_candidates.md` | 概念数据字段、存储职责和 HTTP 候选，不是已批准技术契约 | v0.1 设计输入草案 |
| `features/digital-employee-team/prototype/index.html`、`prototype/README.md` | 隔离 HTML 交互原型及打开方式、模拟范围、轻量走查与产品评估记录；供用户核对整体方向 | v0.1，产品内部复评通过，用户尚未确认 |
| `features/digital-employee-team/product_proposal.md` | 历史产品探索、用户讨论和公开竞品调研记录，当前功能与开放事项转由需求分析维护 | v0.2 历史探索稿 |
| `features/digital-employee-team/prototype/index.html`、`prototype/README.md` | 隔离静态交互原型与轻量走查/产品评估记录；无真实后端，用户尚未确认 | v0.1 交互草案 |
| `02-architecture.md` | 总体架构、核心机制（总线/审批/扇出）、模块设计、时序 | v1.3 |
| `03-test-cases.md` | 测试用例全集（TC-* 22 组）+ §23 浏览器黑盒 E2E 执行记录 | v1.2 |
| `04-lld.md` | 编码依据：目录树、DDL、REST/WS 协议、模块内部设计、错误矩阵 | v1.1 |
| `05-deploy.md` | 一键部署手册 + 故障速查（全部来自真实事故） | v1.1 |

现有 `02/03/04/05` 记录现有系统设计、历史测试和部署，不构成数字员工团队新能力已经设计、实现或验收的依据。待新业务边界与技术方案明确后，按实际影响同步版本及需求追溯。

## 维护规则

1. **版本联动**：01 版本变更（新决策 Dxx）→ 02/03/04 视影响同步升版；各文件头「变更说明」追加一行概要。
2. **决策先行**：功能范围/技术选型变更，先在 `01` 决策日志补条目（编号顺延，注明来源与日期），再动代码。
3. **事故入库**：每次真实故障，根因+处置落入 `05-deploy.md §4 故障速查`；涉及设计的同步固化进 `04-lld.md` 对应章节（标注「⚠ 教训」）。
4. **测试记录**：浏览器 E2E 每轮执行在 `03 §23` 追加结果（引用 gui-test-screenshots 编号）。
5. 编号体系（FR-/NFR-/BD-/D-/TC-/US-）一经分配不复用不改义。
