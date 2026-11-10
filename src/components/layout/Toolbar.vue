<script setup lang="ts">
import { computed } from 'vue'
import {
  Archive, ArchiveRestore, ArrowDownToLine, ArrowUpFromLine, Check, ChevronDown, CloudDownload, Code2, GitBranch,
  GitBranchPlus, Redo2, RefreshCw, Settings, Tag, Terminal, Undo2, CalendarClock, Brush,
} from 'lucide-vue-next'
import ToolButton from '@/components/common/ToolButton.vue'
import { useReposStore } from '@/stores/repos'
import { useOpsStore } from '@/stores/ops'
import { useUiStore, type MenuItem } from '@/stores/ui'
import * as git from '@/actions/git'

const repos = useReposStore()
const ops = useOpsStore()
const ui = useUiStore()
const snapshot = computed(() => repos.active?.snapshot ?? null)
const busy = computed(() => !!ops.running)
const hasRemote = computed(() => (snapshot.value?.remotes.length ?? 0) > 0)

function branchMenu(e: MouseEvent) {
  if (!snapshot.value) return
  const items: MenuItem[] = snapshot.value.branches.map((b) => ({
    label: b.name,
    icon: b.current ? Check : GitBranch,
    action: () => !b.current && git.checkout(b.name),
  }))
  if (!items.length) items.push({ label: 'No local branches' })
  items.push({ separator: true }, { label: 'New branch…', icon: GitBranchPlus, action: () => git.createBranch() })
  ui.openMenuBelow(e.currentTarget as Element, items)
}

function pullMenu(e: MouseEvent) {
  ui.openMenuBelow((e.currentTarget as Element).parentElement!, [
    { label: 'Pull (merge)', action: () => git.pull('merge') },
    { label: 'Pull (rebase)', action: () => git.pull('rebase') },
    { label: 'Pull (fast-forward only)', action: () => git.pull('ffOnly') },
  ])
}

function pushMenu(e: MouseEvent) {
  ui.openMenuBelow((e.currentTarget as Element).parentElement!, [
    { label: 'Push', action: () => git.push() },
    { label: 'Push and set upstream', action: () => git.push({ setUpstream: true }) },
    { separator: true },
    { label: 'Force push (with lease)…', danger: true, action: () => git.push({ force: true }) },
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
        class="-ml-1 flex items-center gap-1 rounded px-1 text-[11px] text-muted hover:bg-hover hover:text-fg disabled:opacity-50"
        title="Switch branch"
        :disabled="busy"
        @click="branchMenu"
      >
        <GitBranch :size="11" class="text-accent" />
        <span class="max-w-[180px] truncate">{{ snapshot.currentBranch }}</span>
        <ChevronDown :size="11" />
      </button>
    </div>

    <div class="mx-1 h-7 w-px bg-line" />
    <ToolButton :icon="Undo2" label="Undo" :title="ops.nextUndo ? `Undo: ${ops.nextUndo.label}` : 'Nothing to undo'" :disabled="busy || !ops.nextUndo" @click="ops.undo()" />
    <ToolButton :icon="Redo2" label="Redo" :title="ops.nextRedo ? `Redo: ${ops.nextRedo.label}` : 'Nothing to redo'" :disabled="busy || !ops.nextRedo" @click="ops.redo()" />
    <div class="mx-1 h-7 w-px bg-line" />
    <ToolButton :icon="CloudDownload" label="Fetch" :disabled="busy || !hasRemote" :loading="ops.running === 'Fetch'" @click="git.fetchAll()" />
    <ToolButton :icon="ArrowDownToLine" label="Pull" dropdown :disabled="busy || !hasRemote" @click="git.pull('merge')" @dropdown="pullMenu" />
    <ToolButton :icon="ArrowUpFromLine" label="Push" dropdown :disabled="busy || !hasRemote" @click="git.push()" @dropdown="pushMenu" />
    <div class="mx-1 h-7 w-px bg-line" />
    <ToolButton :icon="GitBranchPlus" label="Branch" :disabled="busy" @click="git.createBranch()" />
    <ToolButton :icon="Tag" label="Tag" :disabled="busy || !snapshot?.head.oid" @click="git.createTag()" />
    <ToolButton :icon="Archive" label="Stash" :disabled="busy" @click="git.stashPush()" />
    <ToolButton :icon="ArchiveRestore" label="Pop" :disabled="busy || !snapshot?.stashes.length" @click="git.stashPop(0)" />

    <div class="flex-1" />

    <ToolButton :icon="CalendarClock" label="Standup" :accent="ui.centerView === 'standup'" title="What did I do? Commits across all open repositories" @click="ui.showPanel('standup')" />
    <ToolButton :icon="Brush" label="Cleanup" :accent="ui.centerView === 'cleanup'" title="Find merged, gone and stale branches" @click="ui.showPanel('cleanup')" />
    <div class="mx-1 h-7 w-px bg-line" />
    <ToolButton :icon="Terminal" label="Terminal" @click="git.openInTerminal()" />
    <ToolButton :icon="Code2" label="Editor" @click="git.openInEditor()" />
    <ToolButton :icon="RefreshCw" label="Refresh" :loading="repos.busy" :disabled="busy" @click="repos.load(repos.activeTabId)" />
    <ToolButton :icon="Settings" label="Settings" @click="ui.settingsOpen = true" />
  </div>
</template>
