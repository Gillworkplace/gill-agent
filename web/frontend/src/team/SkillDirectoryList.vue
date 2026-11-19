<script setup lang="ts">
import TemplateFileList from './TemplateFileList.vue'
import type { groupTemplateFiles } from './templateFileLayout'
import type { TemplateFilePurpose } from './types'

defineProps<{groups:ReturnType<typeof groupTemplateFiles>;disabled?:boolean;editable?:boolean}>()
const emit=defineEmits<{
 purpose:[path:string,purpose:TemplateFilePurpose];
 remove:[paths:string[]];
}>()

function directoryName(directory:string){
 return directory.replace(/^skills\//,'')||'根目录 Skill'
}
</script>

<template>
 <div class="skill-directory-files">
  <details v-for="group in groups.packages" :key="group.directory" class="skill-file-package"
           :data-skill-directory="group.directory">
   <summary>
    <strong>{{directoryName(group.directory)}}</strong>
    <span>{{group.files.length}} 个文件</span>
   </summary>
   <div class="skill-file-contents">
    <div v-if="editable" class="team-row between skill-file-path">
     <code>{{group.directory ? group.directory+'/' : '/'}}</code>
     <button type="button" class="text-button small" :aria-label="'移除 Skill '+directoryName(group.directory)"
             :disabled="disabled" @click="emit('remove',group.files.map(file=>file.path))">移除 Skill</button>
    </div>
    <TemplateFileList :files="group.files" :directory="group.directory" :disabled="disabled" :read-only="!editable"
                      @purpose="(path,purpose)=>emit('purpose',path,purpose)" @remove="path=>emit('remove',[path])"/>
   </div>
  </details>
  <section v-if="groups.shared.length">
   <h4 v-if="groups.packages.length" class="skill-shared-label">公共文件</h4>
   <TemplateFileList :files="groups.shared" :disabled="disabled" :read-only="!editable"
                     @purpose="(path,purpose)=>emit('purpose',path,purpose)" @remove="path=>emit('remove',[path])"/>
  </section>
 </div>
</template>

<style scoped>
.skill-directory-files{display:grid;gap:7px;margin-top:7px}
.skill-file-package{min-width:0;border:1px solid var(--team-line);border-radius:8px;background:#fff}
.skill-directory-files .skill-file-package>summary{
 display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:8px;
 padding:8px 10px;list-style:none
}
.skill-file-package>summary::-webkit-details-marker{display:none}
.skill-file-package>summary::before{content:"▸";color:#53688a}
.skill-file-package[open]>summary::before{content:"▾"}
.skill-file-package>summary strong{color:#263752;overflow-wrap:anywhere}
.skill-file-package>summary span{white-space:nowrap;color:#53617a}
.skill-file-contents{padding:0 10px 7px}
.skill-file-path code{min-width:0;overflow-wrap:anywhere;color:#53617a}
.skill-file-path button{white-space:nowrap}
.skill-shared-label{margin:5px 0 0;color:#53617a;font-size:12px}
</style>
