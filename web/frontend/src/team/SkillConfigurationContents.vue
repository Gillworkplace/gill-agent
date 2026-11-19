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
  <h3 v-if="!compact">Prompt</h3>
  <p class="skill-record-prompt">{{record.prompt || '暂无补充指令'}}</p>
  <h3 v-if="!compact">文件与 Skills</h3>
  <SkillDirectoryList v-if="record.promptFiles?.length" :groups="ownGroups"/>
  <p v-else-if="!compact" class="skill-dim">暂无文件</p>
  <details v-if="inherited && record.templateRevision" class="skill-inherited">
   <summary>采用模板 v{{record.templateRevision}}</summary>
   <SkillDirectoryList v-if="record.files?.length" :groups="inheritedGroups"/>
   <p v-if="!record.files?.length&&!record.skills?.length" class="skill-dim">该模板未配置额外 Skill 文件。</p>
   <details v-for="(skill,index) in record.skills" :key="index" class="skill-inline">
    <summary>{{skill.name}}</summary><p>{{skill.content || skill.description}}</p>
   </details>
  </details>
 </div>
</template>
