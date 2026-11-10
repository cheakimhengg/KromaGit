<script setup lang="ts">
import type { Component } from 'vue'
import { X } from 'lucide-vue-next'
import { useUiStore } from '@/stores/ui'

defineProps<{ title: string; icon: Component; subtitle?: string }>()
const ui = useUiStore()
</script>

<template>
  <div class="flex h-full min-w-0 flex-col bg-bg">
    <div class="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
      <component :is="icon" :size="16" class="shrink-0 text-accent-2" />
      <span class="text-[13px] font-semibold">{{ title }}</span>
      <span v-if="subtitle" class="truncate text-[12px] text-faint">{{ subtitle }}</span>
      <div class="flex-1" />
      <slot name="actions" />
      <button type="button" class="rounded p-1 text-faint hover:bg-hover hover:text-fg" title="Close" @click="ui.showPanel('graph')"><X :size="16" /></button>
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto">
      <slot />
    </div>
  </div>
</template>
