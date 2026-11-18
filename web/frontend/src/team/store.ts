import { defineStore } from 'pinia'
import { api } from '../api'
import { emptyWorkspace } from './types'
import type { Workspace } from './types'

export const useTeams = defineStore('teams', {
 state: () => ({ data: emptyWorkspace(), loaded: false, busy: false, error: '', refreshError: '', observedAt: '', requestCount: 0 }),
 actions: {
  async refresh() {
   const request = ++this.requestCount
   try {
    const next = await api<Workspace>('/team-workspace')
    if (request < this.requestCount || (this.loaded && next.revision < this.data.revision)) return
    this.data = { ...emptyWorkspace(), ...next }; this.loaded = true
    this.observedAt = new Date().toISOString()
    this.refreshError = ''
   } catch (error: unknown) {
    if (request === this.requestCount) this.refreshError = error instanceof Error ? error.message : '读取失败'
    throw error
   }
  },
  async command(kind: string, payload: Record<string, unknown>, requestKey = crypto.randomUUID()) {
   this.busy = true; this.error = ''
   try {
    const result = await api<{id: string; revision?: number}>('/team-workspace/commands', {kind, payload, requestKey})
    await this.refresh(); return result
   } catch (error: unknown) { this.error = error instanceof Error ? error.message : '操作失败'; throw error }
   finally { this.busy = false }
  }
 }
})
