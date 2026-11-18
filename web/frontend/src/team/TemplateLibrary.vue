<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useTeams } from './store'
import { uploadTemplateFiles } from './templateFiles'
import type { Skill, TemplateFile } from './types'

const store=useTeams()
const mode=ref<'library'|'chat'|'edit'>('library')
const selected=ref(''),draftId=ref(''),text=ref(''),name=ref(''),prompt=ref(''),note=ref('')
const skills=ref<Skill[]>([]),files=ref<TemplateFile[]>([]),sharing=ref<string[]>([])
const baseRevision=ref(0),uploading=ref(false),importError=ref('')
const folderInput=ref<HTMLInputElement>(),fileInput=ref<HTMLInputElement>(),chatInput=ref<HTMLTextAreaElement>()
let importSequence=0
const current=computed(()=>store.data.templates[selected.value])
const draft=computed(()=>store.data.drafts[draftId.value])
const templates=computed(()=>Object.values(store.data.templates))
const drafts=computed(()=>Object.values(store.data.drafts))
const hasConfig=computed(()=>Boolean(prompt.value.trim()||skills.value.length||files.value.some(f=>f.purpose!=='resource')))
const hasPreview=computed(()=>mode.value==='edit'||Boolean(name.value||hasConfig.value||files.value.length))
const pageBusy=computed(()=>store.busy||uploading.value||draft.value?.busy)

function start(next:'library'|'chat'|'edit'){
 importSequence++
 mode.value=next
 selected.value='';draftId.value='';name.value='';prompt.value='';text.value='';note.value=''
 skills.value=[];files.value=[];sharing.value=[];importError.value='';uploading.value=false
 if(next==='chat')nextTick(()=>chatInput.value?.focus())
}
function open(id:string){
 const template=store.data.templates[id]
 start('edit')
 selected.value=id;baseRevision.value=template.revision
 sharing.value=[...(template.authorizedTeamIds||[])]
 name.value=template.name;prompt.value=template.prompt
 skills.value=template.skills.map(skill=>({...skill}))
 files.value=(template.files||[]).map(file=>({...file}))
}
function openDraft(id:string){
 start('chat')
 draftId.value=id
 const saved=store.data.drafts[id]
 name.value=saved.name||'';prompt.value=saved.prompt||''
 skills.value=(saved.skills||[]).map(skill=>({...skill}))
 files.value=(saved.files||[]).map(file=>({...file}))
}
async function importFiles(event:Event){
 const input=event.target as HTMLInputElement
 const chosen=Array.from(input.files||[])
 input.value=''
 if(!chosen.length)return
 if(mode.value==='library')start('edit')
 const sequence=++importSequence
 uploading.value=true;importError.value=''
 try{
  const result=await uploadTemplateFiles(chosen)
  if(sequence!==importSequence)return
  const merged=new Map(files.value.map(file=>[file.path,file]))
  for(const file of result.files){
   const previous=merged.get(file.path)
   const purpose=previous&&file.utf8&&file.size?previous.purpose:file.purpose
   merged.set(file.path,{...file,purpose})
  }
  const packageFiles=[...merged.values()]
  if(packageFiles.length>128||packageFiles.reduce((sum,file)=>sum+file.size,0)>20*1024*1024)
   throw new Error('当前模板最多可保留 128 个文件，合计不超过 20 MB。')
  files.value=packageFiles.sort((a,b)=>a.path.localeCompare(b.path))
  if(!name.value&&result.root)name.value=result.root
 }catch(error){
  if(sequence===importSequence)importError.value=error instanceof Error?error.message:'导入失败，请重试。'
 }finally{
  if(sequence===importSequence)uploading.value=false
 }
}
async function chat(){
 if(!text.value.trim()||pageBusy.value)return
 try{
  const result=await store.command('template.generate',{id:draftId.value,text:text.value.trim(),
   draft:{name:name.value,prompt:prompt.value,skills:skills.value,files:files.value}})
  draftId.value=result.id;text.value=''
 }catch{}
}
async function save(){
 if(pageBusy.value||!hasConfig.value)return
 try{
  const result=await store.command('template.save',{...(selected.value?{id:selected.value,expectedRevision:baseRevision.value}:{}),
   name:name.value,prompt:prompt.value,skills:skills.value,files:files.value,draftId:draftId.value,reason:note.value})
  open(result.id)
 }catch{}
}
async function share(){
 if(!current.value)return
 try{await store.command('template.share',{id:current.value.id,expectedRevision:baseRevision.value,teamIds:sharing.value})}catch{}
}
function removeFile(path:string){files.value=files.value.filter(file=>file.path!==path)}
function skillsCount(template:{skills:Skill[];files?:TemplateFile[]}){
 return template.skills.length+(template.files?.filter(file=>file.purpose==='skill').length||0)
}
watch(()=>draft.value?.busy,(busy,previous)=>{
 if(busy===false&&previous!==false&&draft.value&&!draft.value.error){
  name.value=draft.value.name||'';prompt.value=draft.value.prompt||''
  skills.value=(draft.value.skills||[]).map(skill=>({...skill}))
 }
})
</script>

