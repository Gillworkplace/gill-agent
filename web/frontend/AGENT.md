# web/frontend/AGENT.md — Vue 3 前端工程

## 职责

全部用户界面：登录/注册、工作台（消息流/终端/预览/审批）、文件、知识库、扩展、协作空间、成员聊天、管理后台；桌面 + 移动端（≤768px 一等适配）。

## 结构

```
src/
 ├─ main.ts / App.vue          # 入口：按 token 切换 Login/Workspace
 ├─ api.ts                     # fetch 封装（JWT 注入/ApiError）；types.ts 全量载荷类型
 ├─ styles.css                 # 设计令牌(CSS 变量+暗色) + 布局 + ≤768px 媒体查询
 ├─ views/
 │   ├─ LoginView.vue          # 登录/注册（注册即自动登录）
 │   └─ WorkspaceView.vue      # 编排：openSession(hist→connectWS)/面板互斥/快捷键(Esc/Ctrl+`)
 ├─ stores/                    # Pinia
 │   ├─ auth.ts                # token/user/myUid；login/register/me/logout
 │   ├─ workspace.ts           # spaces/curSpaceId/sessions —— 会话严格跟随选中空间(gill_space 持久化)
 │   └─ events.ts              # WS 生命周期+消息流状态机(StreamItem)+审批/聊天/档位；termSink/frameSink 高频直收
 └─ components/                # Sidebar / ChatStream / ApprovalCard / InputBar /
                               # TerminalPanel(xterm) / PreviewPanel(CDP canvas) / FilesPanel /
                               # TextPreview(页内预览) / KbPanel / ExtPanel / SpaceManager /
                               # AdminPanel / MemberChat
```

## 硬约束

1. `vue-tsc --noEmit` 零错误 + `npm run build` 成功才可提交。
2. 构建产物输出 `../src/main/resources/static/`（gitignore）；**改完必须 build 或走 Docker 三阶段重建 web 镜像**，否则线上不生效。
3. 会话列表禁止硬编码 personal 空间（多标签一致性根因）；高频帧/终端不走 store。
4. `sendTask` 一次性监听发送，不覆盖 `ws.onopen`；自消息按 MYUID 去重。
5. 审批卡四态（pending/approved/denied/timeout/always），倒计时不得回写覆盖终态文案。
6. UI 改动必须双端验证：桌面 + 390×844（抽屉侧栏、无横向滚动）。
7. localStorage 键名（`gill_token/gill_user/gill_space/gill_theme`）是兼容契约，不得改名。

## 常用命令

```bash
npm install --registry=https://registry.npmmirror.com
npm run dev          # 5173，/api /ws 代理到 localhost:8080（热更新，后端容器照常跑）
npm run build        # 产物 → ../src/main/resources/static/
npx vue-tsc --noEmit # 类型检查
```
