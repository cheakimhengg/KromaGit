<script setup lang="ts">
import { computed } from 'vue'
import { Cloud, GitBranch, Monitor, Tag } from 'lucide-vue-next'
import type { RefLabel } from '@/types/git'

const props = defineProps<{ refLabel: RefLabel; color: string; hasRemote?: boolean }>()

const icon = computed(() => {
  switch (props.refLabel.kind) {
    case 'tag': return Tag
    case 'remote': return Cloud
    default: return props.refLabel.current ? Monitor : GitBranch
  }
})
const style = computed(() =>
  props.refLabel.current
    ? { background: props.color, color: '#0b0e14', borderColor: props.color }
    : { background: `${props.color}22`, color: props.color, borderColor: `${props.color}55` },
)
</script>

<template>
  <span
    class="inline-flex h-[18px] max-w-full items-center gap-1 rounded-full border px-1.5 text-[11px] leading-none font-medium whitespace-nowrap"
    :style="style"
    :title="refLabel.current ? `${refLabel.name} (checked out)` : refLabel.name"
  >
    <component :is="icon" :size="10" :stroke-width="2.25" class="shrink-0" />
    <span class="truncate">{{ refLabel.name }}</span>
    <Cloud v-if="hasRemote" :size="10" :stroke-width="2.25" class="shrink-0 opacity-70" />
  </span>
</template>
