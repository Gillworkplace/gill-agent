<script setup lang="ts">
import type { TemplateFile, TemplateFilePurpose } from './types'

defineProps<{files:TemplateFile[];directory?:string;disabled?:boolean}>()
const emit=defineEmits<{
 purpose:[path:string,purpose:TemplateFilePurpose];
 remove:[path:string];
}>()

function changePurpose(path:string,event:Event){
 emit('purpose',path,(event.target as HTMLSelectElement).value as TemplateFilePurpose)
}
</script>

<template>
 <ul v-if="files.length" class="template-file-list">
  <li v-for="file in files" :key="file.path">
   <code :title="file.path">{{directory?file.path.slice(directory.length+1):file.path}}</code>
   <select :value="file.purpose" :aria-label="'文件用途 '+file.path" :disabled="disabled" @change="changePurpose(file.path,$event)">
    <option value="prompt" :disabled="!file.utf8||!file.size">工作指令</option>
    <option value="skill" :disabled="!file.utf8||!file.size">Skill</option>
    <option value="resource">参考文件</option>
   </select>
   <button type="button" class="text-button small" :disabled="disabled" :aria-label="'移除 '+file.path" @click="emit('remove',file.path)">移除</button>
  </li>
 </ul>
</template>

<style scoped>
.template-file-list{list-style:none;margin:8px 0 0;padding:0;max-height:330px;overflow:auto}
.template-file-list li{display:grid;grid-template-columns:minmax(0,1fr) minmax(96px,116px) auto;align-items:center;gap:7px;border-top:1px solid var(--team-line);padding:7px 0}
.template-file-list code{overflow-wrap:anywhere;color:#385078}
.template-file-list select{padding:3px 5px}
.template-file-list .small{white-space:nowrap}
@media(max-width:520px){
 .template-file-list li{grid-template-columns:minmax(0,1fr) auto}
 .template-file-list code{grid-column:1 / -1}
}
</style>
