<script setup lang="ts">
import { computed } from 'vue'
import WorkingCopy from './WorkingCopy.vue'
import CommitDetails from './CommitDetails.vue'
import { useReposStore } from '@/stores/repos'
import { useUiStore } from '@/stores/ui'

const repos = useReposStore()
const ui = useUiStore()

const commit = computed(() => {
  if (!ui.selectedCommit) return null
  return repos.active?.snapshot.commits.find((c) => c.hash === ui.selectedCommit) ?? null
})
</script>

<template>
  <aside class="h-full border-l border-line bg-surface">
    <CommitDetails v-if="commit" :commit="commit" />
    <WorkingCopy v-else />
  </aside>
</template>
