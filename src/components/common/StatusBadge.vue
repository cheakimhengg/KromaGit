<script setup lang="ts">
import type { FileStatus } from '@/types/git'
import { File as FileIcon } from '@/lib/icons'

defineProps<{ status: FileStatus }>()

const styles: Record<FileStatus, string> = {
  M: 'bg-warning/15 text-warning',
  A: 'bg-success/15 text-success',
  D: 'bg-danger/15 text-danger',
  R: 'bg-accent/15 text-accent',
  '?': 'bg-info/15 text-info',
  U: 'bg-danger/25 text-danger',
  '=': 'text-faint',
}
const titles: Record<FileStatus, string> = {
  M: 'Modified', A: 'Added', D: 'Deleted', R: 'Renamed', '?': 'Untracked', U: 'Conflicted', '=': 'Unchanged',
}
</script>

<template>
  <span class="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded font-mono text-[11px] font-bold" :class="styles[status]" :title="titles[status]">
    <FileIcon v-if="status === '='" :size="13" />
    <template v-else>{{ status }}</template>
  </span>
</template>
