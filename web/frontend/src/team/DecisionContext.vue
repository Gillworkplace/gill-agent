<script setup lang="ts">
import { computed } from 'vue'
import { decisionOpinions } from './presentation'
import { useTeams } from './store'
import type { Decision } from './types'

const props=defineProps<{decision:Decision}>()
const store=useTeams()
const task=computed(()=>store.data.tasks[props.decision.taskId])
const opinions=computed(()=>decisionOpinions(store.data.messages,props.decision))
const employeeName=(id:string)=>id==='user'?'我':store.data.employees[id]?.name||'员工 '+id
</script>

<template>
 <details class="decision-context">
  <summary>查看尝试与选项</summary>
  <dl>
   <dt>需要决定的问题</dt><dd>{{decision.problem||'尚未记录'}}</dd>
   <dt>影响范围</dt><dd>{{task?.goal||'尚未记录关联任务'}}</dd>
   <dt>已做尝试</dt><dd><ul v-if="decision.attempts?.length"><li v-for="(attempt,index) in decision.attempts" :key="index">{{attempt}}</li></ul><span v-else>尚未记录</span></dd>
   <dt>候选选项</dt><dd><ul v-if="decision.options?.length"><li v-for="(option,index) in decision.options" :key="index">{{option}}</li></ul><span v-else>尚未记录</span></dd>
   <dt>候选代价</dt><dd>没有单独记录，已知说明见候选选项。</dd>
   <dt>上报经过</dt><dd>{{decision.path?.length?decision.path.map(employeeName).join(' → '):'尚未记录'}}</dd>
   <dt>已记录意见</dt><dd><ul v-if="opinions.length"><li v-for="opinion in opinions" :key="opinion.id">{{opinion.senderType==='user'?'我':employeeName(opinion.senderId)}}：{{opinion.text}}</li></ul><span v-else>尚无意见</span></dd>
  </dl>
 </details>
</template>

<style scoped>
.decision-context dl{display:grid;grid-template-columns:1fr;gap:4px;margin:.5rem 0}
.decision-context dt{font-weight:600}
.decision-context dd{margin:0 0 .4rem;overflow-wrap:anywhere}
.decision-context ul{padding-inline-start:1.25rem;margin:0}
</style>
