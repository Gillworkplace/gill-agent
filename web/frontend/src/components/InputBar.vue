<script setup lang="ts">
import { ref } from 'vue'
import { useWorkspace } from '../stores/workspace'
import { useEvents } from '../stores/events'

const ws = useWorkspace()
const ev = useEvents()
const text = ref('')

function sendOrStop() {
  if (ev.taskRunning) { ev.send({ type: 'stop', payload: {} }); return }
  const t = text.value.trim()
  if (!t || !ws.cur) return
  ev.addUser(t)
  text.value = ''
  ev.taskRunning = true
  ev.connect(ws.cur)
  ev.sendTask(t)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendOrStop() }
}
</script>

<template>
  <div id="modebar">
    审批档：
    <button id="mAuto" :class="{ on: ev.approvalMode === 'auto' }" @click="ev.setMode('auto')">auto 全自动</button>
    <button id="mSug" :class="{ on: ev.approvalMode === 'suggest' }" @click="ev.setMode('suggest')">suggest 需审批</button>
  </div>
  <div id="inputbar">
    <textarea id="input" v-model="text" rows="1"
      placeholder="描述任务，例如：写一个脚本并在沙箱运行验证…（Enter 发送）" @keydown="onKeydown"></textarea>
    <button id="send" :class="{ stop: ev.taskRunning }" @click="sendOrStop">{{ ev.taskRunning ? '停止' : '发送' }}</button>
  </div>
</template>
