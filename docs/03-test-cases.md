# 测试用例设计文档 — Gill Agent（企业级）

| 项 | 内容 |
|---|---|
| 文档版本 | v1.16（CLI 目录选择与 Git 设置回归） |
| 编写日期 | 2026-10-16（v1.2 修订 2026-10-18；v1.3 补记 2026-11-17） |
| 关联文档 | 《01-需求澄清 v1.5》《02-总体架构与模块设计 v1.3》 |
| 变更说明 | v1.1：新增文件（MinIO）、管理后台、可观测性、配额、扩展性（多副本）、备份恢复用例组。v1.2：新增 §23 浏览器黑盒 E2E 三轮执行记录（API 级 E2E 之外补 UI 层覆盖）。v1.3：追加 §23.4 静态原型 v0.7 轻量走查，明确不属于真实团队运行验收。v1.5：追加§23.7真实需求验收、开放缺陷和未验证范围 |

---

## 1. 测试环境与工具

| 项 | 说明 |
|---|---|
| 被测系统 | docker compose（web×N / agentd×N / postgres / redis / minio，+可选 nginx/prometheus/grafana）+ 沙箱专用机 39.107.34.109 CubeSandbox（4C/7.1G/69G，验收口径 3 并发稳定/最低 2，见需求文档 D7/D9） |
| 验收浏览器 | 本机 Chrome / Edge 最新版（`http://localhost:8080`，或启用 edge profile 后 `http://localhost`） |
| 辅助工具 | curl/httpx（REST）、wscat/Python websockets（WS）、redis-cli、mc（MinIO 巡检）、cubemastercli（沙箱巡检）、docker stats、Prometheus/Grafana、sha256sum |
| 测试账号 | `alice/A123456!`、`bob/B123456!`（USER）；`admin/`（ADMIN，env 初始化） |
| LLM | 功能测试走真实智谱接口；压测/故障注入用 mock LLM（`ZHIPU_BASE_URL` 指向本地 mock，剧本化返回工具调用） |

**编号规则**：`TC-<组>-<序号>`；优先级 P0（验收必过）/P1/P2。每组用例含前置、步骤、预期。

## 2. 部署与冒烟（TC-DEPLOY）

| 编号 | 优先级 | 用例 | 步骤 / 预期 |
|---|---|---|---|
| TC-DEPLOY-01 | P0 | Cube 部署健康（沙箱机） | 前置：沙箱机 39.107.34.109 已核验（4C/7.1G/空闲 64G/Ubuntu 24.04.2/无 /dev/kvm→PVM/端口全空闲/RTT 39ms，见需求 D9）。部署后：`cubemastercli sandbox overview` 正常；`sandbox-code` 与 `gill-browser` 模板 **READY**；模板资源限制为 1C/768M；全局沙箱上限=3 生效；4G swap 已建 |
| TC-DEPLOY-06 | P0 | 沙箱机资源基线 | 平台底座组件（mysql/etcd/nomad/cubelet/cubemaster/CubeProxy）合计 RSS ≤1G；swap 不持续增长；`dmesg` 无 OOM kill 记录；本机→39.107.34.109:3000 可达、RTT 实测 ≤50ms（首测 39ms 达标）、出向带宽（帧流方向）≥6Mbps |
| TC-DEPLOY-02 | P0 | 模板含浏览器 | 以 `gill-browser` 手动建沙箱：`chromium --version` 有输出；沙箱内 `curl 127.0.0.1:9222/json/version` 返回 JSON；随后销毁 |
| TC-DEPLOY-03 | P0 | 远端 SDK 连通 | 容器内设置 E2B env 后：Sandbox 创建 → `commands.run("echo hi")` → kill()，全程 ≤10s |
| TC-DEPLOY-04 | P0 | compose 一键起 | `docker compose up -d --build`（代理 host.docker.internal:7890）：web/agentd/pg/redis/minio 全 healthy；minio-init 完成（三桶存在、exports 7 天 ILM 生效）；访问 8080 出登录页；首启自动创建 admin |
| TC-DEPLOY-05 | P1 | 代理配置生效 | 关闭 Allow LAN 重建：构建给出明确失败（不静默直连超时）；NO_PROXY 验证：web→pg/redis/minio、agentd→ECS 3000 不走代理（代理访问日志无记录） |

## 3. 认证与账号（TC-AUTH）

| 编号 | 优先级 | 用例 | 步骤 / 预期 |
|---|---|---|---|
| TC-AUTH-01 | P0 | 注册/重复注册/登录/错密 | 同 v1.0：注册 200（bcrypt 入库）；重复 4xx；登录得 JWT；错密 401 |
| TC-AUTH-02 | P0 | 登录锁定 | 连错 5 次 → 锁 15 分钟（期间正确密码也 401，提示锁定）；锁定计数在 Redis（其他 web 副本同样生效） |
| TC-AUTH-03 | P0 | 无/伪 token 拒绝 | REST 401；WS 握手拒绝 |
| TC-AUTH-04 | P0 | 禁用即时失效 | ADMIN 禁用 alice → alice 存量 JWT 全部 401、WS 被断开（FR-13） |
| TC-AUTH-05 | P1 | token 过期 | 过期 token → 401 → 前端跳登录 |
| TC-AUTH-06 | P0 | RBAC 边界 | alice 调 `/api/admin/**` → 403；admin 可调 |
| TC-AUTH-07 | P1 | 初始 admin | 首启按 env 创建 admin（仅一次），可登录后台 |

## 4. 多账号隔离（TC-ISO）【核心验收 1】

| 编号 | 优先级 | 用例 | 步骤 / 预期 |
|---|---|---|---|
| TC-ISO-01 | P0 | 会话/消息隔离 | A、B 会话互不可见；A 用 B 的 sessionId 访问 REST/WS → 403+审计 |
| TC-ISO-02 | P0 | 文件系统隔离 | A 写 a.txt；B 读不到；两会话 sandbox_id 不同 |
| TC-ISO-03 | P0 | 进程隔离 | A `sleep 300`；B `ps` 无此进程 |
| TC-ISO-04 | P0 | 浏览器/画面隔离 | A 开 example.com 投屏；B 投屏只见自己页面；Cookie 互不可见（B 访问同 URL 呈未登录态） |
| TC-ISO-05 | P0 | **MinIO 对象隔离** | A 上传文件得到对象键；B 无法通过任何接口列出/下载 A 的对象；B 猜测 A 的 downloadUrl（已过期/伪造签名）→ 403 |
| TC-ISO-06 | P1 | 审计归属 | 上述操作审计 user/session 归属正确无串号 |

