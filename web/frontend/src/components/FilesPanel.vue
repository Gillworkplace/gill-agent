<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { api } from '../api'
import { useWorkspace } from '../stores/workspace'
import { useEvents } from '../stores/events'
import type { FileItem, PreviewResp, UploadStartResp } from '../types'

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'preview', p: { name: string; content: string }): void
}>()
const ws = useWorkspace()
const ev = useEvents()
const files = ref<FileItem[]>([])
const treeMode = ref(false)
const treeRows = ref<string[]>([])
const objectKeys = ref<Record<string, string>>({})
const fileInput = ref<HTMLInputElement>()

async function load() {
  if (!ws.curSpaceId) return
  files.value = await api<FileItem[]>(`/spaces/${ws.curSpaceId}/files`)
  treeMode.value = false
}
function refreshTree() { ev.send({ type: 'file_list', payload: {} }) }
watch(() => ev.filesVersion, () => {
  treeRows.value = (ev.fileTree.split('---SIZES---')[0] || '').trim().split('\n').filter(Boolean)
  treeMode.value = true
})

async function onUpload(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || !ws.cur) return
  try {
    const r = await api<UploadStartResp>('/files/uploads', { filename: file.name, size: file.size, sessionId: ws.cur })
    objectKeys.value[r.uploadId] = r.objectKey
    await fetch(r.url, { method: 'PUT', body: file })
    await api(`/files/uploads/${r.uploadId}/complete`, {})
    ev.addSys(`📎 已上传 ${file.name}（${(file.size / 1024).toFixed(0)}KB）`)
    await load()
  } catch (err: any) { ev.addSys('上传失败：' + err.message) }
  input.value = ''
}

function sync(f: FileItem) {
  if (!ws.cur) { ev.addSys('请先选择会话'); return }
  ev.send({ type: 'file_sync_in', payload: { objectKey: objectKeys.value[f.id] || '', filename: f.filename } })
  ev.addSys(`⏳ 同步 ${f.filename} → 沙箱 /home/user/uploads/`)
}
function exportFile(path: string) { ev.send({ type: 'file_export', payload: { path: '/home/user/' + path } }) }

async function preview(f: FileItem) {
  const r = await api<PreviewResp>(`/files/${f.id}/preview`)
  if (r.type === 'text') emit('preview', { name: f.filename, content: r.content || '' })
  else if (r.type === 'image') open(r.url!, '_blank')
  else ev.addSys(`${f.filename}：二进制文件，请下载查看`)
}
async function download(f: FileItem) {
  const r = await api<{ url: string; filename: string }>(`/files/${f.id}/download-url`, {})
  const a = document.createElement('a')
  a.href = r.url; a.download = r.filename; a.click()
}

onMounted(load)
</script>

<template>
  <div id="fpanel" class="on">
    <div class="bar">
      <b>📁 文件</b><span style="flex:1"></span>
      <button @click="fileInput?.click()">⬆ 上传</button>
      <button @click="refreshTree">⟳ 工作区</button>
      <button @click="emit('close')">✕</button>
      <input ref="fileInput" type="file" style="display:none" @change="onUpload">
    </div>
    <div id="flist">
      <template v-if="treeMode">
        <div v-for="l in treeRows" :key="l" class="frow">
          <span class="nm">{{ l }}</span>
          <button @click="exportFile(l)">导出</button>
        </div>
        <div v-if="!treeRows.length" class="hint2">工作区为空</div>
      </template>
      <template v-else>
        <div v-for="f in files" :key="f.id" class="frow">
          <span class="nm">{{ f.filename }}</span>
          <span class="sz">{{ (f.size_bytes / 1024).toFixed(0) }}KB·{{ f.status }}</span>
          <button v-if="f.direction === 'upload'" @click="sync(f)">同步到沙箱</button>
          <button @click="preview(f)">预览</button>
          <button @click="download(f)">下载</button>
        </div>
        <div v-if="!files.length" class="hint2">上传件经 MinIO 直传；「同步」送入沙箱工作区</div>
      </template>
    </div>
  </div>
</template>
