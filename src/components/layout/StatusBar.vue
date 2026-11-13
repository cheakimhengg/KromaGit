<script setup lang="ts">
import { computed } from 'vue'
import { CloudCheck, CloudOff, FileDiff, GitBranch, Loader2, Moon, Sparkles, Sun, ZoomIn } from '@/lib/icons'
import { resolvedTheme } from '@/lib/theme'
import { useReposStore } from '@/stores/repos'
import { useUiStore } from '@/stores/ui'
import { useOpsStore } from '@/stores/ops'
import { useSettingsStore } from '@/stores/settings'
import { useAiStore } from '@/stores/ai'
import { fullDate, relativeTime } from '@/lib/format'

const repos = useReposStore()
const ui = useUiStore()
const ops = useOpsStore()
const settings = useSettingsStore()
const ai = useAiStore()
const snapshot = computed(() => repos.active?.snapshot ?? null)
const head = computed(() => snapshot.value?.head ?? null)
const changes = computed(() => (snapshot.value ? snapshot.value.workingCopy.unstaged.length + snapshot.value.workingCopy.staged.length : 0))
const lastFetch = computed(() => snapshot.value?.lastFetch ?? null)
const version = __APP_VERSION__
</script>

<template>
  <div class="flex h-7 shrink-0 items-center gap-4 border-t border-line bg-bg px-3 text-[12px] text-muted">
    <template v-if="snapshot && head && !ui.home">
      <span class="flex items-center gap-1">
        <GitBranch :size="14" class="text-accent" />
        {{ snapshot.currentBranch }}
        <span v-if="head.ahead" class="text-success" :title="`${head.ahead} ahead of ${head.upstream}`">↑{{ head.ahead }}</span>
        <span v-if="head.behind" class="text-warning" :title="`${head.behind} behind ${head.upstream}`">↓{{ head.behind }}</span>
      </span>
      <span v-if="lastFetch" class="flex items-center gap-1" :title="`Last fetch: ${fullDate(lastFetch)}`"><CloudCheck :size="14" />Fetched {{ relativeTime(lastFetch) }}</span>
      <span v-else class="flex items-center gap-1"><CloudOff :size="14" />Never fetched</span>
      <span class="flex items-center gap-1"><FileDiff :size="14" />{{ changes }} {{ changes === 1 ? 'change' : 'changes' }}</span>
      <span v-if="ai.progress" class="flex items-center gap-1 text-accent-2"><Loader2 :size="14" class="animate-spin" />{{ ai.progress }}</span>
      <span v-else-if="ops.running" class="flex items-center gap-1 text-accent"><Loader2 :size="14" class="animate-spin" />{{ ops.running }}…</span>
      <span v-else-if="repos.busy" class="flex items-center gap-1 text-faint"><Loader2 :size="14" class="animate-spin" />Loading…</span>
    </template>
    <div class="flex-1" />
    <button type="button" class="flex items-center gap-1 rounded px-1 hover:bg-hover hover:text-fg" :title="settings.statusLabel ? 'Active AI provider — click to change' : 'AI is optional — click to set up a provider'" @click="ui.openSettings('ai')">
      <Sparkles :size="14" :class="settings.statusLabel ? 'text-accent-2' : 'text-faint'" />{{ settings.statusLabel ?? 'AI off' }}
    </button>
    <span class="flex items-center gap-0.5" title="Zoom (⌘/Ctrl + = / − / 0)">
      <button type="button" class="rounded px-1 hover:bg-hover hover:text-fg" title="Zoom out" @click="settings.zoomBy(-10)">−</button>
      <button type="button" class="flex items-center gap-1 rounded px-1 hover:bg-hover hover:text-fg" title="Reset zoom" @click="settings.resetZoom()"><ZoomIn :size="14" />{{ settings.settings.appearance.zoom }}%</button>
      <button type="button" class="rounded px-1 hover:bg-hover hover:text-fg" title="Zoom in" @click="settings.zoomBy(10)">+</button>
    </span>
    <button type="button" class="flex items-center rounded px-1 hover:bg-hover hover:text-fg" :title="`Theme: ${settings.settings.appearance.theme} — click to switch`" @click="settings.toggleTheme()">
      <component :is="resolvedTheme === 'light' ? Sun : Moon" :size="14" />
    </button>
    <span class="font-mono text-faint">v{{ version }}</span>
  </div>
</template>