## 5. Agent 对话与沙箱执行（TC-CHAT / TC-SB）【核心验收 3】

| 编号 | 优先级 | 用例 | 步骤 / 预期 |
|---|---|---|---|
| TC-CHAT-01 | P0 | 端到端代码任务 | "创建 hello.py 打印时间并运行"：流式输出、终端实时回显、结果返回；command_audit 带 sandbox_id |
| TC-CHAT-02 | P0 | 状态跨轮保留 | 后续"读取 hello.py"成功（沙箱复用） |
| TC-CHAT-03 | P0 | 全量落沙箱 | 审计每条命令带 sandboxId；web/agentd 容器内无用户进程/文件痕迹 |
| TC-CHAT-04 | P0 | 任务中断 | stop → 沙箱命令 kill，可继续新任务 |
| TC-CHAT-05 | P1 | 轮次/命令超时 | MAX_ROUNDS=25 终止；`sleep 120` 60s 被杀回传超时 |
| TC-CHAT-06 | P1 | LLM 异态 | mock 429/超时 → 退避重试后可读错误，会话不崩；llm_usage 不计失败 |
| TC-CHAT-07 | P1 | 同会话单任务 | 并发双发任务 → 后者被拒/排队（分布式锁 FR-37） |
| TC-CHAT-08 | P1 | CLI 一致性 | `gill chat` 同样落沙箱执行；CLI 下 suggest 档审批为终端 y/n 交互（含 120s 超时） |
| TC-CHAT-09 | P0 | 审批-suggest 拦截 | 会话切 suggest 档，任务含高危命令（如 `rm -rf /tmp/x`、`curl xx | sh`）→ 页面弹审批卡片（含风险等级与理由）；**未批准前沙箱无执行痕迹**（审计无该命令、沙箱内无副作用） |
| TC-CHAT-10 | P0 | 审批-批准/拒绝/总是允许 | 批准→命令执行且审计含决策人与延迟；拒绝→任务安全终止可继续新任务；always_allow→本会话同类命令免批、新会话恢复询问 |
| TC-CHAT-11 | P1 | 审批超时 | 120s 无响应自动 deny 并提示；任务可重发；auto 档全程无拦截但仍全量审计 |
| TC-SB-01 | P0 | 懒创建/销毁 | 首消息建沙箱；关会话 → set_timeout 生效回收；overview 无残留 |
| TC-SB-02 | P1 | 空闲回收与恢复 | 30min 空闲回收；再发消息重建空沙箱并提示 |
| TC-SB-03 | P1 | 沙箱故障恢复 | 手动 kill 沙箱 → 自动重建，会话可用 |
| TC-SB-04 | P1 | 全局并发排队 | 沙箱达上限 3 → 新任务排队，有空位自动继续（升配后按 50 回归） |
| TC-SB-05 | P0 | 3 并发沙箱稳态 | 3 个会话同时跑任务+投屏 10min：均正常、无 OOM、带宽与内存峰值记录在案（最低通过线：2 并发稳定）；上限 3 时第 4 个请求正确排队且前三个不受影响 |

## 6. CDP 浏览器与画面同步（TC-CDP）【核心验收 2】

| 编号 | 优先级 | 用例 | 步骤 / 预期 |
|---|---|---|---|
| TC-CDP-01 | P0 | 首帧 ≤3s | 任务打开 example.com + 开预览 → ≤3s 首帧 |
| TC-CDP-02 | P0 | 画面随操作同步 | Agent 导航新站点 → ≤2s 画面变化 |
| TC-CDP-03 | P0 | 用户交互回注 | 预览区点击/输入 → 页面真实响应 |
| TC-CDP-04 | P0 | 坐标映射 <5% | 刻度页验证（FR-44） |
| TC-CDP-05 | P0 | 帧元数据 | 二进制帧前有 screencast_meta 且与视口一致 |
| TC-CDP-06 | P1 | 停止投屏/断流 | preview_stop 流量归零；关会话停流+销毁 |
| TC-CDP-07 | P1 | Agent+用户混用 | 同时操作均生效不互踢 |
| TC-CDP-08 | P1 | 多副本投屏 | web×2 下开预览 → 经由总线任一副本都能收到帧（含 resync 补帧） |
| TC-CDP-09 | P2 | 中文渲染 | CJK 字体无豆腐块 |

## 7. 文件管理（TC-FILE，MinIO）【企业级新增】

| 编号 | 优先级 | 用例 | 步骤 / 预期 |
|---|---|---|---|
| TC-FILE-01 | P0 | 小文件上传全链路 | 前置：alice 会话。上传 10MB CSV：申请预签名 → PUT 直传 → complete 核验 → file_objects=UPLOADED+审计；**web/agentd 内存无增长**（docker stats 验证直传不中转） |
| TC-FILE-02 | P0 | 同步进沙箱 | 对 TC-FILE-01 文件 sync-in：进度事件 → synced；对话"统计上传 csv 的行数"Agent 经 workspace_files/materialize 自动完成；沙箱内 sha256 与本地一致 |
| TC-FILE-03 | P0 | 导出下载 | 任务"生成 result.csv"后导出：file_exported 事件带 downloadUrl → 浏览器下载内容 sha256 与沙箱内一致；MinIO exports/ 出现对象；file_objects 记录 |
| TC-FILE-04 | P1 | 大文件 | 上传 500MB（≤上限，直传成功）；同步 200MB 边界：200MB 成功、201MB 被拒并提示（FR-68）；期间 agentd 内存增量 ≤32MB（8MB 缓冲流式） |
| TC-FILE-05 | P0 | 配额 | 将 alice 配额调小 → 上传超出 5GiB 默认值（或调小后）→ 申请预签名时 4xx 提示配额不足；ADMIN 可改配额后恢复 |
| TC-FILE-06 | P0 | 文件名安全 | 文件名 `../../etc/passwd`、超长名、控制字符 → 净化或拒绝；沙箱内同步路径无穿越（目标仅工作区内） |
| TC-FILE-07 | P1 | 预签名时效 | PUT URL 15min 后使用 → 403；GET URL 30min 后 → 403 |
| TC-FILE-08 | P1 | 文件树/删除 | 上传件+沙箱生成文件统一展示；删除上传件（PG+MinIO 同删+审计）；沙箱侧 file_delete 生效 |
| TC-FILE-09 | P1 | 生命周期 | 模拟/等待 exports 过期（ILM 或清理任务）→ 对象被移除、file_objects=EXPIRED |
| TC-FILE-10 | P2 | 并发传输 | 10 用户并发 100MB 同步/导出 → 全部成功，全局并发上限生效（第 11 个排队） |
| TC-FILE-11 | P0 | 文件类型双模式管控（BD-2） | 黑名单模式：.exe/.docm 拒绝，且**改扩展名伪装（魔数校验命中 PE/OLE2 特征）仍拒绝**；ADMIN 切白名单模式后仅放行声明类型；两种模式配置即时生效并有审计 |

