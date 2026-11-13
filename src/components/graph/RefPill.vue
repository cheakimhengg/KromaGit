<script setup lang="ts">
import { computed } from 'vue'
import { Check, Cloud, GitBranch, Monitor, Tag } from '@/lib/icons'
import type { RefLabel } from '@/types/git'

const props = defineProps<{ refLabel: RefLabel; color: string; hasRemote?: boolean; label?: string }>()

const icon = computed(() => {
  switch (props.refLabel.kind) {
    case 'tag': return Tag
    case 'remote': return Cloud
    default: return props.refLabel.current ? Monitor : GitBranch
  }
})
const style = computed(() =>
  props.refLabel.current
    ? { background: props.color, color: 'var(--gw-on-accent)', borderColor: props.color }
    : { background: `${props.color}22`, color: props.color, borderColor: `${props.color}55` },
)
</script>

<template>
  <span
    class="inline-flex h-6 max-w-full min-w-0 items-center gap-1.5 rounded-full border px-2.5 text-[13px] leading-none font-medium whitespace-nowrap"
    :style="style"
    :title="refLabel.current ? `${refLabel.name} (checked out)` : refLabel.name"
  >
    <Check v-if="refLabel.current" :size="13" :stroke-width="2.25" class="shrink-0" />
    <component :is="icon" v-else :size="13" :stroke-width="2.25" class="shrink-0" />
    <span class="truncate">{{ label ?? refLabel.name }}</span>
    <Monitor v-if="refLabel.current" :size="13" :stroke-width="2.25" class="shrink-0 opacity-80" />
    <Cloud v-if="hasRemote" :size="13" :stroke-width="2.25" class="shrink-0 opacity-70" />
  </span>
</template>
