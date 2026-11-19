<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { api } from '../api'
import { useTeams } from './store'
import SkillConfigurationContents from './SkillConfigurationContents.vue'
import TeamSkillEditor from './TeamSkillEditor.vue'
import type { SkillForm } from './TeamSkillEditor.vue'
import { inFlightTasks } from './teamSkillPreview'
import type { SkillConfigurationRecord, SkillPreview } from './teamSkillPreview'
import type { Employee, Team } from './types'

type Tab='flow'|'roles'|'members'
type EditorMode='flow'|'role'|'member'
interface Editor {
 mode:EditorMode; title:string; context:string; impact:string; initial:SkillForm;
 record?:SkillConfigurationRecord; teamId:string;
}
const props=defineProps<{team:Team; members:Employee[]}>()
const store=useTeams()
const tabs: { id:Tab; label:string }[]=[{id:'flow',label:'团队流程'},{id:'roles',label:'团队角色'},{id:'members',label:'成员'}]
const tab=ref<Tab>('flow'),roleId=ref(''),memberId=ref('')
const view=ref<'new'|'active'>('new'),taskId=ref('')
const editor=ref<Editor>(),trigger=ref<HTMLElement>()
const notice=ref(''),previewError=ref(''),preview=ref<SkillPreview>(),loading=ref(false)
const roles=computed(()=>Object.values(store.data.teamRoles).filter(role=>role.teamId===props.team.id))
const role=computed(()=>roles.value.find(item=>item.id===roleId.value))
const member=computed(()=>props.members.find(item=>item.id===memberId.value))
const memberRole=computed(()=>roles.value.find(item=>item.id===member.value?.roleId))
const memberTemplate=computed(()=>store.data.templates[member.value?.templateId||''])
const adopters=computed(()=>props.members.filter(item=>item.roleId===role.value?.id && role.value))
const tasks=computed(()=>inFlightTasks(Object.values(store.data.tasks),props.team.id,memberId.value))

watch(roles,list=>{if(!list.some(item=>item.id===roleId.value)) roleId.value=list[0]?.id||''},{immediate:true})
watch(()=>props.members,list=>{if(!list.some(item=>item.id===memberId.value)) memberId.value=list[0]?.id||''},{immediate:true})
watch(tasks,list=>{if(!list.some(item=>item.id===taskId.value)) taskId.value=list[0]?.id||''},{immediate:true})

const previewSignal=computed(()=>{
 if(!member.value||view.value==='active'&&!taskId.value)return ''
 if(view.value==='active')return [props.team.id,memberId.value,taskId.value].join('/')
 return [props.team.id,memberId.value,props.team.revision,member.value.revision,
  memberRole.value?.revision,memberTemplate.value?.revision,memberTemplate.value?.authorizedTeamIds?.join(',')].join('/')
})
watch(previewSignal,async (signal,_previous,cleanup)=>{
 let current=true
 cleanup(()=>{current=false})
 preview.value=undefined
 previewError.value=''
 loading.value=Boolean(signal)
 if(!signal)return
 const parameters=new URLSearchParams({teamId:props.team.id,employeeId:memberId.value})
 if(view.value==='active')parameters.set('taskId',taskId.value)
 try{
  const data=await api<SkillPreview>('/team-workspace/skill-preview?'+parameters)
  if(current)preview.value=data
 }catch(error){
  if(current)previewError.value=error instanceof Error?error.message:'读取配置失败'
 }finally{
  if(current)loading.value=false
 }
},{immediate:true})

const layers=computed(()=>[
 {id:'flow',name:'团队流程',mark:'流',record:preview.value?.team},
 {id:'roles',name:'团队角色',mark:'角',record:preview.value?.role},
 {id:'members',name:'个人配置',mark:'人',record:preview.value?.employee},
])

function showTab(next:Tab){tab.value=next;notice.value=''}
function showMember(id:string){memberId.value=id;showTab('members')}
function showRole(id:string){roleId.value=id;showTab('roles')}
function roleName(id?:string){return id?store.data.teamRoles[id]?.name:undefined}
function adoptionCount(id:string){return props.members.filter(item=>item.roleId===id).length}

