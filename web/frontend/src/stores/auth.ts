import { defineStore } from 'pinia'
import { api, token } from '../api'
import type { MeInfo } from '../types'

export const useAuth = defineStore('auth', {
  state: () => ({
    user: localStorage.getItem('gill_user') || '',
    myUid: null as number | null,
    role: '' as string
  }),
  getters: {
    loggedIn: () => !!token()
  },
  actions: {
    async login(username: string, password: string) {
      const d = await api<{ token: string; role: string }>('/auth/login', { username, password })
      localStorage.setItem('gill_token', d.token)
      localStorage.setItem('gill_user', username)
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
      location.reload()
    }
  }
})
