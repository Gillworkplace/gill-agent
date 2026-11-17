<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useTeams } from './store'
import { api } from '../api'
const props=defineProps<{teamId:string}>()
const store=useTeams(),selected=ref(''),editing=ref(false),name=ref(''),description=ref(''),repository=ref(''),target=ref('main'),check=ref(''),protectedBranches=ref('')
const tab=ref('documents'),documentId=ref(''),title=ref(''),content=ref(''),version=ref<number>()
const baseRevision=ref(0),baseDocumentRevision=ref(0)
const projects=computed(()=>Object.values(store.data.projects).filter(p=>p.teamId===props.teamId))
const current=computed(()=>store.data.projects[selected.value])
const document=computed(()=>current.value?.documents?.[documentId.value])
const work=computed(()=>Object.values(store.data.workItems).filter(w=>w.projectId===selected.value))
function open(id=''){selected.value=id;const p=store.data.projects[id];baseRevision.value=p?.revision||0;name.value=p?.name||'';description.value=p?.description||'';repository.value=p?.repositoryUrl||'';target.value=p?.targetBranch||'main';check.value=p?.checkCommand||'';protectedBranches.value=p?.protectedBranches?.join(',')||'';editing.value=!id;documentId.value='';title.value='';content.value='';version.value=undefined}
function editDocument(id=''){documentId.value=id;const d=current.value?.documents?.[id];baseDocumentRevision.value=d?.revision||0;title.value=d?.title||'';content.value=d?.content||'';version.value=undefined}
async function saveProject(){try{const result=await store.command('project.save',{...(current.value?{id:current.value.id,expectedRevision:baseRevision.value}:{}),teamId:props.teamId,name:name.value,description:description.value,repositoryUrl:repository.value,targetBranch:target.value,checkCommand:check.value,protectedBranches:protectedBranches.value.split(',').map(x=>x.trim()).filter(Boolean)});open(result.id)}catch{}}
async function saveDocument(){try{const result=await store.command('document.save',{projectId:selected.value,...(document.value?{id:document.value.id,expectedRevision:baseDocumentRevision.value}:{}),title:title.value,content:content.value});editDocument(result.id)}catch{}}
async function integrate(taskId:string,commit:string){try{await store.command('integration.request',{taskId,projectId:selected.value,sourceRef:commit,expectedTarget:current.value?.baselineCommit})}catch{}}
async function download(key:string){try{const result=await api<{url:string}>('/team-workspace/object-url?key='+encodeURIComponent(key));location.assign(result.url)}catch(error){store.error=error instanceof Error?error.message:'下载失败'}}
watch(()=>props.teamId,()=>open())
</script>
<template>
 <div><header class="team-page-head"><div><h2>团队项目库</h2><p class="team-muted">归档文档、跟进并行需求，保留工作版本和集成结果。</p></div><button @click="open()">＋ 新建项目</button></header>
 <div class="project-picker"><button v-for="p in projects" :key="p.id" class="secondary" :class="{active:selected===p.id}" @click="open(p.id)">{{p.name}}</button></div>
 <form v-if="editing" class="team-card" @submit.prevent="saveProject"><h3>{{current?'编辑项目':'新建项目'}}</h3><label>项目名称<input v-model="name" required/></label><label>项目说明<textarea v-model="description"/></label><details><summary>代码版本与集成配置（业务项目可留空）</summary><label>HTTPS代码读取源<input v-model="repository" placeholder="可选；首期不接收URL内嵌凭证"/></label><label>授权集成目标分支<input v-model="target"/></label><label>受保护分支<input v-model="protectedBranches" placeholder="逗号分隔，禁止模型自动集成"/></label><label>项目检查命令<textarea v-model="check" placeholder="例如：npm test；需由你为项目配置"/></label></details><button :disabled="store.busy||!name.trim()">保存项目</button></form>
 <section v-if="current"><div class="team-row between"><div><h2>{{current.name}}</h2><p>{{current.description}}</p></div><button class="secondary" @click="editing=!editing">项目配置</button></div>
 <nav class="team-tabs"><button v-for="[id,label] in [['documents','文档归档'],['work','并行需求'],['versions','版本与集成']]" :key="id" class="secondary" :class="{active:tab===id}" @click="tab=id">{{label}}</button></nav>
 <div v-if="tab==='documents'" class="knowledge-layout"><section class="team-card"><button class="secondary" @click="editDocument()">＋ 新文档</button><button v-for="d in current.documents||{}" :key="d.id" class="template-select" @click="editDocument(d.id)">{{d.title}} · v{{d.revision}}</button></section><form class="team-card" @submit.prevent="saveDocument"><label>文档标题<input v-model="title" required/></label><label>内容<textarea v-model="content" rows="12" required/></label><button :disabled="store.busy||!title||!content">{{document?'追加文档版本':'归档文档'}}</button><details v-if="document"><summary>历史版本</summary><div class="team-row"><button v-for="v in document.versions" :key="v.revision" type="button" class="secondary small" @click="version=v.revision">v{{v.revision}}</button></div><pre v-if="version">{{document.versions.find(v=>v.revision===version)?.content}}</pre></details></form></div>
 <section v-else-if="tab==='work'" class="team-grid"><article v-for="item in work" :key="item.id" class="team-card"><h3>{{item.goal}}</h3><small>独立工作项 {{item.id.slice(0,8)}}</small><p v-for="task in Object.values(store.data.tasks).filter(t=>t.runId===item.runId)" :key="task.id">{{store.data.employees[task.employeeId]?.name}} · {{task.goal}} · {{task.state}}</p></article><p v-if="!work.length" class="team-muted">在群聊关联本项目并提出目标后，会在这里记录并行需求。</p></section>
 <section v-else><p class="team-muted">目标 {{current.targetBranch||'main'}} · 当前受控基线 {{current.baselineCommit?.slice(0,12)||'尚无代码版本'}}。集成保存在平台项目基线，不表示已推送外部仓库。</p><article v-for="v in Object.values(store.data.codeVersions).filter(v=>v.projectId===selected)" :key="v.id" class="team-card"><h3>{{v.summary||'代码版本'}}</h3><p>{{v.commit}} · 工作任务 {{v.taskId.slice(0,8)}}</p><div class="team-row"><button class="secondary" @click="download(v.bundleKey)">下载版本归档</button><button :disabled="store.busy" @click="integrate(v.taskId,v.commit)">检查并集成本版</button></div></article><article v-for="i in Object.values(store.data.integrations).filter(i=>i.projectId===selected)" :key="i.id" class="team-card"><b>集成 {{i.state}}</b><pre>{{i.result}}</pre></article></section>
 </section></div>
</template>
