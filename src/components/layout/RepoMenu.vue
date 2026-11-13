<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { Check, ChevronDown, FolderGit2, FolderOpen, GitBranchPlus, Search } from '@/lib/icons'
import { useReposStore } from '@/stores/repos'
import { useUiStore } from '@/stores/ui'
import { formatCombo } from '@/lib/shortcuts'
import { shortPath } from '@/lib/format'

const repos = useReposStore()
const ui = useUiStore()

const root = ref<HTMLElement | null>(null)
const filterInput = ref<HTMLInputElement | null>(null)
const filter = ref('')

interface Entry {
  name: string
  path: string
  tabId?: string
}
interface Section {
  key: string
  title: string
  color?: string
  items: Entry[]
}

const sections = computed<Section[]>(() => {
  const q = filter.value.trim().toLowerCase()
  const match = (e: Entry) => !q || e.name.toLowerCase().includes(q) || e.path.toLowerCase().includes(q)
  const out: Section[] = []
  const seen = new Set<string>()
  for (const g of repos.groups) {
    const items = repos.tabs.filter((t) => t.groupId === g.id).map((t) => ({ name: t.name, path: t.path, tabId: t.id }))
    items.forEach((i) => seen.add(i.path))
    const shown = items.filter(match)
    if (shown.length) out.push({ key: g.id, title: g.name, color: g.color, items: shown })
  }
  const loose = repos.tabs.filter((t) => !seen.has(t.path)).map((t) => ({ name: t.name, path: t.path, tabId: t.id }))
  loose.forEach((i) => seen.add(i.path))
  if (loose.filter(match).length) out.push({ key: 'open', title: 'Open tabs', items: loose.filter(match) })
  const recent = repos.recent.filter((r) => !seen.has(r.path)).map((r) => ({ name: r.name, path: r.path }))
  if (recent.filter(match).length) out.push({ key: 'recent', title: 'Recent', items: recent.filter(match).slice(0, 12) })
  return out
})

async function toggle() {
  ui.repoMenuOpen = !ui.repoMenuOpen
}

watch(
  () => ui.repoMenuOpen,
  async (open) => {
    if (!open) return
    filter.value = ''
    await nextTick()
    filterInput.value?.focus()
  },
)

function choose(e: Entry) {
  ui.repoMenuOpen = false
  if (e.tabId) repos.activate(e.tabId)
  else void repos.openRepoAt(e.path)
}

function run(fn: () => unknown) {
  ui.repoMenuOpen = false
  void fn()
}

function onDocDown(e: MouseEvent) {
  if (ui.repoMenuOpen && root.value && !root.value.contains(e.target as Node)) ui.repoMenuOpen = false
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && ui.repoMenuOpen) {
    e.stopPropagation()
    ui.repoMenuOpen = false
  }
}
window.addEventListener('mousedown', onDocDown, true)
window.addEventListener('keydown', onKey, true)
onBeforeUnmount(() => {
  window.removeEventListener('mousedown', onDocDown, true)
  window.removeEventListener('keydown', onKey, true)
})
</script>

<template>
  <div ref="root" class="relative min-w-0">
    <button
      type="button"
      class="flex h-7 min-w-0 items-center gap-1.5 rounded-full px-2.5 text-[14px] font-semibold text-fg hover:bg-hover"
      :class="{ 'bg-hover': ui.repoMenuOpen }"
      title="Switch or open a repository"
      :aria-expanded="ui.repoMenuOpen"
      @click="toggle"
    >
      <span class="max-w-[180px] truncate">{{ repos.activeTab?.name }}</span>
      <ChevronDown :size="13" class="shrink-0 text-faint transition-transform" :class="{ 'rotate-180': ui.repoMenuOpen }" />
    </button>

    <div
      v-if="ui.repoMenuOpen"
      class="absolute top-[calc(100%+8px)] left-0 z-50 flex max-h-[70vh] w-[440px] flex-col overflow-hidden rounded-xl border border-line-strong bg-surface-2 shadow-2xl shadow-black/40"
      role="menu"
    >
      <div class="relative border-b border-line p-2">
        <Search :size="14" class="pointer-events-none absolute top-1/2 left-4.5 -translate-y-1/2 text-faint" />
        <input ref="filterInput" v-model="filter" class="gw-input h-8 pl-8" placeholder="Find a repository…" spellcheck="false" />
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto py-1">
        <template v-for="s in sections" :key="s.key">
          <div class="flex items-center gap-1.5 px-3.5 pt-2.5 pb-1 text-[12px] font-semibold text-muted">
            <span v-if="s.color" class="h-2 w-2 rounded-full" :style="{ background: s.color }" />{{ s.title }}
          </div>
          <button
            v-for="e in s.items" :key="e.path" type="button" role="menuitem"
            class="flex w-full items-center gap-3 px-3.5 py-1.5 text-left hover:bg-hover"
            @click="choose(e)"
          >
            <FolderGit2 :size="18" class="shrink-0" :class="e.tabId === repos.activeTabId ? 'text-accent' : 'text-muted'" />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-[14px] text-fg">{{ e.name }}</span>
              <span class="block truncate font-mono text-[11px] text-faint">{{ shortPath(e.path) }}</span>
            </span>
            <Check v-if="e.tabId === repos.activeTabId" :size="15" :stroke-width="2.25" class="shrink-0 text-accent" />
          </button>
        </template>
        <p v-if="!sections.length" class="px-3.5 py-4 text-center text-[13px] text-faint">No repositories match.</p>
      </div>

      <div class="border-t border-line py-1">
        <button type="button" class="flex w-full items-center gap-3 px-3.5 py-2 text-left text-[14px] text-fg hover:bg-hover" @click="run(repos.openRepo)">
          <FolderOpen :size="17" class="text-muted" />Open repository…
          <kbd class="ml-auto font-mono text-[11px] text-faint">{{ formatCombo('Mod+O') }}</kbd>
        </button>
        <button type="button" class="flex w-full items-center gap-3 px-3.5 py-2 text-left text-[14px] text-fg hover:bg-hover" :disabled="!!repos.cloning" @click="run(repos.cloneRepo)">
          <GitBranchPlus :size="17" class="text-muted" />{{ repos.cloning ? 'Cloning…' : 'Clone repository…' }}
        </button>
      </div>
    </div>
  </div>
</template>
