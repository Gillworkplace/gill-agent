<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue'
import { useEvents } from '../stores/events'
import type { StreamItem } from '../types'

const props = defineProps<{ item: Extract<StreamItem, { kind: 'appr' }> }>()
const ev = useEvents()
const left = ref(props.item.left)
let timer: number | undefined

function startTimer() {
  timer = window.setInterval(() => {
    if (props.item.state !== 'pending') { clearInterval(timer); return }
    left.value--
    if (left.value <= 0) clearInterval(timer)
  }, 1000)
}
startTimer()
watch(() => props.item.state, s => { if (s !== 'pending' && timer) clearInterval(timer) })
onUnmounted(() => { if (timer) clearInterval(timer) })

const stateText: Record<string, string> = {
  approved: '已批准', denied: '已拒绝', timeout: '已拒绝（超时）', always: '本会话免批'
}
</script>

<template>
  <div class="appr">
    <span class="risk" :class="item.riskLevel">{{ item.riskLevel === 'high' ? '高危' : '中危' }}</span>
    <span class="reason">{{ item.reason }}</span>
    <div class="cmd">{{ item.command }}</div>
    <div class="btns">
      <template v-if="item.state === 'pending'">
        <button class="y" @click="ev.respondApproval(item.cid, 'approve')">批准</button>
        <button class="n" @click="ev.respondApproval(item.cid, 'deny')">拒绝</button>
        <button class="a" @click="ev.respondApproval(item.cid, 'always_allow')">本会话总是允许</button>
        <span class="cnt">{{ left }}s</span>
      </template>
      <span v-else class="cnt">{{ stateText[item.state] }}</span>
    </div>
  </div>
</template>
