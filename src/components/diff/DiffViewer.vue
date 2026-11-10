<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Columns2, FileCode2, Minus, Plus, Rows3, X } from 'lucide-vue-next'
import { useUiStore } from '@/stores/ui'
import { mockDiff } from '@/mock/data'
import { languageFromPath } from '@/lib/format'
import { highlightLine } from '@/lib/highlight'
import { toSplitRows } from '@/lib/diff-split'
import type { DiffLine } from '@/types/git'

const ui = useUiStore()

const diff = computed(() => {
  const d = mockDiff(ui.diffPath ?? '')
  return { ...d, language: languageFromPath(d.path) === 'plaintext' ? 'typescript' : languageFromPath(d.path) }
})

const selected = ref(new Set<string>())
let anchor: { hunk: number; line: number } | null = null
watch(() => [ui.diffPath, ui.diffSource], () => (selected.value = new Set()))

const canStage = computed(() => ui.diffSource !== 'commit')
const stageVerb = computed(() => (ui.diffSource === 'staged' ? 'Unstage' : 'Stage'))
const sourceLabel = computed(() => ({ unstaged: 'Unstaged', staged: 'Staged', commit: 'Commit' })[ui.diffSource])

const html = computed(() => diff.value.hunks.map((h) => h.lines.map((l) => highlightLine(l.text, diff.value.language))))
const splitRows = computed(() => diff.value.hunks.map((h) => toSplitRows(h.lines)))

const key = (hunk: number, line: number) => `${hunk}:${line}`

function toggleLine(e: MouseEvent, hunk: number, line: number, l: DiffLine) {
  if (!canStage.value || l.kind === 'context') return
  const next = new Set(selected.value)
  if (e.shiftKey && anchor && anchor.hunk === hunk) {
    const [a, b] = [Math.min(anchor.line, line), Math.max(anchor.line, line)]
    for (let i = a; i <= b; i++) if (diff.value.hunks[hunk].lines[i].kind !== 'context') next.add(key(hunk, i))
  } else {
    const k = key(hunk, line)
    if (next.has(k)) next.delete(k)
    else next.add(k)
    anchor = { hunk, line }
  }
  selected.value = next
}

const lineClass = (l: DiffLine, sel: boolean) => {
  if (l.kind === 'add') return sel ? 'bg-[var(--gw-add-strong)]' : 'bg-[var(--gw-add-bg)]'
  if (l.kind === 'del') return sel ? 'bg-[var(--gw-del-strong)]' : 'bg-[var(--gw-del-bg)]'
  return ''
}
const sign = (l: DiffLine) => (l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ' ')
const signColor = (l: DiffLine) => (l.kind === 'add' ? 'text-success' : l.kind === 'del' ? 'text-danger' : 'text-faint')
</script>

