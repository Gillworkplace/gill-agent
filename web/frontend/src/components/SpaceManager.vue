<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api } from '../api'
import { useWorkspace } from '../stores/workspace'
import { useEvents } from '../stores/events'
import type { MemberRow } from '../types'

const emit = defineEmits<{ (e: 'close'): void }>()
const ws = useWorkspace()
const ev = useEvents()
const members = ref<MemberRow[]>([])
const spName = ref('')
const invUser = ref('')

async function load() {
  if (!ws.curSpaceId) return
  members.value = await api<MemberRow[]>(`/spaces/${ws.curSpaceId}/members`)
}
async function create() {
  if (!spName.value.trim()) return
  const r = await api<{ id: string }>('/spaces', { name: spName.value.trim() })
  await ws.loadSpaces()
  await ws.switchSpace(r.id)
  spName.value = ''
  emit('close')
}
async function invite() {
  const u = invUser.value.trim()
  if (!u || !ws.curSpaceId) return
  try {
    await api(`/spaces/${ws.curSpaceId}/invites`, { username: u })
    ev.addSys(`已邀请 ${u}`)
    await load()
  } catch (e: any) { ev.addSys('邀请失败：' + e.message) }
}
onMounted(load)
</script>

<template>
  <div id="sp" class="on">
    <div class="bar">
      <h2>👥 空间管理</h2>
      <button class="new" @click="emit('close')">返回</button>
    </div>
    <div class="body">
      <h3>创建协作空间</h3>
      <div class="row"><input v-model="spName" placeholder="空间名称"><button class="new" @click="create">创建</button></div>
      <h3>邀请成员（用户名直邀）</h3>
      <div class="row"><input v-model="invUser" placeholder="对方用户名"><button class="new" @click="invite">邀请</button></div>
      <h3>成员列表</h3>
      <div>
        <div v-for="m in members" :key="m.username" class="frow">
          <span class="nm">{{ m.username }}</span><span class="sz">{{ m.role }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
