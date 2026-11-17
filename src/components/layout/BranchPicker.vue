<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Check, Cloud, GitBranch, GitBranchPlus, Search } from '@/lib/icons'
import { useReposStore } from '@/stores/repos'
import * as git from '@/actions/git'

const props = defineProps<{ anchor: HTMLElement | null }>()
const open = defineModel<boolean>({ required: true })

const repos = useReposStore()
const snapshot = computed(() => repos.active?.snapshot ?? null)
const query = ref('')
const active = ref(0)
const panel = ref<HTMLElement | null>(null)
const input = ref<HTMLInputElement | null>(null)
const list = ref<HTMLElement | null>(null)
const pos = ref({ left: 0, top: 0 })

interface Item {
  key: string
  label: string
  current?: boolean
  remote?: string
  section: 'local' | 'remote'
}

const items = computed<Item[]>(() => {
  const snap = snapshot.value
  if (!snap) return []
  const q = query.value.trim().toLowerCase()
  const hit = (s: string) => !q || s.toLowerCase().includes(q)
  const local = [...snap.branches]
    .sort((a, b) => Number(b.current) - Number(a.current) || a.name.localeCompare(b.name))
    .filter((b) => hit(b.name))
    .map<Item>((b) => ({ key: `l:${b.name}`, label: b.name, current: b.current, section: 'local' }))
  const localNames = new Set(snap.branches.map((b) => b.name))
  const remote: Item[] = []
  for (const r of snap.remotes) {
    for (const name of r.branches) {
      if (name === 'HEAD' || localNames.has(name)) continue
      const full = `${r.name}/${name}`
      if (hit(full)) remote.push({ key: `r:${full}`, label: full, remote: r.name, section: 'remote' })
    }
  }
  remote.sort((a, b) => a.label.localeCompare(b.label))
  return [...local, ...remote]
})
const localCount = computed(() => items.value.filter((i) => i.section === 'local').length)

function place() {
  const r = props.anchor?.getBoundingClientRect()
  if (!r) return
  pos.value = { left: Math.min(r.left, window.innerWidth - 380), top: r.bottom + 6 }
}

watch(open, async (v) => {
  if (!v) return
  query.value = ''
  active.value = 0
  place()
  await nextTick()
  input.value?.focus()
})
watch(query, () => (active.value = 0))

function choose(item: Item | undefined) {
  if (!item) return
  open.value = false
  if (item.section === 'local') {
    if (!item.current) void git.checkout(item.label)
  } else void git.checkoutRemote(item.label, item.remote!)
}
function newBranch() {
  open.value = false
  void git.createBranch()
}

async function move(step: number) {
  const n = items.value.length
  if (!n) return
  active.value = (active.value + step + n) % n
  await nextTick()
  list.value?.querySelector(`[data-i="${active.value}"]`)?.scrollIntoView({ block: 'nearest' })
}
function onInputKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') { e.preventDefault(); void move(1) }
  else if (e.key === 'ArrowUp') { e.preventDefault(); void move(-1) }
  else if (e.key === 'Enter') { e.preventDefault(); choose(items.value[active.value]) }
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); open.value = false }
}

function onPointerDown(e: PointerEvent) {
  if (!open.value) return
  const t = e.target as Node
  if (panel.value?.contains(t) || props.anchor?.contains(t)) return
  open.value = false
}
onMounted(() => {
  window.addEventListener('pointerdown', onPointerDown, true)
  window.addEventListener('resize', place)
})
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', onPointerDown, true)
  window.removeEventListener('resize', place)
})
</script>

<template>
  <div
    v-if="open && snapshot"
    ref="panel"
    class="fixed z-50 flex w-[360px] flex-col overflow-hidden rounded-xl border border-line-strong bg-surface-2/95 shadow-2xl shadow-black/50 backdrop-blur"
    :style="{ left: `${pos.left}px`, top: `${pos.top}px` }"
    role="dialog"
    aria-label="Switch branch"
  >
    <div class="relative border-b border-line p-2">
      <Search :size="14" class="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-faint" />
      <input
        ref="input"
        v-model="query"
        class="gw-input h-8 w-full pl-8 text-[13px]"
        placeholder="Find a branch…"
        spellcheck="false"
        @keydown="onInputKeydown"
      />
    </div>

    <div ref="list" class="max-h-[min(420px,60vh)] overflow-y-auto p-1">
      <template v-for="(item, i) in items" :key="item.key">
        <div v-if="i === 0 && item.section === 'local'" class="px-2.5 pt-1.5 pb-1 text-[11px] font-semibold tracking-wide text-faint uppercase">Local · {{ localCount }}</div>
        <div v-if="item.section === 'remote' && (i === 0 || items[i - 1].section === 'local')" class="px-2.5 pt-2.5 pb-1 text-[11px] font-semibold tracking-wide text-faint uppercase">Remote · {{ items.length - localCount }}</div>
        <button
          type="button"
          :data-i="i"
          class="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px]"
          :class="i === active ? 'bg-accent/15 text-fg' : 'text-fg hover:bg-hover'"
          :title="item.label"
          @mouseenter="active = i"
          @click="choose(item)"
        >
          <Check v-if="item.current" :size="15" class="shrink-0 text-accent" />
          <Cloud v-else-if="item.section === 'remote'" :size="15" class="shrink-0 text-faint" />
          <GitBranch v-else :size="15" class="shrink-0 text-faint" />
          <span class="min-w-0 flex-1 truncate" :class="{ 'font-medium text-accent': item.current }">{{ item.label }}</span>
          <span v-if="item.current" class="shrink-0 text-[11px] text-faint">current</span>
        </button>
      </template>
      <p v-if="!items.length" class="px-3 py-6 text-center text-[13px] text-faint">No branch matches “{{ query }}”.</p>
    </div>

    <button type="button" class="flex items-center gap-2.5 border-t border-line px-4 py-2.5 text-left text-[13px] text-fg hover:bg-hover" @click="newBranch">
      <GitBranchPlus :size="15" class="shrink-0 opacity-80" />New branch…
    </button>
  </div>
</template>
