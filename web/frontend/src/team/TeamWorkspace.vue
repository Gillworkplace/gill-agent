<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useTeams } from './store'
import { useAuth } from '../stores/auth'
import { mentionsForUser, employeeActivity, stateLabel, latestForTeam, workspaceFreshness } from './presentation'
import TeamChat from './TeamChat.vue'
import TeamDirectory from './TeamDirectory.vue'
import TemplateLibrary from './TemplateLibrary.vue'
import KnowledgeLibrary from './KnowledgeLibrary.vue'
import './team.css'
import './templateCatalog.css'

const store=useTeams(), auth=useAuth()
const route=ref(location.hash.slice(1)||'/workbench'), active=ref(''), panel=ref(false)
const nav=[['/workbench','◉','工作台'],['/templates','◇','数字员工模板'],['/teams','♧','团队'],['/knowledge','▤','知识库']]
const teams=computed(()=>Object.values(store.data.teams))
const selected=computed(()=>store.data.teams[active.value]||teams.value[0])
const section=computed(()=>route.value.split('/')[1]||'workbench')
const unread=computed(()=>mentionsForUser(store.data.messages))
const freshness=computed(()=>workspaceFreshness(store.observedAt,Boolean(store.refreshError)))
let timer: ReturnType<typeof setInterval>
function navigate(path:string){location.hash=path;panel.value=false}
function syncRoute(){route.value=location.hash.slice(1)||'/workbench'}
function select(id:string){active.value=id;panel.value=false;navigate('/workbench')}
async function refresh(){try{await store.refresh();if(!active.value&&teams.value.length)active.value=teams.value[0].id}catch{}}
function blockers(id:string){return Object.values(store.data.tasks).filter(t=>t.teamId===id&&['blocked','needs_reconciliation','unknown','failed'].includes(t.state))}
function members(id:string){return Object.values(store.data.employees).filter(e=>e.teamId===id)}
function progress(id:string){return latestForTeam(store.data.runs,id)}
onMounted(()=>{window.addEventListener('hashchange',syncRoute);refresh();timer=setInterval(refresh,4000)})
onUnmounted(()=>{clearInterval(timer);window.removeEventListener('hashchange',syncRoute)})
</script>

<template>
 <div class="team-app" :class="{'team-template-route':section==='templates'}">
  <aside class="team-nav">
   <a class="team-brand" href="#/workbench"><b>g</b><span>Gill<small>数字员工团队</small></span></a>
   <small class="team-muted nav-caption">我的工作空间</small>
   <nav aria-label="主导航"><a v-for="[path,symbol,label] in nav" :key="path" :href="'#'+path" :class="{selected:section===path.slice(1)}" :aria-current="section===path.slice(1)?'page':undefined"><span aria-hidden="true">{{symbol}}</span>{{label}}<b v-if="path==='/workbench'&&unread" class="team-counter">@{{unread}}</b></a></nav>
   <footer v-if="section==='templates'">
    <details class="catalog-account">
     <summary><span class="catalog-avatar" aria-hidden="true">管</span>团队管理员</summary>
     <div class="catalog-account-actions"><span>{{auth.user}}</span><a href="#/legacy">旧版会话</a><button class="text-button" @click="auth.logout()">退出登录</button></div>
    </details>
   </footer>
   <footer v-else><span>{{auth.user}} · 团队管理者</span><a href="#/legacy">旧版会话</a><button class="text-button" @click="auth.logout()">退出登录</button></footer>
  </aside>
  <main class="team-main">
   <header v-if="section==='templates'" class="team-topbar">
    <span class="catalog-crumb">我的工作空间 <span aria-hidden="true">/</span> <b>数字员工模板</b></span>
    <span class="catalog-live">真实工作空间 <button class="text-button" @click="refresh">刷新</button></span>
   </header>
   <header v-else class="team-topbar"><span>{{nav.find(n=>n[0].slice(1)===section)?.[2]||'团队'}}</span><span class="team-muted">真实工作空间 <button class="text-button" @click="refresh">刷新</button></span></header>
   <div v-if="store.error||store.refreshError" class="team-error" role="alert">{{store.error||store.refreshError}} <button class="text-button" @click="refresh">重新读取</button></div>
   <div v-if="!store.loaded" class="team-empty">正在读取工作空间…</div>
   <template v-else-if="section==='workbench'">
    <div class="workbench-layout">
     <section class="chat-core"><TeamChat v-if="selected" :team="selected" @show-teams="panel=!panel"/><div v-else class="team-empty"><h1>从一个团队开始</h1><p>创建团队，再从模板创建专属员工。</p><button @click="navigate('/teams')">创建团队</button></div></section>
     <button v-if="panel" class="team-panel-backdrop" aria-label="关闭团队状态" @click="panel=false"/>
     <aside class="team-status-panel" :class="{open:panel}" aria-label="团队状态">
      <h3>团队状态 <button class="text-button" @click="navigate('/teams')">管理</button></h3>
      <article v-for="team in teams" :key="team.id" class="team-status-card" :class="{active:selected?.id===team.id}">
       <button class="team-switch" @click="select(team.id)"><b>{{team.name}}</b><span v-if="mentionsForUser(store.data.messages,team.id)" class="team-counter">@我 {{mentionsForUser(store.data.messages,team.id)}}</span></button>
       <p class="team-muted">{{members(team.id).length}} 位专属员工 · {{team.description||'尚未填写简介'}}</p>
       <p v-if="freshness!=='fresh'" class="team-warning">{{freshness==='stale'?'状态已过期，等待重新读取。':'当前状态未知。'}}</p>
       <template v-else-if="progress(team.id)">
        <dl><dt>目标</dt><dd>{{progress(team.id)?.goal}}</dd><dt>当前</dt><dd>{{stateLabel(progress(team.id)?.state||'unknown')}}</dd><dt>阻塞</dt><dd>{{blockers(team.id).map(t=>t.reason||stateLabel(t.state)).join('；')||'暂无已知阻塞'}}</dd><dt>下一步</dt><dd>{{blockers(team.id).length?'查看相关问题与执行依据':progress(team.id)?.state==='completed'?'查看成果和未验证范围':'等待团队执行反馈'}}</dd><dt>工作</dt><dd>{{Object.values(store.data.tasks).filter(t=>t.teamId===team.id&&t.state==='completed').length}} 项任务已完成</dd></dl>
       </template>
       <p v-else class="team-muted">尚未发起工作目标</p>
       <div class="team-availability"><span v-for="employee in members(team.id)" :key="employee.id">{{employee.name}} · {{stateLabel(employeeActivity(freshness==='fresh'?store.data.tasks:undefined,employee.id))}}</span></div>
       <small class="team-muted" v-if="store.data.updatedAt">源快照 {{new Date(store.data.updatedAt).toLocaleTimeString()}}</small>
       <small v-if="store.observedAt" class="team-muted">最近读取 {{new Date(store.observedAt).toLocaleTimeString()}}</small>
       <button class="text-button" @click="navigate('/teams/'+team.id)">进入团队详情 →</button>
      </article>
     </aside>
    </div>
   </template>
   <TemplateLibrary v-else-if="section==='templates'"/>
   <KnowledgeLibrary v-else-if="section==='knowledge'"/>
   <TeamDirectory v-else :selected-id="route.split('/')[2]||''" @enter-chat="select" @navigate="navigate"/>
  </main>
 </div>
</template>
