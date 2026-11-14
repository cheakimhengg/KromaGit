<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { Copy, FoldHorizontal, FolderOpen, House, Layers, Palette, Pencil, Plus, UnfoldHorizontal, Ungroup, X } from '@/lib/icons'
import { GROUP_COLORS, useReposStore, type RepoTab, type TabGroup } from '@/stores/repos'
import { useUiStore, type MenuItem } from '@/stores/ui'
import { formatCombo } from '@/lib/shortcuts'
import { titlebarInset } from '@/lib/window-chrome'

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
  for (const g of repos.groups) {
    if (!out.some((b) => b.group?.id === g.id) && g.members?.length) out.push({ group: g, tabs: [] })
  }
  return out
})

function tabMenu(e: MouseEvent, tab: RepoTab) {
  const groupItems: MenuItem[] = [
    { label: 'New group…', icon: Layers, action: () => repos.promptNewGroup(tab.id) },
    ...(repos.groups.length ? [{ separator: true }] : []),
    ...repos.groups.map((g) => ({ label: g.name, swatch: g.color, shortcut: g.id === tab.groupId ? '✓' : undefined, action: () => repos.setTabGroup(tab.id, g.id) })),
    ...(tab.groupId ? [{ separator: true }, { label: 'Remove from group', icon: Ungroup, action: () => repos.setTabGroup(tab.id, undefined) }] : []),
  ]
  ui.openMenu(e, [
    { heading: true, mono: true, label: tab.path },
    { label: tab.groupId ? 'Move to group' : 'Add to group', icon: Layers, children: groupItems },
    { label: 'Copy path', icon: Copy, action: () => copyPath(tab.path) },
    { label: 'Rename tab…', icon: Pencil, action: () => repos.renameTab(tab.id) },
    { separator: true },
    { label: 'Close tab', icon: X, shortcut: formatCombo('Mod+W'), action: () => repos.closeTab(tab.id) },
    { label: 'Close other tabs', icon: X, disabled: repos.tabs.length < 2, action: () => repos.closeOtherTabs(tab.id) },
  ])
}

async function copyPath(path: string) {
  await navigator.clipboard.writeText(path).catch(() => undefined)
  ui.toast({ kind: 'success', title: 'Path copied' }, 1500)
}

function groupMenu(e: MouseEvent, g: TabGroup) {
  const { open, closed } = repos.groupMembers(g.id)
  ui.openMenu(e, [
    { heading: true, swatch: g.color, label: g.name },
    g.collapsed
      ? { label: 'Expand its tabs', icon: UnfoldHorizontal, disabled: !open.length, action: () => repos.toggleGroupCollapsed(g.id) }
      : { label: 'Collapse its tabs', icon: FoldHorizontal, disabled: !open.length, action: () => repos.toggleGroupCollapsed(g.id) },
    { label: 'Collapse other groups', icon: FoldHorizontal, disabled: repos.groups.length < 2, action: () => repos.collapseOtherGroups(g.id) },
    { label: 'Expand all groups', icon: UnfoldHorizontal, disabled: !repos.groups.some((x) => x.collapsed), action: () => repos.expandAllGroups() },
    { label: 'Open the rest in tabs', icon: FolderOpen, shortcut: String(closed.length), disabled: !closed.length, action: () => repos.openRestOfGroup(g.id) },
    { label: 'Close its tabs', icon: X, shortcut: String(open.length), disabled: !open.length, action: () => repos.closeGroup(g.id) },
    { separator: true },
    { label: 'Edit group…', icon: Pencil, action: () => repos.editGroup(g.id) },
    { label: 'Colour', icon: Palette, children: GROUP_COLORS.map((c, i) => ({ label: COLOR_NAMES[i], swatch: c, shortcut: c === g.color ? '✓' : undefined, action: () => repos.setGroupColor(g.id, c) })) },
    { label: 'Ungroup', icon: Ungroup, action: () => repos.ungroup(g.id) },
  ])
}

