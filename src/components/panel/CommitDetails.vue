<script setup lang="ts">
import { computed } from 'vue'
import { ArrowLeft, Copy, GitCommitHorizontal } from 'lucide-vue-next'
import Avatar from '@/components/common/Avatar.vue'
import StatusBadge from '@/components/common/StatusBadge.vue'
import { fullDate, hashString, relativeTime } from '@/lib/format'
import { useUiStore } from '@/stores/ui'
import type { Commit, FileChange, FileStatus } from '@/types/git'

const props = defineProps<{ commit: Commit }>()
const ui = useUiStore()

const POOL = [
  'src/lib/graph-layout.ts', 'src/components/graph/GraphCell.vue', 'src/stores/repos.ts', 'src-tauri/src/git/log.rs',
  'src-tauri/src/git/status.rs', 'src/components/panel/CommitBox.vue', 'tests/graph-layout.test.ts', 'README.md',
]
const STATUSES: FileStatus[] = ['M', 'M', 'M', 'A', 'D']

const files = computed<FileChange[]>(() => {
  const h = hashString(props.commit.hash)
  const n = 1 + (h % 5)
  return Array.from({ length: n }, (_, i) => ({
    path: POOL[(h + i * 3) % POOL.length],
    status: STATUSES[(h >>> i) % STATUSES.length],
    additions: (h >>> (i + 2)) % 60,
    deletions: (h >>> (i + 4)) % 25,
  })).filter((f, i, arr) => arr.findIndex((x) => x.path === f.path) === i)
})

function copy(text: string) {
  void navigator.clipboard?.writeText(text)
  ui.toast({ kind: 'success', title: 'Copied', detail: text }, 1800)
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div class="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
      <button type="button" class="rounded p-1 text-faint hover:bg-hover hover:text-fg" title="Back to working copy" @click="ui.selectCommit(null)">
        <ArrowLeft :size="14" />
      </button>
      <GitCommitHorizontal :size="14" class="text-accent" />
      <span class="text-[12px] font-semibold">Commit</span>
      <button type="button" class="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[11px] text-muted hover:bg-hover hover:text-fg" @click="copy(commit.hash)">
        {{ commit.shortHash }}<Copy :size="11" />
      </button>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <div class="border-b border-line p-3">
        <div class="text-[13px] leading-snug font-semibold text-fg select-text">{{ commit.subject }}</div>
        <pre v-if="commit.body" class="mt-2 font-sans text-[12px] leading-relaxed whitespace-pre-wrap text-muted select-text">{{ commit.body }}</pre>
      </div>

      <div class="space-y-2 border-b border-line p-3 text-[12px]">
        <div class="flex items-center gap-2">
          <Avatar :name="commit.author.name" :email="commit.author.email" :size="28" />
          <div class="min-w-0">
            <div class="truncate text-fg">{{ commit.author.name }}</div>
            <div class="truncate text-[11px] text-faint">{{ commit.author.email }}</div>
          </div>
          <div class="ml-auto text-right text-[11px] text-muted" :title="fullDate(commit.date)">{{ relativeTime(commit.date) }}</div>
        </div>
        <div class="grid grid-cols-[64px_1fr] gap-y-1 text-[11px]">
          <span class="text-faint">Commit</span><span class="truncate font-mono text-muted select-text">{{ commit.hash }}</span>
          <span class="text-faint">{{ commit.parents.length > 1 ? 'Parents' : 'Parent' }}</span>
          <span class="flex flex-wrap gap-1">
            <button
              v-for="p in commit.parents" :key="p" type="button"
              class="rounded bg-surface-3 px-1.5 font-mono text-accent hover:bg-accent/15"
              @click="ui.selectCommit(p)"
            >{{ p.slice(0, 7) }}</button>
            <span v-if="!commit.parents.length" class="text-faint italic">root commit</span>
          </span>
          <span class="text-faint">Date</span><span class="text-muted">{{ fullDate(commit.date) }}</span>
        </div>
      </div>

      <div class="p-2">
        <div class="px-1 pb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">Changed files · {{ files.length }}</div>
        <div
          v-for="f in files" :key="f.path"
          class="flex h-6 cursor-pointer items-center gap-1.5 rounded px-1 text-[12px]"
          :class="ui.centerView === 'diff' && ui.diffSource === 'commit' && ui.diffPath === f.path ? 'bg-select' : 'hover:bg-hover'"
          @click="ui.openDiff(f.path, 'commit')"
        >
          <StatusBadge :status="f.status" />
          <span class="flex-1 truncate text-fg">{{ f.path }}</span>
          <span class="font-mono text-[10px] text-success">+{{ f.additions }}</span>
          <span class="font-mono text-[10px] text-danger">−{{ f.deletions }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
