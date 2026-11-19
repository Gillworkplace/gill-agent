<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useTeams } from './store'
import PromptPackageField from './PromptPackageField.vue'
import SkillConfigurationContents from './SkillConfigurationContents.vue'
import type { OrganizationTemplate, TemplateFile } from './types'

type TemplateType=OrganizationTemplate['type']
const store=useTeams()
const tab=ref<TemplateType>('team'),open=ref(false),uploading=ref(false)
const dialog=ref<HTMLDialogElement>(),nameInput=ref<HTMLInputElement>()
const current=ref<OrganizationTemplate>()
const name=ref(''),description=ref(''),prompt=ref(''),sourceKey=ref(''),error=ref('')
const files=ref<TemplateFile[]>([]),roleTemplateIds=ref<string[]>([]),removedRoles=ref<string[]>([])
const templates=computed(()=>Object.values(store.data.organizationTemplates))
const visible=computed(()=>templates.value.filter(item=>item.type===tab.value))
const roleTemplates=computed(()=>templates.value.filter(item=>item.type==='role'))
const oldTemplates=computed(()=>Object.values(store.data.templates))
const teamSources=computed(()=>Object.values(store.data.teams))
const roleSources=computed(()=>Object.values(store.data.teamRoles))
const source=computed(()=>{
 const [type,id]=sourceKey.value.split(':')
 if(type==='team')return store.data.teams[id]
 if(type==='role')return store.data.teamRoles[id]
 if(type==='legacy')return store.data.templates[id]
})
const copiedRoles=computed(()=>{
 if(current.value)return current.value.roles||[]
 if(tab.value==='team'&&source.value)return roleSources.value.filter(role=>role.teamId===source.value?.id)
 return []
})

watch(open,async value=>{
 if(!value){dialog.value?.close();return}
 await nextTick()
 if(!open.value)return
 dialog.value?.showModal()
 nameInput.value?.focus()
})

function changeTab(type:TemplateType){tab.value=type}
function useSource(){
 const from=source.value
 name.value=from?.name||''
 description.value=from&&'description' in from?from.description||'':''
 prompt.value=from?.prompt||''
 files.value=from?('promptFiles' in from?from.promptFiles||[]:'files' in from?from.files||[]:[]):[]
 removedRoles.value=[]
}

function edit(item?:OrganizationTemplate){
 current.value=item
 name.value=item?.name||''
 description.value=item?.description||''
 prompt.value=item?.prompt||''
 files.value=item?.promptFiles||[]
 sourceKey.value='';roleTemplateIds.value=[];removedRoles.value=[];error.value=''
 open.value=true
}

function convert(id:string){
 tab.value='role'
 edit()
 sourceKey.value='legacy:'+id
 useSource()
}

function close(){if(!store.busy)open.value=false}
async function save(){
 if(!name.value.trim()||uploading.value||store.busy)return
 const [sourceType,sourceId]=sourceKey.value.split(':')
 const item=current.value
 try{
  await store.command('orgTemplate.save',{
   ...(item?{id:item.id,expectedRevision:item.revision}:{}),
   ...(sourceId?{sourceType,sourceId}:{}),
   type:tab.value,name:name.value,description:description.value,prompt:prompt.value,promptFiles:files.value,
   roleTemplateIds:roleTemplateIds.value,removedRoles:removedRoles.value,
  })
  open.value=false
 }catch{error.value=store.error}
}
</script>

