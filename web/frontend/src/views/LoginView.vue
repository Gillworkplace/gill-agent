<script setup lang="ts">
import { ref } from 'vue'
import { useAuth } from '../stores/auth'

const auth = useAuth()
const username = ref('')
const password = ref('')
const err = ref('')
const busy = ref(false)

async function submit(register: boolean) {
  if (busy.value) return
  busy.value = true; err.value = ''
  try {
    if (register) await auth.register(username.value, password.value)
    await auth.login(username.value, password.value)
  } catch (e: any) {
    err.value = e.message || '登录失败'
  } finally { busy.value = false }
}
</script>

<template>
  <div id="login">
    <div class="card">
      <h1>Gill Agent</h1>
      <p>协作开发工作台 · 私有部署</p>
      <div class="field"><input v-model="username" placeholder="用户名（3-32 位字母数字）" @keydown.enter="submit(false)"></div>
      <div class="field"><input v-model="password" type="password" placeholder="密码（≥8 位，含字母数字）" @keydown.enter="submit(false)"></div>
      <button class="btn" :disabled="busy" @click="submit(false)">登录</button>
      <button class="btn ghost" :disabled="busy" @click="submit(true)">注册新账号</button>
      <div class="err">{{ err }}</div>
    </div>
  </div>
</template>
