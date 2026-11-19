<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useTeams } from './store'
import ProjectLibrary from './ProjectLibrary.vue'
import TeamEmptyState from './TeamEmptyState.vue'
import TeamSkillConfiguration from './TeamSkillConfiguration.vue'
import PromptPackageField from './PromptPackageField.vue'
import type { TemplateFile } from './types'
import { employeeActivity, stateLabel } from './presentation'
const props=defineProps<{selectedId:string}>()
defineEmits<{(e:'enter-chat',id:string):void;(e:'navigate',path:string):void;(e:'create-team'):void}>()
const store=useTeams(),name=ref(''),description=ref(''),receiver=ref(''),maxRounds=ref(25),maxSeconds=ref(900)
const employeePromptFiles=ref<TemplateFile[]>([])
const uploadingEmployee=ref(false)
const memberRoleId=ref(''),memberName=ref(''),personality=ref(''),parentId=ref('user')
const editing=ref(''),editPrompt=ref(''),editRole=ref(''),editPersonality=ref('')
const tab=ref('members'),dragged=ref(''),parents=ref<Record<string,string>>({}),dirty=ref(false),mountSource=ref<Record<string,string>>({})
const baseTeamRevision=ref(0),baseEmployeeRevision=ref(0),baseRelations=ref<Record<string,number>>({})
const team=computed(()=>store.data.teams[props.selectedId])
const teams=computed(()=>Object.values(store.data.teams))
const members=computed(()=>Object.values(store.data.employees).filter(e=>e.teamId===props.selectedId))
const teamRoles=computed(()=>Object.values(store.data.teamRoles).filter(item=>item.teamId===props.selectedId))
const currentEmployee=computed(()=>store.data.employees[editing.value])
function resetTeamSettings(){if(team.value){baseTeamRevision.value=team.value.revision;name.value=team.value.name;description.value=team.value.description;receiver.value=team.value.receiverId||'';maxRounds.value=team.value.limits?.maxRounds||25;maxSeconds.value=team.value.limits?.maxSeconds||900}}
function openRuntime(){resetTeamSettings();tab.value='runtime'}
function reset(){resetTeamSettings();parents.value=Object.fromEntries(members.value.map(e=>[e.id,e.parentId]));baseRelations.value=Object.fromEntries(members.value.map(e=>[e.id,e.revision]));dirty.value=false}
watch(()=>props.selectedId,()=>{reset();tab.value='members';editing.value=''},{immediate:true})
watch(()=>members.value.length,()=>{if(!dirty.value){parents.value=Object.fromEntries(members.value.map(e=>[e.id,e.parentId]));baseRelations.value=Object.fromEntries(members.value.map(e=>[e.id,e.revision]))}})
watch(()=>team.value?.id,()=>{if(team.value&&!baseTeamRevision.value)reset()})
async function save(){if(!team.value||store.busy)return;try{await store.command('team.update',{id:team.value.id,expectedRevision:baseTeamRevision.value,name:name.value,description:description.value,receiverId:receiver.value,limits:{maxRounds:maxRounds.value,maxSeconds:maxSeconds.value}});reset()}catch{}}
async function addMember(){
 if(!memberName.value.trim()||store.busy)return
 try{
  await store.command('employee.create',{teamId:props.selectedId,name:memberName.value,personality:personality.value,
   roleId:memberRoleId.value,parentId:parentId.value})
  memberName.value='';personality.value='';memberRoleId.value='';reset()
 }catch{}
}
function drop(target:string){if(dragged.value&&target!==dragged.value){parents.value[dragged.value]=target;dirty.value=true}dragged.value=''}
function depth(id:string){let n=0,p=parents.value[id];const seen=new Set([id]);while(p&&p!=='user'&&!seen.has(p)){seen.add(p);n++;p=parents.value[p]}return n}
function sortedMembers(){const output:typeof members.value=[];const seen=new Set<string>();function visit(parent:string){for(const e of members.value.filter(e=>parents.value[e.id]===parent)){if(seen.has(e.id))continue;seen.add(e.id);output.push(e);visit(e.id)}}visit('user');for(const e of members.value)if(!seen.has(e.id))output.push(e);return output}
async function saveTree(){try{await store.command('team.relations',{teamId:props.selectedId,relations:members.value.map(e=>({id:e.id,parentId:parents.value[e.id],expectedRevision:baseRelations.value[e.id]}))});reset()}catch{}}
function openEmployee(id:string){editing.value=id;baseEmployeeRevision.value=store.data.employees[id].revision;editPrompt.value=store.data.employees[id].prompt;employeePromptFiles.value=store.data.employees[id].promptFiles||[];editRole.value=store.data.employees[id].role;editPersonality.value=store.data.employees[id].personality||''}
async function saveEmployee(){const e=currentEmployee.value;if(!e||store.busy||uploadingEmployee.value)return;try{await store.command('employee.update',{id:e.id,expectedRevision:baseEmployeeRevision.value,prompt:editPrompt.value,promptFiles:employeePromptFiles.value,role:editRole.value,personality:editPersonality.value});editing.value=''}catch{}}
async function mount(id:string,source:string,remove=false){if(!source)return;try{await store.command(remove?'knowledge.unmount':'knowledge.mount',{employeeId:id,sourceId:source})}catch{}}
</script>
<template>
 <div class="team-page">
  <div v-if="!team" class="team-directory team-list-page">
   <header class="team-page-head team-list-head">
    <div><h1>团队</h1><p>管理员工、项目和协作规则。</p></div>
    <button v-if="teams.length" type="button" class="team-entry-primary" @click="$emit('create-team')"><span aria-hidden="true">＋</span> 新建团队</button>
   </header>
   <TeamEmptyState v-if="!teams.length" heading="h2" title="还没有团队" description="创建团队后，就可以从模板添加专属员工。" action="新建团队" @create="$emit('create-team')"/>
   <section v-else class="team-grid" aria-label="团队列表">
    <article v-for="t in teams" :key="t.id" class="team-card team-directory-card">
     <h2>{{t.name}}</h2><p class="team-directory-description">{{t.description||'尚未填写简介'}}</p>
     <p class="team-muted">{{Object.values(store.data.employees).filter(e=>e.teamId===t.id).length}} 位员工 · {{Object.values(store.data.projects).filter(p=>p.teamId===t.id).length}} 个项目</p>
     <p>{{Object.values(store.data.projects).filter(p=>p.teamId===t.id).map(p=>p.name).join('、')||'尚未归档项目'}}</p>
     <div class="team-row"><button @click="$emit('navigate','/teams/'+t.id)">管理团队 →</button><button class="secondary" @click="$emit('enter-chat',t.id)">进入群聊</button></div>
    </article>
   </section>
  </div>
  <template v-else>
   <button class="text-button" @click="$emit('navigate','/teams')">← 返回团队</button><header class="team-page-head"><div><h1>{{team.name}}</h1><p>{{team.description}}</p></div><div class="team-row" style="flex-wrap:wrap;justify-content:flex-end"><button type="button" class="secondary" @click="openRuntime">运行设置</button><button @click="$emit('enter-chat',team.id)">进入群聊 →</button></div></header>
   <nav class="team-tabs"><button v-for="[id,label] in [['members','团队成员'],['projects','项目库'],['settings','团队配置']]" :key="id" :class="{active:tab===id}" class="secondary" @click="tab=id">{{label}}</button></nav>
   <template v-if="tab==='members'">
    <section class="team-card"><div class="team-row between"><div><h2>组织关系</h2><small class="team-muted">拖动节点调整直属上级，或使用选择框；保存后生效。</small></div><div class="team-row"><button class="secondary" @click="reset">重新读取</button><button :disabled="!dirty||store.busy" @click="saveTree">保存层级</button></div></div>
     <div class="organization-root" @dragover.prevent @drop.prevent="drop('user')">我 · 最终人类管理者（拖到此处设为直接汇报）</div>
     <div v-for="e in sortedMembers()" :key="e.id" class="organization-node" :style="{marginLeft:Math.min(depth(e.id),4)*18+'px'}" draggable="true" @dragstart="dragged=e.id" @dragover.prevent @drop.prevent.stop="drop(e.id)">
      <button class="text-button" @click="openEmployee(e.id)"><b>{{e.name}}</b> · {{e.role||'分工待配置'}}</button><span class="team-muted">{{stateLabel(employeeActivity(store.data.tasks,e.id))}}</span><label class="organization-parent">上级<select v-model="parents[e.id]" @change="dirty=true"><option value="user">我</option><option v-for="p in members.filter(m=>m.id!==e.id)" :key="p.id" :value="p.id">{{p.name}}</option></select></label>
     </div><p v-if="!members.length" class="team-muted">尚无员工，可以在下方直接创建。</p>
    </section>
    <form class="team-card team-inline-form" @submit.prevent="addMember">
     <h3>创建员工</h3>
     <label>员工姓名<input v-model="memberName" required/></label>
     <label>团队角色<select v-model="memberRoleId"><option value="">暂未关联</option><option v-for="item in teamRoles" :key="item.id" :value="item.id">{{item.name}}</option></select></label>
     <label>直属上级<select v-model="parentId"><option value="user">我</option><option v-for="e in members" :key="e.id" :value="e.id">{{e.name}}</option></select></label>
     <label>性格与工作态度<textarea v-model="personality" rows="2"/></label>
     <button :disabled="store.busy||!memberName.trim()">创建员工</button>
    </form>
    <section v-if="currentEmployee" class="team-card employee-config"><h2>{{currentEmployee.name}} · 员工配置</h2><form @submit.prevent="saveEmployee"><label>个人分工备注<input v-model="editRole"/></label><label>性格与工作态度<textarea v-model="editPersonality" rows="3"/></label><PromptPackageField :key="currentEmployee.id" id="employee-work-prompt" label="实际员工工作 Prompt" v-model="editPrompt" v-model:files="employeePromptFiles" v-model:uploading="uploadingEmployee" :disabled="store.busy" :rows="7"/>
     <button :disabled="store.busy||uploadingEmployee">保存员工配置</button></form><h3>知识挂载</h3><p class="team-muted">本页只修改这位员工的挂载，同队其他员工不会继承。</p><div v-for="k in currentEmployee.knowledgeIds" :key="k" class="team-row"><span>{{store.data.knowledge[k]?.title}} · v{{store.data.knowledge[k]?.revision}}</span><button class="secondary small" @click="mount(currentEmployee.id,k,true)">卸载</button></div><div class="team-row"><select v-model="mountSource[currentEmployee.id]"><option value="">选择知识源</option><option v-for="k in Object.values(store.data.knowledge).filter(k=>!currentEmployee?.knowledgeIds.includes(k.id))" :key="k.id" :value="k.id">{{k.title}}</option></select><button @click="mount(currentEmployee.id,mountSource[currentEmployee.id])">挂载到此员工</button></div></section>
   </template>
   <ProjectLibrary v-else-if="tab==='projects'" :team-id="team.id"/>
   <TeamSkillConfiguration v-else-if="tab==='settings'" :key="team.id" :team="team" :members="members"/>
   <form v-else class="team-card team-settings" @submit.prevent="save"><h2>运行设置</h2><label>团队名称<input v-model="name" required/></label><label>产品 / 模块 / 业务描述<textarea v-model="description"/></label><label>未指定接收人的目标交给<select v-model="receiver"><option value="">尚未指定</option><option v-for="e in members" :key="e.id" :value="e.id">{{e.name}}</option></select></label><label>每次运行的模型调用上限<input type="number" min="1" max="1000" v-model.number="maxRounds"/></label><label>每次运行的时长上限（秒）<input type="number" min="1" max="86400" v-model.number="maxSeconds"/></label><button :disabled="store.busy">保存配置版本</button><p class="team-muted">在途任务保持原配置快照，新任务按当前有效配置执行。</p></form>
  </template>
 </div>
</template>
