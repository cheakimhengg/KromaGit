<script setup lang="ts">
import WorkingCopy from './WorkingCopy.vue'
import CommitDetails from './CommitDetails.vue'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
</script>

<template>
  <aside class="h-full border-l border-line bg-surface">
    <CommitDetails v-if="ui.selectedCommit" :hash="ui.selectedCommit" />
    <WorkingCopy v-else />
  </aside>
</template>