## 8. 管理后台（TC-ADMIN）

| 编号 | 优先级 | 用例 | 步骤 / 预期 |
|---|---|---|---|
| TC-ADMIN-01 | P0 | 用户管理 | admin 查询/禁用/启用/重置密码 alice；重置后 alice 用新密码登录成功、旧密码失效 |
| TC-ADMIN-02 | P0 | 会话治理 | admin 查询在线会话列表 → 强制终止 bob 会话：bob 侧收到 session_status closed，沙箱销毁 |
| TC-ADMIN-03 | P1 | 审计查询/导出 | 按用户/时间/类型过滤（命令/登录/文件）与 DB 一致；CSV 导出可打开且行数相符 |
| TC-ADMIN-04 | P0 | 平台总览 | 在线数（presence）、活跃会话/沙箱数、今日 token 与费用、存储用量与实际一致（人工比对 PG/Redis/Cube） |
| TC-ADMIN-05 | P1 | 非越权 | alice 访问 admin 页面/API → 403（前端隐藏+后端拦截） |
| TC-ADMIN-06 | P1 | 审计保留与归档（BD-1） | 保留期 365 天策略生效：构造过期数据 → 清理前可按月导出 CSV，清理后审计页不可查；消息/llm_usage 不受影响 |

## 9. 配额与限流（TC-QUOTA）

| 编号 | 优先级 | 用例 | 步骤 / 预期 |
|---|---|---|---|
| TC-QUOTA-01 | P0 | 日 token 配额 | 调小 alice 日配额 → 触发任务拒绝并提示剩余额度；admin 可调大恢复；llm_usage 累计口径正确 |
| TC-QUOTA-02 | P1 | API 限流 | 高频调用 REST → 429（Retry-After）；窗口恢复后放行；限流计数跨 web 副本生效 |
| TC-QUOTA-03 | P1 | 并发上限 | 单用户 WS>3 / 会话>2 被拒；全局沙箱>50 排队 |

## 10. 可观测性（TC-OBS）

| 编号 | 优先级 | 用例 | 步骤 / 预期 |
|---|---|---|---|
| TC-OBS-01 | P0 | 指标端点与覆盖 | `/actuator/prometheus`、agentd `/metrics` 可抓取；架构文档 §8 所列关键指标存在且有数（跑一轮任务+投屏后） |
| TC-OBS-02 | P0 | traceId 贯穿 | 一次任务：web 日志 → cmd 信封 → agentd 日志 → messages.trace_id 同一 traceId，可 grep 串联 |
| TC-OBS-03 | P1 | 结构化日志 | 日志均为 JSON 且含 level/ts/traceId/userId/sessionId/node |
| TC-OBS-04 | P2 | Grafana 看板 | profile obs 启动后：看板展示连接/会话/帧丢弃/token/存储等面板（无空图） |

## 11. 多节点扩展性（TC-SCALE）【D5 硬性要求】

| 编号 | 优先级 | 用例 | 步骤 / 预期 |
|---|---|---|---|
| TC-SCALE-01 | P0 | 双副本功能回归 | `--scale web=2 --scale agentd=2 --profile edge`：全量 P0 核心用例（AUTH/ISO/CHAT/CDP/FILE 抽样）回归通过 |
| TC-SCALE-02 | P0 | 无粘性验证 | 同一浏览器会话请求/WS 分布到不同 web 副本（node_id 观测）：功能无差异（无状态验证 NFR-09） |
| TC-SCALE-03 | P0 | agentd 故障接管 | alice 任务运行中 kill 持有其 lease 的 agentd 副本 → lease 过期后另一副本 XAUTOCLAIM 接管：任务标记 interrupted 且可重发成功，沙箱未销毁；期间 bob 不受影响 |
| TC-SCALE-04 | P1 | web 副本摘除 | kill 一个 web 副本 → 其 WS 客户端断线重连另一副本，历史+状态恢复，投屏 resync ≤3s 恢复 |
| TC-SCALE-05 | P1 | 优雅停机 | 对副本发 SIGTERM → 停新请求、WS 通知、任务到检查点退出（≤15s）；重启后会话延续（FR-84） |

## 12. 性能与稳定性（TC-PERF）

