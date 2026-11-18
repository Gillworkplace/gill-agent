<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useTeams } from './store'
import TemplateCatalog from './TemplateCatalog.vue'
import { sortTemplates } from './templateCatalog'
import TemplateFileList from './TemplateFileList.vue'
import { groupTemplateFiles } from './templateFileLayout'
import { uploadTemplateFiles } from './templateFiles'
import type { Skill, TemplateFile, TemplateFilePurpose } from './types'

const store=useTeams()
type Mode='library'|'chat'|'edit'|'import'
const mode=ref<Mode>('library')
const selected=ref(''),draftId=ref(''),text=ref(''),name=ref(''),prompt=ref(''),note=ref('')
const skills=ref<Skill[]>([]),files=ref<TemplateFile[]>([]),sharing=ref<string[]>([])
const baseRevision=ref(0),uploading=ref(false),importError=ref('')
const dialog=ref<HTMLDialogElement>(),formError=ref(''),catalogQuery=ref('')
const folderInput=ref<HTMLInputElement>(),fileInput=ref<HTMLInputElement>(),nameInput=ref<HTMLInputElement>(),chatInput=ref<HTMLTextAreaElement>()
let importSequence=0
const current=computed(()=>store.data.templates[selected.value])
const draft=computed(()=>store.data.drafts[draftId.value])
const templates=computed(()=>sortTemplates(Object.values(store.data.templates)))
const drafts=computed(()=>Object.values(store.data.drafts))
const hasConfig=computed(()=>Boolean(prompt.value.trim()||skills.value.length||files.value.some(f=>f.purpose!=='resource')))
const hasPreview=computed(()=>mode.value==='edit'||Boolean(name.value||hasConfig.value||files.value.length))
const pageBusy=computed(()=>store.busy||uploading.value||draft.value?.busy)
const fileGroups=computed(()=>groupTemplateFiles(files.value))

