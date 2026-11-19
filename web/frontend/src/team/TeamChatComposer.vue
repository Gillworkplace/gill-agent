<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useTeams } from './store'
import type { ChatIntent, Employee, Message, Project, Team } from './types'
import { chatRouting } from './presentation'
import { insertMention, mentionQuery, updateMentions, type Mention } from './chatMentions'

const props=defineProps<{team:Team; members:Employee[]; projects:Project[]}>()
const emit=defineEmits<{sent:[]}>()
const store=useTeams(), input=ref<HTMLTextAreaElement>(), root=ref<HTMLFormElement>()
const text=ref(''), caret=ref(0), mentions=ref<Mention[]>([])
const reply=ref<{message:Message; sender:string}>()
const defaultIntent=ref<ChatIntent>('assign'), chosenIntent=ref<ChatIntent>()
const project=ref(''), approval=ref(false), optionsOpen=ref(false)
const focused=ref(false), composing=ref(false), dismissed=ref(false), highlight=ref(0)
const submitting=ref(false), error=ref('')
let requestKey=crypto.randomUUID()

const modes:{id:ChatIntent; label:string}[]=[
 {id:'notify',label:'仅通知'}, {id:'review',label:'请同事核查'}, {id:'assign',label:'正式派工'},
]
const intent=computed(()=>chosenIntent.value||defaultIntent.value)
const members=computed(()=>props.members.filter(member=>member.lifecycle!=='disabled'))
const query=computed(()=>!dismissed.value&&!composing.value?mentionQuery(text.value,caret.value,mentions.value):undefined)
const suggestions=computed(()=>{
 if(!query.value)return []
 const search=query.value.search.toLocaleLowerCase()
 return members.value.filter(member=>[member.name,member.role]
  .some(value=>value?.toLocaleLowerCase().includes(search)))
})
const showSuggestions=computed(()=>focused.value&&!!query.value&&!optionsOpen.value)
const recipients=computed(()=>{
 if(mentions.value.length)return [...new Set(mentions.value.map(item=>item.id))]
 const sender=reply.value?.message
 return sender?.senderType==='employee'&&members.value.some(member=>member.id===sender.senderId)?[sender.senderId]:[]
})
const recipientCount=computed(()=>{
 if(recipients.value.length||intent.value!=='assign')return recipients.value.length
 const original=reply.value?.message
 const fallback=original ? (original.taskId?store.data.tasks[original.taskId]?.employeeId:undefined) : props.team.receiverId
 return members.value.some(member=>member.id===fallback)?1:0
})
const hint=computed(()=>{
 if(!text.value.trim())return ''
 if(approval.value&&intent.value==='assign'&&recipientCount.value!==1)return '请只 @ 一位负责人。'
 if(intent.value==='review'&&!recipientCount.value)return '输入 @ 选择核查员工。'
 if(intent.value==='assign'&&!recipientCount.value)return '输入 @ 选择接收员工，或在团队设置中指定负责人。'
 return ''
})
const canSend=computed(()=>!!text.value.trim()&&!query.value&&!hint.value&&!submitting.value&&!store.busy)
const sendLabel=computed(()=>submitting.value?'发送中…':!text.value.trim()||!chosenIntent.value&&query.value?'发送':
 intent.value==='assign'?'派工':intent.value==='review'?'请求核查':'发送')
const activeMode=computed(()=>[
 chosenIntent.value?modes.find(mode=>mode.id===intent.value)?.label:'',
 intent.value!=='notify'&&!reply.value?props.projects.find(item=>item.id===project.value)?.name:'',
 approval.value?'后续派工需我许可':'',
].filter(Boolean).join(' · '))

function changed(){requestKey=crypto.randomUUID();error.value=''}
function onInput(event:Event){
 const field=event.target as HTMLTextAreaElement
 mentions.value=updateMentions(text.value,field.value,field.selectionStart,mentions.value)
 text.value=field.value
 caret.value=field.selectionStart
 dismissed.value=false
 if(!composing.value&&query.value)optionsOpen.value=false
 changed()
}
function trackCaret(){
 if(input.value&&caret.value!==input.value.selectionStart){
  caret.value=input.value.selectionStart
  dismissed.value=false
 }
}
function focusOut(event:FocusEvent){
 if(root.value?.contains(event.relatedTarget as Node|null))return
 focused.value=false
 optionsOpen.value=false
}
function selectMention(member:Employee){
 if(!query.value)return
 const draft=insertMention(text.value,query.value,mentions.value,member)
 text.value=draft.text
 mentions.value=draft.mentions
 caret.value=draft.caret
 defaultIntent.value='notify'
 changed()
 nextTick(()=>{
  input.value?.focus()
  input.value?.setSelectionRange(draft.caret,draft.caret)
 })
}
function chooseIntent(value:ChatIntent){
 chosenIntent.value=value
 if(value!=='assign')approval.value=false
 if(value==='notify'){optionsOpen.value=false;input.value?.focus()}
 changed()
}
function quote(message:Message,sender:string){
 if(submitting.value)return
 reply.value={message,sender}
 project.value=''
 approval.value=false
 chosenIntent.value=undefined
 defaultIntent.value='notify'
 optionsOpen.value=false
 changed()
 nextTick(()=>input.value?.focus())
}
function removeQuote(){reply.value=undefined;changed();input.value?.focus()}
defineExpose({quote})

