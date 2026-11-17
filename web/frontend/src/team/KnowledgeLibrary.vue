<script setup lang="ts">
import { computed, ref } from 'vue'
import { useTeams } from './store'
const store=useTeams(),selected=ref(''),title=ref(''),content=ref(''),category=ref('')
const baseRevision=ref(0)
const current=computed(()=>store.data.knowledge[selected.value])
function open(id=''){selected.value=id;const k=store.data.knowledge[id];baseRevision.value=k?.revision||0;title.value=k?.title||'';content.value=k?.content||'';category.value=k?.category||''}
async function save(){try{const k=await store.command('knowledge.save',{...(selected.value?{id:selected.value,expectedRevision:baseRevision.value}:{}),title:title.value,content:content.value,category:category.value});open(k.id)}catch{}}
</script>
<template>
 <div class="team-page"><header class="team-page-head"><div><h1>知识库</h1><p class="team-muted">员工只读的共享资料，逐员工显式挂载。你可以追加内容版本。</p></div><button @click="open()">＋ 新建知识</button></header>
  <div class="knowledge-layout"><section class="team-grid"><button v-for="k in Object.values(store.data.knowledge)" :key="k.id" class="team-card knowledge-card" @click="open(k.id)"><b>{{k.title}}</b><span class="team-badge">v{{k.revision}}</span><p>{{k.content.slice(0,140)}}</p><small>{{Object.values(store.data.employees).filter(e=>e.knowledgeIds.includes(k.id)).length}} 位员工已挂载</small></button><p v-if="!Object.keys(store.data.knowledge).length" class="team-empty">添加共享资料后，到团队详情为具体员工挂载。</p></section>
   <form class="team-card" @submit.prevent="save"><h2>{{selected?'维护知识版本':'新建共享知识'}}</h2><label>标题<input v-model="title" required/></label><label>分类<input v-model="category" placeholder="可选，自定义分类"/></label><label>内容<textarea v-model="content" rows="15" required/></label><button :disabled="store.busy||!title.trim()||!content.trim()">{{selected?'追加新版本':'保存知识'}}</button><p class="team-muted">源更新后所有显式挂载员工可读取最新版；卸载阻止新读取，当前任务已读信息保留。</p><details v-if="current"><summary>历史原文</summary><article v-for="v in current.versions" :key="v.revision"><b>v{{v.revision}}</b><pre>{{v.content}}</pre></article></details></form>
  </div>
 </div>
</template>
