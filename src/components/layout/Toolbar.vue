<script setup lang="ts">
import BranchPicker from './BranchPicker.vue'
import { computed, ref } from 'vue'
import {
  Archive, ArchiveRestore, ArrowDownToLine, ArrowUpFromLine, ChevronDown, CloudDownload, Code2, GitBranch,
  Command, GitBranchPlus, PanelLeft, Redo2, RefreshCw, Settings, Tag, Terminal, Undo2, CalendarClock, Brush,
} from '@/lib/icons'
import ToolButton from '@/components/common/ToolButton.vue'
import RepoMenu from './RepoMenu.vue'
import { useReposStore } from '@/stores/repos'
import { useOpsStore } from '@/stores/ops'
import { useUiStore } from '@/stores/ui'
import * as git from '@/actions/git'
import { formatCombo } from '@/lib/shortcuts'

const repos = useReposStore()
const ops = useOpsStore()
const ui = useUiStore()
const snapshot = computed(() => repos.active?.snapshot ?? null)
const busy = computed(() => !!ops.running)
const hasRemote = computed(() => (snapshot.value?.remotes.length ?? 0) > 0)
const ahead = computed(() => snapshot.value?.head.ahead ?? 0)
const behind = computed(() => snapshot.value?.head.behind ?? 0)

const branchPickerOpen = ref(false)
const branchButton = ref<HTMLElement | null>(null)

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
  <div class="flex h-[52px] shrink-0 items-center gap-2 border-b border-line bg-surface px-3">
    <ToolButton
      :icon="PanelLeft" :active="!ui.sidebarCollapsed"
      :title="`${ui.sidebarCollapsed ? 'Show' : 'Hide'} sidebar (${formatCombo('Mod+B')})`"
      @click="ui.sidebarCollapsed = !ui.sidebarCollapsed"
    />

    <div v-if="snapshot" class="flex h-9 min-w-0 items-center rounded-full bg-surface-2/70 px-1">
      <RepoMenu />
      <button
        type="button"
        class="ml-1 flex h-7 min-w-0 items-center gap-1.5 rounded-full bg-accent/15 px-2.5 text-[13px] font-medium text-accent hover:bg-accent/25 disabled:opacity-50"
        ref="branchButton"
        title="Switch branch"
        :disabled="busy"
        @click="branchPickerOpen = !branchPickerOpen"
      >
        <GitBranch :size="14" class="shrink-0" />
        <span class="max-w-[180px] truncate">{{ snapshot.currentBranch }}</span>
        <ChevronDown :size="13" class="shrink-0 opacity-70" />
      </button>
    </div>

    <div class="island">
      <ToolButton :icon="Undo2" :title="ops.nextUndo ? `Undo: ${ops.nextUndo.label} (${formatCombo('Mod+Z')})` : 'Nothing to undo'" :disabled="busy || !ops.nextUndo" @click="ops.undo()" />
      <ToolButton :icon="Redo2" :title="ops.nextRedo ? `Redo: ${ops.nextRedo.label} (${formatCombo('Mod+Shift+Z')})` : 'Nothing to redo'" :disabled="busy || !ops.nextRedo" @click="ops.redo()" />
    </div>

    <div class="island">
      <ToolButton :icon="CloudDownload" label="Fetch" loading-label="Fetching…" :title="`Fetch all remotes (${formatCombo('Mod+Shift+F')})`" :disabled="busy || !hasRemote" :loading="ops.running === 'Fetch'" @click="git.fetchAll()" />
      <ToolButton
        :icon="ArrowDownToLine" label="Pull" loading-label="Pulling…" dropdown :disabled="busy || !hasRemote"
        :loading="!!ops.running?.startsWith('Pull')"
        :title="`Pull (${formatCombo('Mod+Shift+L')})${behind ? ` — ${behind} new on the remote` : ''}`"
        :count="behind" count-prefix="↓"
        @click="git.pull('merge')" @dropdown="pullMenu"
      />
      <ToolButton
        :icon="ArrowUpFromLine" label="Push" loading-label="Pushing…" dropdown :disabled="busy || !hasRemote"
        :loading="!!ops.running && /^(Force push|Push)\b/.test(ops.running)"
        :title="`Push (${formatCombo('Mod+Shift+P')})${ahead ? ` — ${ahead} not pushed yet` : ''}`"
        :count="ahead" count-prefix="↑"
        @click="git.push()" @dropdown="pushMenu"
      />
    </div>

    <div class="island">
      <ToolButton :icon="GitBranchPlus" :title="`New branch (${formatCombo('Mod+Shift+B')})`" :disabled="busy" @click="git.createBranch()" />
      <ToolButton :icon="Tag" title="New tag at HEAD" :disabled="busy || !snapshot?.head.oid" @click="git.createTag()" />
      <ToolButton :icon="Archive" :title="`Stash changes (${formatCombo('Mod+Shift+S')})`" :disabled="busy" @click="git.stashPush()" />
      <ToolButton :icon="ArchiveRestore" title="Pop latest stash" :disabled="busy || !snapshot?.stashes.length" @click="git.stashPop(0)" />
    </div>

    <div class="min-w-2 flex-1" />

    <div class="island">
      <ToolButton :icon="CalendarClock" :active="ui.centerView === 'standup'" title="Standup: what did I do?" @click="ui.showPanel('standup')" />
      <ToolButton :icon="Brush" :active="ui.centerView === 'cleanup'" title="Branch cleanup: merged, gone and stale branches" @click="ui.showPanel('cleanup')" />
    </div>
    <div class="island">
      <ToolButton :icon="Command" :title="`Command palette (${formatCombo('Mod+K')})`" @click="ui.paletteOpen = true" />
      <ToolButton :icon="Terminal" :active="ui.terminalOpen" title="Terminal (⌃`)" @click="ui.terminalOpen = !ui.terminalOpen" />
      <ToolButton :icon="Code2" title="Open in editor" @click="git.openInEditor()" />
      <ToolButton :icon="RefreshCw" :title="`Refresh (${formatCombo('Mod+R')})`" :loading="repos.busy" :disabled="busy" @click="repos.load(repos.activeTabId)" />
    </div>
    <ToolButton :icon="Settings" :title="`Settings (${formatCombo('Mod+,')})`" @click="ui.settingsOpen = true" />
    <BranchPicker v-model="branchPickerOpen" :anchor="branchButton" />
  </div>
</template>

<style scoped>
@reference '../../styles/main.css';
.island {
  @apply flex items-center gap-px rounded-lg bg-surface-2/70 p-0.5;
}
</style>
