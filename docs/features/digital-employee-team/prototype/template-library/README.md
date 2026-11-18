# 数字员工模板库 · 交互原型 v0.1

浏览器直接打开 [index.html](index.html)。本设计对应 D41 与「同一模板导入多个 Skill」的补充要求，范围是已有模板时的列表及其主要入口。

- 桌面使用双列卡片，手机使用单列。卡片显示名称、示例职责、所含 Skill、版本与文件数。
- 可以按模板或 Skill 搜索。点开「开发马仔」，可在侧栏分别展开前端和后端 Skill，查看目录及附件。模板公共文件和工作指令也可在此查看。
- 新建、对话草稿、目录导入、编辑和保存使用页面内示例数据。刷新可恢复原始示例。

2026-11-18 使用 Chrome 走查桌面 1440 × 960 和手机宽度 390 × 844。已通过打开和返回、Skill 展开、搜索与无匹配、示例导入、两轮草稿及编辑保存的走查。截图见[桌面](../../../../../gui-test-screenshots/v20261118-template-library-design-desktop.png)、[手机](../../../../../gui-test-screenshots/v20261118-template-library-design-mobile.png)和[模板详情](../../../../../gui-test-screenshots/v20261118-template-library-design-detail.png)。

同日由产品视角代理按 D41 预评估，结论为可展示。用户随后要求按本原型一比一开发，作为本次实现的视觉与交互基线。

## 实现走查

2026-11-18 在浏览器对照原型和真实 Web 服务。相同四个模板下，1440 × 960 和 390 × 844 的每张卡片坐标与尺寸相同。详情侧栏能展开模板实际包含的 Skill，编辑提交后返回库并读取新版本。摘要来自已有工作指令或文本 Skill 描述，两者均为空时留空。真实模板数据、工作空间状态与提交反馈以服务返回为准。

前端 18 项单测、类型检查、生产构建和 7 项基础浏览器回归通过。另实测按 Skill 搜索、键盘关闭详情后恢复焦点、保存新版本、连续与批量导入。真实模型完成两轮模板草稿，浏览器明确保存后可在手机端从该模板创建员工。实现截图见[桌面](../../../../../gui-test-screenshots/v20261118-full-closure-catalog-desktop.png)、[详情](../../../../../gui-test-screenshots/v20261118-full-closure-catalog-detail.png)和[手机](../../../../../gui-test-screenshots/v20261118-full-closure-catalog-mobile.png)。

弹窗定位回归在旧版测得导入弹窗左上角为 `(0, 0)`。修复后在 Chrome 核对导入、新建、编辑在桌面及手机视口居中，390 × 500 下可滚动到保存按钮，详情抽屉仍位于右侧。[导入弹窗桌面截图](../../../../../gui-test-screenshots/v20261118-full-closure-catalog-import-dialog-desktop.png) · [手机截图](../../../../../gui-test-screenshots/v20261118-full-closure-catalog-import-dialog-mobile.png)
