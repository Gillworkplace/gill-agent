import { defineStore } from 'pinia'
import { api } from '../api'
import type { SessionItem, SpaceItem, HistMessage } from '../types'

/**
 * 空间/会话状态。关键约束（多标签一致性修复的延续）：
 * 会话列表始终跟随「当前选中空间」，选择持久化到 localStorage，
 * 严禁回退硬编码 personal 空间——那是历史上多标签内容不一致的根因。
 */
export const useWorkspace = defineStore('workspace', {
  state: () => ({
    spaces: [] as SpaceItem[],
    curSpaceId: null as string | null,
    sessions: [] as SessionItem[],
    cur: null as string | null
  }),
  actions: {
    async loadSpaces() {
      this.spaces = await api<SpaceItem[]>('/spaces')
      const saved = localStorage.getItem('gill_space')
      this.curSpaceId = (saved && this.spaces.some(s => s.id === saved))
        ? saved
        : (this.spaces.find(s => s.type === 'personal') || this.spaces[0])?.id || null
      if (this.curSpaceId) localStorage.setItem('gill_space', this.curSpaceId)
      return this.curSpaceId
    },
    async switchSpace(id: string) {
      this.curSpaceId = id
      localStorage.setItem('gill_space', id)
      await this.loadSessions()
    },
    async loadSessions() {
      if (!this.curSpaceId) await this.loadSpaces()
      if (!this.curSpaceId) return
      this.sessions = await api<SessionItem[]>(`/spaces/${this.curSpaceId}/sessions`)
    },
    async newSession(): Promise<SessionItem> {
      if (!this.curSpaceId) await this.loadSpaces()
      const s = await api<SessionItem>(`/spaces/${this.curSpaceId}/sessions`,
        { title: '新会话 ' + (this.sessions.length + 1) })
      await this.loadSessions()
      return s
    },
    async hist(sid: string): Promise<HistMessage[]> {
      const msgs = await api<HistMessage[]>(`/sessions/${sid}/messages?limit=50`)
      return msgs.reverse()
    }
  }
})