<template>
  <div class="flex h-full min-w-0 flex-col bg-bg">
    <div class="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
      <FileCode2 :size="14" class="text-accent" />
      <span class="truncate font-mono text-[12px] text-fg">{{ diff.path }}</span>
      <span class="rounded bg-surface-3 px-1.5 py-0.5 text-[10px] text-muted">{{ sourceLabel }}</span>
      <div class="flex-1" />
      <button
        v-if="selected.size > 0"
        type="button"
        class="flex h-6 items-center gap-1 rounded-md bg-accent px-2 text-[11px] font-semibold text-[#0b0e14] hover:brightness-110"
        @click="ui.notWired(`${stageVerb} ${selected.size} selected lines`); selected = new Set()"
      >
        <component :is="ui.diffSource === 'staged' ? Minus : Plus" :size="12" />{{ stageVerb }} {{ selected.size }} lines
      </button>
      <div class="flex rounded-md border border-line p-0.5">
        <button
          type="button" class="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px]"
          :class="ui.diffMode === 'unified' ? 'bg-surface-3 text-fg' : 'text-faint hover:text-fg'"
          @click="ui.diffMode = 'unified'"
        ><Rows3 :size="12" />Unified</button>
        <button
          type="button" class="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px]"
          :class="ui.diffMode === 'split' ? 'bg-surface-3 text-fg' : 'text-faint hover:text-fg'"
          @click="ui.diffMode = 'split'"
        ><Columns2 :size="12" />Split</button>
      </div>
      <button type="button" class="rounded p-1 text-faint hover:bg-hover hover:text-fg" title="Close diff (Esc)" @click="ui.closeDiff()">
        <X :size="14" />
      </button>
    </div>

    <div class="min-h-0 flex-1 overflow-auto font-mono text-[12px] leading-[20px]">
      <div v-for="(hunk, hi) in diff.hunks" :key="hi" class="mb-3">
        <div class="sticky top-0 z-10 flex items-center gap-2 border-y border-line bg-surface-2 px-3 py-1 text-[11px] text-accent/80">
          <span class="truncate">{{ hunk.header }}</span>
          <div class="flex-1" />
          <button
            v-if="canStage"
            type="button"
            class="flex items-center gap-1 rounded border border-line-strong px-1.5 py-0.5 font-sans text-[11px] text-fg hover:border-accent/60 hover:bg-accent/10"
            @click="ui.notWired(`${stageVerb} hunk ${hi + 1}`)"
          >
            <component :is="ui.diffSource === 'staged' ? Minus : Plus" :size="11" />{{ stageVerb }} hunk
          </button>
        </div>

        <template v-if="ui.diffMode === 'unified'">
          <div
            v-for="(l, li) in hunk.lines" :key="li"
            class="flex min-w-max" :class="lineClass(l, selected.has(key(hi, li)))"
          >
            <span
              class="w-10 shrink-0 pr-2 text-right text-faint select-none"
              :class="canStage && l.kind !== 'context' ? 'cursor-pointer hover:bg-accent/20' : ''"
              :title="canStage && l.kind !== 'context' ? 'Click to select line (shift-click for range)' : undefined"
              @click="toggleLine($event, hi, li, l)"
            >{{ l.oldNo ?? '' }}</span>
            <span
              class="w-10 shrink-0 pr-2 text-right text-faint select-none"
              :class="canStage && l.kind !== 'context' ? 'cursor-pointer hover:bg-accent/20' : ''"
              @click="toggleLine($event, hi, li, l)"
            >{{ l.newNo ?? '' }}</span>
            <span class="w-5 shrink-0 text-center select-none" :class="signColor(l)">{{ sign(l) }}</span>
            <!-- eslint-disable-next-line vue/no-v-html -->
            <span class="pr-6 whitespace-pre text-fg select-text" v-html="html[hi][li] || ' '" />
          </div>
        </template>

        <template v-else>
          <div v-for="(row, ri) in splitRows[hi]" :key="ri" class="grid grid-cols-2">
            <div
              v-for="side in (['left', 'right'] as const)" :key="side"
              class="flex min-w-0 overflow-hidden"
              :class="[row[side] ? lineClass(row[side]!, selected.has(key(hi, row[side]!.index))) : 'bg-surface/40', side === 'left' ? 'border-r border-line' : '']"
            >
              <template v-if="row[side]">
                <span
                  class="w-10 shrink-0 pr-2 text-right text-faint select-none"
                  :class="canStage && row[side]!.kind !== 'context' ? 'cursor-pointer hover:bg-accent/20' : ''"
                  @click="toggleLine($event, hi, row[side]!.index, row[side]!)"
                >{{ side === 'left' ? row[side]!.oldNo : row[side]!.newNo }}</span>
                <span class="w-5 shrink-0 text-center select-none" :class="signColor(row[side]!)">{{ sign(row[side]!) }}</span>
                <!-- eslint-disable-next-line vue/no-v-html -->
                <span class="truncate pr-4 whitespace-pre text-fg select-text" v-html="html[hi][row[side]!.index] || ' '" />
              </template>
            </div>
          </div>
        </template>
      </div>
      <div v-if="canStage" class="px-3 pb-4 font-sans text-[11px] text-faint">
        Tip: click a line number to select lines (shift-click for a range), then {{ stageVerb.toLowerCase() }} only those lines.
      </div>
    </div>
  </div>
</template>
