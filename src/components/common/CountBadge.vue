<script setup lang="ts">
defineProps<{ count: number }>()
</script>

<template>
  <span class="min-w-[18px] rounded-full bg-surface-3 px-1.5 text-center font-mono text-[10px] leading-4 text-muted">{{ count }}</span>
</template>
