# Gill 数字员工团队平台

通过对话生成员工模板与 Skills，在团队中创建专属员工，用 Prompt 定义协作，由模型派工、互相 @、核查并逐级升级问题。工作台以群聊为核心，右侧展示团队进度；团队详情管理组织树、员工挂载知识和项目库。

Java 负责身份、业务事务、版本与持久工作队列；Python 负责模型轮次、隔离沙箱及受控 Git；Vue 提供四个主入口。旧会话保留在 `#/legacy`。

- [需求与六条已批准政策](docs/features/digital-employee-team/requirement_analysis.md)
- [实现契约、结构与边界](docs/features/digital-employee-team/implementation.md)
- [验证记录](docs/features/digital-employee-team/verification.md)
- [产品验收与六项缺陷修改反馈](docs/features/digital-employee-team/acceptance_fix_feedback_20261117.md)
- [Java 网关](web/README.md) · [前端](web/frontend/README.md) · [Python 执行器](agent/README.md)
- [开发规范](AGENTS.md) · [部署配置](docs/05-deploy.md)

在 `deploy/.env` 配置服务凭据和标准模型 API 资源，运行：

```sh
cd deploy
docker compose up -d --build web agentd
```

打开 <http://localhost:8080>。凭据不入库。当前标准模型接口已恢复，两轮模板生成及三员工协作案例已完成实际续验，见[模型续验记录](docs/features/digital-employee-team/model_validation.md)。有限案例不代替完整业务或独立验收。
