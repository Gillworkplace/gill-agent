<script setup lang="ts">
defineProps<{ name: string; content: string }>()
const emit = defineEmits<{ (e: 'close'): void }>()
</script>

<template>
  <div id="pvov" style="display:flex">
    <div class="bar">
      <b>{{ name }}</b><span style="flex:1"></span>
      <button @click="emit('close')">✕ 关闭</button>
    </div>
    <pre>{{ content }}</pre>
  </div>
</template>
