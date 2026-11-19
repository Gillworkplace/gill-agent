import { defineStore } from 'pinia'
import { api } from '../api'
import type { MeInfo } from '../types'

const EXPIRED_NOTICE = 'gill_session_expired'

export const useAuth = defineStore('auth', {
  state: () => {
    const expired = sessionStorage.getItem(EXPIRED_NOTICE) === '1'
    sessionStorage.removeItem(EXPIRED_NOTICE)
    return {
      user: localStorage.getItem('gill_user') || '',
      myUid: null as number | null,
      role: '',
      // 保留响应式 token，让登录状态即时驱动视图。
      tok: localStorage.getItem('gill_token') || '',
      expired
    }
  },
  getters: {
    loggedIn: (s) => !!s.tok
  },
  actions: {
    async login(username: string, password: string) {
      const d = await api<{ token: string; role: string }>('/auth/login', { username, password })
      localStorage.setItem('gill_token', d.token)
      localStorage.setItem('gill_user', username)
      this.tok = d.token
      this.user = username
    },
    async register(username: string, password: string) {
      await api('/auth/register', { username, password })
    },
    async me(): Promise<MeInfo | null> {
      try {
        const m = await api<MeInfo>('/auth/me')
        this.myUid = m.id; this.role = m.role
        return m
      } catch { return null }
    },
    async saveInstructions(v: string) {
      await api('/auth/me/instructions', { custom_instructions: v }, 'PATCH')
    },
    logout(expired = false) {
      if (!this.tok) return
      localStorage.removeItem('gill_token')
      localStorage.removeItem('gill_user')
      if (expired) sessionStorage.setItem(EXPIRED_NOTICE, '1')
      this.expired = expired
      this.tok = ''
      location.reload()
    }
  }
})