function onKey(event:KeyboardEvent){
 if(composing.value||event.isComposing||event.keyCode===229)return
 if(event.key==='Escape'&&(showSuggestions.value||optionsOpen.value)){
  event.preventDefault()
  dismissed.value=true
  optionsOpen.value=false
  return
 }
 if(showSuggestions.value&&suggestions.value.length&&(event.key==='ArrowDown'||event.key==='ArrowUp')){
  event.preventDefault()
  const length=suggestions.value.length
  highlight.value=(highlight.value+(event.key==='ArrowDown'?1:-1)+length)%length
  nextTick(()=>document.getElementById('chat-member-'+highlight.value)?.scrollIntoView({block:'nearest'}))
  return
 }
 if(event.key!=='Enter'||event.shiftKey)return
 event.preventDefault()
 const member=suggestions.value[highlight.value]
 if(showSuggestions.value&&member){selectMention(member);return}
 if(canSend.value)root.value?.requestSubmit()
}
watch(()=>`${query.value?.start}:${query.value?.search}`,()=>{highlight.value=0})

async function send(){
 if(!canSend.value)return
 submitting.value=true
 try{
  await store.command('message.send',{
   teamId:props.team.id,text:text.value.trim(),mentions:recipients.value,replyTo:reply.value?.message.id||'',
   ...(intent.value==='notify'||reply.value?{}:{projectId:project.value}),
   ...chatRouting(intent.value,approval.value,!!reply.value),
  },requestKey)
  text.value='';caret.value=0;mentions.value=[];reply.value=undefined;project.value=''
  approval.value=false;optionsOpen.value=false;chosenIntent.value=undefined;defaultIntent.value='assign'
  changed()
  emit('sent')
 }catch(cause){error.value=cause instanceof Error?cause.message:'发送失败，请重试'}
 finally{submitting.value=false}
}
</script>

<template>
 <form ref="root" class="team-composer" @submit.prevent="send" @focusout="focusOut">
  <div v-if="reply" class="reply-strip"><span>回复 {{reply.sender}} · {{reply.message.text}}</span>
   <button type="button" class="chat-icon" aria-label="取消引用" @click="removeQuote">×</button>
  </div>
  <div v-if="activeMode||hint||error" class="composer-context">
   <span v-if="activeMode">{{activeMode}}</span>
   <span v-if="hint">{{hint}}</span>
   <span v-if="error" class="team-warning" role="alert">{{error}}</span>
  </div>
  <div class="composer-input-row">
   <button type="button" class="chat-icon composer-more" aria-label="消息选项" :aria-controls="optionsOpen?'team-message-options':undefined" :aria-expanded="optionsOpen"
    :disabled="submitting" @click="optionsOpen=!optionsOpen" @keydown.escape.stop.prevent="optionsOpen=false;input?.focus()">＋</button>
   <textarea id="team-chat-input" ref="input" :value="text" aria-label="团队群聊消息" aria-autocomplete="list"
    :aria-controls="showSuggestions?'team-chat-members':undefined"
    :aria-activedescendant="showSuggestions&&suggestions[highlight]?'chat-member-'+highlight:undefined"
    placeholder="输入消息，@ 提及员工" rows="1" enterkeyhint="send" :readonly="submitting"
    @input="onInput" @focus="focused=true;optionsOpen=false;trackCaret()" @click="trackCaret" @select="trackCaret" @keyup="trackCaret"
    @keydown="onKey" @compositionstart="composing=true" @compositionend="composing=false"/>
   <button class="composer-send" type="submit" :disabled="!canSend">{{sendLabel}}</button>
   <section v-if="optionsOpen" id="team-message-options" class="composer-popover composer-options" aria-label="消息选项"
    @keydown.escape.stop.prevent="optionsOpen=false;input?.focus()">
    <div class="composer-modes" aria-label="发送方式">
     <button v-for="mode in modes" :key="mode.id" type="button" :data-intent="mode.id" :aria-pressed="intent===mode.id"
      @click="chooseIntent(mode.id)">{{mode.label}}</button>
    </div>
    <label v-if="projects.length&&intent!=='notify'&&!reply">关联项目<select v-model="project" @change="changed">
     <option value="">不关联项目</option><option v-for="item in projects" :key="item.id" :value="item.id">{{item.name}}</option>
    </select></label>
    <label v-if="intent==='assign'&&!reply" class="composer-approval">
     <input id="team-dispatch-approval" type="checkbox" v-model="approval" @change="changed"/>后续派工需我许可
    </label>
   </section>
   <div v-else-if="showSuggestions" class="composer-popover composer-mentions">
    <div id="team-chat-members" role="listbox" aria-label="可提及员工">
     <div v-for="(member,index) in suggestions" :id="'chat-member-'+index" :key="member.id" role="option" :aria-selected="index===highlight"
      @pointerdown.prevent @click="selectMention(member)">
      <span class="real-avatar" aria-hidden="true">{{member.name.slice(-1)}}</span>
      <span>{{member.name}} <small v-if="member.role" class="team-muted">{{member.role}}</small></span>
     </div>
    </div>
    <p v-if="!suggestions.length" class="team-muted" role="status">没有匹配的员工</p>
   </div>
  </div>
 </form>
</template>
