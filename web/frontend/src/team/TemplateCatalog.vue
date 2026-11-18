<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { groupTemplateFiles } from './templateFileLayout'
import { catalogSkillNames, filterTemplates, importedSkillName, templateSummary } from './templateCatalog'
import type { EmployeeTemplate } from './types'

const props=defineProps<{templates:EmployeeTemplate[]}>()
const emit=defineEmits<{edit:[id:string]}>()
const query=defineModel<string>('query',{required:true})
const activeId=ref('')
const drawer=ref<HTMLDialogElement>(),search=ref<HTMLInputElement>()
const palette=[['◎','architecture'],['◫','design'],['‹›','coding'],['◇','product']]
const marks=computed(()=>new Map(props.templates.map((template,index)=>[template.id,palette[index%palette.length]])))
const filtered=computed(()=>filterTemplates(props.templates,query.value))
const view=computed(()=>props.templates.find(template=>template.id===activeId.value))
const grouping=computed(()=>groupTemplateFiles(view.value?.files||[]))
const packages=computed(()=>grouping.value.packages.filter(group=>group.files.some(file=>file.purpose==='skill')))
const ungrouped=computed(()=>[...grouping.value.shared,...grouping.value.packages
 .filter(group=>!group.files.some(file=>file.purpose==='skill')).flatMap(group=>group.files)])
const looseSkills=computed(()=>ungrouped.value.filter(file=>file.purpose==='skill'))
const shared=computed(()=>ungrouped.value.filter(file=>file.purpose!=='skill'))
const hasSkills=computed(()=>Boolean(view.value&&(view.value.skills.length||packages.value.length||looseSkills.value.length)))

async function open(id:string){
 activeId.value=id
 await nextTick()
 drawer.value?.showModal()
}
function close(){drawer.value?.close()}
function edit(){close();emit('edit',activeId.value)}
function resetSearch(){query.value='';search.value?.focus()}
</script>

<template>
 <section aria-labelledby="catalog-title">
  <div class="catalog-toolbar">
   <h2 id="catalog-title">{{query.trim()?'匹配模板':'已保存模板'}} <span class="catalog-count" aria-live="polite">{{filtered.length}}</span></h2>
   <label class="catalog-search">
    <span class="catalog-search-icon" aria-hidden="true"></span><span class="catalog-sr-only">搜索模板或 Skill</span>
    <input ref="search" v-model="query" type="search" placeholder="搜索模板或 Skill"/>
   </label>
  </div>
  <div class="template-list catalog-grid">
   <button v-for="template in filtered" :key="template.id" type="button" class="catalog-card" @click="open(template.id)">
    <span class="catalog-card-top"><span class="catalog-mark" :class="marks.get(template.id)?.[1]" aria-hidden="true">{{marks.get(template.id)?.[0]}}</span><span class="catalog-version">v{{template.revision}}</span></span>
    <span class="catalog-card-title">{{template.name}}</span>
    <span class="catalog-description">{{templateSummary(template)}}</span>
    <span class="catalog-chips"><span v-for="skill in catalogSkillNames(template)" :key="skill" class="catalog-chip">{{skill}}</span></span>
    <span class="catalog-card-foot"><span>{{template.files?.length||0}} 个文件</span><span class="catalog-open">查看模板 <span aria-hidden="true">→</span></span></span>
   </button>
   <div v-if="!filtered.length" class="catalog-empty">
    <strong>没有匹配的模板</strong><p>可以换一个模板名或 Skill 名称。</p>
    <button class="catalog-button" type="button" @click="resetSearch">清空搜索</button>
   </div>
  </div>
  <dialog ref="drawer" class="catalog-drawer" aria-labelledby="catalog-detail-title" @click.self="close">
   <div v-if="view" class="catalog-drawer-body">
    <div class="catalog-dialog-top">
     <span class="catalog-mark" :class="marks.get(view.id)?.[1]" aria-hidden="true">{{marks.get(view.id)?.[0]}}</span>
     <button type="button" class="catalog-button catalog-close" aria-label="关闭模板详情" @click="close">×</button>
    </div>
    <h2 id="catalog-detail-title">{{view.name}}</h2>
    <p v-if="templateSummary(view)" class="catalog-detail-copy">{{templateSummary(view)}}</p>
    <div class="catalog-detail-meta"><span class="catalog-version">v{{view.revision}}</span><span class="catalog-chip">{{view.files?.length||0}} 个文件</span></div>
    <section class="catalog-detail-section" aria-labelledby="catalog-detail-skills">
     <h3 id="catalog-detail-skills">Skills</h3>
     <div v-if="hasSkills" class="catalog-skill-list" :key="view.id">
      <details v-for="(skill,index) in view.skills" :key="index" class="catalog-skill">
       <summary>{{skill.name}}</summary><p class="catalog-inline-skill">{{skill.content}}</p>
      </details>
      <details v-for="group in packages" :key="group.directory" class="catalog-skill">
       <summary>{{group.directory.split('/').at(-1)||'根目录 Skill'}}<small v-if="group.directory">{{group.directory}}/</small></summary>
       <ul><li v-for="file in group.files" :key="file.path">{{group.directory?file.path.slice(group.directory.length+1):file.path}}</li></ul>
      </details>
      <details v-for="file in looseSkills" :key="file.path" class="catalog-skill">
       <summary>{{importedSkillName(file.path)}}</summary><ul><li>{{file.path}}</li></ul>
      </details>
     </div>
     <p v-else class="catalog-detail-copy">暂无 Skills</p>
    </section>
    <section v-if="view.prompt||shared.some(file=>file.purpose==='prompt')" class="catalog-detail-section">
     <h3>工作指令</h3>
     <p v-if="view.prompt" class="catalog-detail-copy catalog-prompt">{{view.prompt}}</p>
     <ul v-if="shared.some(file=>file.purpose==='prompt')" class="catalog-shared-list">
      <li v-for="file in shared.filter(file=>file.purpose==='prompt')" :key="file.path">{{file.path}}</li>
     </ul>
    </section>
    <section v-if="shared.length" class="catalog-detail-section">
     <h3>模板公共文件</h3><ul class="catalog-shared-list"><li v-for="file in shared" :key="file.path">{{file.path}}</li></ul>
    </section>
    <button type="button" class="catalog-button catalog-primary" @click="edit">编辑模板</button>
   </div>
  </dialog>
 </section>
</template>
