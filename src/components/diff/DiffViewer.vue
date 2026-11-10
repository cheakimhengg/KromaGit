<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import { Columns2, FileCode2, Loader2, Minus, Plus, Rows3, Undo2, X } from 'lucide-vue-next'
import { useUiStore } from '@/stores/ui'
import { useReposStore } from '@/stores/repos'
import { errorMessage, gitApi } from '@/api/git'
import { languageFromPath } from '@/lib/format'
import { highlightLine } from '@/lib/highlight'
import { toSplitRows } from '@/lib/diff-split'
import type { DiffLine, DiffTarget, FileDiff, HunkSelection } from '@/types/git'
import { useOpsStore } from '@/stores/ops'
import * as git from '@/actions/git'

const props = defineProps<{ target: DiffTarget }>()
const ui = useUiStore()
const repos = useReposStore()
const ops = useOpsStore()

const diff = shallowRef<FileDiff | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const selected = ref(new Set<string>())
let anchor: { hunk: number; line: number } | null = null

watch(
  () => [props.target, repos.activeTab?.path, props.target.source === 'commit' ? null : repos.active?.snapshot.workingCopy] as const,
  async ([target, path], old, onCleanup) => {
    let cancelled = false
    onCleanup(() => (cancelled = true))
    if (!old || old[0] !== target) selected.value = new Set()
    loading.value = true
    error.value = null
    try {
      const d = await gitApi.getFileDiff(path ?? '', target)
      if (!cancelled) {
        diff.value = d
        if (target.line && (!old || old[0] !== target)) void focusLine(target.line)
      }
    } catch (e) {
      if (!cancelled) {
        diff.value = null
        error.value = errorMessage(e)
      }
    } finally {
      if (!cancelled) loading.value = false
    }
  },
  { immediate: true },
)

const scroller = ref<HTMLElement | null>(null)
const focused = ref<number | null>(null)

async function focusLine(line: number) {
  ui.diffMode = 'unified'
  focused.value = line
  await nextTick()
  const el = scroller.value?.querySelector(`[data-new="${line}"]`) ?? scroller.value?.querySelector(`[data-near="${line}"]`)
  el?.scrollIntoView({ block: 'center' })
}

const language = computed(() => languageFromPath(props.target.path))
const canStage = computed(() => props.target.source !== 'commit' && !props.target.untracked && !props.target.oldPath)
const stageVerb = computed(() => (props.target.source === 'staged' ? 'Unstage' : 'Stage'))
const canDiscard = computed(() => props.target.source === 'unstaged')
const busy = computed(() => !!ops.running)
const fileEntry = computed(() => {
  const wc = repos.active?.snapshot.workingCopy
  if (!wc || props.target.source === 'commit') return null
  const list = props.target.source === 'staged' ? wc.staged : wc.unstaged
  return list.find((f) => f.path === props.target.path) ?? null
})

function selectionFromLines(): HunkSelection[] {
  const byHunk = new Map<number, number[]>()
  for (const k of selected.value) {
    const [h, l] = k.split(':').map(Number)
    if (!byHunk.has(h)) byHunk.set(h, [])
    byHunk.get(h)!.push(l)
  }
  return [...byHunk].map(([h, lines]) => ({ header: hunks.value[h].header, lines: lines.sort((a, b) => a - b) }))
}

async function applyLines(mode: 'stage' | 'unstage' | 'discard') {
  const sel = selectionFromLines()
  if (!sel.length) return
  const res = await git.applySelection(props.target, sel, mode)
  if (res) selected.value = new Set()
}

function applyHunk(index: number, mode: 'stage' | 'unstage' | 'discard') {
  return git.applySelection(props.target, [{ header: hunks.value[index].header, lines: null }], mode)
}

function wholeFile(mode: 'stage' | 'unstage' | 'discard') {
  const f = fileEntry.value
  if (!f) return
  if (mode === 'stage') return git.stage([f])
  if (mode === 'unstage') return git.unstage([f])
  return git.discard([f])
}
const sourceLabel = computed(() => {
  if (props.target.untracked) return 'Untracked'
  if (props.target.source === 'commit') return `Commit ${props.target.commit?.slice(0, 7) ?? ''}`
  return props.target.source === 'staged' ? 'Staged' : 'Unstaged'
})

const hunks = computed(() => diff.value?.hunks ?? [])
const html = computed(() => hunks.value.map((h) => h.lines.map((l) => highlightLine(l.text, language.value))))
const splitRows = computed(() => hunks.value.map((h) => toSplitRows(h.lines)))
const stats = computed(() => {
  let add = 0
  let del = 0
  for (const h of hunks.value) for (const l of h.lines) l.kind === 'add' ? add++ : l.kind === 'del' ? del++ : 0
  return { add, del }
})

const key = (hunk: number, line: number) => `${hunk}:${line}`

