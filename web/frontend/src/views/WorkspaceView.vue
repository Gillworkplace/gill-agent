<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { api } from '../api'
import { useAuth } from '../stores/auth'
import { useWorkspace } from '../stores/workspace'
import { useEvents } from '../stores/events'
import Sidebar from '../components/Sidebar.vue'
import ChatStream from '../components/ChatStream.vue'
import InputBar from '../components/InputBar.vue'
import TerminalPanel from '../components/TerminalPanel.vue'
import PreviewPanel from '../components/PreviewPanel.vue'
import FilesPanel from '../components/FilesPanel.vue'
import TextPreview from '../components/TextPreview.vue'
import KbPanel from '../components/KbPanel.vue'
import ExtPanel from '../components/ExtPanel.vue'
import SpaceManager from '../components/SpaceManager.vue'
import AdminPanel from '../components/AdminPanel.vue'
import MemberChat from '../components/MemberChat.vue'

const auth = useAuth()
const ws = useWorkspace()
const ev = useEvents()

const drawerOpen = ref(false)
const showFiles = ref(false)
const showKb = ref(false)
const showExt = ref(false)
const showSpaceMgr = ref(false)
const showAdm = ref(false)
const textPreview = ref<{ name: string; content: string } | null>(null)

function openPanel(which: 'files' | 'kb' | 'ext' | 'space' | 'adm') {
  showFiles.value = which === 'files'
  showKb.value = which === 'kb'
  showExt.value = which === 'ext'
  showSpaceMgr.value = which === 'space'
  showAdm.value = which === 'adm'
  drawerOpen.value = false   // 移动端：从抽屉打开面板后须收起抽屉，否则关面板时抽屉仍遮挡内容
}

function togglePreview() {
  ev.previewOpen = !ev.previewOpen
  drawerOpen.value = false
}

async function openSession(id: string) {
  ws.cur = id
  drawerOpen.value = false
  ev.openStream()
  const msgs = await ws.hist(id)
  for (const m of msgs) {
    if (m.role === 'user') ev.addUser(m.content)
    else if (m.role === 'assistant' && m.content) ev.appendAi(m.content)
  }
  ev.connect(id)
}

async function createAndOpen() {
  const s = await ws.newSession()
  await openSession(s.id)
}

async function undoKb(id: string) {
  await api('/knowledge/' + id, undefined, 'DELETE')
  ev.addSys('已撤销该条记忆')
}

function toggleTheme() {
  const h = document.documentElement
  h.dataset.theme = h.dataset.theme === 'dark' ? '' : 'dark'
  localStorage.setItem('gill_theme', h.dataset.theme)
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && ev.taskRunning) ev.send({ type: 'stop', payload: {} })
  if (e.ctrlKey && e.key === '`') ev.termOpen = !ev.termOpen
}

onMounted(async () => {
  window.addEventListener('keydown', onKey)
  await auth.me()
  await ws.loadSpaces()
  await ws.loadSessions()
  if (ws.sessions.length) await openSession(ws.sessions[0].id)
  else await createAndOpen()
})
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="workspace on">
    <div v-if="ev.banner" id="banner" class="on">连接中断，正在重连…</div>
    <Sidebar
      :drawer-open="drawerOpen"
      @toggle-drawer="drawerOpen = !drawerOpen"
      @open-session="openSession"
      @new-session="createAndOpen"
      @open-panel="openPanel"
      @close-drawer="drawerOpen = false"
      @toggle-preview="togglePreview"
      @toggle-theme="toggleTheme"
    />
    <main>
      <div id="mtop">
        <button id="menuBtn" @click="drawerOpen = !drawerOpen">☰</button>
        <b>Gill Agent</b><span class="sp"></span>
        <span class="who">{{ auth.user }}</span>
      </div>
      <ChatStream @undo-kb="undoKb" />
      <InputBar />
      <TerminalPanel />
    </main>

    <PreviewPanel />
    <FilesPanel v-if="showFiles" @close="showFiles = false" @preview="textPreview = $event" />
    <TextPreview v-if="textPreview" :name="textPreview.name" :content="textPreview.content" @close="textPreview = null" />
    <KbPanel v-if="showKb" @close="showKb = false" />
    <ExtPanel v-if="showExt" @close="showExt = false" />
    <SpaceManager v-if="showSpaceMgr" @close="showSpaceMgr = false" />
    <AdminPanel v-if="showAdm" @close="showAdm = false" />
    <MemberChat />
  </div>
</template>
