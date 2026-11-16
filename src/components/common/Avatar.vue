<script setup lang="ts">
import { computed } from 'vue'
import { avatarHue, initials } from '@/lib/format'
import { avatarColors } from '@/lib/lanes'
import { avatarUrl, markAvatarFailed } from '@/lib/avatars'

const props = withDefaults(defineProps<{ name: string; email?: string; size?: number }>(), { size: 22 })

const style = computed(() => {
  const c = avatarColors(avatarHue(props.email || props.name))
  return {
    width: `${props.size}px`,
    height: `${props.size}px`,
    fontSize: `${Math.round(props.size * 0.42)}px`,
    background: c.bg,
    color: c.fg,
  }
})
const src = computed(() => avatarUrl(props.email))
</script>

<template>
  <span class="relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold leading-none" :style="style" :title="email ? `${name} <${email}>` : name">
    {{ initials(name).charAt(0) }}
    <img
      v-if="src" :src="src" alt="" loading="lazy" referrerpolicy="no-referrer" draggable="false"
      class="absolute inset-0 h-full w-full object-cover"
      @error="markAvatarFailed(email)"
    />
  </span>
</template>
