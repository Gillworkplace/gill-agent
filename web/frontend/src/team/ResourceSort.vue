<script setup lang="ts">
import type { ResourceSortOrder } from './resourceSort'

const order=defineModel<ResourceSortOrder>({required:true})
const props=defineProps<{label:string}>()
</script>

<template>
 <label class="resource-sort">排序
  <select v-model="order" :aria-label="props.label+'排序'">
   <option value="name">名称字典序</option>
   <option value="updated">最近更新</option>
  </select>
 </label>
</template>

<style scoped>
.team-app .resource-sort{display:flex;align-items:center;gap:8px;margin:0;white-space:nowrap}
.resource-sort select{width:auto}
</style>
