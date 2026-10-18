<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api } from '../api'
import { useAuth } from '../stores/auth'
import { useEvents } from '../stores/events'
import type { AuditRow, UserRow } from '../types'

const emit = defineEmits<{ (e: 'close'): void }>()
const auth = useAuth()
const ev = useEvents()
const users = ref<UserRow[]>([])
const audit = ref<AuditRow[]>([])

async function load() {
  users.value = await api<UserRow[]>('/admin/users')
  audit.value = await api<AuditRow[]>('/admin/audit?limit=30')
}
async function toggle(u: UserRow) {
  await api('/admin/users/' + u.id, { status: u.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' }, 'PATCH')
  await load()
}
onMounted(async () => {
  if (auth.role !== 'ADMIN') { ev.addSys('仅管理员可用'); emit('close'); return }
  await load()
})
</script>

<template>
  <div id="adm" class="on">
    <div class="bar">
      <h2>⚙️ 管理后台</h2>
      <button class="new" @click="emit('close')">返回</button>
    </div>
    <div class="grid">
      <div>
        <h3>用户</h3>
        <div v-for="u in users" :key="u.id" class="frow">
          <span class="nm">{{ u.username }}</span>
          <span class="sz">{{ u.role }}·{{ u.status }}</span>
          <button @click="toggle(u)">{{ u.status === 'ACTIVE' ? '禁用' : '启用' }}</button>
        </div>
      </div>
      <div>
        <h3>命令审计（最近）</h3>
        <div class="auditlist">
          <div v-for="(a, i) in audit" :key="i" class="arow">
            {{ (a.command || '').slice(0, 60) }} <span class="dim">exit={{ a.exit_code }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
