# 数字员工团队需求验收设施

对应产品AC01～34和D38六条政策。实际结果与缺陷以[验收报告](../../../../docs/features/digital-employee-team/acceptance_20261117.md)为准；脚本存在不等于验收通过。本轮不修改产品实现。

从仓库根目录使用Node24执行。Python相关操作仅使用`agent/.venv/bin/python`。依赖现有Chrome（可用`CHROME_PATH`覆盖）、Docker服务及本地`deploy/.env`中的Worker凭据；绝不能输出或提交凭据。账户文件只存`/tmp`，权限0600。

## 隔离与顺序

1. 启动同一被测web镜像的专用18080实例，使用独立空数据库和同一Worker服务凭据；先不要启动消费该库的真实模型Worker。
2. `node web/frontend/tests/acceptance/api-cases.mjs`和`node web/frontend/tests/acceptance/control-cases.mjs`顺序运行。每例新账户，真实HTTP/PG，但Worker动作由脚本模拟，没有调用模型。用例结束会领取并结束该专用队列中的剩余fixture工作，**不得指向有其他工作的服务，亦不得同时运行真实Worker**。失败保留断言/事实并继续其他场景，进程最终非零退出。
3. `node web/frontend/tests/acceptance/browser-setup.mjs`创建新GUI数据，再执行`node web/frontend/tests/acceptance/browser-cases.mjs`。操作真实页面，桌面1440×1040、手机390×844，保存`gui-test-screenshots/v20261117-acceptance-*`。组织树为HTML5拖拽事件及选择器等效路径，不声称覆盖物理拖动。
4. 先运行`node web/frontend/tests/acceptance/model-cases-setup.mjs`准备全部模型fixture，再启动项目`run_team_workers`指向18080，2个槽。比较同事实的“纠错复核”和“先等用户决定”流程，并测试真实模板迭代。每run最多8/4次调用及600秒，无隐式重试。此时**禁止**运行步骤2/3或任何drain/claim脚本。通过API只读观察实际任务/产物/核查/决策；不替模型纠错、不追加额度、不自动答复人类决定，不重跑挑选最好结果。
5. 真实研发使用`ACCEPTANCE_URL=http://127.0.0.1:8080 node web/frontend/tests/acceptance/code-setup.mjs`新建独立账户及两需求，只有在该实例已授权且云清理器可见其数据库时执行。只读公开Git基线，不推远端；每run6次调用/900秒。不同数据库共享云沙箱会被主库清理器误认孤儿，不能拿这种失败当产品研发结论。
6. 只有代码fixture实际处于needs_reconciliation时，才执行`node web/frontend/tests/acceptance/unknown-ui.mjs`读取其8080工作台。测试未知状态显示，不自动核实或重放外部动作。

现有默认目标18080；`ACCEPTANCE_URL`只适用于已确认的隔离服务。脚本不负责创建数据库/启动Docker/开启真实模型Worker，以免一次误执行影响现有队列或自动产生费用。新一轮应使用新的专用数据库，不在已有失败队列上直接重放。

## 证据与判定

协议结果写`/tmp/gill-acceptance-results.jsonl`，浏览器尝试写`/tmp/gill-acceptance-browser-results.jsonl`；保留首次失败与设施纠正，导出时去除登录密码、JWT、密钥。模型fixture文件有凭据，不得原样作为证据提交；报告中的结构化JSON只保存合成输入、真实输出、状态、版本、使用量/时间、关联ID和断言结果。

真实模型两轮模板由本轮按`template.generate`→等busy=false→第二轮generate→预览→明确`template.save`操作；事实在报告/证据中，未伪装为C04的手动GUI保存覆盖了真实模型。研发网络阻断后，后续真实Git合并分支保持未执行。测试设施修正不属于产品修复；本轮所有产品缺陷仍开放。

结束时停止自己的Worker和18080实例，按确切ID清理测试云沙箱/未用种子归档；保留PG失败事实，删除临时凭据文件。主应用和真实团队保留。

## F01～F06修改后的开发回归

沿用原A/B用例，不放宽旧失败断言。新独立数据库先执行协议，再准备GUI数据并运行`repair-browser-cases.mjs`：原7项加通知无派工、失效决定、当前/历史核查、失效上级异常及已完成工作引用续接，共12项，截图前缀v20261117-repair-*。用例组间保留60秒间隔以遵守现有限流，续接使用独立新账号；不要在真实Worker运行期间执行这些带claim的设施。

模型对照沿用原model-cases-setup，不改业务Prompt取较好回答；另以无仓库的当前项目文档归档任务检查archive_document实际保存/来源/完成。等待案例用两次只读投影核对超过60秒无额外调用，不能靠睡眠或模型自称证明。当前源码程序测试、所有首次结果、模型上限内未收尾和未复验范围见[修改反馈](../../../../docs/features/digital-employee-team/acceptance_fix_feedback_20261117.md)。这些是开发整合验证，不能代测试/产品正式重验。
