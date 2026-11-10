<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ArrowLeft, Copy, GitCommitHorizontal, Loader2 } from 'lucide-vue-next'
import Avatar from '@/components/common/Avatar.vue'
import StatusBadge from '@/components/common/StatusBadge.vue'
import { fullDate, relativeTime } from '@/lib/format'
import { errorMessage, gitApi } from '@/api/git'
import { useReposStore } from '@/stores/repos'
import { useUiStore } from '@/stores/ui'
import type { CommitDetails, FileChange } from '@/types/git'

const props = defineProps<{ hash: string }>()
const repos = useReposStore()
const ui = useUiStore()

const details = ref<CommitDetails | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const repoPath = computed(() => repos.activeTab?.path ?? '')

watch(
  () => [props.hash, repoPath.value] as const,
  async ([hash, path], _old, onCleanup) => {
    let cancelled = false
    onCleanup(() => (cancelled = true))
    loading.value = true
    error.value = null
    try {
      const d = await gitApi.getCommitDetails(path, hash)
      if (!cancelled) details.value = d
    } catch (e) {
      if (!cancelled) {
        details.value = null
        error.value = errorMessage(e)
      }
    } finally {
      if (!cancelled) loading.value = false
    }
  },
  { immediate: true },
)

const shown = computed(() => (details.value?.hash === props.hash ? details.value : null))
const sameCommitter = computed(() => {
  const d = shown.value
  return !d || (d.committer.email === d.author.email && d.commitDate === d.authorDate)
})

function openFile(f: FileChange) {
  const d = shown.value
  if (!d) return
  ui.openDiff({ path: f.path, oldPath: f.oldPath, source: 'commit', commit: d.hash, parent: d.parents[0] })
}

function copy(text: string) {
  void navigator.clipboard?.writeText(text)
  ui.toast({ kind: 'success', title: 'Copied', detail: text }, 1800)
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div class="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
      <button type="button" class="rounded p-1 text-faint hover:bg-hover hover:text-fg" title="Back to working copy" @click="ui.selectCommit(null)">
        <ArrowLeft :size="16" />
      </button>
      <GitCommitHorizontal :size="16" class="text-accent" />
      <span class="text-[13px] font-semibold">Commit</span>
      <Loader2 v-if="loading" :size="15" class="animate-spin text-faint" />
      <button type="button" class="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[12px] text-muted hover:bg-hover hover:text-fg" @click="copy(hash)">
        {{ hash.slice(0, 7) }}<Copy :size="12" />
      </button>
    </div>

    <div v-if="error" class="m-3 rounded-md border border-danger/30 bg-danger/10 p-3 text-[13px] text-danger">{{ error }}</div>

    <div v-else-if="!shown" class="space-y-2 p-3">
      <div class="h-4 w-3/4 animate-pulse rounded bg-surface-3" />
      <div class="h-3 w-1/2 animate-pulse rounded bg-surface-3" />
      <div class="h-3 w-2/3 animate-pulse rounded bg-surface-3" />
    </div>

    <div v-else class="min-h-0 flex-1 overflow-y-auto">
      <div class="border-b border-line p-3">
        <div class="text-[14px] leading-snug font-semibold text-fg select-text">{{ shown.subject }}</div>
        <pre v-if="shown.body" class="mt-2 font-sans text-[13px] leading-relaxed whitespace-pre-wrap text-muted select-text">{{ shown.body }}</pre>
      </div>

      <div class="space-y-2 border-b border-line p-3 text-[13px]">
        <div class="flex items-center gap-2">
          <Avatar :name="shown.author.name" :email="shown.author.email" :size="30" />
          <div class="min-w-0">
            <div class="truncate text-fg">{{ shown.author.name }}</div>
            <div class="truncate text-[12px] text-faint select-text">{{ shown.author.email }}</div>
          </div>
          <div class="ml-auto text-right text-[12px] text-muted" :title="fullDate(shown.authorDate)">{{ relativeTime(shown.authorDate) }}</div>
        </div>
        <div class="grid grid-cols-[64px_1fr] gap-y-1 text-[12px]">
          <span class="text-faint">Commit</span><span class="truncate font-mono text-muted select-text">{{ shown.hash }}</span>
          <span class="text-faint">{{ shown.parents.length > 1 ? 'Parents' : 'Parent' }}</span>
          <span class="flex flex-wrap gap-1">
            <button
              v-for="p in shown.parents" :key="p" type="button"
              class="rounded bg-surface-3 px-1.5 font-mono text-accent hover:bg-accent/15"
              @click="ui.selectCommit(p)"
            >{{ p.slice(0, 7) }}</button>
            <span v-if="!shown.parents.length" class="text-faint italic">root commit</span>
          </span>
          <span class="text-faint">Date</span><span class="text-muted">{{ fullDate(shown.authorDate) }}</span>
          <template v-if="!sameCommitter">
            <span class="text-faint">Committer</span>
            <span class="truncate text-muted" :title="fullDate(shown.commitDate)">{{ shown.committer.name }} · {{ relativeTime(shown.commitDate) }}</span>
          </template>
        </div>
      </div>

      <div class="p-2">
        <div class="px-1 pb-1 text-[12px] font-semibold tracking-wide text-muted uppercase">
          Changed files · {{ shown.files.length }}
          <span v-if="shown.parents.length > 1" class="font-normal tracking-normal normal-case text-faint">(vs first parent)</span>
        </div>
        <div
          v-for="f in shown.files" :key="f.path"
          class="flex h-7 cursor-pointer items-center gap-1.5 rounded px-1 text-[13px]"
          :class="ui.centerView === 'diff' && ui.diffSource === 'commit' && ui.diffPath === f.path ? 'bg-select' : 'hover:bg-hover'"
          :title="f.oldPath ? `${f.oldPath} → ${f.path}` : f.path"
          @click="openFile(f)"
        >
          <StatusBadge :status="f.status" />
          <span class="flex-1 truncate text-fg">{{ f.path }}</span>
          <span class="font-mono text-[11px] text-success">+{{ f.additions }}</span>
          <span class="font-mono text-[11px] text-danger">−{{ f.deletions }}</span>
        </div>
        <div v-if="!shown.files.length" class="px-1 py-1 text-[12px] text-faint italic">No file changes</div>
      </div>
    </div>
  </div>
</template>
