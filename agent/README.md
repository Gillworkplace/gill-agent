# Python 执行器

旧会话由 `agentd.app.SessionRuntime` 与 `gill_core.loop` 维护。新团队路径独立：

`agentd.app → team_worker → team_turns → team_client / team_protocol / LLM / TeamGit → TeamSandbox / TeamObjects`。

`team_client` 只携带内部服务身份；`team_turns` 管理有效 Prompt、工具调用、检查点与控制；`team_sandbox` 是新运行的 CubeSDK 适配边界，资源 ID 持久化到 Java。模型和沙箱不接触网关/对象存储凭据。旧会话 SDK 适配仍在 `remote_sandbox`。

运行环境始终使用项目虚拟环境：

```sh
uv venv .venv
uv pip install --python .venv/bin/python -e '.[server,sandbox]'
.venv/bin/python -m unittest discover -s tests -v
.venv/bin/python -m agentd.app
```

内部队列需要 `GILL_TEAM_WEB_URL`、至少 32 字符的 `GILL_TEAM_WORKER_SECRET`，默认 3 个槽位；缺少服务凭据时停用新 Worker。Compose 已传递这些变量。模型配置包括 `ZHIPU_API_KEY`、`ZHIPU_MODEL`、可选 `ZHIPU_BASE_URL`，使用有合法标准 API 资源的端点。

测试范围及真实模型阻塞见[验证记录](../docs/features/digital-employee-team/verification.md)。细则见 [AGENT.md](AGENT.md)。
