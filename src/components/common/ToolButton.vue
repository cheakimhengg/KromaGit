<script setup lang="ts">
import type { Component } from 'vue'
import { ChevronDown } from 'lucide-vue-next'

defineProps<{
  icon: Component
  label?: string
  title?: string
  disabled?: boolean
  dropdown?: boolean
  accent?: boolean
}>()
defineEmits<{ click: [MouseEvent]; dropdown: [MouseEvent] }>()
</script>

<template>
  <div class="flex items-stretch">
    <button
      type="button"
      :disabled="disabled"
      :title="title ?? label"
      class="group flex min-w-[44px] flex-col items-center justify-center gap-0.5 rounded-md px-2 py-1 text-muted transition-colors hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-35"
      :class="[dropdown ? 'rounded-r-none pr-1' : '', accent ? 'text-accent' : '']"
      @click="$emit('click', $event)"
    >
      <component :is="icon" :size="16" :stroke-width="1.75" />
      <span v-if="label" class="text-[10px] leading-none">{{ label }}</span>
    </button>
    <button
      v-if="dropdown"
      type="button"
      :disabled="disabled"
      class="flex items-center rounded-r-md px-0.5 text-faint transition-colors hover:bg-hover hover:text-fg disabled:opacity-35"
      :title="`${label ?? ''} options`"
      @click="$emit('dropdown', $event)"
    >
      <ChevronDown :size="12" />
    </button>
  </div>
</template>
