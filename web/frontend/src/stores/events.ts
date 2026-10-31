import { defineStore } from 'pinia'
import { token } from '../api'
import { useAuth } from './auth'
import { useWorkspace } from './workspace'
import type { ChatMsg, StreamItem, WsEvent } from '../types'

/** 高频帧/终端数据不走 store（响应式开销大），由面板组件注册 sink 直收 */
export type TermSink = (data: string, stream: string) => void
export type FrameSink = (b64: string) => void

let uidSeq = 1

export const useEvents = defineStore('events', {
  state: () => ({
    items: [] as StreamItem[],
    taskRunning: false,
    banner: false,                     // 连接中断重连横幅
    presence: '',
    approvalMode: 'auto' as 'auto' | 'suggest',
    chatMsgs: [] as ChatMsg[],
    chatOpen: false,
    demoMode: false,
    previewOpen: false,
    previewUrl: '',
    termOpen: false,
    fileTree: '',          // 沙箱工作区树（file_tree 事件填充，文件面板展示）
    filesVersion: 0,       // 通知文件面板刷新
    termSink: null as TermSink | null,
    frameSink: null as FrameSink | null
  }),
  actions: {
    // ---------- WS 生命周期 ----------
    connect(sessionId: string) {
      const old = (this as any)._ws as WebSocket | undefined
      // 仅 CONNECTING/OPEN 才复用：CLOSED 也早退会让断线重连永远空转（横幅常亮）
      if (old && (this as any)._wsSid === sessionId && old.readyState <= 1) return
      if (old) old.close()
      ;(this as any)._wsSid = sessionId
      const ws = new WebSocket(`ws://${location.host}/ws/agent?sessionId=${sessionId}&token=${token()}`)
      ;(this as any)._ws = ws
      ws.onopen = () => {
        this.banner = false
        ;(this as any)._attempts = 0
        const auth = useAuth()
        this.send({ type: 'presence_join', payload: { userId: auth.myUid } })
      }
      ws.onclose = () => {
        if ((this as any)._ws !== ws) return   // 切换会话时旧连接迟到的 close：忽略，否则误亮横幅
        const cur = useWorkspace().cur
        if (cur === (this as any)._wsSid && token()) {
          this.banner = true
          const att = ((this as any)._attempts = ((this as any)._attempts || 0) + 1)
          setTimeout(() => { if (useWorkspace().cur) this.connect(useWorkspace().cur!) },
            Math.min(30000, 1000 * Math.pow(2, att - 1)))
        }
      }
      ws.onmessage = ev => this.handle(JSON.parse(ev.data))
    },
    send(o: object) {
      const ws = (this as any)._ws as WebSocket | undefined
      if (ws && ws.readyState === 1) ws.send(JSON.stringify(o))
    },
    /** 发任务：连接未就绪时一次性监听 open 后发送（不覆盖 onopen，保住 presence/重连逻辑） */
    sendTask(text: string) {
      const ws = (this as any)._ws as WebSocket | undefined
      const payload = JSON.stringify({ type: 'user_input', payload: { text } })
      if (ws && ws.readyState === 1) ws.send(payload)
      else if (ws) ws.addEventListener('open', () => ws.send(payload), { once: true })
    },

    // ---------- 会话流操作 ----------
    openStream() { this.items = [] },
    addUser(text: string) { this.items.push({ kind: 'user', id: uidSeq++, text }) },
    addSys(text: string, undoKbId?: string) { this.items.push({ kind: 'sys', id: uidSeq++, text, undoKbId }) },
    appendAi(delta: string) {
      const last = this.items[this.items.length - 1]
      if (last && last.kind === 'ai') last.text += delta
      else this.items.push({ kind: 'ai', id: uidSeq++, text: delta })
    },
    respondApproval(cid: string, action: 'approve' | 'deny' | 'always_allow') {
      this.send({ type: 'approval_response', payload: { cid, action } })
      const it = this.items.find(i => i.kind === 'appr' && i.cid === cid)
      if (it && it.kind === 'appr') {
        it.state = action === 'approve' ? 'approved' : action === 'always_allow' ? 'always' : 'denied'
      }
    },
    sendChat(text: string) {
      this.send({ type: 'space_chat', payload: { text } })
      const auth = useAuth()
      this.chatMsgs.push({ self: true, who: auth.user || '我', text })
    },
    setMode(m: 'auto' | 'suggest') {
      this.approvalMode = m
      this.send({ type: 'set_approval', payload: { value: m } })
    },

    // ---------- 事件分发（与旧 SPA handle/handle2 对等） ----------
    handle(env: WsEvent) {
      const p = env.payload || {}
      const auth = useAuth()
      switch (env.type) {
        case 'agent_delta': this.appendAi(p.content || ''); break
        case 'tool_call':
          this.items.push({ kind: 'tool', id: uidSeq++, tool: p.tool, args: JSON.stringify(p.args || {}) })
          break
        case 'tool_result': break     // 终端由 sink 呈现
        case 'terminal':
          this.termOpen = true
          this.termSink?.(p.data || '', p.stream || 'stdout')
          break
        case 'session_status':
          this.addSys(p.status === 'sandbox_creating' ? '沙箱启动中…'
            : p.status === 'active' ? `沙箱就绪 (${p.sandboxId || ''})` : p.status)
          break
        case 'done':
          this.taskRunning = false
          this.addSys(p.status === 'done'
            ? `任务完成（${p.rounds} 轮 · tokens ${p.tokens?.prompt || 0}+${p.tokens?.completion || 0}）`
            : `任务${p.status === 'stopped' ? '已停止' : '失败：' + (p.answer || '')}`)
          break
        case 'error': this.addSys('错误：' + (p.message || '')); break

        // ---- handle2 ----
        case 'file_synced': this.addSys(`✅ 已同步到沙箱：${p.dest}`); break
        case 'file_exported': this.addSys(`📤 已导出：${p.path}`); break
        case 'file_tree': this.fileTree = p.out || ''; this.filesVersion++; break
        case 'approval_request':
          this.items.push({
            kind: 'appr', id: uidSeq++, cid: p.cid, command: p.command || '',
            riskLevel: p.riskLevel || 'medium', reason: p.reason || '',
            state: 'pending', left: p.expiresIn || 120
          })
          this.addSys(`⚠ 需要审批（${p.riskLevel}）：${p.command}`)
          break
        case 'approval_timeout': {
          this.addSys('审批超时已自动拒绝')
          const it = this.items.find(i => i.kind === 'appr' && i.cid === p.cid)
          if (it && it.kind === 'appr' && it.state === 'pending') it.state = 'timeout'
          break
        }
        case 'presence_update': this.presence = `👤 ${(p.members || []).length} 在线`; break
        case 'kb_captured':
          this.addSys(`🧠 已记住：${(p.titles || []).join('、')}`, (p.ids || [])[0])
          break
        case 'nav_follow':
          if (!this.demoMode) { this.previewOpen = true; this.previewUrl = p.url || ''; this.addSys(`跟随演示导航：${p.url}`) }
          break
        case 'op_lock_changed':
          this.addSys(p.holder ? `🔒 接力模式：操作权 → 用户${p.holder}`
            : (p.mode === 'relay' ? '接力模式：操作权空闲（点「接力」旁按钮申请）' : '已切回自由模式'))
          break
        case 'space_chat_msg':
          this.chatOpen = true
          if (Number(p.userId) !== auth.myUid) {   // 自己的本地已 echo，避免双显
            this.chatMsgs.push({ self: false, who: `用户${p.userId}`, text: p.text })
          }
          break
        case 'screencast_meta': break
        case 'screencast_frame': this.frameSink?.(p.data || ''); break
      }
    }
  }
})
