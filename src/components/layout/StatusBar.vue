<script setup lang="ts">
import { computed } from 'vue'
import { CloudCheck, FileDiff, GitBranch, Sparkles, ZoomIn } from 'lucide-vue-next'
import { useReposStore } from '@/stores/repos'
import { useUiStore } from '@/stores/ui'

const repos = useReposStore()
const ui = useUiStore()
const snapshot = computed(() => repos.active?.snapshot ?? null)
const branch = computed(() => snapshot.value?.branches.find((b) => b.current))
const changes = computed(() => (snapshot.value ? snapshot.value.workingCopy.unstaged.length + snapshot.value.workingCopy.staged.length : 0))
const version = __APP_VERSION__
</script>

<template>
  <div class="flex h-6 shrink-0 items-center gap-4 border-t border-line bg-bg px-3 text-[11px] text-muted">
    <span v-if="branch" class="flex items-center gap-1">
      <GitBranch :size="12" class="text-accent" />
      {{ branch.name }}
      <span v-if="branch.ahead" class="text-success">↑{{ branch.ahead }}</span>
      <span v-if="branch.behind" class="text-warning">↓{{ branch.behind }}</span>
    </span>
    <span class="flex items-center gap-1"><CloudCheck :size="12" />{{ ui.fetchStatus }}</span>
    <span class="flex items-center gap-1"><FileDiff :size="12" />{{ changes }} changes</span>
    <div class="flex-1" />
    <span class="flex items-center gap-1"><Sparkles :size="12" class="text-accent-2" />{{ ui.aiProvider }}</span>
    <span class="flex items-center gap-1"><ZoomIn :size="12" />{{ ui.zoom }}%</span>
    <span class="font-mono text-faint">v{{ version }}</span>
  </div>
</template>
