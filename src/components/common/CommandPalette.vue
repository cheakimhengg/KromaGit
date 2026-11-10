<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { CornerDownLeft, Search } from 'lucide-vue-next'
import { useUiStore } from '@/stores/ui'
import { useCommands, type Command } from '@/commands/registry'
import { fuzzyFilter } from '@/lib/fuzzy'
import { formatCombo } from '@/lib/shortcuts'

const ui = useUiStore()
const { all } = useCommands()

const query = ref('')
const active = ref(0)
const input = ref<HTMLInputElement | null>(null)
const list = ref<HTMLElement | null>(null)

const results = computed(() => {
  const enabled = (c: Command) => !c.enabled || c.enabled()
  const items = all.value.filter((c) => enabled(c) || !query.value.trim())
  return fuzzyFilter(items, query.value, (c) => `${c.title} ${c.group} ${c.keywords ?? ''}`, 80)
})

watch(
  () => ui.paletteOpen,
  async (open) => {
    if (!open) return
    query.value = ''
    active.value = 0
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

function run(c: Command | undefined) {
  if (!c || (c.enabled && !c.enabled())) return
  ui.paletteOpen = false
  void Promise.resolve().then(() => c.run())
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
    run(results.value[active.value])
  } else if (e.key === 'Escape') {
    e.preventDefault()
    ui.paletteOpen = false
  }
}
</script>

<template>
  <div v-if="ui.paletteOpen" class="fixed inset-0 z-[58] flex items-start justify-center bg-black/40 pt-[12vh]" @mousedown.self="ui.paletteOpen = false">
    <div class="w-[600px] max-w-[92vw] overflow-hidden rounded-xl border border-line-strong bg-surface-2 shadow-2xl shadow-black/50" role="dialog" aria-label="Command palette">
      <div class="flex items-center gap-2 border-b border-line px-4">
        <Search :size="15" class="text-faint" />
        <input
          ref="input"
          v-model="query"
          class="h-11 flex-1 bg-transparent text-[14px] text-fg outline-none placeholder:text-faint"
          placeholder="Type a command, branch or repository…"
          spellcheck="false"
          autocomplete="off"
          @keydown="onKey"
        />
        <kbd class="rounded border border-line px-1.5 font-mono text-[10px] text-faint">Esc</kbd>
      </div>
      <div ref="list" class="max-h-[52vh] overflow-y-auto p-1.5">
        <div v-if="!results.length" class="px-3 py-6 text-center text-[12px] text-faint">No matching commands</div>
        <button
          v-for="(c, i) in results" :key="c.id"
          type="button"
          :data-index="i"
          class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[13px]"
          :class="[i === active ? 'bg-accent/15 text-fg' : 'text-fg/90', c.enabled && !c.enabled() ? 'opacity-40' : '']"
          @mousemove="active = i"
          @click="run(c)"
        >
          <component :is="c.icon" v-if="c.icon" :size="15" class="shrink-0 text-muted" />
          <span v-else class="w-[15px]" />
          <span class="min-w-0 flex-1 truncate">{{ c.title }}</span>
          <span class="shrink-0 text-[10px] tracking-wide text-faint uppercase">{{ c.group }}</span>
          <kbd v-if="c.shortcut" class="shrink-0 rounded border border-line bg-surface px-1.5 font-mono text-[11px] text-muted">{{ formatCombo(c.shortcut) }}</kbd>
          <CornerDownLeft v-if="i === active" :size="13" class="shrink-0 text-faint" />
        </button>
      </div>
    </div>
  </div>
</template>
