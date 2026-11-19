<script setup lang="ts">
import { ref } from 'vue'

defineProps<{ label: string; disabled?: boolean }>()
const emit = defineEmits<{ select: [files: File[]] }>()
const input = ref<HTMLInputElement>()

function select(event: Event) {
  const target = event.target as HTMLInputElement
  const files = Array.from(target.files || [])
  target.value = ''
  if (files.length) emit('select', files)
}
</script>

<template>
  <button type="button" class="secondary small prompt-folder-button" :aria-label="label" :disabled="disabled" @click="input?.click()">导入文件夹</button>
  <input ref="input" type="file" webkitdirectory multiple hidden :aria-label="'选择文件夹 · ' + label" @change="select"/>
</template>

<style scoped>
.prompt-folder-button { white-space: nowrap; }
</style>
