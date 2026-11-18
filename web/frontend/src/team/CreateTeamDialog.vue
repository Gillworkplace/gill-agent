<script setup lang="ts">
import { ref, watch } from 'vue'
import { useTeams } from './store'

const props=defineProps<{open:boolean}>()
const emit=defineEmits<{close:[];created:[id:string]}>()
const store=useTeams()
const dialog=ref<HTMLDialogElement>(),nameInput=ref<HTMLInputElement>(),rules=ref<HTMLDetailsElement>()
const name=ref(''),description=ref(''),prompt=ref(''),error=ref('')

watch(()=>props.open,open=>{
 if(!open){dialog.value?.close();return}
 name.value='';description.value='';prompt.value='';error.value=''
 if(rules.value)rules.value.open=false
 dialog.value?.showModal()
 nameInput.value?.focus()
},{flush:'post'})

function close(){if(!store.busy)emit('close')}
async function create(){
 if(store.busy||!name.value.trim())return
 error.value=''
 try{
  const team=await store.command('team.create',{name:name.value,description:description.value,prompt:prompt.value})
  emit('created',team.id)
 }catch{error.value=store.error}
}
</script>

<template>
 <dialog ref="dialog" class="team-create-dialog" aria-labelledby="create-team-title" @cancel.prevent="close" @click.self="close">
  <form class="team-create" @submit.prevent="create">
   <header class="team-create-header">
    <h2 id="create-team-title">新建团队</h2>
    <button class="team-create-close" type="button" aria-label="关闭新建团队" :disabled="store.busy" @click="close">×</button>
   </header>
   <p v-if="error" class="team-error team-create-error" role="alert">{{error}}</p>
   <label for="create-team-name">团队名称</label>
   <input id="create-team-name" ref="nameInput" v-model="name" placeholder="例如：产品研发团队" required/>
   <label for="create-team-description">团队简介<span class="team-create-optional">选填</span></label>
   <textarea id="create-team-description" v-model="description" rows="2" placeholder="一句话描述团队负责的产品、模块或业务"/>
   <details ref="rules" class="team-create-rules">
    <summary>协作规则<span class="team-create-optional">选填</span></summary>
    <label for="create-team-prompt">协作 Prompt</label>
    <textarea id="create-team-prompt" v-model="prompt" rows="3" placeholder="描述团队如何分工、复核和上报"/>
   </details>
   <div class="team-create-actions">
    <button class="secondary" type="button" :disabled="store.busy" @click="close">取消</button>
    <button class="team-entry-primary" type="submit" :disabled="store.busy||!name.trim()">{{store.busy?'创建中…':'创建团队'}}</button>
   </div>
  </form>
 </dialog>
</template>