function start(next:Mode){
 importSequence++
 mode.value=next
 selected.value='';draftId.value='';name.value='';prompt.value='';text.value='';note.value=''
 skills.value=[];files.value=[];sharing.value=[];formError.value='';importError.value='';uploading.value=false
}
function open(id:string){
 const template=store.data.templates[id]
 if(!template)return
 start('edit')
 selected.value=id;baseRevision.value=template.revision
 sharing.value=[...(template.authorizedTeamIds||[])]
 name.value=template.name;prompt.value=template.prompt
 skills.value=template.skills.map(skill=>({...skill}))
 files.value=(template.files||[]).map(file=>({...file}))
}
watch(mode,async next=>{
 await nextTick()
 if(next!==mode.value)return
 if(next==='library')dialog.value?.close()
 else if(!dialog.value?.open)dialog.value?.showModal()
 if(next==='chat')chatInput.value?.focus()
 if(next==='edit')nameInput.value?.focus()
})
function onClose(){if(!dialog.value?.open&&mode.value!=='library')start('library')}
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
 if(mode.value==='library')start('import')
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
  if(!name.value&&result.suggestedName)name.value=result.suggestedName
 }catch(error){
  if(sequence===importSequence)importError.value=error instanceof Error?error.message:'导入失败，请重试。'
 }finally{
  if(sequence===importSequence)uploading.value=false
 }
}
async function chat(){
 if(!text.value.trim()||pageBusy.value)return
 const sequence=importSequence
 formError.value=''
 try{
  const result=await store.command('template.generate',{id:draftId.value,text:text.value.trim(),
   draft:{name:name.value,prompt:prompt.value,skills:skills.value,files:files.value}})
  if(sequence===importSequence){draftId.value=result.id;text.value=''}
 }catch{if(sequence===importSequence)formError.value=store.error}
}
async function save(){
 if(pageBusy.value||!hasConfig.value)return
 const sequence=importSequence
 formError.value=''
 try{
  await store.command('template.save',{...(selected.value?{id:selected.value,expectedRevision:baseRevision.value}:{}),
   name:name.value,prompt:prompt.value,skills:skills.value,files:files.value,draftId:draftId.value,reason:note.value})
  if(sequence===importSequence){catalogQuery.value='';start('library')}
 }catch{if(sequence===importSequence)formError.value=store.error}
}
async function share(){
 if(!current.value||pageBusy.value)return
 const sequence=importSequence
 formError.value=''
 try{
  await store.command('template.share',{id:current.value.id,expectedRevision:baseRevision.value,teamIds:sharing.value})
  if(sequence===importSequence&&current.value)baseRevision.value=current.value.revision
 }catch{if(sequence===importSequence)formError.value=store.error}
}
function removeFile(path:string){files.value=files.value.filter(file=>file.path!==path)}
function removeSkill(groupFiles:TemplateFile[]){
 const removed=new Set(groupFiles.map(file=>file.path))
 files.value=files.value.filter(file=>!removed.has(file.path))
}
function changeFilePurpose(path:string,purpose:TemplateFilePurpose){
 const file=files.value.find(file=>file.path===path)
 if(file)file.purpose=purpose
}
function skillLabel(directory:string){
 return directory.replace(/^skills\//,'')||name.value||'根目录 Skill'
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
  <div class="catalog-content">
   <header class="catalog-head">
    <div><h1>数字员工模板</h1><p>为团队复用工作指令、Skills 和参考文件。</p></div>
    <div v-if="templates.length||drafts.length" class="catalog-actions">
     <button class="catalog-button" type="button" @click="start('import')"><span aria-hidden="true">↥</span>导入文件夹</button>
     <button class="catalog-button catalog-primary" type="button" @click="start('chat')"><span aria-hidden="true">＋</span>新建模板</button>
    </div>
   </header>
   <section v-if="!templates.length&&!drafts.length" class="template-start" aria-labelledby="template-start-title">
    <div class="template-figure" aria-hidden="true"><i></i><i></i><i></i></div>
    <h2 id="template-start-title">创建第一个数字员工模板</h2>
    <p>从对话开始，或导入已有的指令、Skills 和资料。</p>
    <div class="team-row template-start-actions">
     <button class="catalog-button catalog-primary" type="button" @click="start('chat')">对话创建</button>
     <button class="catalog-button" type="button" @click="start('import')">导入文件夹</button>
    </div>
    <button class="text-button" @click="start('edit')">手动填写</button>
   </section>
   <TemplateCatalog v-if="templates.length" v-model:query="catalogQuery" :templates="templates" @edit="open"/>
   <section v-if="drafts.length" class="template-drafts">
    <h2>继续草稿</h2>
    <div class="team-row">
     <button v-for="saved in drafts" :key="saved.id" class="secondary" @click="openDraft(saved.id)">
      {{saved.name||'未命名草稿'}}<span v-if="saved.busy"> · 生成中</span>
     </button>
    </div>
   </section>
  </div>

  <dialog ref="dialog" class="catalog-form-dialog" aria-labelledby="catalog-editor-title" @close="onClose" @click.self="start('library')">
   <div v-if="mode!=='library'" class="catalog-form-body">
   <div class="catalog-dialog-top">
    <h2 id="catalog-editor-title">{{mode==='import'?'导入文件夹':selected?'编辑模板':'新建模板'}}</h2>
    <button type="button" class="catalog-button catalog-close" aria-label="关闭编辑" @click="start('library')">×</button>
   </div>
   <p v-if="formError" class="template-dialog-error team-error" role="alert">{{formError}}</p>
   <p v-if="importError" class="template-dialog-error team-error" role="alert">{{importError}}</p>
   <p v-if="uploading" class="catalog-form-copy" role="status">正在导入文件…</p>
   <div v-if="mode==='import'&&!hasPreview">
    <p class="catalog-form-copy">可以导入模板文件夹，也可以导入包含多个 Skill 的目录。</p>
    <button class="catalog-button catalog-import-select" type="button" :disabled="pageBusy" @click="folderInput?.click()">选择文件夹</button>
   </div>
   <section v-if="mode==='chat'" class="template-conversation">
    <p v-if="!draft" class="catalog-form-copy">可通过对话生成草稿，也可以直接填写。</p>
    <div v-if="draft" class="template-messages" aria-live="polite">
     <article v-for="(message,index) in draft.messages" :key="index" :class="{self:message.role==='user'}">
      <b>{{message.role==='user'?'我':'模板助手'}}</b><p>{{message.content}}</p>
     </article>
     <p v-if="draft.busy" role="status">正在生成草稿…</p>
     <p v-if="draft.error" class="team-error" role="alert">{{draft.error}}</p>
    </div>
    <form @submit.prevent="chat">
     <label for="template-chat">{{draft?'继续对话':'你需要怎样的数字员工？'}}</label>
     <textarea id="template-chat" ref="chatInput" v-model="text" placeholder="例如：核查资料来源并整理证据。"/>
     <div class="catalog-actions">
      <button class="catalog-button catalog-primary" :disabled="pageBusy||!text.trim()">{{draft?'继续生成草稿':'生成草稿'}}</button>
      <button v-if="!hasPreview" type="button" class="catalog-button" @click="mode='edit'">手动填写</button>
     </div>
    </form>
   </section>

   <form v-if="hasPreview" class="template-preview" @submit.prevent="save">
    <div class="team-row between template-form-title">
     <h3>{{selected?'模板配置':'模板草稿'}}</h3>
     <button v-if="mode==='edit'" type="button" class="text-button" @click="mode='chat'">用对话完善</button>
    </div>
    <label for="template-name">模板名称</label>
    <input id="template-name" ref="nameInput" v-model="name" required/>
    <div class="template-package">
     <div class="team-row between">
      <h3>Skills 与模板文件</h3>
      <div class="team-row">
       <button type="button" class="secondary small" :disabled="pageBusy" @click="folderInput?.click()">导入文件夹</button>
       <button type="button" class="text-button small" :disabled="pageBusy" @click="fileInput?.click()">添加文件</button>
      </div>
     </div>
     <p v-if="!files.length&&!uploading" class="team-muted template-import-hint">可连续导入多个含 SKILL.md 的目录，也可一次导入整个 Skills 文件夹。</p>
     <div v-if="fileGroups.packages.length" class="template-skill-packages">
      <details v-for="group in fileGroups.packages" :key="group.directory" class="template-skill-package">
       <summary><strong>{{skillLabel(group.directory)}}</strong><small class="team-muted">{{group.files.length}} 个文件</small></summary>
       <div class="team-row between template-skill-location">
        <code v-if="group.directory" class="team-muted">{{group.directory}}/</code>
        <button type="button" class="text-button small" :aria-label="'移除 Skill '+skillLabel(group.directory)" :disabled="pageBusy" @click="removeSkill(group.files)">移除 Skill</button>
       </div>
       <TemplateFileList :files="group.files" :directory="group.directory" :disabled="pageBusy" @purpose="changeFilePurpose" @remove="removeFile"/>
      </details>
     </div>
     <section v-if="fileGroups.shared.length" class="template-shared-files">
      <h4 v-if="fileGroups.packages.length">模板公共文件</h4>
      <TemplateFileList :files="fileGroups.shared" :disabled="pageBusy" @purpose="changeFilePurpose" @remove="removeFile"/>
     </section>
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
    <div class="catalog-actions catalog-form-bottom">
     <button type="button" class="catalog-button" @click="start('library')">取消</button>
     <button class="catalog-button catalog-primary" :disabled="pageBusy||!name.trim()||!hasConfig">{{selected?'保存新版本':'保存模板'}}</button>
    </div>
   </form>
   <div v-else class="catalog-actions catalog-form-bottom"><button type="button" class="catalog-button" @click="start('library')">取消</button></div>
   </div>
  </dialog>
 </div>
</template>

<style scoped>
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
.template-drafts{margin:24px 0 0}
.template-messages{min-height:0;max-height:200px;line-height:1.55}
.template-conversation textarea{margin-bottom:0}
.template-form-title{border-top:1px solid var(--catalog-line);margin-top:17px;padding-top:12px}
.template-form-title h3{margin:0}
.template-dialog-error{margin:10px 0}
.template-package{margin:20px 0 12px;padding:13px;border:1px solid var(--team-line);border-radius:9px;background:#f8faff}
.template-package h3,.template-skills h3{margin:0}
.template-import-hint{margin:10px 0 0}
.template-skill-packages{display:grid;gap:6px;margin-top:12px}
.template-skill-package{padding:8px 10px;background:#fff;border:1px solid var(--team-line);border-radius:7px}
.template-skill-package summary{cursor:pointer;overflow-wrap:anywhere}
.template-skill-package summary small{margin-left:8px}
.template-skill-location{margin-top:8px;overflow-wrap:anywhere}
.template-shared-files h4{font-size:13px;margin:12px 0 2px}
.template-skills{margin-top:14px}
@media(max-width:520px){
 .template-start{padding:45px 14px 38px}
}
</style>
