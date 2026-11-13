<script setup lang="ts">
import type { ThemeInfo } from '@/lib/theme'

defineProps<{ swatch: ThemeInfo['swatch'] }>()
</script>

<template>
  <div class="flex h-full w-full flex-col justify-center gap-2.5 px-5" :style="{ background: swatch.bg }">
    <div class="flex gap-1.5">
      <span v-for="c in [swatch.accent, swatch.success, swatch.accent2]" :key="c" class="h-2.5 w-2.5 rounded-full" :style="{ background: c }" />
    </div>
    <div class="h-2 w-3/5 rounded-full opacity-80" :style="{ background: swatch.text }" />
    <div class="h-2 w-2/5 rounded-full" :style="{ background: swatch.muted }" />
  </div>
</template>
