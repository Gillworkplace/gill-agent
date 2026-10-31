# web/AGENT.md — Java Web 网关模块

## 职责

浏览器与 CLI 的统一入口：REST API（认证/空间/会话/文件/知识库/扩展/PAT/管理）、WebSocket 网关（SSE→WS 事件扇出 + WS 上行转 agentd）、文件预签名直传（MinIO）、JWT/PAT 鉴权与限流、初始管理员与空闲会话回收。无状态，支持多副本（D5）。

## 结构（目标态，D14 分层规范）

```
web/
 ├─ pom.xml                     # 依赖含 mybatis-plus-boot-starter
 ├─ Dockerfile                 # 三阶段：node:20 前端构建 → maven 打 jar → JRE 21 运行
 ├─ frontend/                  # 见 web/frontend/AGENT.md（构建产物输出至 src/main/resources/static/）
 └─ src/main/
     ├─ java/com/gill/web/
     │   ├─ Application.java / WsConfig.java / WsAuthBridge.java
     │   ├─ config/    # WebInit（initAdmin/空闲回收/SPA fallback）、GillProperties、MybatisPlusConfig
     │   ├─ security/  # JwtUtil(HS256)、JwtFilter（JWT+PAT gpat_+限流 60/min）
     │   ├─ controller/ # Auth/Space/File/Knowledge/Extension/Pat/Admin —— 只做校验与包装
     │   ├─ service/    # 业务逻辑与事务边界（@Transactional）
     │   ├─ repo/       # Mapper 接口（MyBatis-Plus BaseMapper + 自定义方法）
     │   ├─ entity/     # 表实体（@TableName，驼峰 ↔ 下划线自动映射）
     │   └─ ws/        # AgentWebSocketHandler（conns 扇出 + SSE 泵）
     └─ resources/
         ├─ application.yml     # 环境变量注入（DB/JWT/INIT_ADMIN/EXT_SECRET/MINIO_*）
         ├─ mapper/             # MyBatis XML（复杂 SQL 唯一归宿）
         └─ migration/V1__init.sql   # 14 张表 DDL（Flyway）
```

## 关键约束（违反即事故）

1. **分层依赖（D15 铁律）**：只允许上层依赖下层（ws/controller → service → repo → entity），**禁止下层 import 上层、禁止循环依赖**；security/config 为横切层，不得依赖业务层。提交前自检（应无输出）：
   ```bash
   grep -rn "com.gill.web.controller\|com.gill.web.ws" web/src/main/java/com/gill/web/{service,repo,entity}/
   grep -rn "com.gill.web.service" web/src/main/java/com/gill/web/repo/
   ```
2. **ORM 分工（D14）**：简单单表 CRUD 用 MyBatis-Plus（BaseMapper/LambdaQueryWrapper）；**多条件、关联查询（JOIN）、聚合、动态 SQL 一律 MyBatis XML 手写 SQL**，禁止 Wrapper 硬拼复杂逻辑；**禁止新增 JdbcTemplate**（存量随迭代迁移）。
3. **SSE 泵生命周期**：一会话一泵；末连接断开必须 `Stream.close()` 关 body 流（`cancel(future)` 无效——future 响应头到达即完成）。僵尸泵 = 事件 N 倍投递。
4. **认证与业务异常分离**：`chain.doFilter` 不进认证 try 块；控制器异常不得伪装 401。
5. **预签名 URL**：出口必须经 `MINIO_PUBLIC_ENDPOINT` 替换内网 `minio:9000`（浏览器直传/下载可达性）；uploads 强校验 sessionId。
6. **SQL 书写**：XML 用 `#{}` 预编译（禁 `${}` 拼接，白名单动态排序除外并注释）；PG 强转 `#{x}::uuid`；`text[]` 聚合 `array_to_string`。

## 常用命令

```bash
# 本地构建+起栈（在 deploy/ 下）
docker compose up -d --build web
# 看日志 / 初始管理员密码（随机生成时）
docker logs gill-web-1
# JAR 内静态资源核对
unzip -l target/gill-web-0.1.0.jar | grep static
```

## 环境变量（compose 注入）

`DB_URL / POSTGRES_PASSWORD / JWT_SECRET / INIT_ADMIN_USERNAME / INIT_ADMIN_PASSWORD / EXT_SECRET(64hex，与 agentd 一致) / AGENTD_URL / MINIO_ENDPOINT / MINIO_PUBLIC_ENDPOINT / MINIO_ROOT_USER / MINIO_ROOT_PASSWORD`
