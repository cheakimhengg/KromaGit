<script setup lang="ts">
import { computed, ref } from 'vue'
import { Check, ScanSearch, Sparkles } from 'lucide-vue-next'
import { useUiStore } from '@/stores/ui'

const props = defineProps<{ stagedCount: number }>()
const ui = useUiStore()

const summary = ref('')
const description = ref('')
const amend = ref(false)
const SOFT_LIMIT = 72

const summaryLen = computed(() => summary.value.length)
const canCommit = computed(() => (props.stagedCount > 0 || amend.value) && summary.value.trim() !== '')

function generate() {
  summary.value = 'feat(graph): render curved merge lanes with author avatars'
  description.value = '- compute lane layout once per repo and virtualize rows\n- add ref pills colored by lane\n- show WIP row with uncommitted change count'
  ui.toast({ kind: 'info', title: 'AI generate (mock)', detail: 'Real generation arrives in Phase 4.' })
}
</script>

<template>
  <div class="border-t border-line bg-surface p-3">
    <div class="relative">
      <input
        v-model="summary"
        class="gw-input h-8 pr-16 text-[13px]"
        placeholder="Summary (required)"
        spellcheck="false"
      />
      <span
        class="pointer-events-none absolute top-1/2 right-9 -translate-y-1/2 font-mono text-[10px]"
        :class="summaryLen > SOFT_LIMIT ? 'text-danger' : summaryLen > 50 ? 'text-warning' : 'text-faint'"
        :title="`${SOFT_LIMIT} characters is the conventional limit`"
      >{{ summaryLen }}</span>
      <button
        type="button"
        class="absolute top-1/2 right-1 -translate-y-1/2 rounded-md p-1 text-accent-2 hover:bg-accent-2/15"
        title="Generate message with AI"
        @click="generate"
      >
        <Sparkles :size="15" />
      </button>
    </div>
    <textarea
      v-model="description"
      rows="4"
      class="gw-input mt-2 h-auto resize-none py-1.5 leading-relaxed"
      placeholder="Description"
      spellcheck="false"
    />
    <div class="mt-2 flex items-center gap-2">
      <label class="flex cursor-pointer items-center gap-1.5 text-[12px] text-muted select-none">
        <input v-model="amend" type="checkbox" class="h-3 w-3 accent-[var(--gw-accent)]" />Amend
      </label>
      <div class="flex-1" />
      <button
        type="button"
        class="flex h-7 items-center gap-1 rounded-md border border-line-strong px-2.5 text-[12px] text-fg hover:bg-hover"
        title="AI review of staged changes"
        @click="ui.notWired('AI review')"
      >
        <ScanSearch :size="13" />Review
      </button>
      <button
        type="button"
        :disabled="!canCommit"
        class="flex h-7 items-center gap-1 rounded-md bg-accent px-3 text-[12px] font-semibold text-[#0b0e14] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
        @click="ui.notWired(amend ? 'Amend commit' : `Commit ${stagedCount} files`)"
      >
        <Check :size="13" />{{ amend ? 'Amend' : 'Commit' }}
      </button>
    </div>
  </div>
</template>
