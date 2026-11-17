<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { useAuth } from './stores/auth'
import LoginView from './views/LoginView.vue'
import WorkspaceView from './views/WorkspaceView.vue'
import TeamWorkspace from './team/TeamWorkspace.vue'
const legacy=ref(location.hash.startsWith('#/legacy'))
const updateRoute=()=>{legacy.value=location.hash.startsWith('#/legacy')}
onMounted(()=>window.addEventListener('hashchange',updateRoute))
onUnmounted(()=>window.removeEventListener('hashchange',updateRoute))

const auth = useAuth()
const view = computed(() => auth.loggedIn ? 'workspace' : 'login')
</script>

<template>
  <LoginView v-if="view === 'login'" />
  <WorkspaceView v-else-if="legacy" />
  <TeamWorkspace v-else />
</template>
