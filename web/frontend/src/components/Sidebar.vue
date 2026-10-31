<script setup lang="ts">
import { useAuth } from '../stores/auth'
import { useWorkspace } from '../stores/workspace'
import { useEvents } from '../stores/events'
import { api } from '../api'

defineProps<{ drawerOpen: boolean }>()
const emit = defineEmits<{
  (e: 'toggle-drawer'): void
  (e: 'close-drawer'): void
  (e: 'open-session', id: string): void
  (e: 'new-session'): void
  (e: 'open-panel', which: 'files' | 'kb' | 'ext' | 'space' | 'adm'): void
  (e: 'toggle-preview'): void
  (e: 'toggle-theme'): void
}>()

const auth = useAuth()
const ws = useWorkspace()
const ev = useEvents()

async function switchSpace(id: string) { await ws.switchSpace(id) }

async function editInstructions() {
  const me = await api<{ custom_instructions?: string }>('/auth/me')
  const v = prompt('个人指令（每次任务注入，≤2000 字）', me.custom_instructions || '')
  if (v === null) return
  await auth.saveInstructions(v)
  ev.addSys('🧭 个人指令已保存，下次任务生效')
}
</script>

<template>
  <aside :class="{ open: drawerOpen }">
    <div class="top">
      <select id="spaceSel" :value="ws.curSpaceId || ''" @change="switchSpace(($event.target as HTMLSelectElement).value)">
        <option v-for="s in ws.spaces" :key="s.id" :value="s.id">
          {{ s.type === 'personal' ? '🏠' : '👥' }} {{ s.name }}
        </option>
      </select>
      <button class="new" @click="emit('new-session')">＋</button>
    </div>
    <div class="spacemeta">
      <a href="javascript:void(0)" @click="emit('open-panel', 'space')">空间管理</a>
      <span id="presence">{{ ev.presence }}</span>
    </div>
    <div id="sessions">
      <div v-for="s in ws.sessions" :key="s.id" class="sess" :class="{ on: s.id === ws.cur }"
           @click="emit('open-session', s.id)">
        {{ s.title || '会话' }}<span class="dot"></span>
      </div>
    </div>
    <div class="tools">
      <button @click="emit('open-panel', 'files')">📁 文件</button>
      <button @click="emit('open-panel', 'kb')">🧠 知识库</button>
      <button @click="emit('open-panel', 'ext')">🔌 扩展</button>
      <button @click="ev.chatOpen = !ev.chatOpen; emit('close-drawer')">💬 聊天</button>
      <button @click="editInstructions">🧭 指令</button>
      <button @click="emit('open-panel', 'adm')">⚙️ 管理</button>
    </div>
    <div class="bottom">
      <span id="whoami">{{ auth.user }}</span>
      <button class="new" @click="emit('toggle-preview')">🌐 预览</button>
      <button class="new" @click="emit('toggle-theme')">🌗</button>
      <button class="new" @click="auth.logout()">退出</button>
    </div>
  </aside>
</template>
