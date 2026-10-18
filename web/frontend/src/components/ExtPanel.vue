<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api } from '../api'
import { useWorkspace } from '../stores/workspace'
import type { ExtItem } from '../types'

const emit = defineEmits<{ (e: 'close'): void }>()
const ws = useWorkspace()
const list = ref<ExtItem[]>([])

async function load() {
  if (!ws.curSpaceId) return
  list.value = await api<ExtItem[]>(`/spaces/${ws.curSpaceId}/extensions`)
}
async function add() {
  const kind = prompt('类型：1=HTTP工具 2=脚本工具 3=MCP服务器 4=技能', '1')
  const name = prompt('名称（小写字母数字-）')
  if (!name) return
  try {
    if (kind === '3') {
      const url = prompt('MCP 端点（Streamable HTTP，如 http://host/mcp）')
      const auth = prompt('鉴权头（可空，如 Bearer xxx）')
      await api(`/spaces/${ws.curSpaceId}/extensions`, { name, extType: 'mcp', manifest: { mcp: { url, headers: auth ? { Authorization: auth } : {} } } })
    } else if (kind === '4') {
      const desc = prompt('技能描述'); const body = prompt('技能指导正文（何时用/怎么做）')
      await api(`/spaces/${ws.curSpaceId}/extensions`, { name, extType: 'skill', manifest: { skill: { description: desc, body_md: body } } })
    } else if (kind === '2') {
      const code = prompt('Python 源码（def 内逻辑，参数经 JSON argv[1]）')
      await api(`/spaces/${ws.curSpaceId}/extensions`, { name, extType: 'script-tools', manifest: { tools: [{ name: 'run', desc: name, code, params: {} }] } })
    } else {
      const url = prompt('工具 URL（如 https://api.corp.com/tickets/{id}）')
      if (!url) return
      const host = new URL(url.replace('{id}', 'x')).hostname
      await api(`/spaces/${ws.curSpaceId}/extensions`, { name, manifest: { tools: [{ name: 'call', desc: `调用 ${name}`, method: 'GET', url, params: {}, network: [host] }] } })
    }
    await load()
  } catch (e: any) { alert('创建失败：' + e.message) }
}
async function toggle(x: ExtItem) {
  await api('/extensions/' + x.id, { status: x.status === 'enabled' ? 'disabled' : 'enabled' }, 'PATCH')
  await load()
}
async function del(x: ExtItem) {
  if (!confirm('删除扩展？')) return
  await api('/extensions/' + x.id, undefined, 'DELETE')
  await load()
}
onMounted(load)
</script>

<template>
  <div id="ex" class="on">
    <div class="bar">
      <h2>🔌 扩展中心</h2>
      <button class="new" @click="add">＋ HTTP 工具</button>
      <button class="new" @click="emit('close')">返回</button>
    </div>
    <div id="exList">
      <div v-for="x in list" :key="x.id" class="kbcard">
        <div class="t">{{ x.name }} <span class="tag">{{ x.type }}</span> <span class="tag">{{ x.status }}</span></div>
        <div class="c">HTTP 工具集 · v{{ x.version }}</div>
        <div class="ops">
          <span>调用 {{ x.call_count_7d }} 次</span>
          <span style="margin-left:auto" @click="toggle(x)">{{ x.status === 'enabled' ? '停用' : '启用' }}</span>
          <span @click="del(x)">删除</span>
        </div>
      </div>
      <div v-if="!list.length" class="hint2">暂无扩展</div>
    </div>
  </div>
</template>
