<script setup lang="ts">
import type { Component } from 'vue'
import { ChevronDown } from '@/lib/icons'

defineProps<{
  icon: Component
  /** shown next to the icon; omit for an icon-only button */
  label?: string
  title?: string
  disabled?: boolean
  dropdown?: boolean
  active?: boolean
  loading?: boolean
  /** e.g. commits behind/ahead, shown as "↓3" next to the label */
  count?: number
  countPrefix?: string
}>()
defineEmits<{ click: [MouseEvent]; dropdown: [MouseEvent] }>()
</script>

<template>
  <div class="flex h-8 items-stretch rounded-md transition-colors" :class="active ? 'bg-accent/15 text-accent' : 'text-muted'">
    <button
      type="button"
      :disabled="disabled"
      :title="title ?? label"
      :aria-label="title ?? label"
      class="relative flex items-center gap-1.5 rounded-md text-[13px] font-medium whitespace-nowrap transition-colors hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-35"
      :class="[label ? 'px-2.5' : 'w-8 justify-center', dropdown ? 'rounded-r-none' : '', active ? 'text-accent' : '']"
      @click="$emit('click', $event)"
    >
      <component :is="icon" :size="17" :stroke-width="1.85" :class="{ 'animate-spin': loading }" />
      <span v-if="label">{{ label }}</span>
      <span v-if="count" class="font-mono text-[12px] font-semibold text-accent">{{ countPrefix }}{{ count > 999 ? '999+' : count }}</span>
    </button>
    <button
      v-if="dropdown"
      type="button"
      :disabled="disabled"
      class="flex w-5 items-center justify-center rounded-r-md text-faint transition-colors hover:bg-hover hover:text-fg disabled:opacity-35"
      :title="`${label ?? title ?? ''} options`"
      @click="$emit('dropdown', $event)"
    >
      <ChevronDown :size="14" />
    </button>
  </div>
</template>
