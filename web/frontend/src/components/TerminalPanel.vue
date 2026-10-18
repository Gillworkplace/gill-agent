<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { useEvents } from '../stores/events'

const ev = useEvents()
const el = ref<HTMLElement>()
let xterm: Terminal | null = null
let fit: FitAddon | null = null
let fallbackBuf = ''

onMounted(() => {
  if (!el.value) return
  xterm = new Terminal({ fontSize: 12, theme: { background: '#0c0e12', foreground: '#9fe8b5' }, convertEol: true, disableStdin: true })
  fit = new FitAddon()
  xterm.loadAddon(fit)
  xterm.open(el.value)
  if (fallbackBuf) xterm.write(fallbackBuf.replace(/\n/g, '\n\n'))
  setTimeout(() => fit && fit.fit(), 300)
  ev.termSink = (data, stream) => {
    const txt = (stream === 'stderr' ? '\x1b[31m' : '') + data
    if (xterm) xterm.write(txt.replace(/\n/g, '\n\n'))
    else { fallbackBuf += txt; if (el.value) { el.value.textContent = fallbackBuf; el.value.scrollTop = el.value.scrollHeight } }
  }
})
watch(() => ev.termOpen, open => { if (open && fit) setTimeout(() => (fit as FitAddon).fit(), 50) })
onUnmounted(() => { ev.termSink = null; xterm?.dispose() })
</script>

<template>
  <div id="term" :class="{ on: ev.termOpen }" ref="el"></div>
</template>
