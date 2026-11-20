<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { ChevronRight } from '@/lib/icons'
import { useUiStore, type MenuItem } from '@/stores/ui'

const ui = useUiStore()
const { menu } = storeToRefs(ui)
const el = ref<HTMLElement | null>(null)
const pos = ref({ x: 0, y: 0 })
const openSub = ref<number | null>(null)
const subLeft = ref(false)

watch(menu, async (m) => {
  openSub.value = null
  if (!m) return
  pos.value = { x: m.x, y: m.y }
  await nextTick()
  const rect = el.value?.getBoundingClientRect()
  if (!rect) return
  pos.value = {
    x: Math.min(m.x, window.innerWidth - rect.width - 6),
    y: Math.min(m.y, window.innerHeight - rect.height - 6),
  }
  subLeft.value = pos.value.x + rect.width * 2 + 12 > window.innerWidth
})

function run(item: MenuItem) {
  if (item.disabled || item.children) return
  ui.closeMenu()
  item.action?.()
}

function onPointerDown(e: PointerEvent) {
  if (menu.value && el.value && !el.value.contains(e.target as Node)) ui.closeMenu(true)
}
const closeOnBlur = () => ui.closeMenu()
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') ui.closeMenu()
}

onMounted(() => {
  window.addEventListener('pointerdown', onPointerDown, true)
  window.addEventListener('keydown', onKey)
  window.addEventListener('blur', closeOnBlur)
})
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', onPointerDown, true)
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('blur', closeOnBlur)
})
</script>

<template>
  <div
    v-if="menu"
    ref="el"
    class="fixed z-50 max-w-[340px] min-w-[220px] rounded-xl border border-line-strong bg-surface-2/95 p-1 shadow-2xl shadow-black/50 backdrop-blur"
    :style="{ left: `${pos.x}px`, top: `${pos.y}px` }"
    @contextmenu.prevent
  >
    <template v-for="(item, i) in menu.items" :key="i">
      <div v-if="item.separator" class="my-1 h-px bg-line" />
      <div
        v-else-if="item.heading"
        class="flex items-center gap-2 px-2.5 pt-1.5 pb-1 text-[12px] text-faint"
        :class="{ 'font-mono': item.mono }"
      >
        <span v-if="item.swatch" class="h-2.5 w-2.5 shrink-0 rounded-full" :style="{ background: item.swatch }" />
        <span class="truncate" :class="{ 'font-semibold': item.swatch }" :style="item.swatch ? { color: item.swatch } : undefined">{{ item.label }}</span>
      </div>
      <div v-else class="relative" @mouseenter="openSub = item.children ? i : null">
        <button
          type="button"
          class="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors"
          :class="[
            item.disabled ? 'cursor-default text-faint' : item.danger ? 'text-danger hover:bg-danger/15' : 'text-fg hover:bg-accent/15',
            openSub === i ? 'bg-accent/15' : '',
          ]"
          :disabled="item.disabled"
          @click="run(item)"
        >
          <span v-if="item.swatch" class="mx-0.5 h-3 w-3 shrink-0 rounded-full" :style="{ background: item.swatch }" />
          <component :is="item.icon" v-else-if="item.icon" :size="16" class="shrink-0 opacity-80" />
          <span v-else class="w-[16px]" />
          <span class="flex-1 truncate">{{ item.label }}</span>
          <span v-if="item.shortcut" class="font-mono text-[11px] text-faint">{{ item.shortcut }}</span>
          <ChevronRight v-if="item.children" :size="14" class="text-faint" />
        </button>
        <div
          v-if="item.children && openSub === i"
          class="absolute -top-1 z-10 min-w-[200px] rounded-xl border border-line-strong bg-surface-2 p-1 shadow-2xl shadow-black/50"
          :class="subLeft ? 'right-full mr-1' : 'left-full ml-1'"
        >
          <template v-for="(sub, j) in item.children" :key="j">
            <div v-if="sub.separator" class="my-1 h-px bg-line" />
            <button
              v-else type="button"
              class="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors"
              :class="sub.disabled ? 'cursor-default text-faint' : sub.danger ? 'text-danger hover:bg-danger/15' : 'text-fg hover:bg-accent/15'"
              :disabled="sub.disabled"
              @click="run(sub)"
            >
              <span v-if="sub.swatch" class="mx-0.5 h-3 w-3 shrink-0 rounded-full" :style="{ background: sub.swatch }" />
              <component :is="sub.icon" v-else-if="sub.icon" :size="16" class="shrink-0 opacity-80" />
              <span v-else class="w-[16px]" />
              <span class="flex-1 truncate">{{ sub.label }}</span>
              <span v-if="sub.shortcut" class="font-mono text-[11px] text-faint">{{ sub.shortcut }}</span>
            </button>
          </template>
        </div>
      </div>
    </template>
  </div>
</template>
