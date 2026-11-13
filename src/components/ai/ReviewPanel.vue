<script setup lang="ts">
import { computed } from 'vue'
import { AlertOctagon, Bug, KeyRound, Lightbulb, Loader2, RotateCw, ScanSearch, Terminal, TriangleAlert } from '@/lib/icons'
import PanelShell from './PanelShell.vue'
import { useAiStore } from '@/stores/ai'
import { useUiStore } from '@/stores/ui'
import type { ReviewComment, Severity } from '@/ai/prompts'

const ai = useAiStore()
const ui = useUiStore()
const r = computed(() => ai.review)

const meta: Record<Severity, { label: string; icon: unknown; cls: string }> = {
  bug: { label: 'Bug', icon: Bug, cls: 'bg-danger/15 text-danger' },
  secret: { label: 'Secret', icon: KeyRound, cls: 'bg-danger/15 text-danger' },
  debug: { label: 'Debug', icon: Terminal, cls: 'bg-warning/15 text-warning' },
  warning: { label: 'Warning', icon: TriangleAlert, cls: 'bg-warning/15 text-warning' },
  suggestion: { label: 'Suggestion', icon: Lightbulb, cls: 'bg-accent/15 text-accent' },
}

const byFile = computed(() => {
  const m = new Map<string, ReviewComment[]>()
  for (const c of r.value.comments) m.set(c.file, [...(m.get(c.file) ?? []), c])
  return [...m]
})
const omitted = computed(() => r.value.files.filter((f) => f.omitted || f.truncated || f.redactions))

const target = computed(() => (r.value.commit ? `commit ${r.value.commit.hash.slice(0, 7)}` : 'staged changes'))

function open(c: ReviewComment) {
  const commit = r.value.commit
  if (commit) ui.openDiff({ path: c.file, source: 'commit', commit: commit.hash, parent: commit.parent, line: c.line || undefined })
  else ui.openDiff({ path: c.file, source: 'staged', line: c.line || undefined })
}
</script>

<template>
  <PanelShell title="AI review" :icon="ScanSearch" :subtitle="r.status === 'done' ? `${target} · ${r.comments.length} comments · ${r.model}` : target">
    <template #actions>
      <button
        type="button" :disabled="r.status === 'running'"
        class="flex h-7 shrink-0 items-center whitespace-nowrap gap-1 rounded-md border border-line-strong px-2 text-[12px] hover:bg-hover disabled:opacity-40"
        @click="ai.runReview(null, true)"
      ><RotateCw :size="12" />Review again</button>
    </template>

    <div v-if="r.status === 'running'" class="flex flex-col items-center gap-2 p-12 text-[13px] text-muted">
      <Loader2 :size="22" class="animate-spin text-accent-2" />{{ ai.progress ?? 'Reviewing…' }}
    </div>

    <div v-else-if="r.status === 'error'" class="m-4 flex gap-2 rounded-md border border-danger/30 bg-danger/10 p-3 text-[13px] text-danger select-text">
      <AlertOctagon :size="17" class="shrink-0" />{{ r.error }}
    </div>

    <div v-else-if="r.status === 'done'" class="space-y-4 p-4">
      <div class="rounded-lg border border-line bg-surface p-3 text-[13px] leading-relaxed text-fg select-text">{{ r.summary || 'Review complete.' }}</div>
      <div v-if="!r.comments.length" class="text-center text-[13px] text-success">No problems found in the {{ r.commit ? 'commit' : 'staged changes' }}.</div>

      <div v-for="[file, comments] in byFile" :key="file" class="overflow-hidden rounded-lg border border-line">
        <div class="border-b border-line bg-surface px-3 py-1.5 font-mono text-[13px] text-fg">{{ file }}</div>
        <button
          v-for="(c, i) in comments" :key="i" type="button"
          class="flex w-full items-start gap-2 border-b border-line px-3 py-2 text-left text-[13px] last:border-b-0 hover:bg-surface-2"
          :title="c.line ? `Open the diff at line ${c.line}` : 'Open the diff'"
          @click="open(c)"
        >
          <span class="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold" :class="meta[c.severity].cls">
            <component :is="meta[c.severity].icon" :size="11" />{{ meta[c.severity].label }}
          </span>
          <span class="w-12 shrink-0 pt-0.5 font-mono text-[12px] text-faint">{{ c.line ? `L${c.line}` : '—' }}</span>
          <span class="flex-1 leading-relaxed text-fg select-text">{{ c.message }}</span>
        </button>
      </div>

      <div v-if="omitted.length" class="text-[12px] text-faint">
        Not fully reviewed:
        <span v-for="f in omitted" :key="f.path" class="mr-2 font-mono">{{ f.path }} ({{ f.omitted ?? (f.truncated ? 'truncated' : `${f.redactions} redacted`) }})</span>
      </div>
      <p class="text-[12px] text-faint">AI review can miss things or be wrong — treat it as a second pair of eyes, not a gate.</p>
    </div>
  </PanelShell>
</template>
