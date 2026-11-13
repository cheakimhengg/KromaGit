<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { CornerDownLeft, FolderGit2, FolderOpen, Search, X } from 'lucide-vue-next'
import { useUiStore } from '@/stores/ui'
import { useReposStore } from '@/stores/repos'
import { fuzzyFilter } from '@/lib/fuzzy'
import { formatCombo } from '@/lib/shortcuts'
import { shortPath } from '@/lib/format'

const ui = useUiStore()
const repos = useReposStore()

const query = ref('')
const active = ref(0)
const input = ref<HTMLInputElement | null>(null)
const list = ref<HTMLElement | null>(null)

interface Item {
  name: string
  path: string
  tabId?: string
}

const items = computed<Item[]>(() => {
  const byPath = new Map<string, Item>()
  for (const r of repos.recent) byPath.set(r.path, { name: r.name, path: r.path })
  for (const t of repos.tabs) {
    const it = byPath.get(t.path) ?? { name: t.name, path: t.path }
    it.tabId = t.id
    byPath.set(t.path, it)
  }
  const all = [...byPath.values()]
  const cur = all.findIndex((i) => i.tabId === repos.activeTabId)
  if (cur > 0) all.unshift(...all.splice(cur, 1))
  return all
})

const results = computed(() => fuzzyFilter(items.value, query.value, (i) => `${i.name} ${i.path}`, 100))

watch(
  () => ui.switcherOpen,
  async (open) => {
    if (!open) return
    query.value = ''
    active.value = items.value.length > 1 && !ui.home ? 1 : 0
    await nextTick()
    input.value?.focus()
  },
)
watch(query, () => (active.value = 0))

function move(delta: number) {
  const n = results.value.length
  if (!n) return
  active.value = (active.value + delta + n) % n
  void nextTick(() => list.value?.querySelector(`[data-index="${active.value}"]`)?.scrollIntoView({ block: 'nearest' }))
}

function choose(it: Item | undefined) {
  if (!it) return
  ui.switcherOpen = false
  if (it.tabId) repos.activate(it.tabId)
  else void repos.openRepoAt(it.path)
}

function browse() {
  ui.switcherOpen = false
  void repos.openRepo()
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) {
    e.preventDefault()
    move(1)
  } else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) {
    e.preventDefault()
    move(-1)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    choose(results.value[active.value])
  } else if (e.key === 'Escape') {
    e.preventDefault()
    ui.switcherOpen = false
  }
}
</script>

<template>
  <div v-if="ui.switcherOpen" class="fixed inset-0 z-[58] flex items-start justify-center bg-black/40 pt-[12vh]" @mousedown.self="ui.switcherOpen = false">
    <div class="flex max-h-[70vh] w-[640px] max-w-[92vw] flex-col overflow-hidden rounded-xl border border-line-strong bg-surface-2 shadow-2xl shadow-black/50" role="dialog" aria-label="Switch repository">
      <div class="flex items-center gap-2 border-b border-line px-4">
        <Search :size="17" class="text-faint" />
        <input
          ref="input"
          v-model="query"
          class="h-12 flex-1 bg-transparent text-[15px] text-fg outline-none placeholder:text-faint"
          placeholder="Search repositories by name or path…"
          spellcheck="false"
          autocomplete="off"
          @keydown="onKey"
        />
      </div>
      <div ref="list" class="min-h-0 flex-1 overflow-y-auto p-1.5">
        <div v-if="!results.length" class="px-3 py-6 text-center text-[13px] text-faint">
          {{ items.length ? 'No matching repositories' : 'No repositories yet' }}
        </div>
        <div
          v-for="(it, i) in results" :key="it.path"
          role="button" tabindex="-1"
          :data-index="i"
          class="group flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left"
          :class="i === active ? 'bg-accent/15' : ''"
          @mousemove="active = i"
          @click="choose(it)"
        >
          <FolderGit2 :size="18" class="shrink-0" :class="it.tabId ? 'text-accent' : 'text-muted'" />
          <span class="min-w-0 flex-1">
            <span class="block truncate text-[14px] text-fg">{{ it.name }}</span>
            <span class="block truncate font-mono text-[12px] text-faint">{{ shortPath(it.path) }}</span>
          </span>
          <span v-if="it.tabId === repos.activeTabId && !ui.home" class="shrink-0 rounded-md bg-accent/15 px-2 py-0.5 text-[11px] font-semibold text-accent">Current</span>
          <span v-else-if="it.tabId" class="shrink-0 rounded-md bg-surface-3 px-2 py-0.5 text-[11px] text-muted">Open tab</span>
          <button
            v-else type="button" class="shrink-0 rounded p-1 text-faint opacity-0 group-hover:opacity-100 hover:bg-surface-3 hover:text-fg"
            title="Remove from recent" @click.stop="repos.forgetRecent(it.path)"
          ><X :size="14" /></button>
          <CornerDownLeft v-if="i === active" :size="15" class="shrink-0 text-faint" />
        </div>
      </div>
      <button type="button" class="flex items-center gap-2 border-t border-line px-4 py-2.5 text-left text-[13px] text-muted hover:bg-hover hover:text-fg" @click="browse">
        <FolderOpen :size="16" />Open another folder…
        <kbd class="ml-auto rounded border border-line px-1.5 font-mono text-[11px] text-faint">{{ formatCombo('Mod+O') }}</kbd>
      </button>
      <div class="flex items-center gap-4 border-t border-line bg-surface px-4 py-2 text-[12px] text-faint">
        <span><kbd class="mr-1 rounded border border-line px-1 font-mono">↑↓</kbd>move</span>
        <span><kbd class="mr-1 rounded border border-line px-1 font-mono">↵</kbd>open or switch</span>
        <span><kbd class="mr-1 rounded border border-line px-1 font-mono">Esc</kbd>close</span>
        <span class="ml-auto">{{ items.length }} {{ items.length === 1 ? 'repository' : 'repositories' }}</span>
      </div>
    </div>
  </div>
</template>
