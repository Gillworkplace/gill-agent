import { defineStore } from 'pinia'
import { api } from '../api'
import type { MeInfo } from '../types'

export const useAuth = defineStore('auth', {
  state: () => ({
    user: localStorage.getItem('gill_user') || '',
    myUid: null as number | null,
    role: '',
    // token 的响应式镜像：loggedIn 若直接读 localStorage（非响应式），computed 零依赖永不失效，
    // 登录成功后视图会卡在登录页（登录按钮"无反应"）
    tok: localStorage.getItem('gill_token') || ''
  }),
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
      await api('/me/instructions', { custom_instructions: v }, 'PATCH')
    },
    logout() {
      localStorage.removeItem('gill_token')
      localStorage.removeItem('gill_user')
      this.tok = ''
      location.reload()
    }
  }
})