function open(mode:EditorMode,event:MouseEvent,create=false){
 const record=mode==='flow'?props.team:mode==='member'?member.value:create?undefined:role.value
 if(!record&&!create)return
 trigger.value=event.currentTarget as HTMLElement
 editor.value={
  mode,record,teamId:props.team.id,
  title:mode==='flow'?'编辑团队流程':mode==='member'?'编辑成员配置':create?'新建团队角色':'编辑角色',
  context:record?`${record.name} · 当前版本 v${record.revision}`:'创建后可在成员配置中关联。',
  impact:mode==='flow'?`保存影响全部 ${props.members.length} 位成员的新任务。`:
   mode==='member'?'保存仅影响该成员的新任务。':
   record?`保存影响 ${adoptionCount(record.id||'')} 位采用成员的新任务。`:'成员关联后，新任务才会采用。',
  initial:{name:record?.name||'',roleId:mode==='member'?member.value?.roleId||'':'',
   prompt:record?.prompt||'',promptFiles:record?.promptFiles||[]},
 }
}

async function save(form:SkillForm){
 const draft=editor.value
 if(!draft)return
 const fields={prompt:form.prompt,promptFiles:form.promptFiles}
 const identity=draft.record?{id:draft.record.id,expectedRevision:draft.record.revision}:{}
 const result=draft.mode==='flow'
  ?await store.command('team.update',{...identity,...fields,name:draft.record?.name})
  :draft.mode==='role'
   ?await store.command('role.save',{...identity,...fields,teamId:draft.teamId,name:form.name})
   :await store.command('employee.update',{...identity,...fields,roleId:form.roleId})
 if(draft.mode==='role')roleId.value=result.id
 notice.value=`已保存 ${draft.mode==='flow'?'团队流程':form.name} · v${result.revision}`
}

async function close(){
 editor.value=undefined
 await nextTick()
 trigger.value?.focus()
}
</script>