function onGroupClick(g: TabGroup) {
  if (!repos.groupMembers(g.id).open.length) void repos.openRestOfGroup(g.id)
  else repos.toggleGroupCollapsed(g.id)
}

// ---------- drag to reorder ----------
// Pointer based (HTML5 drag-and-drop is unreliable in the desktop webview). Tabs reorder live as the
// pointer crosses a neighbour's midpoint, with a short slide animation; a copy follows the cursor.
type DragItem = { kind: 'tab'; id: string } | { kind: 'group'; id: string }
const strip = ref<HTMLElement | null>(null)
const press = ref<{ item: DragItem; x: number; offset: number; top: number; w: number; label: string; color?: string } | null>(null)
const dragging = ref<DragItem | null>(null)
const ghost = ref<{ x: number; y: number; w: number; label: string; color?: string } | null>(null)
let suppressClick = false
let moving = false
let lastX = 0
let scrollTimer: number | undefined

function onPointerDown(e: PointerEvent, item: DragItem) {
  if (e.button !== 0 || (e.target as HTMLElement).closest('[data-close]')) return
  const el = e.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  press.value = { item, x: e.clientX, offset: e.clientX - rect.left, top: rect.top, w: rect.width, label: el.innerText.trim().split('\n')[0], color: el.style.color || undefined }
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', endDrag, { once: true })
  window.addEventListener('blur', endDrag, { once: true })
}

function onPointerMove(e: PointerEvent) {
  const p = press.value
  if (!p) return
  if (!dragging.value) {
    if (Math.abs(e.clientX - p.x) < 5) return
    dragging.value = p.item
    document.body.classList.add('tab-dragging')
  }
  lastX = e.clientX
  ghost.value = { x: e.clientX - p.offset, y: p.top, w: p.w, label: p.label, color: p.color }
  autoScroll()
  void reorder(e.clientX, p.top + 15)
}

function endDrag() {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('blur', endDrag)
  if (dragging.value) {
    suppressClick = true
    setTimeout(() => (suppressClick = false), 0)
  }
  clearInterval(scrollTimer)
  scrollTimer = undefined
  document.body.classList.remove('tab-dragging')
  press.value = null
  dragging.value = null
  ghost.value = null
}

function autoScroll() {
  const el = strip.value
  if (!el || scrollTimer) return
  scrollTimer = window.setInterval(() => {
    const r = el.getBoundingClientRect()
    const dx = lastX < r.left + 40 ? -10 : lastX > r.right - 40 ? 10 : 0
    if (!dx || !dragging.value) {
      clearInterval(scrollTimer)
      scrollTimer = undefined
      return
    }
    el.scrollLeft += dx
  }, 16)
}

const itemKey = (el: HTMLElement) => (el.dataset.tabId ? `t:${el.dataset.tabId}` : `g:${el.dataset.groupId}`)

/** Applies a reorder and slides every tab from its old spot to the new one. */
async function flip(mutate: () => void) {
  const root = strip.value
  if (!root) return mutate()
  const items = () => [...root.querySelectorAll<HTMLElement>('[data-tab-id],[data-group-id]')]
  const before = new Map(items().map((el) => [itemKey(el), el.getBoundingClientRect().left]))
  moving = true
  mutate()
  await nextTick()
  for (const el of items()) {
    const prev = before.get(itemKey(el))
    if (prev === undefined) continue
    const dx = prev - el.getBoundingClientRect().left
    if (Math.abs(dx) > 0.5) el.animate([{ transform: `translateX(${dx}px)` }, { transform: 'translateX(0)' }], { duration: 170, easing: 'cubic-bezier(.2,.8,.2,1)' })
  }
  moving = false
}

async function reorder(x: number, y: number) {
  const item = dragging.value
  if (!item || moving) return
  const hit = document.elementFromPoint(x, y) as HTMLElement | null
  if (item.kind === 'tab') return reorderTab(item.id, x, hit)
  return reorderGroup(item.id, x, hit)
}

