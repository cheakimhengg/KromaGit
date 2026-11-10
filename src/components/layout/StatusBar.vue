<script setup lang="ts">
import { computed } from 'vue'
import { CloudCheck, CloudOff, FileDiff, GitBranch, Loader2, Sparkles, ZoomIn } from 'lucide-vue-next'
import { useReposStore } from '@/stores/repos'
import { useUiStore } from '@/stores/ui'
import { useOpsStore } from '@/stores/ops'
import { fullDate, relativeTime } from '@/lib/format'

const repos = useReposStore()
const ui = useUiStore()
const ops = useOpsStore()
const snapshot = computed(() => repos.active?.snapshot ?? null)
const head = computed(() => snapshot.value?.head ?? null)
const changes = computed(() => (snapshot.value ? snapshot.value.workingCopy.unstaged.length + snapshot.value.workingCopy.staged.length : 0))
const lastFetch = computed(() => snapshot.value?.lastFetch ?? null)
const version = __APP_VERSION__
</script>

<template>
  <div class="flex h-6 shrink-0 items-center gap-4 border-t border-line bg-bg px-3 text-[11px] text-muted">
    <template v-if="snapshot && head">
      <span class="flex items-center gap-1">
        <GitBranch :size="12" class="text-accent" />
        {{ snapshot.currentBranch }}
        <span v-if="head.ahead" class="text-success" :title="`${head.ahead} ahead of ${head.upstream}`">↑{{ head.ahead }}</span>
        <span v-if="head.behind" class="text-warning" :title="`${head.behind} behind ${head.upstream}`">↓{{ head.behind }}</span>
      </span>
      <span v-if="lastFetch" class="flex items-center gap-1" :title="`Last fetch: ${fullDate(lastFetch)}`"><CloudCheck :size="12" />Fetched {{ relativeTime(lastFetch) }}</span>
      <span v-else class="flex items-center gap-1"><CloudOff :size="12" />Never fetched</span>
      <span class="flex items-center gap-1"><FileDiff :size="12" />{{ changes }} {{ changes === 1 ? 'change' : 'changes' }}</span>
      <span v-if="ops.running" class="flex items-center gap-1 text-accent"><Loader2 :size="12" class="animate-spin" />{{ ops.running }}…</span>
      <span v-else-if="repos.busy" class="flex items-center gap-1 text-faint"><Loader2 :size="12" class="animate-spin" />Loading…</span>
    </template>
    <div class="flex-1" />
    <span class="flex items-center gap-1" :title="ui.aiProvider ? 'Active AI provider' : 'AI is optional — set up a provider in Settings (Phase 4)'">
      <Sparkles :size="12" :class="ui.aiProvider ? 'text-accent-2' : 'text-faint'" />{{ ui.aiProvider ?? 'AI off' }}
    </span>
    <span class="flex items-center gap-1"><ZoomIn :size="12" />{{ ui.zoom }}%</span>
    <span class="font-mono text-faint">v{{ version }}</span>
  </div>
</template>
