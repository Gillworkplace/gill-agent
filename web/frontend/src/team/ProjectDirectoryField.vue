<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { api } from '../api'
import type { LocalDirectory } from './types'

type Root = Pick<LocalDirectory,'rootId'|'label'>
const props=defineProps<{value?:LocalDirectory; disabled?:boolean}>()
const emit=defineEmits<{select:[value:LocalDirectory|null];mode:[enabled:boolean]}>()
const dialog=ref<HTMLDialogElement>()
const enabled=ref(false), roots=ref<Root[]>([]), rootId=ref(''), pending=ref(false), error=ref('')
const directory=ref<{path:string;children:string[];hasGit:boolean}>()
const root=computed(()=>roots.value.find(item=>item.rootId===rootId.value))
const parent=computed(()=>directory.value?.path.split('/').slice(0,-1).join('/')||'')
const selectedLabel=computed(()=>{
 if(!root.value||!directory.value)return ''
 return directory.value.path?root.value.label.replace(/\/$/,'')+'/'+directory.value.path:root.value.label
})

async function loadRoots(){
 const response=await api<{enabled:boolean;runners:Root[]}>('/team-workspace/local-directories')
 enabled.value=response.enabled
 emit('mode',response.enabled)
 roots.value=response.runners
}

onMounted(()=>{void loadRoots().catch(()=>{})})

async function browse(path:string){
 if(!rootId.value||pending.value)return
 pending.value=true;error.value=''
 try{
  directory.value=await api('/team-workspace/local-directories/browse',{rootId:rootId.value,path})
 }catch(cause){
  error.value=cause instanceof Error?cause.message:'目录读取失败'
 }finally{pending.value=false}
}

async function refresh(){
 if(pending.value)return
 pending.value=true;error.value='';directory.value=undefined
 try{await loadRoots()}catch(cause){error.value=cause instanceof Error?cause.message:'执行器读取失败'}
 finally{pending.value=false}
 const saved=props.value
 rootId.value=roots.value.find(item=>item.rootId===saved?.rootId)?.rootId||roots.value[0]?.rootId||''
 if(rootId.value)await browse(rootId.value===saved?.rootId?saved.path:'')
}

async function open(){
 await nextTick()
 dialog.value?.showModal()
 await refresh()
}

function changeRoot(){
 directory.value=undefined
 void browse('')
}

function choose(){
 if(!directory.value||!root.value||pending.value||error.value)return
 emit('select',{rootId:root.value.rootId,path:directory.value.path,label:selectedLabel.value,hasGit:directory.value.hasGit})
 dialog.value?.close()
}
</script>

<template>
 <div v-if="enabled" class="project-directory-field">
  <div class="team-row between">
   <div><b>CLI 本地目录</b>
    <p v-if="value" class="project-directory-path"><code>{{value.label}}</code></p>
    <p v-else class="team-muted">从 CLI 的启动目录或其子目录选择工作位置。</p>
   </div>
   <div class="team-row resource-actions">
    <button type="button" class="secondary" :disabled="disabled" @click="open">选择本地目录</button>
    <button v-if="value" type="button" class="text-button" :disabled="disabled" @click="emit('select',null)">解除绑定</button>
   </div>
  </div>
  <dialog ref="dialog" class="project-directory-dialog" aria-labelledby="project-directory-title" @click.self="dialog?.close()">
   <header class="team-row between">
    <h2 id="project-directory-title">选择 CLI 本地目录</h2>
    <button type="button" class="secondary small" aria-label="关闭目录选择" @click="dialog?.close()">×</button>
   </header>
   <div v-if="roots.length">
    <label>CLI 启动目录<select v-model="rootId" :disabled="pending" @change="changeRoot">
     <option v-for="item in roots" :key="item.rootId" :value="item.rootId">{{item.label}}</option>
    </select></label>
    <template v-if="directory">
     <p class="project-directory-path"><code>{{selectedLabel}}</code></p>
     <button v-if="directory.path" type="button" class="text-button" :disabled="pending" @click="browse(parent)">↑ 上一级</button>
     <ul v-if="directory.children.length" class="project-directory-list" aria-label="子目录">
      <li v-for="name in directory.children" :key="name">
       <button type="button" class="secondary" :disabled="pending" @click="browse(directory.path?directory.path+'/'+name:name)">{{name}} <span aria-hidden="true">›</span></button>
      </li>
     </ul>
     <p v-else class="team-muted">当前目录下没有可选子目录。</p>
    </template>
   </div>
   <p v-if="pending" class="team-muted" role="status">正在读取 CLI 目录…</p>
   <p v-else-if="!roots.length&&!error" class="team-muted">当前没有开放目录的 CLI。请启动 <code>gill team-worker</code>，用 <code>--directory</code> 指定想开放的目录。</p>
   <p v-if="error" class="team-error" role="alert">{{error}}</p>
   <footer class="team-row resource-actions">
    <button v-if="!roots.length||error" type="button" class="secondary" :disabled="pending" @click="refresh">重新读取</button>
    <button type="button" class="secondary" @click="dialog?.close()">取消</button>
    <button type="button" :disabled="!directory||pending||!!error" @click="choose">选用当前目录</button>
   </footer>
  </dialog>
 </div>
</template>

<style scoped>
.project-directory-field{margin:16px 0;padding:14px;border:1px solid var(--team-line);border-radius:8px}
.project-directory-field>.team-row{flex-wrap:wrap}
.project-directory-path{overflow-wrap:anywhere}
.team-app .project-directory-dialog{
 position:fixed;inset:0;margin:auto;width:min(540px,100% - 30px);max-width:none;
 height:fit-content;max-height:calc(100% - 30px);overflow:auto;padding:22px;
 border:1px solid var(--team-line);border-radius:14px;background:#fff;color:var(--team-ink)
}
.project-directory-dialog::backdrop{background:#17213c58}
.project-directory-dialog h2{margin:0}
.project-directory-list{list-style:none;display:grid;gap:5px;max-height: min(32vh,280px);overflow:auto;padding:0}
.project-directory-list button{display:flex;justify-content:space-between;gap:12px;width:100%;text-align:left;overflow-wrap:anywhere}
.project-directory-dialog footer{margin-top:16px}
</style>
