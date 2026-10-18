<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useEvents } from '../stores/events'

const ev = useEvents()
const text = ref('')
const msgsEl = ref<HTMLElement>()

function send() {
  const t = text.value.trim()
  if (!t) return
  ev.sendChat(t)
  text.value = ''
}
watch(() => ev.chatMsgs.length, async () => {
  await nextTick()
  if (msgsEl.value) msgsEl.value.scrollTop = msgsEl.value.scrollHeight
})
</script>

<template>
  <div v-if="ev.chatOpen" id="chat" class="on">
    <div class="bar">💬 成员聊天（@agent 转任务）</div>
    <div id="chatmsgs" ref="msgsEl">
      <div v-for="(m, i) in ev.chatMsgs" :key="i" class="m"><b>{{ m.who }}</b> {{ m.text }}</div>
    </div>
    <div class="inp">
      <input v-model="text" placeholder="说点什么… / @agent 帮我…" @keydown.enter="send">
      <button @click="send">送</button>
    </div>
  </div>
</template>
