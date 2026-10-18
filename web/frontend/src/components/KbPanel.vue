<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api } from '../api'
import { useWorkspace } from '../stores/workspace'
import type { KbItem } from '../types'

const emit = defineEmits<{ (e: 'close'): void }>()
const ws = useWorkspace()
const q = ref('')
const items = ref<KbItem[]>([])

async function load() {
  if (!ws.curSpaceId) return
  items.value = await api<KbItem[]>(`/spaces/${ws.curSpaceId}/knowledge${q.value ? '?q=' + encodeURIComponent(q.value) : ''}`)
}
async function add() {
  const title = prompt('标题'); if (!title) return
  const content = prompt('内容'); if (!content) return
  await api(`/spaces/${ws.curSpaceId}/knowledge`, { title, content, type: 'fact', scope: 'user' })
  await load()
}
async function del(id: string) {
  if (!confirm('删除该条知识？')) return
  await api('/knowledge/' + id, undefined, 'DELETE')
  await load()
}
async function pin(id: string, pinned: boolean) {
  await api('/knowledge/' + id, { pinned }, 'PATCH')
  await load()
}
onMounted(load)
</script>

<template>
  <div id="kb" class="on">
    <div class="bar">
      <h2>📚 知识库</h2>
      <input v-model="q" placeholder="搜索…" @input="load">
      <button class="new" @click="add">＋ 添加</button>
      <button class="new" @click="emit('close')">返回工作台</button>
    </div>
    <div id="kblist">
      <div v-for="i in items" :key="i.id" class="kbcard">
        <div class="t">{{ i.title }} <span class="tag">{{ i.type }}</span> <span class="tag">{{ i.scope }}</span> <span v-if="i.pinned" class="tag">📌</span></div>
        <div class="c">{{ i.content }}</div>
        <div class="ops">
          <span>命中 {{ i.hit_count }} 次</span><span>来源 {{ i.source === 'explicit' ? '手动' : '对话沉淀' }}</span>
          <span style="margin-left:auto" @click="pin(i.id, !i.pinned)">置顶</span>
          <span @click="del(i.id)">删除</span>
        </div>
      </div>
      <div v-if="!items.length" class="hint" style="margin:40px auto">暂无知识条目 —— 在对话中说“记住 xxx”即可沉淀</div>
    </div>
  </div>
</template>