| 编号 | 优先级 | 用例 | 步骤 / 预期 |
|---|---|---|---|
| TC-PERF-01 | P0 | 3 并发沙箱会话 | 3 账号并发混合任务（mock LLM 剧本）：全完成、无 5xx、无串扰、沙箱机无 OOM；**（SC 阶段）沙箱机升配后以 50 并发回归本用例** |
| TC-PERF-02 | P0 | 200 WS + 3 投屏 | 保活 10min：无掉线风暴；各副本线程/连接平稳（WS 连接在本地、不依赖 ECS 规格） |
| TC-PERF-03 | P0 | 内存上限（双侧） | 本地：web ≤1.5GB/副本、agentd ≤1GB/副本，结束 10min 无持续增长；沙箱机：平台底座+沙箱合计不触发 OOM kill、swap 使用记录在案 |
| TC-PERF-04 | P1 | 延迟与带宽 | 命令回显 P95 ≤1s（本地→云沙箱链路）；投屏端到端 P95 ≤500ms、首帧 ≤3s（帧打时间戳）；3 路并发投屏时 ECS 出带宽实测 ≥6Mbps（不足验证降帧策略生效：帧率/质量自适应下降） |
| TC-PERF-05 | P1 | 慢客户端背压 | 64KB/s 客户端开投屏 10min：服务内存不涨（frame_drop_total 增长）、事件通道无丢失（对话照常完成） |
| TC-PERF-06 | P2 | 30min 长稳 | 50 会话轮询 + 10 投屏 + 周期文件传输：错误率不升、无 FD/内存泄漏 |
| TC-PERF-07 | P2 | 扩展线性度 | 双副本对比单副本：吞吐/连接容量近似 ×2（±20%） |

## 13. 安全（TC-SEC）

| 编号 | 优先级 | 用例 | 步骤 / 预期 |
|---|---|---|---|
| TC-SEC-01 | P0 | 密钥不泄漏 | 页面/接口/WS/JS bundle 中无 ZHIPU/E2B/MinIO/JWT 密钥与内部地址 |
| TC-SEC-02 | P0 | 密码与 JWT | bcrypt 入库；伪造/篡改 JWT 全 401 |
| TC-SEC-03 | P1 | 审计完整性 | 抽样 10 条命令/文件操作与审计一一对应 |
| TC-SEC-04 | P2 | 沙箱网络面 | 沙箱内 curl 内网（pg/redis/minio 地址）→ 不通（仅公网出方向） |

## 14. 备份恢复（TC-DR）

| 编号 | 优先级 | 用例 | 步骤 / 预期 |
|---|---|---|---|
| TC-DR-01 | P1 | 备份与恢复演练 | 执行 backup.sh → MinIO backup 桶出现 dump → 新起空 PG 恢复 → 用户/会话/审计数据完整可用 |

## 15. 端到端验收场景（TC-E2E，演示脚本）

| 编号 | 场景 | 步骤 |
|---|---|---|
| TC-E2E-01 | 多账号隔离演示 | alice 建会话写文件、上传数据文件、开 example.com 投屏 → bob 登录验证：会话/文件/浏览器/MinIO 对象全部隔离 |
| TC-E2E-02 | 浏览器 Agent 演示 | "打开 news.ycombinator.com 点第一条评论链接并告诉我标题"：画面全程同步，用户中途手工点一次（交互回注），返回正确标题 |
| TC-E2E-03 | 沙箱执行演示 | 系统命令+pip install+python 任务：审计展示 sandbox_id、本机容器无痕迹；关会话展示沙箱回收 |
| TC-E2E-04 | 数据分析演示（企业级） | 上传 sales.csv → "按月汇总并画柱状图保存为 chart.png" → 导出下载 chart.png 本地可打开：覆盖文件上传/同步/Agent 分析/导出全链路 |
| TC-E2E-05 | 平台治理演示（企业级） | admin 后台：查看在线/用量总览 → 禁用一个违规账号（其会话即时失效）→ 导出当日审计 CSV；Grafana 展示实时指标 |

## 16. 验收标准映射与通过定义

| 验收项 | 必过用例 |
|---|---|
| 核心 1：浏览器登录 + 账号空间隔离 | TC-AUTH-01/03/04/06、TC-ISO-01~05、TC-E2E-01 |
| 核心 2：CDP 浏览器操作 + 画面同步 | TC-CDP-01~05、TC-E2E-02 |
| 核心 3：命令全量接入 e2b 沙箱 | TC-DEPLOY-03、TC-CHAT-01/02/03、TC-SB-01、TC-E2E-03 |
| 企业级：文件（MinIO） | TC-FILE-01~07、TC-E2E-04 |
| 企业级：后台/配额/观测/审批 | TC-ADMIN-01~04/06、TC-QUOTA-01/02、TC-OBS-01/02、TC-CHAT-09/10、TC-FILE-11 |
| 企业级：横向扩展 | TC-SCALE-01~03 |
| **核心 4：知识库闭环** | TC-KB-01~10（沉淀/作用域/去重/检索/管理/降级） |
| **核心 5：扩展体系** | TC-EXT-01~10（HTTP/脚本/技能/MCP/安全） |
| **核心 6：CLI 完整功能** | TC-CLI-01~08（登录/chat/run/双端互通） |
| **核心 7：协作空间闭环** | TC-COLLAB-01~14（空间/同步/操作权/组级资源/治理） |
| **产品体验** | TC-UX-01~06（黄金5分钟/三态/主题/键盘/响应式/URL） |
| 质量门槛 | TC-PERF-01/02/03、TC-SEC-01/02、TC-DR-01 |

**通过定义**：P0 100% 通过；P1 ≥90% 且无阻断缺陷；P2 不设门槛。缺陷分级：S1 功能不可用/隔离失效/数据丢失/泄密（阻断验收）、S2 主流程可用的降级或性能不达标、S3 体验类。

## 17. 自动化分层

- **TU**：gill_core（loop/tools/bus/files 用 mock LLM+mock 沙箱+fakeredis+minio-mock）；web（JWT/RBAC/配额/文件名净化/总线信封）。
- **TI（集成，脚本化）**：TC-DEPLOY-03/04、TC-SB、TC-CHAT、TC-FILE-01~03、TC-QUOTA-02（Python 驱动 REST+WS+redis 断言事件序列）。
- **TE（端到端）**：TC-ISO/TC-CDP/TC-E2E 脚本驱动 + 画面人工确认。
- **TP/S（性能/稳定性）**：TC-PERF/TC-SCALE 全脚本化（asyncio 并发、docker kill 故障注入），报告存 `scripts/reports/`。

## 18. 知识库（TC-KB，v1.4）【核心验收 4】

