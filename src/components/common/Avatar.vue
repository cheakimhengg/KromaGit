<script setup lang="ts">
import { computed } from 'vue'
import { avatarHue, initials } from '@/lib/format'

const props = withDefaults(defineProps<{ name: string; email?: string; size?: number }>(), { size: 22 })

const style = computed(() => {
  const hue = avatarHue(props.email || props.name)
  return {
    width: `${props.size}px`,
    height: `${props.size}px`,
    fontSize: `${Math.round(props.size * 0.42)}px`,
    background: `hsl(${hue} 45% 32%)`,
    color: `hsl(${hue} 90% 88%)`,
  }
})
</script>

<template>
  <span class="inline-flex shrink-0 items-center justify-center rounded-full font-semibold leading-none" :style="style" :title="email ? `${name} <${email}>` : name">
    {{ initials(name) }}
  </span>
</template>