<template>
 <div class="team-page template-page">
  <input ref="folderInput" type="file" webkitdirectory multiple hidden aria-label="选择模板文件夹" @change="importFiles"/>
  <input ref="fileInput" type="file" multiple hidden aria-label="选择模板文件" @change="importFiles"/>
  <header class="team-page-head">
   <div>
    <button v-if="mode!=='library'" type="button" class="text-button" @click="start('library')">← 返回模板库</button>
    <h1>数字员工模板</h1>
    <p v-if="mode==='library'" class="team-muted">管理可复用的工作指令、Skills 和参考文件。</p>
   </div>
   <div v-if="mode==='library'&&(templates.length||drafts.length)" class="team-row">
    <button class="secondary" @click="folderInput?.click()">导入文件夹</button>
    <button @click="start('chat')">新建模板</button>
   </div>
   <button v-else-if="mode==='edit'" class="secondary" @click="mode='chat'">用对话完善</button>
  </header>

  <template v-if="mode==='library'">
   <section v-if="!templates.length&&!drafts.length" class="template-start" aria-labelledby="template-start-title">
    <div class="template-figure" aria-hidden="true"><i></i><i></i><i></i></div>
    <h2 id="template-start-title">创建第一个数字员工模板</h2>
    <p>从对话开始，或导入已有的指令、Skills 和资料。</p>
    <div class="team-row template-start-actions">
     <button @click="start('chat')">对话创建</button>
     <button class="secondary" @click="folderInput?.click()">导入文件夹</button>
    </div>
    <button class="text-button" @click="start('edit')">手动填写</button>
   </section>
   <section v-if="templates.length" class="template-list" aria-label="已保存模板">
    <button v-for="template in templates" :key="template.id" class="secondary template-library-item" @click="open(template.id)">
     <b>{{template.name}}</b>
     <small>v{{template.revision}} · {{skillsCount(template)}} 项 Skills<span v-if="template.files?.length"> · {{template.files.length}} 个文件</span></small>
    </button>
   </section>
   <section v-if="drafts.length" class="template-drafts">
    <h2>继续草稿</h2>
    <div class="team-row">
     <button v-for="saved in drafts" :key="saved.id" class="secondary" @click="openDraft(saved.id)">
      {{saved.name||'未命名草稿'}}<span v-if="saved.busy"> · 生成中</span>
     </button>
    </div>
   </section>
  </template>

  <div v-else class="template-editor" :class="{split:mode==='chat'&&hasPreview}">
   <section v-if="mode==='chat'" class="team-card template-conversation" :class="{intro:!draft}">
    <h2>{{draft?'模板对话':'描述你需要怎样的员工'}}</h2>
    <p v-if="!draft" class="team-muted">可以从员工需要完成的工作、能力和上报方式说起。</p>
    <div v-if="draft" class="template-messages" aria-live="polite">
     <article v-for="(message,index) in draft.messages" :key="index" :class="{self:message.role==='user'}">
      <b>{{message.role==='user'?'我':'模板助手'}}</b><p>{{message.content}}</p>
     </article>
     <p v-if="draft.busy" role="status">正在生成草稿…</p>
     <p v-if="draft.error" class="team-error" role="alert">{{draft.error}}</p>
    </div>
    <form @submit.prevent="chat">
     <label for="template-chat">{{draft?'继续对话':'员工需要做什么？'}}</label>
     <textarea id="template-chat" ref="chatInput" v-model="text" placeholder="例如：核对项目资料的出处，发现冲突时列出证据并向上级反馈。"/>
     <div class="team-row">
      <button :disabled="pageBusy||!text.trim()">发送</button>
      <button v-if="!hasPreview" type="button" class="text-button" @click="folderInput?.click()">导入文件夹</button>
      <button v-if="!hasPreview" type="button" class="text-button" @click="mode='edit'">手动填写</button>
     </div>
    </form>
   </section>

   <form v-if="hasPreview" class="team-card template-preview" @submit.prevent="save">
    <h2>{{selected?'模板配置':'模板草稿'}}</h2>
    <label for="template-name">模板名称</label>
    <input id="template-name" v-model="name" required/>
    <div class="template-package">
     <div class="team-row between">
      <h3>模板文件<span v-if="files.length" class="team-muted"> · {{files.length}}</span></h3>
      <div class="team-row">
       <button type="button" class="secondary small" :disabled="pageBusy" @click="folderInput?.click()">导入文件夹</button>
       <button type="button" class="text-button small" :disabled="pageBusy" @click="fileInput?.click()">添加文件</button>
      </div>
     </div>
     <p v-if="uploading" role="status">正在导入文件…</p>
     <p v-if="importError" class="team-error" role="alert">{{importError}}</p>
     <ul v-if="files.length" class="template-file-list">
      <li v-for="file in files" :key="file.path">
       <code>{{file.path}}</code>
       <select v-model="file.purpose" :aria-label="'文件用途 '+file.path" :disabled="pageBusy">
        <option value="prompt" :disabled="!file.utf8||!file.size">工作指令</option>
        <option value="skill" :disabled="!file.utf8||!file.size">Skill</option>
        <option value="resource">参考文件</option>
       </select>
       <button type="button" class="text-button small" :disabled="pageBusy" :aria-label="'移除 '+file.path" @click="removeFile(file.path)">移除</button>
      </li>
     </ul>
    </div>
    <label for="template-prompt">补充工作指令</label>
    <textarea id="template-prompt" v-model="prompt" rows="5" placeholder="可填写适用于这个模板的补充说明"/>
    <div class="team-row between template-skills"><h3>文本 Skills</h3><button type="button" class="text-button" @click="skills.push({name:'',content:''})">添加 Skill</button></div>
    <section v-for="(skill,index) in skills" :key="index" class="skill-editor">
     <label>名称<input v-model="skill.name" required/></label>
     <label>指令与素材<textarea v-model="skill.content" required/></label>
     <button type="button" class="text-button" @click="skills.splice(index,1)">移除</button>
    </section>
    <label v-if="selected">修改说明<input v-model="note"/></label>
    <button :disabled="pageBusy||!name.trim()||!hasConfig">{{selected?'保存新版本':'保存为模板'}}</button>
    <details v-if="current?.originTeamId">
     <summary>跨团队采用授权</summary>
     <p class="team-muted">本迭代来自 {{store.data.teams[current.originTeamId]?.name}}。</p>
     <label v-for="team in Object.values(store.data.teams).filter(t=>t.id!==current?.originTeamId)" :key="team.id">
      <input style="width:auto" type="checkbox" v-model="sharing" :value="team.id"/> {{team.name}}
     </label>
     <button type="button" class="secondary" @click="share">保存当前版本分享范围</button>
    </details>
    <details v-if="current">
     <summary>版本与迭代来源</summary>
     <article v-for="version in current.versions" :key="version.revision">
      <b>v{{version.revision}} · {{version.authorType}} {{version.authorId}}</b>
      <pre v-if="version.prompt">{{version.prompt}}</pre>
      <ul v-if="version.files?.length"><li v-for="file in version.files" :key="file.path">{{file.path}}</li></ul>
     </article>
    </details>
   </form>
  </div>
 </div>
