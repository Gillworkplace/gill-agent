<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import PromptFolderInput from '../components/PromptFolderInput.vue'
import SkillDirectoryList from './SkillDirectoryList.vue'
import { groupTemplateFiles } from './templateFileLayout'
import { mergeTemplateFiles, uploadTemplateFiles } from './templateFiles'
import type { TemplateFile, TemplateFilePurpose } from './types'

const props=defineProps<{
 id:string; label:string; modelValue:string; files:TemplateFile[]; rows:number; placeholder?:string; disabled?:boolean; expandedByDefault?:boolean
}>()
const emit=defineEmits<{
 'update:modelValue':[value:string]; 'update:files':[files:TemplateFile[]]; 'update:uploading':[value:boolean]
}>()
const uploading=ref(false),error=ref(''),expanded=ref(props.expandedByDefault||false)
const groups=computed(()=>groupTemplateFiles(props.files))
let active=true
onBeforeUnmount(()=>{
 active=false
 if(uploading.value)emit('update:uploading',false)
})

async function importFolder(selection:File[]) {
 uploading.value=true;error.value=''
 emit('update:uploading',true)
 try {
  const result=await uploadTemplateFiles(selection,true)
  if(!active)return
  emit('update:files',mergeTemplateFiles(props.files,result.files))
  expanded.value=true
 }catch(cause){
  if(active)error.value=cause instanceof Error?cause.message:'导入失败，请重试。'
 }finally{
  if(active){uploading.value=false;emit('update:uploading',false)}
 }
}

function changePurpose(path:string,purpose:TemplateFilePurpose){
 emit('update:files',props.files.map(file=>file.path===path?{...file,purpose}:file))
}

function removeFiles(paths:string[]){
 const removed=new Set(paths)
 emit('update:files',props.files.filter(file=>!removed.has(file.path)))
}
</script>

<template>
 <div class="prompt-package-field">
  <div class="team-row between">
   <label :for="id">{{ label }}</label>
   <PromptFolderInput :label="label+' · 导入文件夹'" :disabled="disabled||uploading" @select="importFolder"/>
  </div>
  <textarea :id="id" :value="modelValue" :rows="rows" :placeholder="placeholder" :disabled="disabled"
            @input="emit('update:modelValue',($event.target as HTMLTextAreaElement).value)"/>
  <p v-if="uploading" class="team-muted" role="status">正在导入文件夹…</p>
  <p v-if="error" class="team-error" role="alert">{{error}}</p>
  <p class="team-muted import-instruction">可连续导入多个 Skill 目录，也可选择包含多个 Skill 的上级文件夹。</p>
  <details v-if="files.length" :open="expanded" @toggle="expanded=($event.target as HTMLDetailsElement).open">
   <summary>{{groups.packages.length ? groups.packages.length+' 个 Skill · ' : ''}}{{files.length}} 个已选文件</summary>
   <SkillDirectoryList :groups="groups" editable :disabled="disabled||uploading" @purpose="changePurpose" @remove="removeFiles"/>
  </details>
 </div>
</template>

<style scoped>
.prompt-package-field { margin-block: 10px; }
.prompt-package-field .team-row { flex-wrap: wrap; }
.prompt-package-field label { margin: 0; }
.prompt-package-field textarea { margin-top: 5px; }
.prompt-package-field details { margin-top: 6px; }
.prompt-package-field .import-instruction { font-size: 12px; }
</style>
