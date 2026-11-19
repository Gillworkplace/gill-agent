<script setup lang="ts">
import { ref } from 'vue'
import PromptFolderInput from './PromptFolderInput.vue'
import { readPromptFolder } from './promptFolder'

const props = defineProps<{ id: string; label: string; modelValue: string; maximum?: number; required?: boolean; disabled?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: string]; 'update:uploading': [value: boolean] }>()
const error = ref(''), message = ref(''), uploading = ref(false)

async function importFolder(files: File[]) {
  uploading.value = true
  emit('update:uploading', true)
  error.value = ''
  message.value = ''
  try {
    const text = await readPromptFolder(files, props.modelValue, props.maximum)
    emit('update:modelValue', text)
    message.value = '目录文本已追加，可修改后保存。'
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '导入失败，请重试。'
  } finally {
    uploading.value = false
    emit('update:uploading', false)
  }
}
</script>

<template>
  <div class="prompt-text">
    <div class="prompt-text-heading">
      <label :for="id">{{ label }}</label>
      <PromptFolderInput :label="label + ' · 导入文件夹'" :disabled="disabled || uploading" @select="importFolder"/>
    </div>
    <textarea :id="id" :value="modelValue" :maxlength="maximum" :required="required" :readonly="uploading" :disabled="disabled" rows="5"
              @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"/>
    <p v-if="error" class="team-error" role="alert">{{ error }}</p>
    <p v-else-if="uploading || message" class="team-muted" role="status">{{ uploading ? '正在读取文件夹…' : message }}</p>
  </div>
</template>

<style scoped>
.prompt-text-heading { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; justify-content: space-between; }
.prompt-text textarea { box-sizing: border-box; width: 100%; }
</style>