<template>
 <section class="team-page template-page">
  <div class="catalog-content organization-template-library">
   <header class="catalog-head">
    <div><h1>组织模板</h1><p>复用团队的协作方式与角色的职责标准。</p></div>
    <button type="button" class="catalog-button catalog-primary" @click="edit()">
     {{tab==='team'?'新建团队模板':'新建角色模板'}}
    </button>
   </header>
   <nav class="team-tabs" aria-label="组织模板类型">
    <button type="button" class="secondary" :class="{active:tab==='team'}" :aria-current="tab==='team'?'page':undefined" @click="changeTab('team')">团队模板</button>
    <button type="button" class="secondary" :class="{active:tab==='role'}" :aria-current="tab==='role'?'page':undefined" @click="changeTab('role')">角色模板</button>
   </nav>
   <p v-if="!visible.length" class="team-card team-muted">暂无{{tab==='team'?'团队':'角色'}}模板。可从现有{{tab==='team'?'团队':'角色'}}复制，或直接新建。</p>
   <div v-else class="team-grid">
    <article v-for="item in visible" :key="item.id" class="team-card">
     <div class="team-row between"><h2>{{item.name}}</h2><small class="team-muted">v{{item.revision}}</small></div>
     <p v-if="item.description" class="team-muted">{{item.description}}</p>
     <p v-if="item.type==='team'" class="team-muted">{{item.roles?.length||0}} 个角色 · {{item.promptFiles?.length||0}} 个流程文件</p>
     <p v-else class="team-muted">{{item.promptFiles?.length||0}} 个文件<span v-if="item.skills?.length"> · {{item.skills.length}} 个文本 Skill</span></p>
     <details><summary>查看配置</summary>
      <SkillConfigurationContents :record="item" compact/>
      <ul v-if="item.roles?.length"><li v-for="role in item.roles" :key="role.name">{{role.name}}</li></ul>
     </details>
     <button type="button" class="secondary" @click="edit(item)">编辑模板</button>
    </article>
   </div>
   <details v-if="oldTemplates.length" class="team-card organization-template-history">
    <summary>历史员工模板（{{oldTemplates.length}}）</summary>
    <p class="team-muted">旧配置可按需整理为角色模板。</p>
    <div v-for="item in oldTemplates" :key="item.id" class="team-row between">
     <span>{{item.name}} · v{{item.revision}}</span>
     <button class="secondary small" type="button" @click="convert(item.id)">转为角色模板</button>
    </div>
   </details>
  </div>

  <dialog ref="dialog" class="catalog-form-dialog organization-template-dialog" aria-labelledby="org-template-title" @cancel.prevent="close" @click.self="close">
   <form v-if="open" class="organization-template-editor" @submit.prevent="save">
    <header class="team-row between">
     <h2 id="org-template-title">{{current?'编辑':sourceKey.startsWith('legacy:')?'转换为':'新建'}}{{tab==='team'?'团队模板':'角色模板'}}</h2>
     <button type="button" class="secondary small" aria-label="关闭模板编辑" @click="close">×</button>
    </header>
    <p v-if="error" class="team-error" role="alert">{{error}}</p>
    <label v-if="!current" for="org-template-source">创建来源</label>
    <select v-if="!current" id="org-template-source" v-model="sourceKey" :disabled="uploading" @change="useSource">
     <option value="">空白模板</option>
     <template v-if="tab==='team'">
      <option v-for="item in teamSources" :key="item.id" :value="'team:'+item.id">复制团队 · {{item.name}}</option>
     </template>
     <template v-else>
      <option v-for="item in roleSources" :key="item.id" :value="'role:'+item.id">复制角色 · {{store.data.teams[item.teamId]?.name}} / {{item.name}}</option>
      <option v-for="item in oldTemplates" :key="item.id" :value="'legacy:'+item.id">历史模板 · {{item.name}}</option>
     </template>
    </select>
    <label for="org-template-name">模板名称</label>
    <input id="org-template-name" ref="nameInput" v-model="name" :maxlength="tab==='role'?30:undefined" required/>
    <label for="org-template-description">用途</label>
    <textarea id="org-template-description" v-model="description" rows="2"/>
    <PromptPackageField id="org-template-prompt" :label="tab==='team'?'团队流程 Prompt':'角色职责 Prompt'"
                        v-model="prompt" v-model:files="files" v-model:uploading="uploading" :rows="4" :disabled="store.busy"/>
    <fieldset v-if="tab==='team'&&(roleTemplates.length||copiedRoles.length)">
     <legend>团队角色</legend>
     <label v-for="item in copiedRoles" :key="item.name">
      <input type="checkbox" :checked="!removedRoles.includes(item.name)" @change="($event.target as HTMLInputElement).checked?removedRoles=removedRoles.filter(role=>role!==item.name):removedRoles.push(item.name)"/>
      {{item.name}} · 已纳入
     </label>
     <label v-for="item in roleTemplates" :key="item.id">
      <input type="checkbox" v-model="roleTemplateIds" :value="item.id"/> {{item.name}} · 角色模板
     </label>
    </fieldset>
    <div class="team-row organization-template-actions">
     <button type="button" class="secondary" :disabled="store.busy" @click="close">取消</button>
     <button type="submit" :disabled="uploading||store.busy">保存模板</button>
    </div>
   </form>
  </dialog>
 </section>
</template>

<style scoped>
.organization-template-library .team-tabs{margin-bottom:16px}
.organization-template-library .team-card details{margin-bottom:12px}
.organization-template-history{margin-top:16px}
.organization-template-history .team-row{margin-top:8px}
.organization-template-editor fieldset{border:1px solid var(--team-line);border-radius:8px;margin:12px 0;padding:8px 12px}
.organization-template-editor fieldset input{width:auto}
.organization-template-editor fieldset label{margin:5px 0}
.organization-template-actions{justify-content:flex-end;margin-top:14px}
</style>
