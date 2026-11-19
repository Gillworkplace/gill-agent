<script setup lang="ts">
import { computed } from 'vue'
import SkillDirectoryList from './SkillDirectoryList.vue'
import { groupTemplateFiles } from './templateFileLayout'
import type { SkillConfigurationRecord } from './teamSkillPreview'

const props=defineProps<{ record: SkillConfigurationRecord; compact?: boolean; inherited?: boolean }>()
const ownGroups=computed(()=>groupTemplateFiles(props.record.promptFiles||[]))
const inheritedGroups=computed(()=>groupTemplateFiles(props.record.files||[]))
</script>

<template>
 <div class="skill-record-contents" :class="{compact}">
  <template v-if="record.personality">
   <h3>性格与工作态度</h3>
   <p class="skill-record-prompt">{{record.personality}}</p>
  </template>
  <h3 v-if="!compact">Prompt</h3>
  <p class="skill-record-prompt">{{record.prompt || '暂无补充指令'}}</p>
  <h3 v-if="!compact">文件与 Skills</h3>
  <SkillDirectoryList v-if="record.promptFiles?.length" :groups="ownGroups"/>
  <p v-else-if="!compact" class="skill-dim">暂无文件</p>
  <details v-if="inherited && record.files?.length" class="skill-inherited">
   <summary>{{record.templateRevision ? '历史模板文件 v'+record.templateRevision : '保留的个人文件'}}</summary>
   <SkillDirectoryList v-if="record.files?.length" :groups="inheritedGroups"/>
  </details>
  <details v-for="(skill,index) in record.skills" :key="index" class="skill-inline">
   <summary>{{skill.name}}</summary><p>{{skill.content || skill.description}}</p>
  </details>
 </div>
</template>