function toggleLine(e: MouseEvent, hunk: number, line: number, l: DiffLine) {
  if (!canStage.value || l.kind === 'context') return
  const next = new Set(selected.value)
  if (e.shiftKey && anchor && anchor.hunk === hunk) {
    const [a, b] = [Math.min(anchor.line, line), Math.max(anchor.line, line)]
    for (let i = a; i <= b; i++) if (hunks.value[hunk].lines[i].kind !== 'context') next.add(key(hunk, i))
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
      <FileCode2 :size="14" class="shrink-0 text-accent" />
      <span class="truncate font-mono text-[12px] text-fg" :title="target.oldPath ? `${target.oldPath} → ${target.path}` : target.path">
        <template v-if="target.oldPath"><span class="text-faint">{{ target.oldPath }} → </span></template>{{ target.path }}
      </span>
      <span class="shrink-0 rounded bg-surface-3 px-1.5 py-0.5 text-[10px] text-muted">{{ sourceLabel }}</span>
      <span v-if="diff && !loading" class="shrink-0 font-mono text-[11px]">
        <span class="text-success">+{{ stats.add }}</span> <span class="text-danger">−{{ stats.del }}</span>
      </span>
      <Loader2 v-if="loading" :size="13" class="animate-spin text-faint" />
      <div class="flex-1" />
      <template v-if="selected.size > 0">
        <button
          v-if="canDiscard"
          type="button" :disabled="busy"
          class="flex h-6 items-center gap-1 rounded-md border border-danger/40 px-2 text-[11px] text-danger hover:bg-danger/10 disabled:opacity-40"
          @click="applyLines('discard')"
        >
          <Undo2 :size="12" />Discard {{ selected.size }}
        </button>
        <button
          type="button" :disabled="busy"
          class="flex h-6 items-center gap-1 rounded-md bg-accent px-2 text-[11px] font-semibold text-on-accent hover:brightness-110 disabled:opacity-40"
          @click="applyLines(target.source === 'staged' ? 'unstage' : 'stage')"
        >
          <component :is="target.source === 'staged' ? Minus : Plus" :size="12" />{{ stageVerb }} {{ selected.size }} {{ selected.size === 1 ? 'line' : 'lines' }}
        </button>
      </template>
      <template v-else-if="fileEntry">
        <button
          v-if="canDiscard"
          type="button" :disabled="busy"
          class="flex h-6 items-center gap-1 rounded-md px-2 text-[11px] text-danger/90 hover:bg-danger/10 disabled:opacity-40"
          title="Discard all changes to this file"
          @click="wholeFile('discard')"
        ><Undo2 :size="12" />Discard file</button>
        <button
          type="button" :disabled="busy"
          class="flex h-6 items-center gap-1 rounded-md border border-line-strong px-2 text-[11px] text-fg hover:border-accent/60 hover:bg-accent/10 disabled:opacity-40"
          @click="wholeFile(target.source === 'staged' ? 'unstage' : 'stage')"
        >
          <component :is="target.source === 'staged' ? Minus : Plus" :size="12" />{{ stageVerb }} file
        </button>
      </template>
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

    <div v-if="error" class="m-4 rounded-md border border-danger/30 bg-danger/10 p-3 text-[12px] text-danger select-text">{{ error }}</div>
    <div v-else-if="diff?.binary" class="p-8 text-center text-[12px] text-muted">Binary file — no text diff to show.</div>
    <div v-else-if="diff && !hunks.length && !loading" class="p-8 text-center text-[12px] text-muted">
      <template v-if="target.source !== 'commit' && !fileEntry">No {{ target.source }} changes left in this file.</template>
      <template v-else>No content changes{{ target.oldPath ? ' (pure rename)' : '' }}.</template>
    </div>

    <div v-else ref="scroller" class="min-h-0 flex-1 overflow-auto font-mono text-[12px] leading-[20px]" :class="{ 'opacity-60': loading }">
      <div v-if="diff?.truncated" class="border-b border-warning/30 bg-warning/10 px-3 py-1.5 font-sans text-[11px] text-warning">
        Diff is very large; showing the first 20,000 lines.
      </div>
      <div v-for="(hunk, hi) in hunks" :key="hi" class="mb-3">
        <div class="sticky top-0 z-10 flex items-center gap-2 border-y border-line bg-surface-2 px-3 py-1 text-[11px] text-accent/80">
          <span class="truncate">{{ hunk.header }}</span>
          <div class="flex-1" />
          <template v-if="canStage">
            <button
              v-if="canDiscard"
              type="button" :disabled="busy"
              class="flex items-center gap-1 rounded px-1.5 py-0.5 font-sans text-[11px] text-danger/90 hover:bg-danger/10 disabled:opacity-40"
              @click="applyHunk(hi, 'discard')"
            >
              <Undo2 :size="11" />Discard hunk
            </button>
            <button
              type="button" :disabled="busy"
              class="flex items-center gap-1 rounded border border-line-strong px-1.5 py-0.5 font-sans text-[11px] text-fg hover:border-accent/60 hover:bg-accent/10 disabled:opacity-40"
              @click="applyHunk(hi, target.source === 'staged' ? 'unstage' : 'stage')"
            >
              <component :is="target.source === 'staged' ? Minus : Plus" :size="11" />{{ stageVerb }} hunk
            </button>
          </template>
        </div>

        <template v-if="ui.diffMode === 'unified'">
          <div
            v-for="(l, li) in hunk.lines" :key="li"
            class="flex min-w-max" :class="[lineClass(l, selected.has(key(hi, li))), focused !== null && l.newNo === focused ? 'ring-1 ring-accent-2 ring-inset' : '']"
            :data-new="l.newNo" :data-near="l.oldNo"
          >
            <span
              class="w-12 shrink-0 pr-2 text-right text-faint select-none"
              :class="canStage && l.kind !== 'context' ? 'cursor-pointer hover:bg-accent/20' : ''"
              :title="canStage && l.kind !== 'context' ? 'Click to select line (shift-click for range)' : undefined"
              @click="toggleLine($event, hi, li, l)"
            >{{ l.oldNo ?? '' }}</span>
            <span
              class="w-12 shrink-0 pr-2 text-right text-faint select-none"
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
                  class="w-12 shrink-0 pr-2 text-right text-faint select-none"
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
      <div v-if="canStage && hunks.length" class="px-3 pb-4 font-sans text-[11px] text-faint">
        Tip: click a line number to select lines (shift-click for a range), then {{ stageVerb.toLowerCase() }} only those lines.
      </div>
    </div>
  </div>
</template>
