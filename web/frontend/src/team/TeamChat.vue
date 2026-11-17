<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useTeams } from './store'
import type { Team, Message } from './types'
import { teamMessages, stateLabel } from './presentation'
import TaskControls from './TaskControls.vue'
const props=defineProps<{team:Team}>()
defineEmits<{(e:'show-teams'):void}>()
const store=useTeams(), text=ref(''), mentions=ref<string[]>([]), reply=ref<Message>(), project=ref(''), onlyMentions=ref(false), feed=ref<HTMLElement>()
const submitting=ref(false), requestKey=ref(crypto.randomUUID()), decisionText=ref<Record<string,string>>({})
const messages=computed(()=>teamMessages(store.data.messages,props.team.id).filter(m=>!onlyMentions.value||m.mentionUser))
const members=computed(()=>Object.values(store.data.employees).filter(e=>e.teamId===props.team.id))
const projects=computed(()=>Object.values(store.data.projects).filter(p=>p.teamId===props.team.id))
const runs=computed(()=>Object.values(store.data.runs).filter(r=>r.teamId===props.team.id))
const artifacts=computed(()=>Object.values(store.data.artifacts).filter(a=>a.teamId===props.team.id))
function sender(m:Message){return m.senderType==='user'?'我':store.data.employees[m.senderId]?.name||'平台'}
function quote(m:Message){reply.value=m;if(m.senderType==='employee')mentions.value=[m.senderId];nextTick(()=>document.getElementById('team-chat-input')?.focus())}
function inputChanged(){requestKey.value=crypto.randomUUID()}
async function send(){
 if(!text.value.trim()||submitting.value)return
 submitting.value=true
 try{
  await store.command('message.send',{teamId:props.team.id,text:text.value.trim(),mentions:mentions.value,replyTo:reply.value?.id||'',projectId:project.value},requestKey.value)
  text.value='';mentions.value=[];reply.value=undefined;requestKey.value=crypto.randomUUID()
  nextTick(()=>{if(feed.value)feed.value.scrollTop=feed.value.scrollHeight})
 }catch{}finally{submitting.value=false}
}
async function answer(id:string,resolved:boolean){
 const value=decisionText.value[id]?.trim();if(!value)return
 try{await store.command('decision.respond',{decisionId:id,answer:value,resolved});delete decisionText.value[id]}catch{}
}
const additionalCalls=ref<Record<string,number>>({})
const additionalSeconds=ref<Record<string,number>>({})
async function control(runId:string,operation:string){try{await store.command('run.control',{runId,operation,additionalCalls:additionalCalls.value[runId]||0,additionalSeconds:additionalSeconds.value[runId]||0})}catch{}}
watch(()=>props.team.id,()=>{text.value='';mentions.value=[];reply.value=undefined;project.value='';onlyMentions.value=false;requestKey.value=crypto.randomUUID()})
watch(()=>messages.value.length,()=>nextTick(()=>{if(feed.value&&feed.value.scrollHeight-feed.value.scrollTop-feed.value.clientHeight<350)feed.value.scrollTop=feed.value.scrollHeight}))
</script>
<template>
 <div class="team-chat">
  <header class="team-chat-header"><div><h2>{{team.name}}</h2><small class="team-muted">{{members.length}} 位专属员工 · {{team.description}}</small></div><button class="team-mobile-toggle secondary" @click="$emit('show-teams')">团队状态</button></header>
  <div class="team-chat-toolbar"><button class="secondary small" :aria-pressed="onlyMentions" @click="onlyMentions=!onlyMentions">@我</button><span class="team-muted">目标、协作和需要你决定的事项都在群里</span><details v-if="runs.length"><summary>运行控制</summary><div v-for="run in runs" :key="run.id" class="run-controls"><span>{{run.goal}} · {{stateLabel(run.state)}} · 已派发模型 {{run.calls}} 次</span><button class="secondary small" @click="control(run.id,'pause')">暂停</button><button class="secondary small" @click="control(run.id,'resume')">恢复</button><button class="secondary small" @click="control(run.id,'stop')">停止</button><label>追加调用额度<input type="number" min="0" max="1000" v-model.number="additionalCalls[run.id]"/></label><label>追加运行秒数<input type="number" min="0" max="86400" v-model.number="additionalSeconds[run.id]"/></label></div></details></div>
  <div ref="feed" class="team-chat-feed">
   <p v-if="!messages.length" class="team-empty">给团队一个目标，或 @一位员工开始沟通。</p>
   <TaskControls :team-id="team.id"/>
   <article v-for="message in messages" :key="message.id" class="real-message" :class="{self:message.senderType==='user',attention:message.mentionUser&&message.status==='needs-user'}" :id="'real-message-'+message.id">
    <span class="real-avatar">{{sender(message).slice(-1)}}</span><div class="real-message-main">
     <div class="real-message-meta"><b>{{sender(message)}}</b><time>{{new Date(message.createdAt).toLocaleTimeString()}}</time><span v-if="message.kind!=='chat'">{{message.kind}}</span></div>
     <div class="real-message-bubble"><div v-if="message.mentions?.length" class="mention-chips"><span v-for="id in message.mentions" :key="id">@{{store.data.employees[id]?.name||'失效员工'}}</span></div><p>{{message.text}}</p>
      <small v-if="message.replyTo" class="team-muted">回复：{{store.data.messages[message.replyTo]?.text.slice(0,90)}}</small>
      <template v-if="message.decisionId&&store.data.decisions[message.decisionId]">
       <section class="real-decision"><span class="team-badge">{{store.data.decisions[message.decisionId].state==='open'?'等待评估':'已记录并应用决定'}}</span>
        <p>当前处理者：{{store.data.decisions[message.decisionId].handlerId==='user'?'我':store.data.employees[store.data.decisions[message.decisionId].handlerId]?.name}}</p>
        <details><summary>查看尝试与选项</summary><pre>{{store.data.decisions[message.decisionId].attempts}}</pre><pre>{{store.data.decisions[message.decisionId].options}}</pre></details>
        <template v-if="store.data.decisions[message.decisionId].state==='open'">
         <label :for="'answer-'+message.id">你的处理意见</label><textarea :id="'answer-'+message.id" v-model="decisionText[message.decisionId]" placeholder="明确决定，或说明还需要补充哪些依据"/>
         <div class="team-row"><button :disabled="store.busy||!decisionText[message.decisionId]" @click="answer(message.decisionId,true)">提交明确决定</button><button class="secondary" :disabled="store.busy||!decisionText[message.decisionId]" @click="answer(message.decisionId,false)">补充信息，仍未解决</button></div>
        </template><p v-else>{{store.data.decisions[message.decisionId].answer}} · 人工另行暂停仍需单独恢复。</p>
       </section>
      </template>
     </div><button class="text-button small" @click="quote(message)">引用回复</button>
    </div>
   </article>
   <section v-if="artifacts.length" class="team-artifacts"><h3>团队成果</h3><details v-for="artifact in artifacts" :key="artifact.id" class="team-card"><summary>{{artifact.title}} <span class="team-badge">v{{artifact.revision}}</span></summary><pre>{{artifact.content}}</pre><p class="team-warning">未验证：{{artifact.unchecked}}</p><p>剩余问题：{{artifact.remaining||'未记录'}}</p><details><summary>历史版本与检查依据</summary><pre v-for="version in artifact.versions" :key="version.revision">v{{version.revision}} · {{version.content}}</pre><p v-for="check in Object.values(store.data.checks).filter(c=>c.artifactId===artifact.id)" :key="check.id">v{{check.subjectRevision}} · {{check.kind}}：{{check.result}}；{{check.limitations}}</p><p class="team-muted">实际工具回执：</p><pre>{{store.data.tasks[artifact.taskId]?.executedActions||'尚无实际工具执行记录'}}</pre></details></details></section>
  </div>
  <form class="team-composer" @submit.prevent="send">
   <div v-if="reply" class="reply-strip">回复 {{sender(reply)}}：{{reply.text.slice(0,50)}}<button type="button" class="text-button" @click="reply=undefined">取消引用</button></div>
   <div class="composer-routing"><label>@员工 <select v-model="mentions" multiple aria-label="@员工"><option v-for="employee in members" :value="employee.id" :key="employee.id">{{employee.name}} · {{employee.role}}</option></select></label><label v-if="projects.length">关联项目<select v-model="project"><option value="">不关联项目</option><option v-for="p in projects" :key="p.id" :value="p.id">{{p.name}}</option></select></label><small class="team-muted">未指定接收人时，目标交给团队配置的接收员工。</small></div>
   <textarea id="team-chat-input" v-model="text" aria-label="团队群聊消息" placeholder="交给团队一个目标，补充资料，或 @同事…" @input="inputChanged"/>
   <div class="team-row between"><small class="team-muted">消息会真实保存；请求收到与执行完成分开显示。</small><button :disabled="submitting||!text.trim()">{{submitting?'发送中…':'发送 →'}}</button></div>
  </form>
 </div>
</template>
