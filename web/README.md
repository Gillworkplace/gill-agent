# Java 网关

新团队接口按 `TeamController / TeamWorkerController → TeamService → TeamEngine → 下层策略` 编排；`TeamService → TeamMapper → TeamWorkspaceRow` 持久化。纯策略互不形成循环，公共任务快照与权限下沉到 `TaskAdoption / TaskAccess / TeamData`。

`V2__digital_teams.sql` 新增独立工作区、幂等请求、事件、持久工作项和动作回执，兼容 V1 数据。定义对象在每用户 JSONB 聚合中；租约和执行意图是独立关系表。所有外部模型、沙箱、MinIO 等待都在 Java 事务之外。

```sh
mvn test
mvn package
```

需要 Java 21。`TeamEngineTest` 为纯领域测试；`TeamPersistenceTest` 只有在 `GILL_TEAM_DB_TEST=1` 时运行，必须设置 `DB_URL` 指向独立测试数据库及相应凭据，测试通过真实 PostgreSQL 验证事务与租约。禁止指向业务数据库。

接口与状态见[实现契约](../docs/features/digital-employee-team/implementation.md)，前端见 [frontend/README.md](frontend/README.md)，规范见 [AGENT.md](AGENT.md)。
