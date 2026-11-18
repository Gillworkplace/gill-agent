<script setup lang="ts">
defineProps<{heading:'h1'|'h2';title:string;description:string;action:string}>()
defineEmits<{create:[]}>()
</script>

<template>
 <div class="team-empty-state">
  <div class="team-entry-icon" aria-hidden="true"><span class="team-entry-organization"><i></i><i></i><i></i></span></div>
  <component :is="heading">{{title}}</component>
  <p>{{description}}</p>
  <button type="button" class="team-entry-primary" @click="$emit('create')"><span aria-hidden="true">＋</span> {{action}}</button>
 </div>
</template>
