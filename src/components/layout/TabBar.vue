<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronRight, FolderGit2, Layers, Pencil, Plus, Tag, Ungroup, X } from 'lucide-vue-next'
import { GROUP_COLORS, useReposStore, type RepoTab, type TabGroup } from '@/stores/repos'
import { useUiStore, type MenuItem } from '@/stores/ui'
import { formatCombo } from '@/lib/shortcuts'

const repos = useReposStore()
const ui = useUiStore()

const COLOR_NAMES = ['Blue', 'Teal', 'Pink', 'Amber', 'Violet', 'Green']

/** Tabs in stored order, cut into runs: ungrouped tabs and one block per group. */
const blocks = computed(() => {
  const known = new Set(repos.groups.map((g) => g.id))
  const out: { group: TabGroup | null; tabs: RepoTab[] }[] = []
  for (const tab of repos.tabs) {
    const g = tab.groupId && known.has(tab.groupId) ? repos.groups.find((x) => x.id === tab.groupId)! : null
    const last = out[out.length - 1]
    if (last && last.group?.id === g?.id) last.tabs.push(tab)
    else out.push({ group: g, tabs: [tab] })
  }
  return out
})

function tabMenu(e: MouseEvent, tab: RepoTab) {
  const items: MenuItem[] = [{ label: 'New group with this tab…', icon: Layers, action: () => repos.promptNewGroup(tab.id) }]
  for (const g of repos.groups) {
    if (g.id !== tab.groupId) items.push({ label: `Move to “${g.name}”`, icon: Tag, swatch: g.color, action: () => repos.setTabGroup(tab.id, g.id) })
  }
  if (tab.groupId) items.push({ label: 'Remove from group', icon: Ungroup, action: () => repos.setTabGroup(tab.id, undefined) })
  items.push(
    { separator: true },
    { label: 'Close tab', icon: X, shortcut: formatCombo('Mod+W'), action: () => repos.closeTab(tab.id) },
    ...(repos.tabs.length > 1 ? [{ label: 'Close other tabs', action: () => repos.closeOtherTabs(tab.id) }] : []),
  )
  ui.openMenu(e, items)
}

function groupMenu(e: MouseEvent, g: TabGroup) {
  ui.openMenu(e, [
    { label: g.collapsed ? 'Expand group' : 'Collapse group', icon: ChevronRight, action: () => repos.toggleGroupCollapsed(g.id) },
    { label: 'Rename…', icon: Pencil, action: () => repos.renameGroup(g.id) },
    { separator: true },
    ...GROUP_COLORS.map((c, i) => ({ label: COLOR_NAMES[i], swatch: c, shortcut: c === g.color ? '✓' : undefined, action: () => repos.setGroupColor(g.id, c) })),
    { separator: true },
    { label: 'Ungroup (keep tabs open)', icon: Ungroup, action: () => repos.ungroup(g.id) },
    { label: 'Close all tabs in group…', icon: X, danger: true, action: () => repos.closeGroup(g.id) },
  ])
}

// ---------- drag and drop ----------
const dragging = ref<string | null>(null)
const dropTarget = ref<string | null>(null)

function onDragStart(e: DragEvent, tab: RepoTab) {
  dragging.value = tab.id
  e.dataTransfer?.setData('text/plain', tab.id)
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}
function onDropOnTab(target: RepoTab) {
  if (dragging.value) repos.moveTab(dragging.value, target.id, target.groupId ?? null)
  endDrag()
}
function onDropOnGroup(g: TabGroup) {
  if (dragging.value) repos.setTabGroup(dragging.value, g.id)
  endDrag()
}
function onDropAtEnd() {
  if (dragging.value) repos.moveTab(dragging.value, null, null)
  endDrag()
}
function endDrag() {
  dragging.value = null
  dropTarget.value = null
}

const isCollapsedHidden = (g: TabGroup | null, tab: RepoTab) => !!g?.collapsed && tab.id !== repos.activeTabId
</script>

<template>
  <div class="flex h-[42px] shrink-0 items-end border-b border-line bg-bg pr-2 pl-[78px]" data-tauri-drag-region>
    <div class="flex min-w-0 items-end gap-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none]" data-tauri-drag-region>
      <template v-for="(block, bi) in blocks" :key="block.group?.id ?? `loose-${bi}`">
        <button
          v-if="block.group"
          type="button"
          class="mb-[7px] ml-1 flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold tracking-wide uppercase transition-shadow"
          :class="dropTarget === `g:${block.group.id}` ? 'ring-2 ring-current' : ''"
          :style="{ color: block.group.color, background: `${block.group.color}1f` }"
          :title="`${block.group.name} — click to ${block.group.collapsed ? 'expand' : 'collapse'}, right-click for options`"
          @click="repos.toggleGroupCollapsed(block.group.id)"
          @contextmenu="groupMenu($event, block.group)"
          @dragover.prevent="dropTarget = `g:${block.group.id}`"
          @dragleave="dropTarget = null"
          @drop.prevent="onDropOnGroup(block.group)"
        >
          <ChevronRight :size="11" class="transition-transform" :class="{ 'rotate-90': !block.group.collapsed }" />
          {{ block.group.name }}
          <span v-if="block.group.collapsed" class="rounded-full bg-current/20 px-1 font-mono">{{ block.tabs.length }}</span>
        </button>
        <template v-for="tab in block.tabs" :key="tab.id">
          <button
            v-if="!isCollapsedHidden(block.group, tab)"
            type="button"
            draggable="true"
            class="group relative flex h-[38px] max-w-[200px] shrink-0 items-center gap-1.5 rounded-t-md border border-b-0 px-3 text-[13px] transition-colors"
            :class="[
              tab.id === repos.activeTabId ? 'border-line bg-surface text-fg' : 'border-transparent text-muted hover:bg-surface-2 hover:text-fg',
              dragging === tab.id ? 'opacity-40' : '',
              dropTarget === tab.id ? 'shadow-[inset_2px_0_0_var(--gw-accent)]' : '',
            ]"
            :title="tab.path"
            @click="repos.activate(tab.id)"
            @auxclick.middle="repos.closeTab(tab.id)"
            @contextmenu="tabMenu($event, tab)"
            @dragstart="onDragStart($event, tab)"
            @dragend="endDrag"
            @dragover.prevent="dropTarget = tab.id"
            @dragleave="dropTarget === tab.id && (dropTarget = null)"
            @drop.prevent="onDropOnTab(tab)"
          >
            <span v-if="block.group" class="absolute inset-x-2 top-0 h-[2px] rounded-full" :style="{ background: block.group.color }" />
            <FolderGit2 :size="15" class="shrink-0" :class="block.group ? '' : 'opacity-70'" :style="block.group ? { color: block.group.color } : undefined" />
            <span class="truncate">{{ tab.name }}</span>
            <span
              class="ml-1 rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-hover" :class="{ 'opacity-60': tab.id === repos.activeTabId }"
              title="Close tab" @click.stop="repos.closeTab(tab.id)"
            ><X :size="14" /></span>
          </button>
        </template>
      </template>
    </div>
    <button
      type="button" class="mb-1 ml-1 shrink-0 rounded-md p-1.5 text-muted hover:bg-hover hover:text-fg"
      :title="`Open repository (${formatCombo('Mod+O')})`"
      @click="repos.openRepo()"
      @dragover.prevent
      @drop.prevent="onDropAtEnd"
    ><Plus :size="16" /></button>
    <div class="h-full min-w-6 flex-1" data-tauri-drag-region @dragover.prevent @drop.prevent="onDropAtEnd" />
  </div>
</template>
