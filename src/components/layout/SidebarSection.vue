<script setup lang="ts">
import type { Component } from 'vue'
import { computed } from 'vue'
import { ChevronRight } from 'lucide-vue-next'
import CountBadge from '@/components/common/CountBadge.vue'
import { useUiStore } from '@/stores/ui'

const props = withDefaults(defineProps<{ title: string; icon: Component; count: number; defaultOpen?: boolean }>(), { defaultOpen: true })
const ui = useUiStore()
const open = computed({
  get: () => ui.sidebarSections[props.title] ?? props.defaultOpen,
  set: (v: boolean) => (ui.sidebarSections[props.title] = v),
})
</script>

<template>
  <section class="mb-1">
    <button
      type="button"
      class="flex h-8 w-full items-center gap-1.5 rounded px-1.5 text-[13px] font-semibold text-fg hover:text-fg"
      @click="open = !open"
    >
      <ChevronRight :size="14" class="transition-transform" :class="{ 'rotate-90': open }" />
      <component :is="icon" :size="15" />
      <span class="flex-1 text-left">{{ title }}</span>
      <CountBadge :count="count" />
    </button>
    <div v-if="open" class="pb-1">
      <slot />
      <div v-if="count === 0" class="px-7 py-1 text-[12px] text-faint italic">None</div>
    </div>
  </section>
</template>