| 编号 | 优先级 | 用例 | 步骤 / 预期 |
|---|---|---|---|
| TC-KB-01 | P0 | 自动沉淀-偏好 | 会话 A 纠正"统一用 uv"→提示条出现+条目入库(scope=user, type=preference)；新会话装依赖任务直接用 uv且回复体现来源（US-11） |
| TC-KB-02 | P0 | 纠错跨会话生效 | 沉淀纠错后开新会话验证同类任务不重犯；命中条目 hit_count+1（US-12） |
| TC-KB-03 | P0 | 显式记住/忘掉 | "记住X"必存；"忘掉X"命中多条时列出供选，确认删除后 Agent 不再引用（US-15） |
| TC-KB-04 | P0 | project 作用域 | 会话挂项目标签 P1 沉淀项目知识；同 P1 新会话自动注入；P2 会话/无标签不注入（US-13） |
| TC-KB-05 | P0 | 去重与版本 | 重复"记住"相似内容（>0.92）→ 版本+1 而非新条目；版本历史可回看 diff |
| TC-KB-06 | P1 | 检索预算与优先级 | 构造 20 条命中 → 注入仅 top-8/≤2000 token；session>project>group>user 排序正确 |
| TC-KB-07 | P1 | 90 天降权 | 构造 last_used_at=100 天前条目 → 不在注入结果；hit 后恢复 |
| TC-KB-08 | P0 | 管理页/CLI | 知识库页 CRUD/搜索/筛选/置顶/来源跳转；`gill knowledge list/search/add/rm/export/import` 全可用（US-14） |
| TC-KB-09 | P1 | 导入导出往返 | 导出 JSON → 新账号导入 → 条目无损；相似冲突按策略提示（US-16） |
| TC-KB-10 | P1 | embedding 降级 | mock embedding 接口 5xx → 沉淀走关键词入库（embedding 空+补算任务）、检索回退关键词，任务不受阻 |

## 19. 扩展体系（TC-EXT，v1.4）【核心验收 5】

| 编号 | 优先级 | 用例 | 步骤 / 预期 |
|---|---|---|---|
| TC-EXT-01 | P0 | HTTP 工具表单接入 | 表单建 query_ticket → 对话"查工单T-1024"命中调用 → 结果返回；调用在沙箱内 curl（审计带 sandboxId）；全程 ≤3 分钟（US-17/NFR-12） |
| TC-EXT-02 | P0 | 域名白名单 | 调用未声明域名 → EXT-8102 拒绝并提示加白方式；manifest 增加域名后放行 |
| TC-EXT-03 | P0 | OpenAPI 导入 | 粘贴 OpenAPI 片段 → 批量生成工具；参数 Schema 正确进入工具定义 |
| TC-EXT-04 | P0 | 脚本工具 | 上传 calc_fee.py+Schema → "寄3kg到杭州"调用成功；脚本在沙箱执行（审计）；结果>64KB 截断（US-18） |
| TC-EXT-05 | P0 | 技能安装与触发 | Git 安装技能（SKILL.md 解析预览）→ 相关任务自动触发；`/skill 名称`显式触发；禁用后不再触发（US-19） |
| TC-EXT-06 | P0 | MCP 挂载 | 配 SSE MCP → 工具清单自动出现（mcp_{server}_{tool}）；对话调用成功；server 停掉→扩展标红+工具摘除，恢复自动回归（US-20） |
| TC-EXT-07 | P1 | 提示词扩展 | 个人指令+GILL.md 同时生效不冲突；改语气立即生效（US-21） |
| TC-EXT-08 | P0 | manifest 校验 | 非法 manifest（坏 name/越权域名/缺字段）→ EXT-8101 行号级错误提示 |
| TC-EXT-09 | P1 | 命名冲突 | 扩展工具与内置重名 → 禁用并提示改名，不静默覆盖 |
| TC-EXT-10 | P0 | 测试运行与安全 | 扩展中心"测试运行"即时试跑展示脱敏请求/响应；密钥保存后任何接口/日志/前端不回显明文 |

## 20. Agent CLI（TC-CLI，v1.4）【核心验收 6】

| 编号 | 优先级 | 用例 | 步骤 / 预期 |
|---|---|---|---|
| TC-CLI-01 | P0 | 登录与凭证 | `gill login --token <PAT>`；credentials 600 权限；PAT 吊销后即时报 AUTH-1006 |
| TC-CLI-02 | P0 | chat 全流程 | 交互对话：流式 md、审批 y/n/a、Ctrl+C 一次中断任务两次退出、--resume 续会话 |
| TC-CLI-03 | P0 | run 脚本化 | `gill run task.md --json --yes`：JSON schema gill.run.v1 字段完整；退出码 0/1/2 语义正确；非 TTY 无色无 spinner（US-23） |
| TC-CLI-04 | P0 | 文件与知识 | `gill file upload/download/ls`、`gill knowledge` 六子命令对同一账号数据生效 |
| TC-CLI-05 | P0 | 双端互通 | CLI 发起的会话/上传/知识/扩展在 Web 同账号可见可用；`gill chat --web` 链接可打开（US-24/22） |
| TC-CLI-06 | P1 | 配置三层 | env > 项目 .gill/config.toml > ~/.gill/config.toml 优先级；`config list` 标注来源 |
| TC-CLI-07 | P1 | doctor/completion | doctor 检出断网/坏凭证/沙箱不可达并给建议；completion 三 shell 生成可加载 |
| TC-CLI-08 | P2 | 跨平台 | Windows Git Bash / WSL / Linux 各跑通 chat+run |

## 21. Web 体验走查（TC-UX，v1.4）

| 编号 | 优先级 | 用例 | 步骤 / 预期 |
|---|---|---|---|
| TC-UX-01 | P0 | 黄金 5 分钟 | 新用户注册→示例任务出结果 ≤2 分钟/≤3 次点击（US-01/NFR-11） |
| TC-UX-02 | P0 | 三态全覆盖 | 逐页核查空态/加载/错误态（会话/文件/知识/扩展/聊天/后台）文案口语化 |
| TC-UX-03 | P0 | 主题与规范 | 亮/暗/跟随系统切换即时生效；设计 token 无硬编码色；组件行为与组件库一致 |
| TC-UX-04 | P0 | 键盘可达 | 快捷键表全可用；纯键盘完成 发任务→停止→切会话；? 面板呼出 |
| TC-UX-05 | P1 | 响应式 | 1280 全功能；768 面板折叠为 Tab 可用 |
| TC-UX-06 | P1 | URL 规范 | 任意页面刷新不 404；会话/知识库/扩展中心 URL 可分享（权限校验后） |

