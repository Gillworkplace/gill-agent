# 团队前端模块

遵守根 AGENTS.md 与 frontend/AGENT.md。入口及依赖见 frontend/README.md。

- 模型、执行或检查结果只来自 API，不使用模拟成功回执。
- 修改表单保留打开时 revision；轮询不得覆盖未保存输入或隐藏命令错误。
- 任务未知状态不能计为空闲，收到回复不能当作决定已应用。
- 新顶级入口需有产品依据；任务、执行核实和项目内容留在工作台或团队详情。
- 任何布局改动验证桌面与 390px 手机，运行 typecheck/build。
- 决定superseded不能显示已应用；编辑保留开始时的revision。通知和请求处理按requiresResponse明确提交，当前核查只取对应版本，旧评审不充当新版本通过。