async function reorderTab(id: string, x: number, hit: HTMLElement | null) {
  const order = repos.tabs
  const self = order.find((t) => t.id === id)
  if (!self || !hit) return
  const i = order.indexOf(self)
  const current = { before: order[i + 1]?.id ?? null, group: self.groupId }
  let want: { before: string | null; group: string | undefined } | null = null

  if (hit.closest('[data-drop-end]')) want = { before: null, group: undefined }
  const tabEl = hit.closest<HTMLElement>('[data-tab-id]')
  const labelEl = hit.closest<HTMLElement>('[data-group-id]')
  if (!want && tabEl && tabEl.dataset.tabId !== id) {
    const target = order.find((t) => t.id === tabEl.dataset.tabId)!
    const j = order.indexOf(target)
    const r = tabEl.getBoundingClientRect()
    const mid = r.left + r.width / 2
    if (j > i && x > mid) want = { before: order[j + 1]?.id ?? null, group: target.groupId }
    else if (j < i && x < mid) want = { before: target.id, group: target.groupId }
  } else if (!want && labelEl) {
    const gid = labelEl.dataset.groupId!
    const first = order.find((t) => t.groupId === gid && t.id !== id)
    const r = labelEl.getBoundingClientRect()
    if (x < r.left + r.width / 2) {
      if (first) want = { before: first.id, group: undefined }
    } else want = { before: first?.id ?? current.before, group: gid }
  }
  if (!want || (want.before === current.before && want.group === current.group)) return
  const w = want
  await flip(() => {
    if (w.group && !order.some((t) => t.groupId === w.group && t.id !== id)) repos.setTabGroup(id, w.group)
    else repos.moveTab(id, w.before, w.group ?? null)
  })
}

async function reorderGroup(gid: string, x: number, hit: HTMLElement | null) {
  const block = hit?.closest<HTMLElement>('[data-block]')
  if (!block || block.dataset.block === `g:${gid}` || !block.dataset.first) return
  const order = repos.tabs
  const mine = order.findIndex((t) => t.groupId === gid)
  if (mine === -1) return
  const first = order.findIndex((t) => t.id === block.dataset.first)
  const last = order.findIndex((t) => t.id === block.dataset.last)
  const r = block.getBoundingClientRect()
  const mid = r.left + r.width / 2
  let before: string | null | undefined
  if (first > mine && x > mid) before = order[last + 1]?.id ?? null
  else if (first < mine && x < mid) before = block.dataset.first
  if (before === undefined) return
  const b = before
  await flip(() => repos.moveGroup(gid, b))
}

function guardClick(fn: () => void) {
  if (!suppressClick) fn()
}

const isDragged = (kind: DragItem['kind'], id: string) => dragging.value?.kind === kind && dragging.value.id === id

const isCollapsedHidden = (g: TabGroup | null, tab: RepoTab) => !!g?.collapsed && tab.id !== repos.activeTabId
const isActive = (tab: RepoTab) => tab.id === repos.activeTabId && !ui.home
/** thin divider before a tab, hidden next to the active one */
const showDivider = (tabs: RepoTab[], i: number) => i > 0 && !isActive(tabs[i]) && !isActive(tabs[i - 1])
</script>

