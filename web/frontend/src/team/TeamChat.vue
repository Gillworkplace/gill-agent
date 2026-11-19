<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useTeams } from './store'
import type { Team, Message } from './types'
import { teamMessages, stateLabel, decisionStateLabel, checksForVersion } from './presentation'
import TaskControls from './TaskControls.vue'
import DecisionContext from './DecisionContext.vue'
import TeamChatComposer from './TeamChatComposer.vue'
const props=defineProps<{team:Team}>()
defineEmits<{(e:'show-teams'):void}>()
const store=useTeams(), onlyMentions=ref(false), feed=ref<HTMLElement>()
const composer=ref<InstanceType<typeof TeamChatComposer>>()
const decisionText=ref<Record<string,string>>({}), decisionVersions=ref<Record<string,number>>({})
const allMessages=computed(()=>teamMessages(store.data.messages,props.team.id))
const messages=computed(()=>allMessages.value.filter(m=>!onlyMentions.value||m.mentionUser))
const mentionsMe=computed(()=>allMessages.value.some(message=>message.mentionUser))
const pendingMentions=computed(()=>allMessages.value.filter(message=>message.mentionUser&&message.status==='needs-user').length)
const members=computed(()=>Object.values(store.data.employees).filter(e=>e.teamId===props.team.id))
const projects=computed(()=>Object.values(store.data.projects).filter(p=>p.teamId===props.team.id))
const runs=computed(()=>Object.values(store.data.runs).filter(r=>r.teamId===props.team.id))
const artifacts=computed(()=>Object.values(store.data.artifacts).filter(a=>a.teamId===props.team.id))
function sender(m:Message){return m.senderType==='user'?'我':store.data.employees[m.senderId]?.name||'平台'}
function quote(m:Message){composer.value?.quote(m,sender(m))}
function extraMentions(message:Message){
 return (message.mentions||[]).map(id=>({id,name:store.data.employees[id]?.name||'已移除员工'}))
  .filter(member=>!message.text.includes('@'+member.name))
}
function bottom(){nextTick(()=>{if(feed.value)feed.value.scrollTop=feed.value.scrollHeight})}
function approvalLabel(workItemId?:string){
 const work=workItemId?store.data.workItems[workItemId]:undefined
 if(work?.requireDispatchApproval)return work.dispatchApprovalDecisionId?'派工已获许可':'正式派工需你许可'
 return ''
}
function messageApprovalLabel(message:Message){
 const task=message.taskId?store.data.tasks[message.taskId]:undefined
 return task&&!task.parentTaskId&&message.intent==='assign'?approvalLabel(task.workItemId):''
}
async function answer(id:string,resolved:boolean,approveDispatch?:boolean){
 const value=decisionText.value[id]?.trim();if(!value)return
 try{await store.command('decision.respond',{decisionId:id,answer:value,resolved,expectedRevision:decisionVersions.value[id]??store.data.decisions[id]?.revision,...(approveDispatch===undefined?{}:{approveDispatch})});delete decisionText.value[id];delete decisionVersions.value[id]}catch{}
}
function beginAnswer(id:string){if(decisionVersions.value[id]===undefined)decisionVersions.value[id]=store.data.decisions[id]?.revision||1}
const additionalCalls=ref<Record<string,number>>({})
const additionalSeconds=ref<Record<string,number>>({})
async function control(runId:string,operation:string){try{await store.command('run.control',{runId,operation,additionalCalls:additionalCalls.value[runId]||0,additionalSeconds:additionalSeconds.value[runId]||0})}catch{}}
watch(()=>props.team.id,()=>{onlyMentions.value=false;bottom()})
watch(()=>messages.value.length,()=>nextTick(()=>{if(feed.value&&feed.value.scrollHeight-feed.value.scrollTop-feed.value.clientHeight<350)feed.value.scrollTop=feed.value.scrollHeight}))
</script>
<template>
 <div class="team-chat">
  <header class="team-chat-header">
   <div class="team-chat-title"><h2>{{team.name}}</h2><small class="team-muted">{{members.length}} 位成员</small></div>
   <div class="chat-header-actions">
    <button v-if="mentionsMe||onlyMentions" type="button" class="text-button" :aria-pressed="onlyMentions" @click="onlyMentions=!onlyMentions">@我<span v-if="pendingMentions"> {{pendingMentions}}</span></button>
    <details v-if="runs.length" class="chat-run-menu"><summary aria-label="运行控制">运行</summary>
     <div class="chat-run-panel">
      <div v-for="run in runs" :key="run.id" class="run-controls"><span>{{run.goal}} · {{stateLabel(run.state)}} · 已派发模型 {{run.calls}} 次</span><span v-if="approvalLabel(run.workItemId)" class="team-badge">{{approvalLabel(run.workItemId)}}</span><button class="secondary small" @click="control(run.id,'pause')">暂停</button><button class="secondary small" @click="control(run.id,'resume')">恢复</button><button class="secondary small" @click="control(run.id,'stop')">停止</button><label>追加调用额度<input type="number" min="0" max="1000" v-model.number="additionalCalls[run.id]"/></label><label>追加运行秒数<input type="number" min="0" max="86400" v-model.number="additionalSeconds[run.id]"/></label></div>
     </div>
    </details>
    <button type="button" class="team-mobile-toggle text-button" @click="$emit('show-teams')">团队状态</button>
   </div>
  </header>
  <div ref="feed" class="team-chat-feed">
   <p v-if="!messages.length" class="team-empty">给团队一个目标，或 @一位员工开始沟通。</p>
   <TaskControls :team-id="team.id"/>
   <article v-for="message in messages" :key="message.id" class="real-message" :class="{self:message.senderType==='user',attention:message.mentionUser&&message.status==='needs-user'}" :id="'real-message-'+message.id">
    <span class="real-avatar">{{sender(message).slice(-1)}}</span><div class="real-message-main">
     <div class="real-message-meta"><b>{{sender(message)}}</b><time>{{new Date(message.createdAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}}</time><button type="button" class="text-button chat-quote-action" @click="quote(message)">引用回复</button></div>
     <div class="real-message-bubble"><div v-if="extraMentions(message).length" class="mention-chips"><span v-for="member in extraMentions(message)" :key="member.id">@{{member.name}}</span></div><p>{{message.text}}</p>
      <small v-if="message.intent==='notify'||message.requiresResponse===false" class="team-muted">仅通知</small>
      <small v-else-if="message.intent==='review'" class="team-muted">同事核查</small>
      <small v-else-if="message.intent==='assign'" class="team-muted">正式派工</small>
      <span v-if="messageApprovalLabel(message)" class="team-badge">{{messageApprovalLabel(message)}}</span>
      <small v-if="message.replyTo" class="team-muted">回复：{{store.data.messages[message.replyTo]?.text.slice(0,90)}}</small>
      <template v-if="message.decisionId&&store.data.decisions[message.decisionId]">
       <section class="real-decision"><span class="team-badge">{{decisionStateLabel(store.data.decisions[message.decisionId].state)}}</span>
        <p v-if="store.data.decisions[message.decisionId].configurationError" class="team-warning">{{store.data.decisions[message.decisionId].configurationError}}</p>
        <p>当前处理者：{{store.data.decisions[message.decisionId].handlerId==='user'?'我':store.data.employees[store.data.decisions[message.decisionId].handlerId]?.name}}</p>
        <p v-if="store.data.decisions[message.decisionId].dispatchApproval" class="team-badge">{{store.data.decisions[message.decisionId].dispatchApproved===true?'派工已获许可':store.data.decisions[message.decisionId].dispatchApproved===false?'保持派工限制':'申请派工许可'}}</p>
        <DecisionContext :decision="store.data.decisions[message.decisionId]"/>
        <template v-if="store.data.decisions[message.decisionId].state==='open'">
         <label :for="'answer-'+message.id">你的处理意见</label><textarea :id="'answer-'+message.id" v-model="decisionText[message.decisionId]" @focus="beginAnswer(message.decisionId)" @input="beginAnswer(message.decisionId)" placeholder="明确决定，或说明还需要补充哪些依据"/>
         <div class="team-row">
          <template v-if="store.data.decisions[message.decisionId].dispatchApproval&&store.data.decisions[message.decisionId].handlerId==='user'">
           <button :disabled="store.busy||!decisionText[message.decisionId]" @click="answer(message.decisionId,true,true)">提交决定并允许派工</button>
           <button class="secondary" :disabled="store.busy||!decisionText[message.decisionId]" @click="answer(message.decisionId,true,false)">提交决定，保持派工限制</button>
          </template>
          <button v-else-if="!store.data.decisions[message.decisionId].dispatchApproval" :disabled="store.busy||!decisionText[message.decisionId]" @click="answer(message.decisionId,true)">提交明确决定</button>
          <button class="secondary" :disabled="store.busy||!decisionText[message.decisionId]" @click="answer(message.decisionId,false)">补充信息，仍未解决</button>
         </div>
        </template><p v-else-if="store.data.decisions[message.decisionId].state==='superseded'">{{store.data.decisions[message.decisionId].invalidReason||'原任务已变化，此决定不再适用。'}}</p><p v-else>{{store.data.decisions[message.decisionId].answer}} · 人工另行暂停仍需单独恢复。</p>
       </section>
      </template>
     </div>
    </div>
   </article>
   <section v-if="artifacts.length" class="team-artifacts"><h3>团队成果</h3><details v-for="artifact in artifacts" :key="artifact.id" class="team-card"><summary>{{artifact.title}} <span class="team-badge">v{{artifact.revision}}</span></summary><pre>{{artifact.content}}</pre><p class="team-warning">未验证：{{artifact.unchecked}}</p><p>剩余问题：{{artifact.remaining||'未记录'}}</p><div class="current-version-checks"><p v-for="check in checksForVersion(store.data.checks,artifact.id,artifact.revision)" :key="check.id">本版 v{{artifact.revision}} · {{check.kind}}：{{check.result}}；{{check.limitations}}</p><p v-if="!checksForVersion(store.data.checks,artifact.id,artifact.revision).length" class="team-muted">当前 v{{artifact.revision}} 暂无核查记录（未验证）。</p></div><details><summary>历史版本与检查依据</summary><div v-for="version in artifact.versions" :key="version.revision"><pre>v{{version.revision}} · {{version.content}}</pre><p v-for="check in checksForVersion(store.data.checks,artifact.id,version.revision)" :key="check.id">历史 v{{check.subjectRevision}} · {{check.kind}}：{{check.result}}；{{check.limitations}}</p></div><p class="team-muted">实际工具回执：</p><pre>{{store.data.tasks[artifact.taskId]?.executedActions||'尚无实际工具执行记录'}}</pre></details></details></section>
  </div>
  <TeamChatComposer :key="team.id" ref="composer" :team="team" :members="members" :projects="projects" @sent="bottom"/>
 </div>
</template>
