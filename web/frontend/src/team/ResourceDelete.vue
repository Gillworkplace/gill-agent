<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { useTeams } from './store'

const props=defineProps<{
 kind:string; id:string; name:string; label:string; revision:number; impact:string; projectId?:string
}>()
const store=useTeams()
const dialog=ref<HTMLDialogElement>()
const pending=ref<{name:string; id:string; revision:number; projectId?:string}>()
const deleting=ref(false), error=ref('')

async function ask(){
 pending.value={name:props.name,id:props.id,revision:props.revision,projectId:props.projectId}
 error.value=''
 await nextTick()
 dialog.value?.showModal()
}

function close(){
 if(deleting.value)return
 dialog.value?.close()
 pending.value=undefined
}

async function remove(){
 const requested=pending.value
 if(!requested||deleting.value||store.busy)return
 deleting.value=true
 error.value=''
 try{
  await store.command(props.kind,{
   id:requested.id,expectedRevision:requested.revision,
   ...(requested.projectId?{projectId:requested.projectId}:{}),
  })
 }catch(cause){
  error.value=cause instanceof Error?cause.message:'删除失败'
  return
 }finally{deleting.value=false}
 close()
}
</script>

<template>
 <button type="button" class="secondary resource-delete" :disabled="store.busy" @click="ask">删除{{label}}</button>
 <dialog v-if="pending" ref="dialog" class="resource-delete-dialog" :aria-label="'删除'+label" @cancel.prevent="close" @click.self="close">
  <div>
   <h2>删除{{label}}</h2>
   <p>确定删除「{{pending.name}}」？</p>
   <p class="team-muted">{{impact}}</p>
   <p v-if="error" class="resource-delete-error" role="alert">{{error}}</p>
   <div class="team-row resource-delete-actions">
    <button type="button" class="secondary" :disabled="deleting" autofocus @click="close">取消</button>
    <button type="button" class="resource-delete-confirm" :disabled="deleting||store.busy" @click="remove">{{deleting?'正在删除…':'确认删除'}}</button>
   </div>
  </div>
 </dialog>
</template>

<style scoped>
.team-app .resource-delete{color:#9f2925}
.team-app .resource-delete-dialog{
 position:fixed;inset:0;margin:auto;width:min(440px,100% - 30px);max-width:none;
 height:fit-content;max-height:calc(100% - 30px);overflow:auto;padding:22px;
 border:1px solid var(--team-line);border-radius:14px;background:#fff;color:var(--team-ink);
}
.resource-delete-dialog::backdrop{background:#17213c58}
.resource-delete-error{color:#9f2925}
.resource-delete-actions{justify-content:flex-end;margin-top:18px}
.team-app .resource-delete-confirm{background:#b52925;border-color:#b52925;color:#fff}
</style>
