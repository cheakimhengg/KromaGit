<script setup lang="ts">
import { CheckCircle2, Info, X, XCircle } from 'lucide-vue-next'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
const icons = { info: Info, success: CheckCircle2, error: XCircle }
const colors = { info: 'text-accent', success: 'text-success', error: 'text-danger' }
</script>

<template>
  <div class="pointer-events-none fixed bottom-10 left-4 z-50 flex w-80 flex-col gap-2">
    <TransitionGroup
      enter-from-class="translate-y-2 opacity-0"
      leave-to-class="opacity-0"
      enter-active-class="transition duration-200"
      leave-active-class="transition duration-150"
    >
      <div
        v-for="t in ui.toasts"
        :key="t.id"
        class="pointer-events-auto flex items-start gap-2 rounded-lg border border-line-strong bg-surface-2 p-3 shadow-xl shadow-black/40"
      >
        <component :is="icons[t.kind]" :size="16" class="mt-0.5 shrink-0" :class="colors[t.kind]" />
        <div class="min-w-0 flex-1">
          <div class="text-[12px] font-medium text-fg">{{ t.title }}</div>
          <div v-if="t.detail" class="mt-0.5 text-[11px] text-muted">{{ t.detail }}</div>
        </div>
        <button type="button" class="text-faint hover:text-fg" @click="ui.dismissToast(t.id)"><X :size="14" /></button>
      </div>
    </TransitionGroup>
  </div>
</template>
