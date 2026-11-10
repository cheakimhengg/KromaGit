<script setup lang="ts">
import { computed } from 'vue'
import {
  Archive, ArchiveRestore, ArrowDownToLine, ArrowUpFromLine, ChevronDown, Code2, GitBranch, GitBranchPlus,
  RefreshCw, Redo2, Settings, Tag, Terminal, Undo2, CloudDownload, Check,
} from 'lucide-vue-next'
import ToolButton from '@/components/common/ToolButton.vue'
import { useReposStore } from '@/stores/repos'
import { useUiStore, type MenuItem } from '@/stores/ui'

const repos = useReposStore()
const ui = useUiStore()
const snapshot = computed(() => repos.active?.snapshot ?? null)

function branchMenu(e: MouseEvent) {
  if (!snapshot.value) return
  const items: MenuItem[] = snapshot.value.branches.map((b) => ({
    label: b.name,
    icon: b.current ? Check : GitBranch,
    action: () => ui.notWired(`Checkout ${b.name}`),
  }))
  ui.openMenuBelow(e.currentTarget as Element, items)
}

function pullMenu(e: MouseEvent) {
  ui.openMenuBelow((e.currentTarget as Element).parentElement!, [
    { label: 'Pull (merge)', action: () => ui.notWired('Pull (merge)') },
    { label: 'Pull (rebase)', action: () => ui.notWired('Pull (rebase)') },
    { label: 'Pull (fast-forward only)', action: () => ui.notWired('Pull (ff-only)') },
  ])
}

function pushMenu(e: MouseEvent) {
  ui.openMenuBelow((e.currentTarget as Element).parentElement!, [
    { label: 'Push', action: () => ui.notWired('Push') },
    { label: 'Push and set upstream', action: () => ui.notWired('Push --set-upstream') },
    { separator: true },
    { label: 'Force push (with lease)…', danger: true, action: () => ui.notWired('Force push with lease') },
  ])
}
</script>

<template>
  <div class="flex h-[52px] shrink-0 items-center gap-1 border-b border-line bg-surface px-3">
    <div class="mr-3 flex min-w-0 flex-col justify-center">
      <span class="truncate text-[13px] leading-tight font-semibold text-fg">{{ snapshot?.name ?? 'No repository' }}</span>
      <button
        v-if="snapshot"
        type="button"
        class="-ml-1 flex items-center gap-1 rounded px-1 text-[11px] text-muted hover:bg-hover hover:text-fg"
        title="Switch branch"
        @click="branchMenu"
      >
        <GitBranch :size="11" class="text-accent" />
        <span class="max-w-[180px] truncate">{{ snapshot.currentBranch }}</span>
        <ChevronDown :size="11" />
      </button>
    </div>

    <div class="mx-1 h-7 w-px bg-line" />
    <ToolButton :icon="Undo2" label="Undo" title="Undo: commit “feat(graph): …”" @click="ui.notWired('Undo')" />
    <ToolButton :icon="Redo2" label="Redo" disabled />
    <div class="mx-1 h-7 w-px bg-line" />
    <ToolButton :icon="CloudDownload" label="Fetch" @click="ui.notWired('Fetch')" />
    <ToolButton :icon="ArrowDownToLine" label="Pull" dropdown @click="ui.notWired('Pull (merge)')" @dropdown="pullMenu" />
    <ToolButton :icon="ArrowUpFromLine" label="Push" dropdown @click="ui.notWired('Push')" @dropdown="pushMenu" />
    <div class="mx-1 h-7 w-px bg-line" />
    <ToolButton :icon="GitBranchPlus" label="Branch" @click="ui.notWired('Create branch')" />
    <ToolButton :icon="Tag" label="Tag" @click="ui.notWired('Create tag')" />
    <ToolButton :icon="Archive" label="Stash" @click="ui.notWired('Stash')" />
    <ToolButton :icon="ArchiveRestore" label="Pop" @click="ui.notWired('Pop stash')" />

    <div class="flex-1" />

    <ToolButton :icon="Terminal" label="Terminal" @click="ui.notWired('Open in terminal')" />
    <ToolButton :icon="Code2" label="Editor" @click="ui.notWired('Open in editor')" />
    <ToolButton :icon="RefreshCw" label="Refresh" :loading="repos.busy" @click="repos.load(repos.activeTabId)" />
    <ToolButton :icon="Settings" label="Settings" @click="ui.notWired('Settings')" />
  </div>
</template>
