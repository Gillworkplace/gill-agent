<script setup lang="ts">
import type { SkillConfigurationRecord } from './teamSkillPreview'
import type { TemplateFile } from './types'

defineProps<{ record: SkillConfigurationRecord; compact?: boolean; inherited?: boolean }>()
const names={prompt:'工作指令',skill:'Skill',resource:'参考文件'}
function fileKind(file:TemplateFile){return names[file.purpose]}
</script>

<template>
 <div class="skill-record-contents" :class="{compact}">
  <h3 v-if="!compact">Prompt</h3>
  <p class="skill-record-prompt">{{record.prompt || '暂无补充指令'}}</p>
  <h3 v-if="!compact">文件与 Skills</h3>
  <ul v-if="record.promptFiles?.length" class="skill-record-files">
   <li v-for="file in record.promptFiles" :key="file.path"><code>{{file.path}}</code><span>{{fileKind(file)}}</span></li>
  </ul>
  <p v-else-if="!compact" class="skill-dim">暂无文件</p>
  <details v-if="inherited && record.templateRevision" class="skill-inherited">
   <summary>采用模板 v{{record.templateRevision}}</summary>
   <ul v-if="record.files?.length" class="skill-record-files">
    <li v-for="file in record.files" :key="file.path"><code>{{file.path}}</code><span>{{fileKind(file)}}</span></li>
   </ul>
   <p v-if="!record.files?.length&&!record.skills?.length" class="skill-dim">该模板未配置额外 Skill 文件。</p>
   <details v-for="(skill,index) in record.skills" :key="index" class="skill-inline">
    <summary>{{skill.name}}</summary><p>{{skill.content || skill.description}}</p>
   </details>
  </details>
 </div>
</template>
