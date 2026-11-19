<script setup lang="ts">
import { onMounted, ref } from 'vue'
import PromptTextField from './PromptTextField.vue'

const props = defineProps<{ title: string; initial: string; maximum: number; save: (value: string) => Promise<void> }>()
const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLDialogElement>()
const text = ref(props.initial), error = ref(''), saving = ref(false), uploading = ref(false)
onMounted(() => dialog.value?.showModal())

function close() {
  if (!saving.value) emit('close')
}

async function submit() {
  if (saving.value || uploading.value) return
  saving.value = true
  error.value = ''
  try {
    await props.save(text.value)
    emit('close')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '保存失败，请重试。'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <dialog ref="dialog" class="prompt-dialog" aria-labelledby="prompt-dialog-title" @cancel.prevent="close">
    <form @submit.prevent="submit">
      <h2 id="prompt-dialog-title">{{ title }}</h2>
      <PromptTextField id="prompt-dialog-text" label="指令正文" v-model="text" v-model:uploading="uploading" :maximum="maximum" :disabled="saving"/>
      <p v-if="error" role="alert">{{ error }}</p>
      <footer>
        <button type="button" :disabled="saving" @click="close">取消</button>
        <button :disabled="saving || uploading">保存</button>
      </footer>
    </form>
  </dialog>
</template>

<style scoped>
.prompt-dialog { margin: auto; inset: 0; width: min(520px, calc(100% - 32px)); padding: 20px; border: 1px solid #d6deec; border-radius: 12px; background: var(--panel, #fff); color: inherit; }
.prompt-dialog::backdrop { background: #15203966; }
.prompt-dialog h2 { margin-block: 0 14px; }
.prompt-dialog footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
</style>
