<script setup lang="ts">
import { ref, watch } from 'vue'
import { Loader2, Pencil } from '@/lib/icons'
import Avatar from '@/components/common/Avatar.vue'
import { errorMessage, gitApi } from '@/api/git'
import { fullDate, relativeTime } from '@/lib/format'
import type { FileHistoryEntry } from '@/types/git'

/** `selected` is a commit hash, or "working" for the file on disk */
const props = defineProps<{ repo: string; path: string; selected?: string }>()
const emit = defineEmits<{ open: [FileHistoryEntry | null] }>()

const entries = ref<FileHistoryEntry[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

watch(
  () => [props.repo, props.path] as const,
  async ([repo, path], _o, onCleanup) => {
    let cancelled = false
    onCleanup(() => (cancelled = true))
    loading.value = true
    error.value = null
    try {
      const r = await gitApi.fileHistory(repo, path, 500)
      if (!cancelled) entries.value = r
    } catch (e) {
      if (!cancelled) error.value = errorMessage(e)
    } finally {
      if (!cancelled) loading.value = false
    }
  },
  { immediate: true },
)
</script>

<template>
  <aside class="flex w-[300px] shrink-0 flex-col border-r border-line bg-surface/40">
    <div class="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3 text-[12px] text-muted">
      <span class="font-semibold text-fg">History</span>
      <span>{{ entries.length }}{{ entries.length >= 500 ? '+' : '' }} commits</span>
      <Loader2 v-if="loading" :size="13" class="animate-spin text-faint" />
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto">
      <button
        type="button"
        class="flex w-full items-center gap-2.5 border-b border-line/60 px-3 py-2.5 text-left hover:bg-hover"
        :class="selected === 'working' ? 'bg-select shadow-[inset_2px_0_0_var(--gw-accent)]' : ''"
        @click="emit('open', null)"
      >
        <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent"><Pencil :size="14" /></span>
        <span class="min-w-0">
          <span class="block text-[13px] text-fg">Working copy</span>
          <span class="block truncate text-[12px] text-faint">The file as it is on disk right now</span>
        </span>
      </button>
      <div v-if="error" class="m-3 rounded-md border border-danger/30 bg-danger/10 p-2 text-[12px] text-danger select-text">{{ error }}</div>
      <div v-else-if="loading && !entries.length" class="gw-skel-wrap" role="status" aria-label="Loading history">
        <div v-for="i in 7" :key="i" class="flex items-center gap-2.5 border-b border-line/60 px-3 py-2.5">
          <span class="gw-skel h-7 w-7 shrink-0 rounded-full" />
          <span class="min-w-0 flex-1 space-y-1.5">
            <span class="gw-skel block h-2.5" :style="{ width: `${55 + ((i * 17) % 35)}%` }" />
            <span class="gw-skel block h-2 w-1/3 opacity-60" />
          </span>
        </div>
      </div>
      <p v-else-if="!loading && !entries.length" class="p-4 text-center text-[12px] text-faint">No commits touch this file yet.</p>
      <button
        v-for="e in entries" :key="e.commit.hash" type="button"
        class="flex w-full items-center gap-2.5 border-b border-line/60 px-3 py-2.5 text-left hover:bg-hover"
        :class="selected === e.commit.hash ? 'bg-select shadow-[inset_2px_0_0_var(--gw-accent)]' : ''"
        :title="`${e.commit.subject}\n${e.commit.author.name} · ${fullDate(e.commit.date)}${e.path !== path ? `\nwas ${e.path}` : ''}`"
        @click="emit('open', e)"
      >
        <Avatar :name="e.commit.author.name" :email="e.commit.author.email" :size="28" />
        <span class="min-w-0 flex-1">
          <span class="block truncate text-[13px] text-fg">{{ e.commit.subject }}</span>
          <span class="block truncate text-[12px] text-faint">
            {{ e.commit.author.name }} · {{ relativeTime(e.commit.date) }}<template v-if="e.path !== path"> · <span class="text-warning">renamed</span></template>
          </span>
        </span>
        <span class="shrink-0 rounded-md bg-surface-2 px-1.5 font-mono text-[11px] leading-[20px] text-muted">{{ e.commit.shortHash }}</span>
      </button>
    </div>
  </aside>
</template>
