<script setup lang="ts">
import { computed } from 'vue'
import { latestKnowledgeReads } from './presentation'
import { useTeams } from './store'
import type { Task } from './types'

const props=defineProps<{task:Task}>()
const store=useTeams()
const reads=computed(()=>latestKnowledgeReads(props.task.knowledgeReads))
const template=computed(()=>store.data.templates[props.task.employeeSnapshot?.templateId||''])
</script>

<template>
 <details class="task-sources">
  <summary>查看本任务的配置与知识来源</summary>
  <p v-if="task.teamSnapshot">团队流程 {{task.teamSnapshot.name}} v{{task.teamSnapshot.revision}}</p>
  <p v-else>未记录团队流程快照</p>
  <template v-if="task.employeeSnapshot">
   <p>员工工作配置 {{task.employeeSnapshot.name}} v{{task.employeeSnapshot.revision}}</p>
   <p>采用模板 {{template?.name||task.employeeSnapshot.templateId}} v{{task.employeeSnapshot.templateRevision}}</p>
   <p v-if="task.employeeSnapshot.skills.length">采用的 Skills {{task.employeeSnapshot.skills.map(skill=>skill.name).join('、')}}</p>
   <details v-if="task.employeeSnapshot.files?.length">
    <summary>采用的模板文件（{{task.employeeSnapshot.files.length}}）</summary>
    <ul><li v-for="file in task.employeeSnapshot.files" :key="file.path"><code>{{file.path}}</code></li></ul>
   </details>
  </template>
  <p v-else>未记录员工工作配置快照</p>
  <ul v-if="reads.length">
   <li v-for="read in reads" :key="read.sourceId+':'+read.revision">
    {{store.data.knowledge[read.sourceId]?.title||read.sourceId}} · 执行器读取 v{{read.revision}} · {{new Date(read.readAt).toLocaleString()}}
    <span v-if="store.data.knowledge[read.sourceId]"> · 共享源当前 v{{store.data.knowledge[read.sourceId].revision}}</span>
   </li>
  </ul>
  <p v-else>暂无知识读取记录</p>
 </details>
</template>
