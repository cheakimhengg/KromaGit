<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { FolderTree, List, Minus, Plus, Trash2, Undo2 } from 'lucide-vue-next'
import FileList from './FileList.vue'
import CommitBox from './CommitBox.vue'
import CountBadge from '@/components/common/CountBadge.vue'
import { useReposStore } from '@/stores/repos'
import { useUiStore } from '@/stores/ui'
import type { FileChange, WorkingCopy } from '@/types/git'

const repos = useReposStore()
const ui = useUiStore()

const wc = ref<WorkingCopy>({ unstaged: [], staged: [] })
watch(
  () => repos.active?.snapshot,
  (s) => {
    wc.value = s ? { unstaged: [...s.workingCopy.unstaged], staged: [...s.workingCopy.staged] } : { unstaged: [], staged: [] }
  },
  { immediate: true },
)

const activePath = computed(() => (ui.centerView === 'diff' ? ui.diffPath : null))

function move(file: FileChange, toStaged: boolean) {
  const from = toStaged ? wc.value.unstaged : wc.value.staged
  const to = toStaged ? wc.value.staged : wc.value.unstaged
  const i = from.findIndex((f) => f.path === file.path)
  if (i === -1) return
  from.splice(i, 1)
  to.push(file)
}

function stageAll() {
  wc.value.staged.push(...wc.value.unstaged)
  wc.value.unstaged = []
}
function unstageAll() {
  wc.value.unstaged.push(...wc.value.staged)
  wc.value.staged = []
}

function fileMenu(e: MouseEvent, file: FileChange, staged: boolean) {
  ui.openMenu(e, [
    { label: staged ? 'Unstage file' : 'Stage file', icon: staged ? Minus : Plus, action: () => move(file, !staged) },
    { label: 'Open diff', action: () => ui.openDiff(file.path, staged ? 'staged' : 'unstaged') },
    { label: 'Copy path', action: () => void navigator.clipboard?.writeText(file.path) },
    ...(staged ? [] : [{ separator: true }, { label: 'Discard changes…', icon: Undo2, danger: true, action: () => ui.notWired('Discard (will confirm)') }]),
  ])
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div class="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
      <span class="text-[12px] font-semibold">Working Copy</span>
      <div class="flex-1" />
      <div class="flex rounded-md border border-line p-0.5">
        <button
          type="button" class="rounded p-1" :class="ui.fileViewMode === 'list' ? 'bg-surface-3 text-fg' : 'text-faint hover:text-fg'"
          title="List view" @click="ui.fileViewMode = 'list'"
        ><List :size="12" /></button>
        <button
          type="button" class="rounded p-1" :class="ui.fileViewMode === 'tree' ? 'bg-surface-3 text-fg' : 'text-faint hover:text-fg'"
          title="Tree view" @click="ui.fileViewMode = 'tree'"
        ><FolderTree :size="12" /></button>
      </div>
    </div>

    <div class="flex min-h-0 flex-1 flex-col">
      <div class="flex min-h-0 flex-1 flex-col">
        <div class="flex h-8 shrink-0 items-center gap-2 px-3">
          <span class="text-[11px] font-semibold tracking-wide text-muted uppercase">Changes</span>
          <CountBadge :count="wc.unstaged.length" />
          <div class="flex-1" />
          <button
            type="button" :disabled="!wc.unstaged.length"
            class="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-danger/90 hover:bg-danger/10 disabled:opacity-30"
            @click="ui.notWired('Discard all (will confirm)')"
          ><Trash2 :size="11" />Discard all</button>
          <button
            type="button" :disabled="!wc.unstaged.length"
            class="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-success hover:bg-success/10 disabled:opacity-30"
            @click="stageAll"
          ><Plus :size="11" />Stage all</button>
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto">
          <FileList
            :files="wc.unstaged" :mode="ui.fileViewMode" :checked="false" :active-path="ui.diffSource === 'unstaged' ? activePath : null"
            @open="(f) => ui.openDiff(f.path, 'unstaged')" @toggle="(f) => move(f, true)" @menu="(e, f) => fileMenu(e, f, false)"
          />
          <div v-if="!wc.unstaged.length" class="px-3 py-2 text-[11px] text-faint italic">No unstaged changes</div>
        </div>
      </div>

      <div class="flex min-h-0 flex-1 flex-col border-t border-line">
        <div class="flex h-8 shrink-0 items-center gap-2 px-3">
          <span class="text-[11px] font-semibold tracking-wide text-muted uppercase">Staged</span>
          <CountBadge :count="wc.staged.length" />
          <div class="flex-1" />
          <button
            type="button" :disabled="!wc.staged.length"
            class="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-hover hover:text-fg disabled:opacity-30"
            @click="unstageAll"
          ><Minus :size="11" />Unstage all</button>
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto">
          <FileList
            :files="wc.staged" :mode="ui.fileViewMode" :checked="true" :active-path="ui.diffSource === 'staged' ? activePath : null"
            @open="(f) => ui.openDiff(f.path, 'staged')" @toggle="(f) => move(f, false)" @menu="(e, f) => fileMenu(e, f, true)"
          />
          <div v-if="!wc.staged.length" class="px-3 py-2 text-[11px] text-faint italic">Nothing staged yet</div>
        </div>
      </div>
    </div>

    <CommitBox :staged-count="wc.staged.length" />
  </div>
</template>