<template>
 <section class="team-skill-config" aria-label="团队 Skill 配置">
  <header class="skill-page-head">
   <h2>团队 Skill 配置</h2>
   <p>统一团队协作规则，复用角色指令，保留成员自己的能力。</p>
  </header>
  <nav class="skill-tabs" aria-label="配置维度">
   <button v-for="item in tabs" :key="item.id" type="button" :aria-current="tab===item.id?'page':undefined"
           :data-skill-tab="item.id" @click="showTab(item.id)">{{item.label}}</button>
  </nav>
  <p v-if="notice" class="skill-notice" role="status">{{notice}}</p>
  <div class="skill-layout">
   <section v-if="tab==='flow'" class="skill-panel" aria-label="团队流程">
    <header class="skill-panel-head"><div><h3>团队流程</h3><p>全队共用一份，保存后供新任务采用。</p></div>
     <button type="button" @click="open('flow',$event)">编辑流程</button>
    </header>
    <div class="skill-record">
     <p class="skill-meta"><span class="skill-version">v{{team.revision}}</span> 适用于全部 {{members.length}} 位成员</p>
     <SkillConfigurationContents :record="team"/>
    </div>
   </section>

   <section v-else-if="tab==='roles'" class="skill-panel" aria-label="团队角色">
    <header class="skill-panel-head"><div><h3>团队角色</h3><p>同一角色的成员共用一套岗位指令。</p></div>
     <button type="button" @click="open('role',$event,true)">新建角色</button>
    </header>
    <div v-if="role" class="skill-directory">
     <ul class="skill-directory-list" aria-label="角色列表">
      <li v-for="item in roles" :key="item.id">
       <button type="button" class="skill-item" :aria-current="item.id===role.id?'true':undefined" @click="showRole(item.id)">
        <span class="skill-mark mark-roles" aria-hidden="true">{{item.name.slice(0,1)}}</span>
        <span><strong>{{item.name}}</strong><small>{{adoptionCount(item.id)}} 位成员</small></span>
       </button>
      </li>
     </ul>
     <div class="skill-selection">
      <header class="skill-panel-head"><h3>{{role.name}}</h3>
       <button type="button" class="secondary" @click="open('role',$event)">编辑角色</button>
      </header>
      <div class="skill-record">
       <p class="skill-meta"><span class="skill-version">v{{role.revision}}</span> 角色共用配置</p>
       <div class="skill-adoption">
        <span>采用成员</span>
        <button v-for="item in adopters" :key="item.id" type="button" class="secondary small" @click="showMember(item.id)">{{item.name}}</button>
        <small v-if="!adopters.length">暂无成员采用</small>
       </div>
       <SkillConfigurationContents :record="role"/>
      </div>
     </div>
    </div>
    <p v-else class="skill-empty">创建角色后，可在成员配置中关联。</p>
   </section>

   <section v-else class="skill-panel" aria-label="成员配置">
    <header class="skill-panel-head"><div><h3>成员</h3><p>关联角色，并配置成员自己的 Skill。</p></div></header>
    <div v-if="member" class="skill-directory">
     <ul class="skill-directory-list" aria-label="成员列表">
      <li v-for="item in members" :key="item.id">
       <button type="button" class="skill-item" :aria-current="item.id===member.id?'true':undefined" @click="showMember(item.id)">
        <span class="skill-mark mark-members" aria-hidden="true">{{item.name.slice(0,1)}}</span>
        <span><strong>{{item.name}}</strong><small>{{roleName(item.roleId)||'未关联角色'}}</small></span>
       </button>
      </li>
     </ul>
     <div class="skill-selection">
      <header class="skill-panel-head"><h3>{{member.name}}</h3>
       <button type="button" class="secondary" @click="open('member',$event)">编辑成员配置</button>
      </header>
      <div class="skill-record">
       <p class="skill-meta"><span class="skill-version">v{{member.revision}}</span> 个人配置</p>
       <div class="skill-adoption">
        <span>采用角色</span>
        <button v-if="memberRole" type="button" class="secondary small" @click="showRole(memberRole.id)">{{memberRole.name}}</button>
        <small v-else>未关联角色</small>
       </div>
       <SkillConfigurationContents :record="member" inherited/>
      </div>
     </div>
    </div>
    <p v-else class="skill-empty">从「团队成员」创建员工后，即可配置个人 Skill。</p>
   </section>

   <section class="skill-panel skill-preview" aria-label="生效预览">
    <h3>生效预览</h3>
    <template v-if="members.length">
     <label for="skill-preview-member">选择成员</label>
     <select id="skill-preview-member" v-model="memberId">
      <option v-for="item in members" :key="item.id" :value="item.id">{{item.name}}</option>
     </select>
     <div class="skill-segment" aria-label="任务配置版本">
      <button type="button" :aria-pressed="view==='new'" @click="view='new'">新任务</button>
      <button type="button" :aria-pressed="view==='active'" @click="view='active'">在途任务</button>
     </div>
     <template v-if="view==='active'">
      <label v-if="tasks.length" class="skill-task-picker">选取在途任务
       <select v-model="taskId">
        <option v-for="task in tasks" :key="task.id" :value="task.id">{{task.goal}}</option>
       </select>
      </label>
      <p v-else class="skill-dim">该成员当前没有在途任务。</p>
     </template>
     <p v-if="loading" class="skill-dim" role="status">正在读取生效配置…</p>
     <p v-else-if="previewError" class="team-error" role="alert">{{previewError}}</p>
     <template v-else-if="preview">
      <p class="skill-dim">{{view==='active'?'采用该任务创建时的配置快照。':'按新任务将采用的配置预览。'}}</p>
      <details v-for="layer in layers" :key="layer.id" class="skill-layer" :data-skill-layer="layer.id">
       <summary>
        <span class="skill-mark" :class="'mark-'+layer.id" aria-hidden="true">{{layer.mark}}</span>
        <span><strong>{{layer.name}}</strong>
         <small v-if="layer.record">
          {{layer.id==='flow'?'全队共用':layer.record.name}} · v{{layer.record.revision}} · {{layer.record.promptFiles?.length||0}} 个文件
         </small>
         <small v-else>{{layer.id==='roles'?'未关联角色':'该任务未记录此配置'}}</small>
        </span>
       </summary>
       <SkillConfigurationContents v-if="layer.record" :record="layer.record" compact :inherited="layer.id==='members'"/>
       <p v-else class="skill-layer-empty">暂无该层配置。</p>
      </details>
     </template>
    </template>
    <p v-else class="skill-dim">添加团队成员后即可预览。</p>
   </section>
  </div>
  <TeamSkillEditor v-if="editor" :title="editor.title" :context="editor.context" :impact="editor.impact"
                   :mode="editor.mode" :initial="editor.initial" :roles="roles" :save="save" @close="close"/>
 </section>
</template>

<style src="./teamSkillConfiguration.css"></style>
