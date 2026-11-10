<script setup lang="ts">
import type { Component } from 'vue'
import { ref } from 'vue'
import { ChevronRight } from 'lucide-vue-next'
import CountBadge from '@/components/common/CountBadge.vue'

const props = withDefaults(defineProps<{ title: string; icon: Component; count: number; defaultOpen?: boolean }>(), { defaultOpen: true })
const open = ref(props.defaultOpen)
</script>

<template>
  <section class="mb-1">
    <button
      type="button"
      class="flex h-7 w-full items-center gap-1.5 rounded px-1.5 text-[11px] font-semibold tracking-wide text-muted uppercase hover:text-fg"
      @click="open = !open"
    >
      <ChevronRight :size="12" class="transition-transform" :class="{ 'rotate-90': open }" />
      <component :is="icon" :size="13" />
      <span class="flex-1 text-left">{{ title }}</span>
      <CountBadge :count="count" />
    </button>
    <div v-if="open" class="pb-1">
      <slot />
      <div v-if="count === 0" class="px-7 py-1 text-[11px] text-faint italic">None</div>
    </div>
  </section>
</template>