<template>
  <div class="flex h-[44px] shrink-0 items-center gap-1 border-b border-line bg-bg pr-2" :style="{ paddingLeft: `${titlebarInset + 8}px` }" data-tauri-drag-region>
    <button
      type="button"
      class="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg transition-colors"
      :class="ui.home || !repos.activeTab ? 'bg-accent/15 text-accent' : 'text-muted hover:bg-hover hover:text-fg'"
      :title="`Home (${formatCombo('Mod+Shift+H')})`"
      @click="ui.home = !!repos.activeTab && !ui.home"
    ><House :size="17" /></button>
    <div class="mx-1 h-5 w-px shrink-0 bg-line" />
    <div ref="strip" class="flex h-full min-w-0 items-center gap-2 overflow-x-auto overflow-y-hidden [scrollbar-width:none]" data-tauri-drag-region>
      <div
        v-for="(block, bi) in blocks" :key="block.group?.id ?? `loose-${bi}`"
        class="relative flex h-full shrink-0 items-center"
        :class="{ 'px-1': block.group }"
        :data-block="block.group ? `g:${block.group.id}` : 'loose'"
        :data-first="block.tabs[0]?.id"
        :data-last="block.tabs[block.tabs.length - 1]?.id"
      >
        <span v-if="block.group" class="absolute inset-x-2 top-0 h-[2px] rounded-b-full" :style="{ background: block.group.color, opacity: block.tabs.length ? 1 : 0.45 }" />
        <button
          v-if="block.group"
          type="button"
          class="flex h-[30px] shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-semibold transition-colors hover:bg-hover"
          :class="[block.tabs.length ? '' : 'opacity-60', isDragged('group', block.group.id) ? 'opacity-30' : '']"
          :data-group-id="block.group.id"
          :style="{ color: block.group.color }"
          :title="block.tabs.length ? `${block.group.name} — click to ${block.group.collapsed ? 'expand' : 'collapse'}, right-click for options` : `${block.group.name} — click to open its repositories`"
          @click="guardClick(() => onGroupClick(block.group!))"
          @pointerdown="onPointerDown($event, { kind: 'group', id: block.group.id })"
          @contextmenu="groupMenu($event, block.group)"
        >
          {{ block.group.name }}
          <span
            v-if="block.group.collapsed || !block.tabs.length"
            class="rounded-full bg-current/15 px-1.5 font-mono text-[11px] leading-[16px]"
          >{{ block.tabs.length || repos.groupMembers(block.group.id).closed.length }}</span>
        </button>
        <template v-for="(tab, ti) in block.tabs" :key="tab.id">
          <template v-if="!isCollapsedHidden(block.group, tab)">
            <span class="h-4 w-px shrink-0" :class="showDivider(block.tabs, ti) ? 'bg-line-strong' : 'bg-transparent'" />
            <button
              type="button"
              :data-tab-id="tab.id"
              class="group relative flex h-[30px] max-w-[200px] shrink-0 items-center gap-1 rounded-lg pr-1.5 pl-3 text-[13px] transition-colors"
              :class="[
                isActive(tab) ? 'bg-surface-2 text-fg' : 'text-muted hover:bg-surface-2/60 hover:text-fg',
                isDragged('tab', tab.id) ? 'opacity-30' : '',
              ]"
              :title="tab.path"
              @click="guardClick(() => repos.activate(tab.id))"
              @pointerdown="onPointerDown($event, { kind: 'tab', id: tab.id })"
              @auxclick.middle="repos.closeTab(tab.id)"
              @contextmenu="tabMenu($event, tab)"
            >
              <span class="truncate">{{ tab.name }}</span>
              <span
                class="flex h-5 w-5 items-center justify-center rounded hover:bg-hover"
                :class="isActive(tab) ? 'opacity-70' : 'opacity-0 group-hover:opacity-70'"
                title="Close tab" data-close @click.stop="repos.closeTab(tab.id)"
              ><X :size="13" /></span>
            </button>
          </template>
        </template>
      </div>
    </div>
    <button
      type="button" class="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg text-muted hover:bg-hover hover:text-fg"
      :title="`Open repository (${formatCombo('Mod+O')})`"
      @click="repos.openRepo()"
      data-drop-end
    ><Plus :size="16" /></button>
    <div class="h-full min-w-6 flex-1" data-tauri-drag-region data-drop-end />
    <div
      v-if="ghost"
      class="pointer-events-none fixed z-50 flex h-[30px] items-center rounded-lg bg-surface-3 px-3 text-[13px] font-medium text-fg shadow-xl ring-1 shadow-black/40 ring-line-strong"
      :style="{ left: `${ghost.x}px`, top: `${ghost.y}px`, width: `${ghost.w}px`, color: ghost.color }"
    ><span class="truncate">{{ ghost.label }}</span></div>
  </div>
</template>