## 22. 协作空间（TC-COLLAB，v1.4）【核心验收 7】

| 编号 | 优先级 | 用例 | 步骤 / 预期 |
|---|---|---|---|
| TC-COLLAB-01 | P0 | 建空间/邀请 | 建协作空间→用户名直邀+链接邀（24h/可撤销）→成员接受；个人空间资源互不可见（US-26） |
| TC-COLLAB-02 | P0 | 多端同步 | 4 客户端同会话：对话/终端/工具卡片/画面同步 P95≤1s；互不踢线（US-27） |
| TC-COLLAB-03 | P0 | 任务协作规则 | 成员 B 在 A 任务进行中发消息→排队提示；B 可停止任务；审计 actor 正确 |
| TC-COLLAB-04 | P0 | 空间隔离 | 空间 X 成员完全不可见空间 Y（会话/文件/知识/扩展/聊天）；空间 ADMIN 与平台 ADMIN 权限分离 |
| TC-COLLAB-05 | P0 | 操作权-自由 | 多人并发点浏览器→服务端串行化无丢失；轻提示"X 正在操作"（US-28） |
| TC-COLLAB-06 | P0 | 操作权-接力 | 切接力：非持令者输入被拦+蒙灰；申请/释放/2 分钟超时释放/掉线 30s 释放全通；广播事件各端一致 |
| TC-COLLAB-07 | P0 | 成员聊天 | 聊天区发消息仅人际可见；`@agent` 转任务有确认；与 Agent 对话流分区清晰（US-29） |
| TC-COLLAB-08 | P1 | 协作感知 | 在线头像列表实时进出；member_typing 节流提示可关闭 |
| TC-COLLAB-09 | P1 | 演示模式 | 发起者导航文件树/预览 URL，跟随端 ≤1s 同步；退出恢复自由（US-33） |
| TC-COLLAB-10 | P0 | 组级知识库 | group 作用域沉淀/检索优先级正确；新成员入职首问命中团队约定；删他人条目需 ADMIN（US-32） |
| TC-COLLAB-11 | P0 | 组级扩展 | 发布到空间（ADMIN 审）→组内即时可用；密钥各成员自绑不泄露；卸载仅影响自己（US-31） |
| TC-COLLAB-12 | P0 | 治理与交接 | 踢人即时断连失权；角色变更边界正确；/handoff 沉淀交接摘要+新成员可见（US-30/35）；解散级联+7 天导出宽限 |
| TC-COLLAB-13 | P1 | 满员边界 | 同会话第 11 个观看者被拒提示；空间第 51 成员被拒 |
| TC-COLLAB-14 | P1 | CLI 协作 | CLI 加入协作空间会话可见同步输出（只读+可聊天） |

## 23. 浏览器黑盒 E2E 执行记录（v1.2，2026-10-18）

> 背景：此前全部 E2E 为 API/WS 层脚本，UI 层零覆盖——登录页语法错误、六面板无入口等缺陷长期潜伏。2026-10-18 起以真实浏览器（GUI 黑盒，仅可见元素交互，截图留证 `gui-test-screenshots/`）执行三轮全量回归。

### 23.1 三轮执行结果

| 轮次 | 范围 | 结果 |
|---|---|---|
| 第一轮 t01-t16 | 登录/注册/错误密码、新会话、任务流式+终端、审批（卡渲染/拒绝/超时/批准）、空间创建+邀请、主题/预览/历史回放、空发送 | 通过 12 项；**阻塞 10 项**（六面板无入口、上传 URL 内网不可达、协作空间会话不可见） |
| 第二轮 r1-r8 | 修复后回归：六入口、双标签同历史、审批单卡+批准真实执行+审计 denied 留痕、超时卡文案、页内预览、移动端 390×844 | 全部通过 |
| 第三轮 v1-v7 | Vue 重构版：工作台/任务流式/审批/终端（xterm）/五面板+聊天去重/双标签对话一致/移动端抽屉 | 全部通过 |

### 23.2 首轮暴露并已修复的缺陷（编号对应 8164450/6de651f 提交）

| # | 缺陷 | 根因与修复 |
|---|---|---|
| 1 | 登录按钮无反应 | 内联脚本含真实换行字符致整段不解析（单文件 SPA 无 lint 盲区）→ 修复并驱动前端工程化 |
| 2 | 六大面板（文件/知识库/扩展/管理/指令/聊天）无入口 | open/toggle 函数零调用点，自诞生未接线 → 侧栏 tools 区六按钮 |
| 3 | 审批双卡、首卡点击无效 | loop.py 与 approve() 双发射不同 cid → 审批单发射器（仅 approve()） |
| 4 | 多标签内容不一致/事件重复 | 会话列表硬编码 personal 空间 + WS 网关僵尸泵（SSE body 流未 close，N 倍投递）→ currentSpaceId 统一 + 泵 Stream.close 生命周期 |
| 5 | 被拦截命令不入审计 | denied tool_result 无审计行 → 携 command/risk 补录（decision=denied） |
| 6 | 上传必失败 | 预签名 URL 内网主机名+端口未映射 → MINIO_PUBLIC_ENDPOINT + 9000 映射 |
| 7 | 控制器异常伪装 401 | JwtFilter catch-all → 认证段独立 try |
| 8 | AI 幻觉汇报 | 系统提示词补"如实汇报"硬规则（模型行为问题，工具一致性校验为长期项） |

### 23.3 已知测试运行时限制

- IAB 内嵌浏览器不支持系统文件选择器 → 浏览器内上传按钮不可自动化（上传链路以 API 直传+URL 出口可达性验证代替）；
- prompt()/confirm() 类原生弹窗在自动化中不稳定 → 扩展添加/知识库添加/指令编辑的表单化（模态组件）列入迭代；
- 长会话标签页 locator 点击偶发失效 → 以坐标路径（CUA）替代，不影响结论。

