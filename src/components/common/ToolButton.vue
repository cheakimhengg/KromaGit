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
  loading?: boolean
}>()
defineEmits<{ click: [MouseEvent]; dropdown: [MouseEvent] }>()
</script>

<template>
  <div class="flex items-stretch">
    <button
      type="button"
      :disabled="disabled"
      :title="title ?? label"
      class="group flex min-w-[50px] flex-col items-center justify-center gap-0.5 rounded-md px-2 py-1 text-muted transition-colors hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-35"
      :class="[dropdown ? 'rounded-r-none pr-1' : '', accent ? 'text-accent' : '']"
      @click="$emit('click', $event)"
    >
      <component :is="icon" :size="18" :stroke-width="1.75" :class="{ 'animate-spin': loading }" />
      <span v-if="label" class="text-[11px] leading-none">{{ label }}</span>
    </button>
    <button
      v-if="dropdown"
      type="button"
      :disabled="disabled"
      class="flex items-center rounded-r-md px-0.5 text-faint transition-colors hover:bg-hover hover:text-fg disabled:opacity-35"
      :title="`${label ?? ''} options`"
      @click="$emit('dropdown', $event)"
    >
      <ChevronDown :size="14" />
    </button>
  </div>
</template>