</template>

<style scoped>
.template-page{padding-inline:clamp(18px,3.2vw,54px)}
.template-page .team-page-head{max-width:1260px;margin-inline:auto}
.template-start{border:1px solid #e2e9f6;border-radius:18px;background:radial-gradient(ellipse at 50% 0,#edf3ff,#fff 68%);max-width:1260px;margin:auto;text-align:center;padding:64px 20px 58px}
.template-start h2{font-size:clamp(20px,2.3vw,28px);margin-top:24px}
.template-start p{color:#586a84;font-size:14px}
.template-start-actions{justify-content:center;margin:24px 0 10px}
.template-start-actions button{min-width:110px}
.template-figure{position:relative;width:74px;height:68px;margin:auto}
.template-figure i{position:absolute;display:block;inset:7px 13px 4px;border:1px solid #a5bdf8;border-radius:9px;background:#f6f9ff;transform:rotate(-12deg) translateX(-8px)}
.template-figure i:nth-child(2){transform:rotate(12deg) translateX(8px)}
.template-figure i:last-child{transform:none;background:#fff;box-shadow:0 5px 14px #2f6bff20}
.template-figure i:last-child::after{content:'';position:absolute;inset:15px 10px;background:repeating-linear-gradient(to bottom,#709afb 0 2px,transparent 2px 8px)}
.template-list,.template-drafts{max-width:1260px;margin:0 auto 24px}
.template-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,245px),1fr));gap:12px}
.template-library-item{text-align:left;padding:16px!important;display:flex;flex-direction:column;gap:3px;overflow-wrap:anywhere}
.template-library-item small{color:#667990}
.template-editor{display:grid;gap:18px;align-items:start;max-width:780px;margin:auto}
.template-editor.split{grid-template-columns:minmax(0,1fr) minmax(0,1.05fr);max-width:1260px}
.template-editor .template-preview{grid-column:auto;margin:0}
.template-conversation.intro{padding:clamp(20px,4vw,42px)}
.template-conversation.intro form{margin-top:22px}
.template-messages{min-height:0}
.template-package{margin:20px 0 12px;padding:13px;border:1px solid var(--team-line);border-radius:9px;background:#f8faff}
.template-package h3,.template-skills h3{margin:0}
.template-file-list{list-style:none;margin:8px 0 0;padding:0;max-height:330px;overflow:auto}
.template-file-list li{display:grid;grid-template-columns:minmax(0,1fr) minmax(96px,116px) auto;align-items:center;gap:7px;border-top:1px solid var(--team-line);padding:7px 0}
.template-file-list code{overflow-wrap:anywhere;color:#385078}
.template-file-list select{padding:3px 5px}
.template-file-list .small{white-space:nowrap}
.template-skills{margin-top:14px}
@media(max-width:900px){.template-editor.split{grid-template-columns:1fr}}
@media(max-width:520px){
 .template-start{padding:45px 14px 38px}
 .team-page-head{flex-wrap:wrap}
 .template-file-list li{grid-template-columns:minmax(0,1fr) auto}
 .template-file-list code{grid-column:1 / -1}
}
</style>
