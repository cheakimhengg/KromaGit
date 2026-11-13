<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import { ArrowDown, ArrowUp, ChevronRight, Clock, Columns2, Copy, FileView, Files, Info, Loader2, SlidersHorizontal, Space, TextFont, TextWrap, Check, Minus, Plus, Rows3, Undo2, User, X } from '@/lib/icons'
import { useUiStore } from '@/stores/ui'
import { useReposStore } from '@/stores/repos'
import { errorMessage, gitApi } from '@/api/git'
import { isImagePath, languageFromPath } from '@/lib/format'
import ImageDiff from './ImageDiff.vue'
import { wordDiffHtml } from '@/lib/word-diff'
import FileHistory from './FileHistory.vue'
import BlameView from './BlameView.vue'
import { highlightLine } from '@/lib/highlight'
import { toSplitRows } from '@/lib/diff-split'
import type { DiffLine, DiffTarget, FileChange, FileDiff, FileHistoryEntry, HunkSelection } from '@/types/git'
import { useOpsStore } from '@/stores/ops'
import * as git from '@/actions/git'

const props = defineProps<{ target: DiffTarget }>()
const ui = useUiStore()
const repos = useReposStore()
const ops = useOpsStore()

const diff = shallowRef<FileDiff | null>(null)
/** a commit picked in the History list replaces the opened target until another file is opened */
const histTarget = shallowRef<DiffTarget | null>(null)
watch(() => props.target, () => (histTarget.value = null))
const tgt = computed<DiffTarget>(() => histTarget.value ?? props.target)
const isImage = computed(() => isImagePath(tgt.value.path))
const loading = ref(false)
const error = ref<string | null>(null)
const selected = ref(new Set<string>())
let anchor: { hunk: number; line: number } | null = null

