<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useTeams } from './store'
import type { Skill } from './types'
const store=useTeams(),selected=ref(''),draftId=ref(''),text=ref(''),name=ref(''),prompt=ref(''),skills=ref<Skill[]>([]),note=ref('')
const sharing=ref<string[]>([])
const baseRevision=ref(0)
const current=computed(()=>store.data.templates[selected.value])
const draft=computed(()=>store.data.drafts[draftId.value])
const templates=computed(()=>Object.values(store.data.templates))
function blank(){selected.value='';draftId.value='';name.value='';prompt.value='';skills.value=[];note.value=''}
function open(id:string){selected.value=id;draftId.value='';const t=store.data.templates[id];baseRevision.value=t.revision;sharing.value=[...(t.authorizedTeamIds||[])];name.value=t.name;prompt.value=t.prompt;skills.value=t.skills.map(s=>({...s}))}
function addSkill(){skills.value.push({name:'',content:''})}
async function chat(){
 if(!text.value.trim()||draft.value?.busy)return
 try{const result=await store.command('template.generate',{id:draftId.value,text:text.value,draft:{name:name.value,prompt:prompt.value,skills:skills.value}});draftId.value=result.id;text.value='';selected.value=''}catch{}
}
async function share(){if(!current.value)return;try{await store.command('template.share',{id:current.value.id,expectedRevision:baseRevision.value,teamIds:sharing.value})}catch{}}
async function save(){
 try{const result=await store.command('template.save',{...(selected.value?{id:selected.value,expectedRevision:baseRevision.value}:{}),name:name.value,prompt:prompt.value,skills:skills.value,draftId:draftId.value,reason:note.value});open(result.id)}catch{}
}
watch(()=>draft.value?.busy,(busy,previous)=>{
 if(busy===false&&previous===true&&draft.value){name.value=draft.value.name||'';prompt.value=draft.value.prompt||'';skills.value=(draft.value.skills||[]).map(s=>({...s}))}
})
function openDraft(id:string){draftId.value=id;selected.value='';const d=store.data.drafts[id];name.value=d.name||'';prompt.value=d.prompt||'';skills.value=(d.skills||[]).map(s=>({...s}))}
</script>
<template>
 <div class="team-page"><header class="team-page-head"><div><h1>数字员工模板</h1><p class="team-muted">通过对话定义工作 Prompt 和 Skills，再为团队创建专属员工。</p></div><button @click="blank">＋ 新建模板</button></header>
  <div class="template-workspace">
   <aside class="team-card template-list"><h3>已保存模板</h3><button v-for="t in templates" :key="t.id" class="template-select" :class="{active:selected===t.id}" @click="open(t.id)"><b>{{t.name}}</b><small>v{{t.revision}} · {{t.skills.length}} 项 Skills</small></button><p v-if="!templates.length" class="team-muted">尚无模板，从右侧对话开始。</p><details><summary>继续已有草稿</summary><button v-for="d in Object.values(store.data.drafts)" :key="d.id" class="template-select" @click="openDraft(d.id)">{{d.name||'未命名草稿'}} {{d.busy?'· 生成中':''}}</button></details></aside>
   <section class="team-card template-conversation"><h2>{{selected?'完善模板':'聊聊需要怎样的员工'}}</h2><div class="template-messages"><p v-if="!draft" class="team-muted">可以描述员工的职责、能力、协作方式及拿不准时如何上报。模型会生成可编辑草稿。</p><article v-for="(m,i) in draft?.messages" :key="i" :class="{self:m.role==='user'}"><b>{{m.role==='user'?'我':'模板助手'}}</b><p>{{m.content}}</p></article><p v-if="draft?.busy" role="status">正在生成草稿…</p><p v-if="draft?.error" class="team-error">{{draft.error}}</p></div><form @submit.prevent="chat"><label for="template-chat">继续对话</label><textarea id="template-chat" v-model="text" placeholder="例如：帮我创建一位擅长资料研究、核实出处的数字员工…"/><button :disabled="store.busy||draft?.busy||!text.trim()">发送</button></form></section>
   <form class="team-card template-preview" @submit.prevent="save"><h2>{{selected?'模板配置':'草稿预览'}}</h2><label for="template-name">模板名称</label><input id="template-name" v-model="name" required/><label for="template-prompt">工作 Prompt</label><textarea id="template-prompt" v-model="prompt" rows="10" required/><div class="team-row between"><h3>能力 Skills</h3><button type="button" class="text-button" @click="addSkill">＋ 添加 Skill</button></div><section v-for="(skill,index) in skills" :key="index" class="skill-editor"><label>名称<input v-model="skill.name" required/></label><label>指令与素材<textarea v-model="skill.content" required/></label><button type="button" class="text-button" @click="skills.splice(index,1)">移除</button></section><label>修改说明<input v-model="note"/></label><button :disabled="store.busy||!name.trim()||!prompt.trim()">{{selected?'保存新版本':'保存为数字员工模板'}}</button><p class="team-muted">草稿经保存后成为模板；员工创建与模板采用分别记录。</p><details v-if="current?.originTeamId"><summary>跨团队采用授权</summary><p class="team-muted">本迭代来自 {{store.data.teams[current.originTeamId]?.name}}。选择允许采用当前版本的团队；新迭代重新核对分享范围。</p><label v-for="team in Object.values(store.data.teams).filter(t=>t.id!==current?.originTeamId)" :key="team.id"><input style="width:auto" type="checkbox" v-model="sharing" :value="team.id"/> {{team.name}}</label><button type="button" class="secondary" @click="share">保存当前版本分享范围</button></details><details v-if="current"><summary>版本与迭代来源</summary><article v-for="v in current.versions" :key="v.revision"><b>v{{v.revision}} · {{v.authorType}} {{v.authorId}}</b><pre>{{v.prompt}}</pre></article></details></form>
  </div>
 </div>
</template>
