<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useEvents } from '../stores/events'

const ev = useEvents()
const url = ref('')
const fps = ref('')
const cv = ref<HTMLCanvasElement>()
let frameCount = 0
let frameT0 = 0

function toggle() {
  ev.previewOpen = !ev.previewOpen
  if (!ev.previewOpen) ev.send({ type: 'preview_stop', payload: {} })
  else { frameT0 = performance.now(); frameCount = 0; ev.send({ type: 'preview_start', payload: { quality: 'mid' } }) }
}
function opMode() {
  ev.send({ type: 'op_lock', payload: { action: 'mode', mode: 'relay' } })
  ev.addSys('已切接力模式（多人协作防误触）')
}
function toggleDemo() {
  ev.demoMode = !ev.demoMode
  if (ev.demoMode) { ev.previewOpen = true; ev.addSys('🎬 演示模式：你的导航将同步给空间内其他成员') }
  else ev.addSys('演示模式已结束')
}
function navigate() {
  let u = url.value.trim()
  if (!u) return
  if (!/^https?:/.test(u)) u = 'https://' + u
  ev.send({ type: 'browser_navigate', payload: { url: u } })
  if (ev.demoMode) ev.send({ type: 'nav_follow', payload: { url: u } })
}
function onClick(e: MouseEvent) {
  if (!cv.value) return
  const r = cv.value.getBoundingClientRect()
  const x = (e.clientX - r.left) * (cv.value.width / r.width)
  const y = (e.clientY - r.top) * (cv.value.height / r.height)
  ev.send({ type: 'input_event', payload: { kind: 'mouse_click', x, y, button: 'left' } })
  setTimeout(() => ev.send({ type: 'input_event', payload: { kind: 'mouse_up', x, y, button: 'left' } }), 60)
}

onMounted(() => {
  ev.frameSink = async (b64: string) => {
    if (!cv.value) return
    const img = new Image()
    img.src = 'data:image/jpeg;base64,' + b64
    await img.decode().catch(() => {})
    const ctx = cv.value.getContext('2d')!
    if (cv.value.width !== img.width) { cv.value.width = img.width; cv.value.height = img.height }
    ctx.drawImage(img, 0, 0)
    frameCount++
    const dt = (performance.now() - frameT0) / 1000
    if (dt > 1) { fps.value = (frameCount / dt).toFixed(1) + ' fps'; frameT0 = performance.now(); frameCount = 0 }
  }
})
onUnmounted(() => { ev.frameSink = null })
</script>

<template>
  <div v-if="ev.previewOpen" id="preview" class="on">
    <div class="bar">
      <b>🌐 浏览器预览</b>
      <input v-model="url" placeholder="输入网址回车导航" @keydown.enter="navigate">
      <span class="sp"></span>
      <span class="fps">{{ fps }}</span>
      <button @click="toggleDemo">🎬 演示</button>
      <button @click="opMode">接力</button>
      <button @click="toggle">关闭</button>
    </div>
    <canvas ref="cv" @mousedown="onClick"></canvas>
  </div>
</template>
