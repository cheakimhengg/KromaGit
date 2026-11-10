<script setup lang="ts">
import { computed } from 'vue'
import { FolderTree, List, Loader2, Minus, Plus, Split, Trash2, Undo2 } from 'lucide-vue-next'
import { useAiStore } from '@/stores/ai'
import FileList from './FileList.vue'
import CommitBox from './CommitBox.vue'
import CountBadge from '@/components/common/CountBadge.vue'
import { useReposStore } from '@/stores/repos'
import { useUiStore } from '@/stores/ui'
import type { FileChange } from '@/types/git'
import * as git from '@/actions/git'
import { useOpsStore } from '@/stores/ops'

const ops = useOpsStore()
const ai = useAiStore()
const totalFiles = computed(() => new Set([...wc.value.staged, ...wc.value.unstaged].map((f) => f.path)).size)

const repos = useReposStore()
const ui = useUiStore()

const wc = computed(() => repos.active?.snapshot.workingCopy ?? { staged: [], unstaged: [] })
const loading = computed(() => !!repos.active?.loading.status)
const activePath = (source: 'staged' | 'unstaged') => (ui.centerView === 'diff' && ui.diffSource === source ? ui.diffPath : null)

function open(file: FileChange, staged: boolean) {
  ui.selectCommit(null)
  ui.openDiff({ path: file.path, oldPath: file.oldPath, source: staged ? 'staged' : 'unstaged', untracked: file.status === '?' })
}

function fileMenu(e: MouseEvent, file: FileChange, staged: boolean) {
  ui.openMenu(e, [
    { label: staged ? 'Unstage file' : 'Stage file', icon: staged ? Minus : Plus, action: () => (staged ? git.unstage([file]) : git.stage([file])) },
    { label: 'Open diff', action: () => open(file, staged) },
    { label: 'Copy path', action: () => git.copyText(file.path) },
    ...(staged ? [] : [{ separator: true }, { label: 'Discard changes…', icon: Undo2, danger: true, action: () => git.discard([file]) }]),
  ])
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div class="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
      <span class="text-[13px] font-semibold">Working Copy</span>
      <Loader2 v-if="loading" :size="15" class="animate-spin text-faint" />
      <div class="flex-1" />
      <button
        type="button" :disabled="totalFiles < 2 || !!ops.running || ai.split.status === 'running'"
        class="flex h-7 shrink-0 items-center whitespace-nowrap gap-1 rounded-md border border-line px-2 text-[12px] text-muted hover:border-accent-2/50 hover:text-fg disabled:opacity-30"
        title="AI: suggest how to split these changes into several commits"
        @click="ai.suggestSplit()"
      ><Split :size="12" class="text-accent-2" />Split…</button>
      <div class="flex rounded-md border border-line p-0.5">
        <button
          type="button" class="rounded p-1" :class="ui.fileViewMode === 'list' ? 'bg-surface-3 text-fg' : 'text-faint hover:text-fg'"
          title="List view" @click="ui.fileViewMode = 'list'"
        ><List :size="14" /></button>
        <button
          type="button" class="rounded p-1" :class="ui.fileViewMode === 'tree' ? 'bg-surface-3 text-fg' : 'text-faint hover:text-fg'"
          title="Tree view" @click="ui.fileViewMode = 'tree'"
        ><FolderTree :size="14" /></button>
      </div>
    </div>

    <div class="flex min-h-0 flex-1 flex-col">
      <div class="flex min-h-0 flex-1 flex-col">
        <div class="flex h-9 shrink-0 items-center gap-2 px-3">
          <span class="text-[12px] font-semibold tracking-wide text-muted uppercase">Changes</span>
          <CountBadge :count="wc.unstaged.length" />
          <div class="flex-1" />
          <button
            type="button" :disabled="!wc.unstaged.length || !!ops.running"
            class="flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] text-danger/90 hover:bg-danger/10 disabled:opacity-30"
            @click="git.discardAll()"
          ><Trash2 :size="12" />Discard all</button>
          <button
            type="button" :disabled="!wc.unstaged.length || !!ops.running"
            class="flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] text-success hover:bg-success/10 disabled:opacity-30"
            @click="git.stageAll()"
          ><Plus :size="12" />Stage all</button>
        </div>
        <FileList
          class="min-h-0 flex-1"
          :files="wc.unstaged" :mode="ui.fileViewMode" :checked="false" :active-path="activePath('unstaged')"
          @open="(f) => open(f, false)" @toggle="(f) => git.stage([f])" @menu="(e, f) => fileMenu(e, f, false)"
        >
          <template #empty><div v-if="!loading" class="px-3 py-2 text-[12px] text-faint italic">No unstaged changes</div></template>
        </FileList>
      </div>

      <div class="flex min-h-0 flex-1 flex-col border-t border-line">
        <div class="flex h-9 shrink-0 items-center gap-2 px-3">
          <span class="text-[12px] font-semibold tracking-wide text-muted uppercase">Staged</span>
          <CountBadge :count="wc.staged.length" />
          <div class="flex-1" />
          <button
            type="button" :disabled="!wc.staged.length || !!ops.running"
            class="flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] text-muted hover:bg-hover hover:text-fg disabled:opacity-30"
            @click="git.unstageAll()"
          ><Minus :size="12" />Unstage all</button>
        </div>
        <FileList
          class="min-h-0 flex-1"
          :files="wc.staged" :mode="ui.fileViewMode" :checked="true" :active-path="activePath('staged')"
          @open="(f) => open(f, true)" @toggle="(f) => git.unstage([f])" @menu="(e, f) => fileMenu(e, f, true)"
        >
          <template #empty><div v-if="!loading" class="px-3 py-2 text-[12px] text-faint italic">Nothing staged yet</div></template>
        </FileList>
      </div>
    </div>

    <CommitBox :staged-count="wc.staged.length" />
  </div>
</template>
