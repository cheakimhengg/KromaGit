<script setup lang="ts">
import { computed } from 'vue'
import { FolderGit2, Plus, Tag, X } from 'lucide-vue-next'
import { useReposStore, type RepoTab } from '@/stores/repos'
import { useUiStore, type MenuItem } from '@/stores/ui'

const repos = useReposStore()
const ui = useUiStore()

const sections = computed(() => {
  const ungrouped = repos.tabs.filter((t) => !t.groupId || !repos.groups.some((g) => g.id === t.groupId))
  const grouped = repos.groups
    .map((g) => ({ group: g, tabs: repos.tabs.filter((t) => t.groupId === g.id) }))
    .filter((s) => s.tabs.length > 0)
  return { ungrouped, grouped }
})

function tabMenu(e: MouseEvent, tab: RepoTab) {
  const items: MenuItem[] = repos.groups.map((g) => ({
    label: tab.groupId === g.id ? `In group “${g.name}”` : `Move to group “${g.name}”`,
    icon: Tag,
    action: () => repos.setTabGroup(tab.id, g.id),
  }))
  if (tab.groupId) items.push({ label: 'Remove from group', action: () => repos.setTabGroup(tab.id, undefined) })
  items.push({ separator: true }, { label: 'Close tab', icon: X, shortcut: '⌘W', action: () => repos.closeTab(tab.id) })
  ui.openMenu(e, items)
}
</script>

<template>
  <div class="flex h-[38px] shrink-0 items-end gap-1 border-b border-line bg-bg pr-2 pl-[78px]" data-tauri-drag-region>
    <template v-for="tab in sections.ungrouped" :key="tab.id">
      <button
        type="button"
        class="group relative flex h-[30px] max-w-[200px] items-center gap-1.5 rounded-t-md border border-b-0 px-3 text-[12px] transition-colors"
        :class="tab.id === repos.activeTabId ? 'border-line bg-surface text-fg' : 'border-transparent text-muted hover:bg-surface-2 hover:text-fg'"
        @click="repos.activate(tab.id)"
        @contextmenu="tabMenu($event, tab)"
      >
        <FolderGit2 :size="13" class="shrink-0 opacity-70" />
        <span class="truncate">{{ tab.name }}</span>
        <span class="ml-1 rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-hover" :class="{ 'opacity-60': tab.id === repos.activeTabId }" title="Close tab" @click.stop="repos.closeTab(tab.id)">
          <X :size="12" />
        </span>
      </button>
    </template>

    <div v-for="s in sections.grouped" :key="s.group.id" class="flex items-end gap-1 pl-1">
      <span
        class="mb-[7px] rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase"
        :style="{ color: s.group.color, background: `${s.group.color}1f` }"
      >{{ s.group.name }}</span>
      <button
        v-for="tab in s.tabs"
        :key="tab.id"
        type="button"
        class="group relative flex h-[30px] max-w-[200px] items-center gap-1.5 rounded-t-md border border-b-0 px-3 text-[12px] transition-colors"
        :class="tab.id === repos.activeTabId ? 'border-line bg-surface text-fg' : 'border-transparent text-muted hover:bg-surface-2 hover:text-fg'"
        @click="repos.activate(tab.id)"
        @contextmenu="tabMenu($event, tab)"
      >
        <span class="absolute inset-x-2 top-0 h-[2px] rounded-full" :style="{ background: s.group.color }" />
        <FolderGit2 :size="13" class="shrink-0" :style="{ color: s.group.color }" />
        <span class="truncate">{{ tab.name }}</span>
        <span class="ml-1 rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-hover" :class="{ 'opacity-60': tab.id === repos.activeTabId }" title="Close tab" @click.stop="repos.closeTab(tab.id)">
          <X :size="12" />
        </span>
      </button>
    </div>

    <button type="button" class="mb-1 ml-1 rounded-md p-1.5 text-muted hover:bg-hover hover:text-fg" title="Open repository" @click="repos.openRepo()">
      <Plus :size="14" />
    </button>
    <div class="h-full flex-1" data-tauri-drag-region />
  </div>
</template>