### 23.4 隔离交互原型 v0.7 轻量走查（2026-11-17，非生产 E2E）

范围为 docs/features/digital-employee-team/prototype/ 静态 HTML/CSS/JavaScript，通过 Chrome headless + CDP 点击页面、提交表单、截图并核对内存状态。未接后台、真实模型、数据库、Git 或执行工具；旧系统用例与运行架构均未重验。本节只记录原型交互，不构成真实数字员工工作流、模型语义识别或系统性能验收。

19 项关键路径及 3 项修正复查通过，未观察到脚本异常：决策阅读/补证/明确选择、原等待范围与决定回执、暂停不恢复、历史证据绑定版本/失败保留、跨团队证据拒绝、未知/过期快照隐藏旧统计、源更新时间不因查看改变、新目标不生成虚假进度，以及 1440×1040/390×844 布局和手机定位/证据抽屉。修复手机定位后状态面板未关闭、决定后等待文案仍像当前状态两处交互问题；另核对空团队留目标后创建员工，摘要正确转为待核实且不生成进度。

完整范围和截图见[原型走查记录](features/digital-employee-team/prototype/README.md)。本轮不新增永久自动化测试脚本；截图编号 v20261117-prototype-v07-*，建议中的其他运行/采用政策仍待明确。

### 23.5 数字员工团队真实实现自验（v1.4，2026-11-17）

新增Java领域与真实PG测试、Python协议/恢复测试和前端状态测试；实际隔离沙箱/Git/MinIO及桌面/手机页面分项证据见[专题验证记录](features/digital-employee-team/verification.md)。六条运行政策由D38确认。真实模型模板/员工试跑返回429资源不足，未完成语义与独立验收；旧用例全集也未因此视为重验通过。

### 23.6 模型资源恢复后的真实续验（2026-11-17）

使用glm-4.6完成两轮模板生成与三员工合成业务案例，实际run及4项任务均completed，含GUI人工决定、额度上限/显式追加及检查点恢复。现场干预、发现的缺陷、磁盘故障及未覆盖范围见[model_validation.md](features/digital-employee-team/model_validation.md)，不代表完整研发/任意业务或独立验收通过。

### 23.7 按产品需求执行功能验收（v1.5，2026-11-17）

固定deb48c5基线，从AC01～34新建账户与用例，协议11项中6通过/5失败，GUI有效8项通过（保留设施错误），真实模型4场景中两个限定样例通过、两个整体场景失败，研发两个并行需求因云端GitHub连接失败受阻。确认暂停恢复丢调度、取消后旧答复复活、员工无法归档文档、非法版本核查、失效上级不报告配置异常，以及等待人工仍派生同事项模型调用。**整体验收暂不通过**，本轮未改产品实现。

完整AC矩阵、首次尝试、模型局部成果与限制、缺陷及复测交接见[产品需求验收报告](features/digital-employee-team/acceptance_20261117.md)与同目录结构化证据。真实Chrome截图编号v20261117-acceptance-*；同会话承担测试和产品视角，不称独立第三方认证。Python15/前端4/Java纯领域19项程序测试通过不抵消业务缺陷，旧用例全集未重验。

### 23.8 六项缺陷修改反馈及开发回归（v1.6，2026-11-17）

F01～F06已实现修复：Java纯领域28+真实PG7、Python16、前端6通过，原11条API复现全通过；真实Chrome桌面/390px有效GUI12项通过（保留一次设施选择器错误）。真实模型验证等待场景109.31秒调用稳定为2、文档归档及模板迭代闭环；纠错/复核样例仍在8次额度内未完成全部收尾，Git云端网络和原AC缺口保留。主web/agentd已重建并在本地运行。详见[修改反馈](features/digital-employee-team/acceptance_fix_feedback_20261117.md)，截图v20261117-repair-*。这属于开发整合验证，不将原验收改成整体通过。

### 23.9 产品/测试回归（v1.7，2026-11-18）

被测65de3af，生产实现未改。Java35/Python16/前端6及构建检查通过；新账户原11+新增6条协议共17通过，GUI修正重载后的测试团队定位后12通过，另有实际Git项目页面证据。F01～F06及完成后引用续接在覆盖范围复测通过。真实无仓库模型等待场景110.315秒调用保持2，模板/归档各3调用完成；纠错案例虽修正、复核和报告已保存，仍在8调用上限未结束任务。

原Git网络阻塞未复现；两个已有项目需求分别6调用完成，实际沙箱/分支/文件隔离、2次真实检查后集成通过，保护/过期/未知来源拒绝，故意失败检查不推进基线，未推远端。实际冲突/unknown恢复等仍未全验，整体产品不判通过。全部首次结果、设施纠正、资源清理与产品判断见[回归报告](features/digital-employee-team/regression_20261118.md)，截图v20261118-regression-*。

### 23.10 库存协作收尾的修改复验（2026-11-18）

同业务Prompt/事实、共享8次上限，不追加额度：完整95→90/v2检查/复核报告/3任务结束，以及原稿v1保留/真实人工决定/至少60秒不新增调用。增加complete_task.artifact保存失败不结束、幂等重放、两步间暂停、未知动作阻断、共享资源注入与消息交接含义程序保护；程序通过不替代模型业务判断。结果与所有失败候选见[收尾反馈](features/digital-employee-team/completion_fix_feedback_20261118.md)。

### 23.11 1075be9再次产品/测试回归（2026-11-18）

23条真实接口/定义/收尾边界、35项Java（含7项PG）/26项Python/6项前端和typecheck/build通过；22个最终GUI场景展示实际结果。预先安排两组独立库存对照，纠错1通过1失败（R07收尾未结束），等待1通过1失败（R08先派工再升级）；首阶段38次、同部署镜像补充9次，合计47次真实模型请求，未追加任何run额度。两组模板迭代、真实归档和两轮模板草稿/保存采用，以及两项并行研发和受控合并通过。完整原始结果、一次Git设施超时、断言字段修正、未覆盖AC及不通过结论见[再次验收](features/digital-employee-team/reacceptance_20261118.md)。

