<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useEvents } from '../stores/events'
import ApprovalCard from './ApprovalCard.vue'

const emit = defineEmits<{ (e: 'undo-kb', id: string): void }>()
const ev = useEvents()
const box = ref<HTMLElement>()

function esc(s: string) { return s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string)) }

watch(() => ev.items.length, async () => {
  await nextTick()
  if (box.value) box.value.scrollTop = box.value.scrollHeight
}, { flush: 'post' })
// 流式追加也需跟随滚动（长度不变时 content 变化）
watch(() => ev.items.map(i => i.kind === 'ai' ? i.text.length : 0).join(','), async () => {
  await nextTick()
  if (box.value) box.value.scrollTop = box.value.scrollHeight
})
</script>

<template>
  <div id="stream" ref="box">
    <div v-if="!ev.items.length" class="hint">选择或新建一个会话开始 · Enter 发送 / Shift+Enter 换行 · Esc 停止 · Ctrl+` 终端</div>
    <template v-for="it in ev.items" :key="it.id">
      <div v-if="it.kind === 'user'" class="msg user">{{ it.text }}</div>
      <div v-else-if="it.kind === 'ai'" class="msg ai">{{ it.text }}</div>
      <div v-else-if="it.kind === 'sys'" class="msg sys">
        {{ it.text }}
        <span v-if="it.undoKbId" class="undo" @click="emit('undo-kb', it.undoKbId)">不该记？点击撤销</span>
      </div>
      <div v-else-if="it.kind === 'tool'" class="tool"><b>▶ {{ it.tool }}</b> {{ esc(it.args).slice(0, 120) }}</div>
      <ApprovalCard v-else-if="it.kind === 'appr'" :item="it" />
    </template>
  </div>
</template>
