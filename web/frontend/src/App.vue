<script setup lang="ts">
import { computed } from 'vue'
import { useAuth } from './stores/auth'
import LoginView from './views/LoginView.vue'
import WorkspaceView from './views/WorkspaceView.vue'

const auth = useAuth()
const view = computed(() => auth.loggedIn ? 'workspace' : 'login')
</script>

<template>
  <LoginView v-if="view === 'login'" />
  <WorkspaceView v-else />
</template>