watch(
  () => [tgt.value, repos.activeTab?.path, tgt.value.source === 'commit' ? null : repos.active?.snapshot.workingCopy, ui.diffOptions.ignoreWhitespace, ui.diffOptions.fullFile] as const,
  async ([target, path], old, onCleanup) => {
    let cancelled = false
    onCleanup(() => (cancelled = true))
    if (!old || old[0] !== target) selected.value = new Set()
    loading.value = true
    error.value = null
    try {
      const d = await gitApi.getFileDiff(path ?? '', target, { ignoreWhitespace: ui.diffOptions.ignoreWhitespace, fullFile: ui.diffOptions.fullFile })
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

const language = computed(() => languageFromPath(tgt.value.path))
const displayOnly = computed(() => ui.diffOptions.ignoreWhitespace || ui.diffOptions.fullFile)
const canStage = computed(() => tgt.value.source !== 'commit' && !tgt.value.untracked && !tgt.value.oldPath && !displayOnly.value)
const stageVerb = computed(() => (tgt.value.source === 'staged' ? 'Unstage' : 'Stage'))
const canDiscard = computed(() => tgt.value.source === 'unstaged')
const busy = computed(() => !!ops.running)
const fileEntry = computed(() => {
  const wc = repos.active?.snapshot.workingCopy
  if (!wc || tgt.value.source === 'commit') return null
  const list = tgt.value.source === 'staged' ? wc.staged : wc.unstaged
  return list.find((f) => f.path === tgt.value.path) ?? null
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
  const res = await git.applySelection(tgt.value, sel, mode)
  if (res) selected.value = new Set()
}

function applyHunk(index: number, mode: 'stage' | 'unstage' | 'discard') {
  return git.applySelection(tgt.value, [{ header: hunks.value[index].header, lines: null }], mode)
}

function wholeFile(mode: 'stage' | 'unstage' | 'discard') {
  const f = fileEntry.value
  if (!f) return
  if (mode === 'stage') return git.stage([f])
  if (mode === 'unstage') return git.unstage([f])
  return git.discard([f])
}
// ---------- view switch, change and file navigation ----------

const repoPath = computed(() => repos.activeTab?.path ?? '')
const view = computed({ get: () => ui.diffView, set: (v) => (ui.diffView = v) })

/** Contiguous runs of changed rows across all hunks, in display order (inline or split). */
interface ChangeBlock {
  row: number
  len: number
  kind: 'add' | 'del' | 'mod'
}
const rowOffsets = computed(() => {
  const out: number[] = []
  let n = 0
  hunks.value.forEach((h, hi) => {
    n += 1
    out.push(n)
    n += ui.diffMode === 'split' ? splitRows.value[hi].length : h.lines.length
  })
  return { offsets: out, total: Math.max(n, 1) }
})
const rowIndex = (hi: number, i: number) => rowOffsets.value.offsets[hi] + i
const changeBlocks = computed<ChangeBlock[]>(() => {
  const out: ChangeBlock[] = []
  hunks.value.forEach((h, hi) => {
    const kinds: (string | null)[] =
      ui.diffMode === 'split'
        ? splitRows.value[hi].map((row) => {
            const a = row.right?.kind === 'add'
            const d = row.left?.kind === 'del'
            return a && d ? 'mod' : a ? 'add' : d ? 'del' : null
          })
        : h.lines.map((l) => (l.kind === 'context' ? null : l.kind))
    let cur: ChangeBlock | null = null
    kinds.forEach((k, i) => {
      if (!k) {
        cur = null
        return
      }
      if (cur) {
        cur.len++
        if (cur.kind !== k) cur.kind = 'mod'
      } else {
        cur = { row: rowIndex(hi, i), len: 1, kind: k as ChangeBlock['kind'] }
        out.push(cur)
      }
    })
  })
  return out
})
const currentChange = ref(0)
watch(tgt, () => (currentChange.value = 0))
function jumpToRow(row: number) {
  scroller.value?.querySelector(`[data-row="${row}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
}
async function goChange(delta: number) {
  const n = changeBlocks.value.length
  if (!n) return
  currentChange.value = (currentChange.value + delta + n) % n
  await nextTick()
  jumpToRow(changeBlocks.value[currentChange.value].row)
}
function jumpToBlock(i: number) {
  currentChange.value = i
  jumpToRow(changeBlocks.value[i].row)
}
const RULER_COLOR = { add: 'var(--gw-success)', del: 'var(--gw-danger)', mod: 'var(--gw-accent)' }

const commitFiles = shallowRef<{ hash: string; files: FileChange[]; parent?: string } | null>(null)
watch(
  () => [tgt.value.source, tgt.value.commit, repoPath.value] as const,
  async ([source, commit, path]) => {
    if (source !== 'commit' || !commit) return
    if (commitFiles.value?.hash === commit) return
    try {
      const d = await gitApi.getCommitDetails(path, commit)
      commitFiles.value = { hash: commit, files: d.files, parent: d.parents[0] }
    } catch {
      commitFiles.value = null
    }
  },
  { immediate: true },
)
const fileList = computed<FileChange[]>(() => {
  const t = tgt.value
  const cf = commitFiles.value
  if (t.source === 'commit') return cf && cf.hash === t.commit ? cf.files : []
  const wc = repos.active?.snapshot.workingCopy
  return (t.source === 'staged' ? wc?.staged : wc?.unstaged) ?? []
})
const fileIndex = computed(() => fileList.value.findIndex((f) => f.path === tgt.value.path))
function goFile(delta: number) {
  const list = fileList.value
  if (list.length < 2) return
  const i = fileIndex.value < 0 ? 0 : (fileIndex.value + delta + list.length) % list.length
  const f = list[i]
  const t = tgt.value
  if (t.source === 'commit') ui.openDiff({ path: f.path, oldPath: f.oldPath, source: 'commit', commit: t.commit, parent: t.parent })
  else ui.openDiff({ path: f.path, oldPath: f.oldPath, source: t.source, untracked: f.status === '?' })
}

const dirName = computed(() => {
  const i = tgt.value.path.lastIndexOf('/')
  return i < 0 ? '' : tgt.value.path.slice(0, i + 1)
})
const baseName = computed(() => tgt.value.path.slice(tgt.value.path.lastIndexOf('/') + 1))

function copyPath() {
  void navigator.clipboard?.writeText(tgt.value.path)
  ui.toast({ kind: 'success', title: 'Path copied', detail: tgt.value.path }, 1600)
}

const historyKey = computed(() => (tgt.value.source === 'commit' ? tgt.value.commit ?? '' : 'working'))
function pickHistory(e: FileHistoryEntry | null) {
  if (!e) {
    histTarget.value = props.target.source === 'commit' ? { path: props.target.path, source: 'unstaged' } : null
    return
  }
  histTarget.value = { path: e.path, source: 'commit', commit: e.commit.hash, parent: e.commit.parents[0] }
}

const blameRev = computed(() => (tgt.value.source === 'commit' ? tgt.value.commit : undefined))

const sourceLabel = computed(() => {
  if (tgt.value.untracked) return 'Untracked'
  if (tgt.value.source === 'commit') return `Commit ${tgt.value.commit?.slice(0, 7) ?? ''}`
  return tgt.value.source === 'staged' ? 'Staged' : 'Unstaged'
})

const hunks = computed(() => diff.value?.hunks ?? [])
const html = computed(() => hunks.value.map((h) => h.lines.map((l) => highlightLine(l.text, language.value))))
const wordHtml = computed(() => (ui.diffOptions.wordDiff ? hunks.value.map((h) => wordDiffHtml(h.lines)) : null))
const lineHtml = (hi: number, li: number) => wordHtml.value?.[hi]?.get(li) ?? html.value[hi][li]
const optionsOpen = ref(false)
const OPTIONS = [
  { k: 'wordDiff', label: 'Word diff', icon: TextFont },
  { k: 'ignoreWhitespace', label: 'Ignore whitespace', icon: Space },
  { k: 'wrap', label: 'Wrap long lines', icon: TextWrap },
  { k: 'fullFile', label: 'Show whole file', icon: FileView },
] as const
function toggleView(v: 'history' | 'blame') {
  if (v === 'history') view.value = view.value === 'diff' ? 'history' : 'diff'
  else view.value = view.value === 'blame' ? 'history' : 'blame'
}
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
  <div class="relative flex h-full min-w-0 flex-col bg-bg">
    <div class="flex h-11 shrink-0 items-center gap-1 overflow-x-auto overflow-y-hidden border-b border-line px-2 [scrollbar-width:none]">
      <button type="button" class="tb-icon" title="Close (Esc)" @click="ui.closeDiff()"><X :size="16" /></button>
      <span class="min-w-[120px] flex-1 truncate font-mono text-[13px]" :title="tgt.oldPath ? `${tgt.oldPath} → ${tgt.path}` : tgt.path">
        <span v-if="tgt.oldPath" class="text-faint">{{ tgt.oldPath }} → </span><span class="text-muted">{{ dirName }}</span><span class="font-semibold text-fg">{{ baseName }}</span>
      </span>
      <button type="button" class="tb-icon" title="Copy path" @click="copyPath"><Copy :size="14" /></button>
      <span v-if="tgt.source === 'commit'" class="shrink-0 rounded-md bg-surface-2 px-1.5 font-mono text-[12px] leading-[22px] text-muted">{{ tgt.commit?.slice(0, 7) }}</span>
      <span v-else class="shrink-0 rounded-md bg-surface-2 px-1.5 text-[11px] leading-[22px] text-muted">{{ sourceLabel }}</span>
      <span v-if="diff && !loading && !isImage" class="shrink-0 px-1 font-mono text-[12px]">
        <span class="text-success">+{{ stats.add }}</span> <span class="text-danger">−{{ stats.del }}</span>
      </span>
      <Loader2 v-if="loading" :size="15" class="shrink-0 animate-spin text-faint" />

      <template v-if="view !== 'blame' && !isImage && selected.size > 0">
        <div class="tb-sep" />
        <button v-if="canDiscard" type="button" :disabled="busy" class="tb-btn text-danger hover:bg-danger/10" @click="applyLines('discard')"><Undo2 :size="14" />Discard {{ selected.size }}</button>
        <button type="button" :disabled="busy" class="tb-btn bg-accent font-semibold text-on-accent hover:brightness-110" @click="applyLines(tgt.source === 'staged' ? 'unstage' : 'stage')">
          <component :is="tgt.source === 'staged' ? Minus : Plus" :size="14" />{{ stageVerb }} {{ selected.size }} {{ selected.size === 1 ? 'line' : 'lines' }}
        </button>
      </template>
      <template v-else-if="view !== 'blame' && fileEntry">
        <div class="tb-sep" />
        <button v-if="canDiscard" type="button" :disabled="busy" class="tb-btn text-muted hover:bg-danger/10 hover:text-danger" title="Discard all changes to this file" @click="wholeFile('discard')"><Undo2 :size="14" />Discard</button>
        <button type="button" :disabled="busy" class="tb-btn text-fg hover:bg-accent/10" @click="wholeFile(tgt.source === 'staged' ? 'unstage' : 'stage')">
          <component :is="tgt.source === 'staged' ? Minus : Plus" :size="14" />{{ stageVerb }} file
        </button>
      </template>

      <template v-if="view !== 'blame' && !isImage">
        <div class="tb-sep" />
        <button type="button" class="tb-icon" :class="{ on: !ui.diffOptions.fullFile }" title="Changes only" @click="ui.diffOptions.fullFile = false"><Files :size="15" /></button>
        <button type="button" class="tb-icon" :class="{ on: ui.diffOptions.fullFile }" title="Whole file" @click="ui.diffOptions.fullFile = true"><FileView :size="15" /></button>
        <div class="tb-sep" />
        <button type="button" class="tb-btn" :class="ui.diffMode === 'unified' ? 'bg-surface-3 text-fg' : 'text-muted hover:text-fg'" title="Inline diff" @click="ui.diffMode = 'unified'"><Rows3 :size="14" />Inline</button>
        <button type="button" class="tb-btn" :class="ui.diffMode === 'split' ? 'bg-surface-3 text-fg' : 'text-muted hover:text-fg'" title="Side-by-side diff" @click="ui.diffMode = 'split'"><Columns2 :size="14" />Split</button>
        <div class="relative">
          <button type="button" class="tb-icon" :class="{ on: optionsOpen }" title="View options" @click="optionsOpen = !optionsOpen"><SlidersHorizontal :size="15" /></button>
        </div>
      </template>

      <div class="tb-sep" />
      <button type="button" class="tb-btn" :class="view !== 'diff' ? 'bg-surface-3 text-fg' : 'text-muted hover:text-fg'" title="Every commit that changed this file" @click="toggleView('history')"><Clock :size="14" />History</button>
      <button v-if="!isImage" type="button" class="tb-btn" :class="view === 'blame' ? 'bg-surface-3 text-fg' : 'text-muted hover:text-fg'" title="Who last changed each line" @click="toggleView('blame')"><User :size="14" />Blame</button>

      <template v-if="view !== 'blame' && !isImage && changeBlocks.length">
        <div class="tb-sep" />
        <button type="button" class="tb-icon" title="Previous change" :disabled="changeBlocks.length < 2" @click="goChange(-1)"><ArrowUp :size="14" /></button>
        <button type="button" class="tb-icon" title="Next change" :disabled="changeBlocks.length < 2" @click="goChange(1)"><ArrowDown :size="14" /></button>
        <span class="shrink-0 text-[12px] whitespace-nowrap text-faint">{{ currentChange + 1 }} of {{ changeBlocks.length }} {{ changeBlocks.length === 1 ? 'change' : 'changes' }}</span>
      </template>
      <template v-if="fileList.length > 1 && view === 'diff'">
        <div class="tb-sep" />
        <button type="button" class="tb-icon" title="Previous file" @click="goFile(-1)"><ChevronRight :size="15" class="rotate-180" /></button>
        <span class="shrink-0 text-[12px] whitespace-nowrap text-faint">{{ fileIndex + 1 }} of {{ fileList.length }}</span>
        <button type="button" class="tb-icon" title="Next file" @click="goFile(1)"><ChevronRight :size="15" /></button>
      </template>
    </div>

    <div v-if="optionsOpen" class="fixed inset-0 z-40" @mousedown="optionsOpen = false" />
    <div v-if="optionsOpen" class="absolute right-48 z-50 mt-12 w-[260px] rounded-xl border border-line-strong bg-surface-2 p-1.5 shadow-2xl shadow-black/40">
      <div class="px-2.5 pt-1 pb-1.5 text-[12px] font-semibold text-muted">View options</div>
      <button
        v-for="o in OPTIONS" :key="o.k" type="button"
        class="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] text-fg hover:bg-hover"
        @click="ui.diffOptions[o.k] = !ui.diffOptions[o.k]"
      >
        <component :is="o.icon" :size="16" class="text-muted" />
        <span class="flex-1">{{ o.label }}</span>
        <Check v-if="ui.diffOptions[o.k]" :size="15" :stroke-width="2.25" class="text-accent" />
      </button>
      <div v-if="displayOnly && tgt.source !== 'commit'" class="mt-1 flex gap-2 rounded-md bg-surface px-2.5 py-2 text-[12px] leading-snug text-muted">
        <Info :size="14" class="mt-0.5 shrink-0" />Staging is off: these hunks are not the patch git would apply.
      </div>
    </div>

        <div class="flex min-h-0 flex-1">
    <FileHistory v-if="view !== 'diff'" :repo="repoPath" :path="props.target.path" :selected="historyKey" @open="pickHistory" />
    <div class="flex min-w-0 flex-1 flex-col">
    <BlameView v-if="view === 'blame' && !isImage" :repo="repoPath" :path="tgt.path" :rev="blameRev" @select="(h) => ui.selectCommit(h)" />
    <ImageDiff
      v-else-if="isImage"
      :repo="repos.activeTab?.path ?? ''"
      :target="tgt"
      :refresh-key="tgt.source === 'commit' ? null : repos.active?.snapshot.workingCopy"
    />
    <div v-else-if="error" class="m-4 rounded-md border border-danger/30 bg-danger/10 p-3 text-[13px] text-danger select-text">{{ error }}</div>
    <div v-else-if="diff?.binary" class="p-8 text-center text-[13px] text-muted">Binary file — no text diff to show.</div>
    <div v-else-if="diff && !hunks.length && !loading" class="p-8 text-center text-[13px] text-muted">
      <template v-if="tgt.source !== 'commit' && !fileEntry">No {{ tgt.source }} changes left in this file.</template>
      <template v-else>No content changes{{ tgt.oldPath ? ' (pure rename)' : '' }}.</template>
    </div>

    <div v-else class="relative flex min-h-0 flex-1">
    <div ref="scroller" class="min-h-0 flex-1 overflow-auto font-mono text-[13px] leading-[22px]" :class="{ 'opacity-60': loading }">
      <div v-if="diff?.truncated" class="border-b border-warning/30 bg-warning/10 px-3 py-1.5 font-sans text-[12px] text-warning">
        Diff is very large; showing the first 20,000 lines.
      </div>
      <div v-for="(hunk, hi) in hunks" :key="hi" class="mb-3 scroll-mt-1" :data-hunk="hi">
        <div class="sticky top-0 z-10 flex items-center gap-2 border-y border-line bg-surface-2 px-3 py-1 text-[12px] text-accent/80">
          <span class="min-w-0 truncate">{{ hunk.header }}</span>
          <div class="flex-1" />
          <template v-if="canStage">
            <button
              v-if="canDiscard"
              type="button" :disabled="busy"
              class="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 font-sans text-[12px] whitespace-nowrap text-danger/90 hover:bg-danger/10 disabled:opacity-40"
              @click="applyHunk(hi, 'discard')"
            >
              <Undo2 :size="12" />Discard hunk
            </button>
            <button
              type="button" :disabled="busy"
              class="flex shrink-0 items-center gap-1 rounded border border-line-strong px-1.5 py-0.5 font-sans text-[12px] whitespace-nowrap text-fg hover:border-accent/60 hover:bg-accent/10 disabled:opacity-40"
              @click="applyHunk(hi, tgt.source === 'staged' ? 'unstage' : 'stage')"
            >
              <component :is="tgt.source === 'staged' ? Minus : Plus" :size="12" />{{ stageVerb }} hunk
            </button>
          </template>
        </div>

        <template v-if="ui.diffMode === 'unified'">
          <div
            v-for="(l, li) in hunk.lines" :key="li"
            :data-row="rowIndex(hi, li)"
            class="flex" :data-kind="l.kind" :class="[ui.diffOptions.wrap ? '' : 'min-w-max', lineClass(l, selected.has(key(hi, li))), focused !== null && l.newNo === focused ? 'ring-1 ring-accent-2 ring-inset' : '']"
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
            <span class="pr-6 text-fg select-text" :class="ui.diffOptions.wrap ? 'min-w-0 break-all whitespace-pre-wrap' : 'whitespace-pre'" v-html="lineHtml(hi, li) || ' '" />
          </div>
        </template>

        <template v-else>
          <div v-for="(row, ri) in splitRows[hi]" :key="ri" class="grid grid-cols-2" :data-row="rowIndex(hi, ri)">
            <div
              v-for="side in (['left', 'right'] as const)" :key="side"
              class="flex min-w-0 overflow-hidden"
              :data-kind="row[side]?.kind"
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
                <span class="pr-4 text-fg select-text" :class="ui.diffOptions.wrap ? 'min-w-0 break-all whitespace-pre-wrap' : 'truncate whitespace-pre'" v-html="lineHtml(hi, row[side]!.index) || ' '" />
              </template>
            </div>
          </div>
        </template>
      </div>
      <div v-if="canStage && hunks.length" class="px-3 pb-4 font-sans text-[12px] text-faint">
        Tip: click a line number to select lines (shift-click for a range), then {{ stageVerb.toLowerCase() }} only those lines.
      </div>
    </div>
    <div v-if="changeBlocks.length" class="relative w-3 shrink-0 border-l border-line bg-surface/60" title="Change map — click to jump">
      <button
        v-for="(b, i) in changeBlocks" :key="i" type="button"
        class="absolute right-0.5 left-0.5 min-h-[3px] rounded-sm hover:brightness-125"
        :class="{ 'ring-1 ring-fg': i === currentChange }"
        :style="{ top: `${(b.row / rowOffsets.total) * 100}%`, height: `${Math.max((b.len / rowOffsets.total) * 100, 0.4)}%`, background: RULER_COLOR[b.kind] }"
        :title="`${b.kind === 'add' ? 'Added' : b.kind === 'del' ? 'Removed' : 'Changed'} · ${b.len} ${b.len === 1 ? 'line' : 'lines'}`"
        @click="jumpToBlock(i)"
      />
    </div>
    </div>
  </div>
    </div>
  </div>
</template>

<style scoped>
@reference '../../styles/main.css';
.tb-icon {
  @apply flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-faint hover:bg-hover hover:text-fg disabled:opacity-30;
}
.tb-icon.on {
  @apply bg-surface-3 text-fg;
}
:deep([data-kind='add'] .wd) {
  background: color-mix(in srgb, var(--gw-success) 32%, transparent);
  border-radius: 3px;
}
:deep([data-kind='del'] .wd) {
  background: color-mix(in srgb, var(--gw-danger) 32%, transparent);
  border-radius: 3px;
}
.tb-btn {
  @apply flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-[12px] whitespace-nowrap disabled:opacity-40;
}
.tb-sep {
  @apply mx-0.5 h-5 w-px shrink-0 bg-line;
}
.tb-seg {
  @apply flex shrink-0 rounded-md bg-surface-2/70 p-0.5;
}
.tb-seg button {
  @apply flex h-6 items-center gap-1 rounded px-2 text-[12px] whitespace-nowrap text-muted hover:text-fg;
}
.tb-seg button.on {
  @apply bg-surface-3 text-fg shadow-sm;
}
</style>