运行环境补充：宿主业务venv的openai3.52.0与部署镜像3.54.0不同，源码SHA一致。追加同部署镜像关键两例均通过（纠错7调用、待决2调用），不覆盖宿主R07/R08失败，不将差异直接归因为SDK；整体跨环境验收仍未通过。

### 23.12 Prompt 目录导入开发回归（2026-11-19）

D43 在隔离 PostgreSQL、MinIO 和真实 Chrome 中验证团队创建、流程编辑、实际员工配置、旧版个人指令与技能正文导入。重新读取验证手写文本与目录并存、移除后保存、跨帐号文件拒绝及新旧任务使用各自快照。现有模板多 Skill 目录回归通过。截图为 `v20261119-full-closure-prompt-flow-desktop.png` 和 `v20261119-full-closure-prompt-flow-mobile.png`。

一项真实 CLI 模型任务使用三个来源的同名指令及作用域内的参考文件完成报告。入队后更新团队目录，报告仍采用入队快照。42 项 Java（其中 10 项连接 PostgreSQL）、44 项 Python、20 项前端测试及前端类型检查和构建通过。上述为开发自验范围。

### 23.13 团队 Skill 三层配置开发回归（2026-11-19）

D44 在隔离 PostgreSQL、MinIO 和 Chrome 中验证流程编辑取消、角色目录上传、两位成员关联同一角色、角色更新后的新旧任务预览、个人配置隔离和 390 像素布局。原 D43 入口和目录导入用例按新流程弹窗复测通过。截图为 `v20261119-full-closure-team-skill-{flow,roles,mobile}.png`。

43 项 Java（其中 10 项连接 PostgreSQL）、45 项 Python、21 项前端测试、类型检查及前端构建通过。程序验证覆盖角色创建权限、同队关联、配置读取范围和角色快照。

一项真实 CLI 任务同时读取团队、角色、成员与模板的配置，并调用 `read_template_file(scope=role)` 读取角色参考文件。入队后修改团队与角色指令，最终报告仍反映创建任务时的快照。

### 23.14 同一角色导入多个 Skill（2026-11-19）

真实 Chrome 中先单独导入第一个 Skill 目录，再选择包含另外两个 Skill 的上级目录。保存重开后显示三组，三个同名参考文件保持各自的路径与内容。移除一整组后，新配置保留另两组，已排队任务继续使用原来的三组。原 Prompt 导入、模板多 Skill 导入和 390 像素视口复测通过。前端 21 项测试、类型检查及构建通过。[编辑器截图](../gui-test-screenshots/v20261119-full-closure-team-skill-directories.png)

### 23.15 组织模板与独立员工（2026-11-19）

Chrome 走通独立角色模板、将角色加入团队模板、从模板复制团队、直接创建与编辑员工和手机弹窗。数据核验覆盖新团队采用流程和角色、成员起始为空、员工性格进入任务快照与现有角色保留已复制的职责。复测 D43 目录导入和 D44 多 Skill、预览及快照。[模板入口](../gui-test-screenshots/v20261119-full-closure-organization-templates.png) · [手机成员设定](../gui-test-screenshots/v20261119-full-closure-organization-member-mobile.png)

真实 CLI 合成任务通过两次模型调用完成。报告包含团队、角色和个人设定的标识，并读取了角色目录的参考文件。任务入队后调整角色模板和个人设定，报告仍体现任务快照。44 项 Java（含 10 项 PostgreSQL）、46 项 Python、21 项前端、类型检查和两端镜像构建通过。旧员工模板创建与自动采用场景以 D45 的退役和兼容用例替代。

### 23.16 工作空间布局与登录失效（2026-11-19）

Chrome 在 1440×1040 和 390×844 视口切换工作台、团队、知识库与组织模板，校验导航、顶栏及三个列表页标题的对齐和横向溢出。组织模板创建、应用和成员独立配置复测通过。[桌面组织模板](../gui-test-screenshots/v20261119-full-closure-organization-shell-desktop.png) · [手机组织模板](../gui-test-screenshots/v20261119-full-closure-organization-shell-mobile.png)

隔离部署中使用无效 JWT 触发受保护接口的真实 401，验证组织模板轮询与旧版会话首次加载均清理登录凭据并展示登录页。密码错误显示表单提示，重新登录后回到组织模板。[登录失效提示](../gui-test-screenshots/v20261119-full-closure-session-expired-mobile.png)

21 项前端测试、类型检查、前端构建与 Web 镜像构建通过。

### 23.17 工作空间资源删除与排序（2026-11-19）

隔离部署的 Chrome 验证名称字典序与最近更新时间切换、同名模板按选中项删除、确认取消、团队模板删除后已采用角色仍可用、知识删除自动卸载。角色仍有关联成员或项目仍有文档时展示依赖提示。移除成员、角色、文档、项目和团队后，通过接口复核结果。旧组织模板、团队 Skill 配置、布局与登录失效回归通过。[排序](../gui-test-screenshots/v20261119-full-closure-resource-sort-desktop.png) · [手机删除确认](../gui-test-screenshots/v20261119-full-closure-resource-delete-mobile.png)

48 项 Java 测试（其中 11 项使用 PostgreSQL）验证权限、版本冲突、执行未收尾与快照保留。21 项前端测试、类型检查、前端构建与 Web 镜像构建通过。

### 23.18 CLI 项目目录选择（2026-11-19）

Chrome 使用隔离工作空间和实际宿主 CLI 验证启动根目录、子目录、账号隔离及目录绑定保存。只含 `.gitignore` 的普通目录隐藏 Git 配置，选中带 `.git` 的项目后展示 Git 控件。Sandbox 表单继续提供 HTTPS 代码来源。真实任务从选中的 Git 目录读到合成数据，并将产物写到该目录的独立执行工作区，原 Git 提交与工作目录保持原状。[Git 设置](../gui-test-screenshots/v20261119-full-closure-project-directory-git.png) · [手机目录选择](../gui-test-screenshots/v20261119-full-closure-project-directory-mobile.png)

48 项 Java 测试（其中 11 项使用 PostgreSQL）、47 项 Python 测试、21 项前端测试、类型检查及 Web、Agent 镜像构建通过。
