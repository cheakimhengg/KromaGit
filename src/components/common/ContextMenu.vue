<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useUiStore, type MenuItem } from '@/stores/ui'

const ui = useUiStore()
const { menu } = storeToRefs(ui)
const el = ref<HTMLElement | null>(null)
const pos = ref({ x: 0, y: 0 })

watch(menu, async (m) => {
  if (!m) return
  pos.value = { x: m.x, y: m.y }
  await nextTick()
  const rect = el.value?.getBoundingClientRect()
  if (!rect) return
  pos.value = {
    x: Math.min(m.x, window.innerWidth - rect.width - 6),
    y: Math.min(m.y, window.innerHeight - rect.height - 6),
  }
})

function run(item: MenuItem) {
  ui.closeMenu()
  item.action?.()
}

function onPointerDown(e: PointerEvent) {
  if (menu.value && el.value && !el.value.contains(e.target as Node)) ui.closeMenu()
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') ui.closeMenu()
}

onMounted(() => {
  window.addEventListener('pointerdown', onPointerDown, true)
  window.addEventListener('keydown', onKey)
  window.addEventListener('blur', ui.closeMenu)
})
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', onPointerDown, true)
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('blur', ui.closeMenu)
})
</script>

<template>
  <div
    v-if="menu"
    ref="el"
    class="fixed z-50 min-w-[200px] rounded-lg border border-line-strong bg-surface-2/95 p-1 shadow-2xl shadow-black/50 backdrop-blur"
    :style="{ left: `${pos.x}px`, top: `${pos.y}px` }"
    @contextmenu.prevent
  >
    <template v-for="(item, i) in menu.items" :key="i">
      <div v-if="item.separator" class="my-1 h-px bg-line" />
      <button
        v-else
        type="button"
        class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors"
        :class="item.danger ? 'text-danger hover:bg-danger/15' : 'text-fg hover:bg-accent/15'"
        @click="run(item)"
      >
        <span v-if="item.swatch" class="h-3 w-3 shrink-0 rounded-full" :style="{ background: item.swatch }" />
        <component :is="item.icon" v-else-if="item.icon" :size="16" class="shrink-0 opacity-80" />
        <span v-else class="w-[16px]" />
        <span class="flex-1">{{ item.label }}</span>
        <span v-if="item.shortcut" class="font-mono text-[11px] text-faint">{{ item.shortcut }}</span>
      </button>
    </template>
  </div>
</template>
