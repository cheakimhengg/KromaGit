<script setup lang="ts">
import { computed } from 'vue'
import { AlertTriangle, Play, X } from 'lucide-vue-next'
import { useReposStore } from '@/stores/repos'
import { useOpsStore } from '@/stores/ops'
import * as git from '@/actions/git'

const repos = useReposStore()
const ops = useOpsStore()
const snapshot = computed(() => repos.active?.snapshot ?? null)
const operation = computed(() => snapshot.value?.operation ?? null)
const conflicts = computed(() => snapshot.value?.workingCopy.unstaged.filter((f) => f.status === 'U').length ?? 0)
const names = { merge: 'Merge', rebase: 'Rebase', cherryPick: 'Cherry-pick', revert: 'Revert' }
</script>

<template>
  <div v-if="operation" class="flex h-9 shrink-0 items-center gap-2 border-b border-warning/30 bg-warning/10 px-3 text-[13px]">
    <AlertTriangle :size="16" class="text-warning" />
    <span class="font-semibold text-warning">{{ names[operation] }} in progress</span>
    <span class="text-muted">
      <template v-if="conflicts">{{ conflicts }} conflicted {{ conflicts === 1 ? 'file' : 'files' }} — resolve them in your editor, then stage them.</template>
      <template v-else>All conflicts are resolved. Continue to finish.</template>
    </span>
    <div class="flex-1" />
    <button
      type="button" :disabled="!!ops.running"
      class="flex h-7 shrink-0 items-center whitespace-nowrap gap-1 rounded-md border border-line-strong px-2 text-[12px] hover:bg-hover disabled:opacity-40"
      @click="git.abortOperation()"
    ><X :size="14" />Abort</button>
    <button
      type="button" :disabled="!!ops.running || conflicts > 0"
      :title="conflicts ? 'Resolve and stage all conflicted files first' : 'Continue'"
      class="flex h-7 shrink-0 items-center whitespace-nowrap gap-1 rounded-md bg-accent px-2 text-[12px] font-semibold text-on-accent hover:brightness-110 disabled:opacity-40"
      @click="git.continueOperation()"
    ><Play :size="14" />Continue</button>
  </div>
</template>
