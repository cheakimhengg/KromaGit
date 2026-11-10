<script setup lang="ts">
import type { FileStatus } from '@/types/git'

defineProps<{ status: FileStatus }>()

const styles: Record<FileStatus, string> = {
  M: 'bg-warning/15 text-warning',
  A: 'bg-success/15 text-success',
  D: 'bg-danger/15 text-danger',
  R: 'bg-accent/15 text-accent',
  '?': 'bg-info/15 text-info',
  U: 'bg-danger/25 text-danger',
}
const titles: Record<FileStatus, string> = {
  M: 'Modified', A: 'Added', D: 'Deleted', R: 'Renamed', '?': 'Untracked', U: 'Conflicted',
}
</script>

<template>
  <span class="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded font-mono text-[11px] font-bold" :class="styles[status]" :title="titles[status]">
    {{ status }}
  </span>
</template>
