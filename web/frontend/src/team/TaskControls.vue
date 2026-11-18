<script setup lang="ts">
import { computed, ref } from 'vue'
import { api } from '../api'
import { useTeams } from './store'
import { stateLabel } from './presentation'
import TaskSources from './TaskSources.vue'
const props=defineProps<{teamId:string}>(),store=useTeams()
const tasks=computed(()=>Object.values(store.data.tasks).filter(t=>t.teamId===props.teamId))
const members=computed(()=>Object.values(store.data.employees).filter(e=>e.teamId===props.teamId))
const targets=ref<Record<string,string>>({}),evidence=ref<Record<string,string>>({}),stopped=ref<Record<string,boolean>>({})
const resolutions=ref<Record<string,string>>({}),records=ref<Record<string,unknown>>({})
async function update(taskId:string,state:string,employeeId?:string){try{await store.command('task.update',{taskId,state,...(employeeId?{employeeId}:{})})}catch{}}
async function inspect(id:string){try{records.value[id]=await api('/team-workspace/executions/'+id)}catch(error){store.error=error instanceof Error?error.message:'读取失败'}}
async function reconcile(executionId:string){try{await store.command('execution.reconcile',{executionId,executionStopped:stopped.value[executionId]===true,resolution:resolutions.value[executionId]||'failed',evidence:evidence.value[executionId]});delete records.value[executionId]}catch{}}
</script>
<template>
 <details v-if="tasks.length" class="team-card"><summary>任务与执行核实 · {{tasks.length}} 项</summary>
  <article v-for="task in tasks" :key="task.id" class="team-card">
   <b>{{store.data.employees[task.employeeId]?.name}} · {{stateLabel(task.state)}}</b><p>{{task.goal}}</p><p class="team-muted">{{task.reason}}</p>
   <TaskSources :task="task"/>
   <div class="team-row" v-if="!['completed','cancelled'].includes(task.state)">
    <button class="secondary small" :disabled="store.busy" @click="update(task.id,'blocked')">阻断此任务</button>
    <button class="secondary small" :disabled="store.busy||['needs_reconciliation','unknown'].includes(task.state)" @click="update(task.id,'queued')">明确恢复</button>
    <select v-model="targets[task.id]" aria-label="改派给员工"><option v-for="e in members.filter(e=>e.id!==task.employeeId)" :key="e.id" :value="e.id">{{e.name}}</option></select>
    <button class="secondary small" :disabled="store.busy||!targets[task.id]||['needs_reconciliation','unknown'].includes(task.state)" @click="update(task.id,'queued',targets[task.id])">改派</button>
   </div>
   <template v-if="task.executionId">
    <button class="text-button" @click="inspect(task.executionId)">查看真实执行与工具回执</button><pre v-if="records[task.executionId]">{{records[task.executionId]}}</pre>
    <form v-if="['needs_reconciliation','failed'].includes(task.state)" @submit.prevent="reconcile(task.executionId)">
     <p>先核查工作区和外部请求。记录人工结论后仍需明确恢复，不会自动重放未知动作。</p>
     <label><input type="checkbox" v-model="stopped[task.executionId]" required/>已确认旧执行和外部请求停止或结束</label>
     <label>实际核实结果<select v-model="resolutions[task.executionId]"><option value="failed">未完成 / 失败</option><option value="succeeded">已完成</option></select></label>
     <label>核实依据<textarea v-model="evidence[task.executionId]" required placeholder="实际日志、产物、请求状态和用量依据"/></label>
     <button :disabled="store.busy||!stopped[task.executionId]||!evidence[task.executionId]?.trim()">记录核实结论</button>
    </form>
   </template>
  </article>
 </details>
</template>
