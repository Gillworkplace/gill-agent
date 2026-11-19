<script setup lang="ts">
import { onMounted, ref } from 'vue'
import PromptPackageField from './PromptPackageField.vue'
import type { OrganizationTemplate, TeamRole, TemplateFile } from './types'

export interface SkillForm { name:string; roleId:string; personality:string; prompt:string; promptFiles:TemplateFile[]; orgTemplateId?:string; templateRevision?:number }
const props=defineProps<{
 title:string; context:string; impact:string; initial:SkillForm;
 mode:'flow'|'role'|'member'; roles:TeamRole[];
 roleTemplates?:OrganizationTemplate[];
 save:(form:SkillForm)=>Promise<void>
}>()
const emit=defineEmits<{close:[]}>()
const dialog=ref<HTMLDialogElement>(),nameInput=ref<HTMLInputElement>()
const form=ref({...props.initial,promptFiles:props.initial.promptFiles.map(file=>({...file}))})
const uploading=ref(false),saving=ref(false),error=ref('')

onMounted(()=>{
 dialog.value?.showModal()
 if(props.mode==='role')nameInput.value?.focus()
 else dialog.value?.querySelector('textarea')?.focus()
})

function close(){if(!saving.value)emit('close')}
function useTemplate(){
 const source=props.roleTemplates?.find(item=>item.id===form.value.orgTemplateId)
 form.value.templateRevision=source?.revision
 if(source){
  form.value.name=source.name
  form.value.prompt=source.prompt||''
  form.value.promptFiles=source.promptFiles||[]
 }
}
async function submit(){
 if(uploading.value||saving.value)return
 error.value=''
 if(props.mode==='role'&&!form.value.name.trim()){
  error.value='请输入角色名称。'
  nameInput.value?.focus()
  return
 }
 saving.value=true
 try{
  await props.save({...form.value,name:form.value.name.trim()})
  emit('close')
 }catch(cause){
  error.value=cause instanceof Error?cause.message:'保存失败，请重试。'
 }finally{saving.value=false}
}
</script>

<template>
 <dialog ref="dialog" class="team-skill-dialog" aria-labelledby="team-skill-editor-title" @cancel.prevent="close">
  <form @submit.prevent="submit">
   <header class="skill-dialog-head">
    <div><h2 id="team-skill-editor-title">{{title}}</h2><p class="skill-dim">{{context}}</p></div>
    <button type="button" class="secondary skill-close" aria-label="关闭编辑" :disabled="saving" @click="close">×</button>
   </header>
   <div class="skill-dialog-body">
    <label v-if="roleTemplates?.length">角色模板
     <select v-model="form.orgTemplateId" :disabled="saving||uploading" @change="useTemplate">
      <option value="">空白角色</option>
      <option v-for="item in roleTemplates" :key="item.id" :value="item.id">{{item.name}} · v{{item.revision}}</option>
     </select>
    </label>
    <label v-if="mode==='role'">角色名称<input ref="nameInput" v-model="form.name" maxlength="30" :disabled="saving" required/></label>
    <label v-if="mode==='member'">采用角色
     <select v-model="form.roleId" :disabled="saving">
      <option value="">暂未关联角色</option>
      <option v-for="role in roles" :key="role.id" :value="role.id">{{role.name}}</option>
     </select>
    </label>
    <label v-if="mode==='member'">性格与工作态度
     <textarea v-model="form.personality" rows="3" placeholder="例如：谨慎核对依据，沟通时先给结论" :disabled="saving"/>
    </label>
    <PromptPackageField id="team-skill-prompt" :label="mode==='member'?'个人工作方式 Prompt':'Prompt'" v-model="form.prompt" v-model:files="form.promptFiles"
                         v-model:uploading="uploading" :disabled="saving" :rows="5" expanded-by-default/>
    <p v-if="error" class="team-error" role="alert">{{error}}</p>
   </div>
   <footer class="skill-dialog-foot">
    <p class="skill-dim">{{impact}}</p>
    <div class="team-row">
     <button type="button" class="secondary" :disabled="saving" @click="close">取消</button>
     <button type="submit" :disabled="uploading||saving">{{saving?'保存中…':'保存配置'}}</button>
    </div>
   </footer>
  </form>
 </dialog>
</template>
