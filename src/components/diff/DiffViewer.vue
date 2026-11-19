<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, ChevronUp, Search, Clock, Columns2, Copy, FileView, Files, Info, Loader2, SlidersHorizontal, Space, TextFont, TextWrap, Check, Minus, Plus, Rows3, Undo2, User, X } from '@/lib/icons'
import { useUiStore } from '@/stores/ui'
import { useReposStore } from '@/stores/repos'
import { errorMessage, gitApi } from '@/api/git'
import { isImagePath, languageFromPath } from '@/lib/format'
import ImageDiff from './ImageDiff.vue'
import { wordDiffHtml } from '@/lib/word-diff'
import FileHistory from './FileHistory.vue'
import BlameView from './BlameView.vue'
import { highlightLine, isMixedMarkup, mixedLanguages } from '@/lib/highlight'
import { toSplitRows } from '@/lib/diff-split'
import { lineMatches, markMatches } from '@/lib/find-in-html'
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
/** a reload of the same file (e.g. after an outside edit) stays visually still */
const quietReload = ref(false)
const SKELETON_WIDTHS = [42, 68, 55, 0, 74, 61, 38, 80, 52, 0, 66, 47, 71, 35, 58, 0, 63, 49]
const error = ref<string | null>(null)
const selected = ref(new Set<string>())
let anchor: { hunk: number; line: number } | null = null

watch(
  () => [tgt.value, repos.activeTab?.path, tgt.value.source === 'commit' ? null : repos.active?.snapshot.workingCopy, ui.diffOptions.ignoreWhitespace, ui.diffOptions.fullFile] as const,
  async ([target, path], old, onCleanup) => {
    let cancelled = false
    onCleanup(() => (cancelled = true))
    if (!old || old[0] !== target) selected.value = new Set()
    if (old && old[0].path !== target.path) diff.value = null
    quietReload.value = !!old && old[0] === target && old[4] === ui.diffOptions.fullFile
    const freshView = !old || old[0] !== target || old[4] !== ui.diffOptions.fullFile
    loading.value = true
    error.value = null
    try {
      const d = await gitApi.getFileDiff(path ?? '', target, { ignoreWhitespace: ui.diffOptions.ignoreWhitespace, fullFile: ui.diffOptions.fullFile || !!target.unchanged })
      if (!cancelled) {
        diff.value = d
        if (target.line && (!old || old[0] !== target)) void focusLine(target.line)
        else if (freshView && (ui.diffOptions.fullFile || target.unchanged)) void jumpToFirstChange()
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
  focused.value = line
  await nextTick()
  const at = (pick: (l: DiffLine) => number | null | undefined) => {
    for (let hi = 0; hi < hunks.value.length; hi++) {
      const lines = hunks.value[hi].lines
      if (ui.diffMode === 'split') {
        const rows = splitRows.value[hi]
        for (let ri = 0; ri < rows.length; ri++) {
          const c = rows[ri].right ?? rows[ri].left
          if (c && pick(lines[c.index]) === line) return rowIndex(hi, ri)
        }
      } else {
        for (let li = 0; li < lines.length; li++) if (pick(lines[li]) === line) return rowIndex(hi, li)
      }
    }
    return -1
  }
  let row = at((l) => l.newNo)
  if (row === -1) row = at((l) => l.oldNo)
  if (row !== -1) scrollToRow(row)
}

const language = computed(() => languageFromPath(tgt.value.path))
const displayOnly = computed(() => ui.diffOptions.ignoreWhitespace || ui.diffOptions.fullFile)
const isConflict = computed(() => fileEntry.value?.status === 'U')
const canStage = computed(() => tgt.value.source !== 'commit' && !tgt.value.untracked && !tgt.value.oldPath && !displayOnly.value && !isConflict.value)
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
  adds: number
  dels: number
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
        cur = { row: rowIndex(hi, i), len: 1, kind: k as ChangeBlock['kind'], adds: 0, dels: 0 }
        out.push(cur)
      }
      if (k !== 'del') cur.adds++
      if (k !== 'add') cur.dels++
    })
  })
  return out
})
const currentChange = ref(0)
watch(tgt, () => (currentChange.value = 0))
/** Split view scrolls sideways as one: both halves shift by the same offset (a single CSS variable, so it stays fast). */
const splitX = ref(0)
const hbar = ref<HTMLElement | null>(null)
const splitSideways = computed(() => ui.diffMode === 'split' && !ui.diffOptions.wrap)
const widestLine = computed(() => {
  let max = 0
  for (const h of hunks.value) {
    for (const l of h.lines) {
      let w = 0
      for (const ch of l.text) w += ch === '\t' ? 4 : /[\u1100-\uFFDC]/.test(ch) ? 2 : 1
      if (w > max) max = w
    }
  }
  return max
})
const halfWidth = ref(600)
const maxSplitX = computed(() => Math.max(0, widestLine.value * 7.83 + 24 - (halfWidth.value - 68)))
function setSplitX(x: number) {
  splitX.value = Math.max(0, Math.min(maxSplitX.value, x))
  if (hbar.value && Math.abs(hbar.value.scrollLeft - splitX.value) > 1) hbar.value.scrollLeft = splitX.value
}
function onDiffWheel(e: WheelEvent) {
  if (!splitSideways.value) return
  const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX
  if (!dx || Math.abs(dx) < Math.abs(e.deltaY) * (e.shiftKey ? 0 : 1)) return
  e.preventDefault()
  setSplitX(splitX.value + dx)
}
watch(() => [tgt.value.path, ui.diffMode] as const, () => setSplitX(0))

/** In whole-file view, open at the first change rather than line 1. */
async function jumpToFirstChange() {
  await nextTick()
  if (!changeBlocks.value.length) return
  currentChange.value = 0
  scrollToRow(changeBlocks.value[0].row)
}
async function jumpToRow(row: number) {
  scrollToRow(row)
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
function onRulerClick(e: MouseEvent) {
  const el = e.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  if (!rect.height || !changeBlocks.value.length) return
  const y = ((e.clientY - rect.top) / rect.height) * 100
  let best = 0
  let bestDist = Infinity
  changeBlocks.value.forEach((b, i) => {
    const top = blockPos.value[i]?.top ?? (b.row / rowOffsets.value.total) * 100
    const height = blockPos.value[i]?.height ?? 0
    const dist = y < top ? top - y : y > top + height ? y - top - height : 0
    if (dist < bestDist) {
      bestDist = dist
      best = i
    }
  })
  jumpToBlock(best)
}
/** A mixed block shows its removed part in red above its added part in green, in proportion. */
function rulerColor(b: ChangeBlock) {
  if (b.kind === 'add') return 'var(--gw-success)'
  if (b.kind === 'del') return 'var(--gw-danger)'
  const red = Math.round((b.dels / (b.dels + b.adds)) * 100)
  return `linear-gradient(to bottom, var(--gw-danger) 0 ${red}%, var(--gw-success) ${red}% 100%)`
}

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
/** Once the open file has been fully staged (or unstaged), move on to the next one so review keeps flowing. */
let lastIndex = -1
watch(fileIndex, (i) => {
  if (i >= 0) lastIndex = i
}, { immediate: true })
watch(fileList, (list) => {
  const t = tgt.value
  if (t.source === 'commit' || lastIndex < 0 || list.some((f) => f.path === t.path)) return
  const candidates = list.filter((f) => f.status !== 'U')
  const next = candidates[Math.min(lastIndex, candidates.length - 1)]
  lastIndex = -1
  if (next) {
    ui.openDiff({ path: next.path, oldPath: next.oldPath, source: t.source, untracked: next.status === '?' })
    return
  }
  const wc = repos.active?.snapshot.workingCopy
  const other = t.source === 'unstaged' ? 'staged' : 'unstaged'
  const moved = (other === 'staged' ? wc?.staged : wc?.unstaged)?.find((f) => f.path === t.path)
  if (moved) ui.openDiff({ path: moved.path, oldPath: moved.oldPath, source: other, untracked: moved.status === '?' })
})
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
const lineLanguages = computed(() => (isMixedMarkup(tgt.value.path) ? mixedLanguages(hunks.value) : null))
const html = computed(() => hunks.value.map((h, hi) => h.lines.map((l, li) => highlightLine(l.text, lineLanguages.value?.[hi][li] ?? language.value))))
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

/** Only the rows on screen exist in the page, so a 3,000-line file opens as fast as a 30-line one. */
interface DiffItem { hi: number; ri: number }
const items = computed<DiffItem[]>(() => {
  const out: DiffItem[] = []
  hunks.value.forEach((h, hi) => {
    out.push({ hi, ri: -1 })
    const n = ui.diffMode === 'split' ? splitRows.value[hi].length : h.lines.length
    for (let ri = 0; ri < n; ri++) out.push({ hi, ri })
  })
  return out
})
const HEADER_H = 30
const virtualizer = useVirtualizer(
  computed(() => ({
    count: items.value.length,
    getScrollElement: () => scroller.value,
    estimateSize: (i: number) => (items.value[i]?.ri === -1 ? (items.value[i].hi > 0 ? HEADER_H + 12 : HEADER_H) : 22),
    overscan: 8,
  })),
)
const measureRow = (el: unknown) => {
  if (el instanceof Element && ui.diffOptions.wrap) virtualizer.value.measureElement(el)
}
watch(() => [hunks.value, ui.diffMode, ui.diffOptions.wrap] as const, () => void nextTick(() => virtualizer.value.measure()))
const unifiedWidth = computed(() => (ui.diffMode === 'unified' && !ui.diffOptions.wrap ? `max(100%, ${Math.ceil(widestLine.value * 7.83 + 160)}px)` : '100%'))
function scrollToRow(row: number) {
  virtualizer.value.scrollToIndex(row, { align: 'center' })
}

/** Find in the whole diff: rows off screen are not in the page, so the webview's own search can't see them. */
const findOpen = ref(false)
const findQuery = ref('')
const findCur = ref(0)
const findInput = ref<HTMLInputElement | null>(null)
const findCase = ref(localStorage.getItem('kromagit.findCase') === '1')
const findWord = ref(localStorage.getItem('kromagit.findWord') === '1')
watch(findCase, (v) => localStorage.setItem('kromagit.findCase', v ? '1' : '0'))
watch(findWord, (v) => localStorage.setItem('kromagit.findWord', v ? '1' : '0'))
const findOpts = computed(() => ({ caseSensitive: findCase.value, wholeWord: findWord.value }))
const findHits = computed(() => {
  const q = findOpen.value ? findQuery.value : ''
  if (!q) return []
  const opts = findOpts.value
  const out: number[] = []
  items.value.forEach((it, i) => {
    if (it.ri < 0) return
    const lines = hunks.value[it.hi].lines
    const idx = ui.diffMode === 'split' ? [splitRows.value[it.hi][it.ri].left?.index, splitRows.value[it.hi][it.ri].right?.index] : [it.ri]
    if (idx.some((li) => li !== undefined && lineMatches(lines[li].text, q, opts))) out.push(i)
  })
  return out
})
const findSet = computed(() => new Set(findHits.value))
const findRow = computed(() => findHits.value[findCur.value] ?? -1)
const shown = (h: string) => (findOpen.value && findQuery.value ? markMatches(h, findQuery.value, findOpts.value) : h)
function openFind() {
  findOpen.value = true
  void nextTick(() => findInput.value?.select())
}
function closeFind() {
  findOpen.value = false
}
function findStep(delta: number) {
  const n = findHits.value.length
  if (!n) return
  findCur.value = (findCur.value + delta + n) % n
  scrollToRow(findHits.value[findCur.value])
}
watch(findHits, (hits) => {
  findCur.value = 0
  if (hits.length) scrollToRow(hits[0])
})
watch(() => ui.findInDiffRequest, () => {
  if (view.value === 'diff' && !isImage.value) openFind()
})

/** Where each change block really sits in the scrolled content (wrapped lines make rows taller), as % of the full height. */
const blockPos = ref<{ top: number; height: number }[]>([])
function measureBlocks() {
  const el = scroller.value
  if (!el) return
  halfWidth.value = el.clientWidth / 2
  const v = virtualizer.value
  const total = Math.max(v.getTotalSize(), 1)
  const m = v.measurementsCache
  blockPos.value = changeBlocks.value.map((b) => {
    const first = m[b.row]
    const last = m[b.row + b.len - 1] ?? first
    if (!first || !last) return { top: (b.row / rowOffsets.value.total) * 100, height: Math.max((b.len / rowOffsets.value.total) * 100, 0.4) }
    return { top: (first.start / total) * 100, height: Math.max(((last.end - first.start) / total) * 100, 0.4) }
  })
}
let measureFrame = 0
function scheduleMeasure() {
  cancelAnimationFrame(measureFrame)
  measureFrame = requestAnimationFrame(measureBlocks)
}
watch(
  () => [changeBlocks.value, ui.diffMode, ui.diffOptions.wrap, ui.diffOptions.fullFile, hunks.value] as const,
  () => void nextTick(scheduleMeasure),
  { flush: 'post' },
)
let measureObs: ResizeObserver | null = null
onMounted(() => {
  if (typeof ResizeObserver === 'undefined' || !scroller.value) return
  measureObs = new ResizeObserver(scheduleMeasure)
  measureObs.observe(scroller.value)
  if (scroller.value.firstElementChild) measureObs.observe(scroller.value.firstElementChild)
})
onBeforeUnmount(() => {
  measureObs?.disconnect()
  cancelAnimationFrame(measureFrame)
})
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

const CONFLICT_MARK = /^(<{7}|={7}|>{7}|\|{7})( |$)/
const lineClass = (l: DiffLine, sel: boolean) => {
  if (isConflict.value && CONFLICT_MARK.test(l.text)) return 'bg-[color-mix(in_srgb,var(--gw-warning)_22%,transparent)] font-semibold'
  if (l.kind === 'add') return sel ? 'bg-[var(--gw-add-strong)]' : 'bg-[var(--gw-add-bg)]'
  if (l.kind === 'del') return sel ? 'bg-[var(--gw-del-strong)]' : 'bg-[var(--gw-del-bg)]'
  return ''
}
/** No +/− column: the row colour says it, and changed line numbers take the same tint. */
const numColor = (l: DiffLine) => (l.kind === 'add' ? 'text-success/80' : l.kind === 'del' ? 'text-danger/80' : 'text-faint')
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
      <span v-if="tgt.unchanged" class="shrink-0 rounded-md bg-surface-2 px-1.5 text-[11px] leading-[22px] text-faint">unchanged</span>
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
      <button v-if="view === 'diff' && !isImage" type="button" class="tb-icon" :class="findOpen ? 'bg-surface-3 text-fg' : ''" title="Find in diff (⌘F)" @click="findOpen ? closeFind() : openFind()"><Search :size="14" /></button>
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
    <div v-else-if="loading && !diff" class="gw-skel-wrap flex-1 overflow-hidden py-3" role="status" aria-label="Loading diff">
      <div class="mx-3 mb-3 h-5 w-64 max-w-[60%] gw-skel opacity-70" />
      <div v-for="(w, i) in SKELETON_WIDTHS" :key="i" class="flex h-[22px] items-center gap-4 px-3">
        <span class="gw-skel h-2.5 w-7 shrink-0 opacity-50" />
        <span v-if="w" class="gw-skel h-2.5" :style="{ width: `${w}%` }" />
      </div>
    </div>
    <div v-else-if="error" class="m-4 rounded-md border border-danger/30 bg-danger/10 p-3 text-[13px] text-danger select-text">{{ error }}</div>
    <div v-else-if="diff?.binary" class="p-8 text-center text-[13px] text-muted">Binary file — no text diff to show.</div>
    <div v-else-if="diff && !hunks.length && !loading" class="p-8 text-center text-[13px] text-muted">
      <template v-if="tgt.source !== 'commit' && !fileEntry">No {{ tgt.source }} changes left in this file.</template>
      <template v-else>No content changes{{ tgt.oldPath ? ' (pure rename)' : '' }}.</template>
    </div>

    <div v-else class="relative flex min-h-0 flex-1">
    <div
      v-if="findOpen" data-own-esc
      class="absolute top-2 right-6 z-20 flex items-center gap-1 rounded-lg border border-line-strong bg-surface-2 py-1 pr-1 pl-2.5 font-sans shadow-lg"
    >
      <Search :size="14" class="shrink-0 text-faint" />
      <input
        ref="findInput" v-model="findQuery"
        class="h-7 w-56 bg-transparent text-[13px] text-fg outline-none placeholder:text-faint"
        placeholder="Find in diff" spellcheck="false"
        @keydown.enter.exact.prevent="findStep(1)" @keydown.shift.enter.prevent="findStep(-1)" @keydown.esc.prevent="closeFind"
      />
      <button
        type="button" class="find-opt" :class="{ on: findCase }" title="Match case"
        @mousedown.prevent @click="findCase = !findCase"
      >Aa</button>
      <button
        type="button" class="find-opt" :class="{ on: findWord }" title="Match whole word"
        @mousedown.prevent @click="findWord = !findWord"
      ><span class="underline decoration-1 underline-offset-2">ab</span></button>
      <span class="min-w-[56px] shrink-0 text-right text-[12px] tabular-nums" :class="findQuery && !findHits.length ? 'text-danger' : 'text-faint'">
        {{ findQuery ? (findHits.length ? `${findCur + 1} of ${findHits.length}` : 'No results') : '' }}
      </span>
      <button type="button" class="tb-icon" title="Previous (⇧↵)" :disabled="!findHits.length" @click="findStep(-1)"><ChevronUp :size="15" /></button>
      <button type="button" class="tb-icon" title="Next (↵)" :disabled="!findHits.length" @click="findStep(1)"><ChevronDown :size="15" /></button>
      <button type="button" class="tb-icon" title="Close (Esc)" @click="closeFind"><X :size="15" /></button>
    </div>
    <div ref="scroller" class="min-h-0 flex-1 overflow-auto font-mono text-[13px] leading-[22px]" :class="{ 'opacity-60': loading && !quietReload, 'sx-on': splitX > 0 }" :style="{ '--sx': `${splitX}px` }" @wheel="onDiffWheel">
      <div v-if="isConflict" class="flex items-center gap-2 border-b border-warning/30 bg-warning/10 px-3 py-1.5 font-sans text-[12px] text-warning">
      This file has conflicts. Keep the lines you want, remove the <code>&lt;&lt;&lt;&lt;&lt;&lt;&lt;</code> <code>=======</code> <code>&gt;&gt;&gt;&gt;&gt;&gt;&gt;</code> markers in your editor, then Stage file to mark it resolved.
      </div>
      <div v-if="diff?.truncated" class="border-b border-warning/30 bg-warning/10 px-3 py-1.5 font-sans text-[12px] text-warning">
        Diff is very large; showing the first 20,000 lines.
      </div>
      <div class="relative" :style="{ height: `${virtualizer.getTotalSize()}px`, width: unifiedWidth }">
        <div class="absolute top-0 left-0 w-full" :style="{ transform: `translateY(${virtualizer.getVirtualItems()[0]?.start ?? 0}px)` }">
        <div
          v-for="v in virtualizer.getVirtualItems()" :key="v.index"
          :ref="measureRow" :data-index="v.index"
          class="w-full"
        >
          <template v-for="it in [items[v.index]]" :key="v.index">
            <div v-if="it.ri === -1" :class="it.hi > 0 ? 'pt-3' : ''">
            <div class="flex h-[30px] items-center gap-2 border-y border-line bg-surface-2 px-3 py-1 text-[12px] text-accent/80">
              <span class="min-w-0 truncate">{{ hunks[it.hi].header }}</span>
              <div class="flex-1" />
              <template v-if="canStage">
                <button
                  v-if="canDiscard"
                  type="button" :disabled="busy"
                  class="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 font-sans text-[12px] whitespace-nowrap text-danger/90 hover:bg-danger/10 disabled:opacity-40"
                  @click="applyHunk(it.hi, 'discard')"
                >
                  <Undo2 :size="12" />Discard hunk
                </button>
                <button
                  type="button" :disabled="busy"
                  class="flex shrink-0 items-center gap-1 rounded border border-line-strong px-1.5 py-0.5 font-sans text-[12px] whitespace-nowrap text-fg hover:border-accent/60 hover:bg-accent/10 disabled:opacity-40"
                  @click="applyHunk(it.hi, tgt.source === 'staged' ? 'unstage' : 'stage')"
                >
                  <component :is="tgt.source === 'staged' ? Minus : Plus" :size="12" />{{ stageVerb }} hunk
                </button>
              </template>
            </div>
            </div>

            <div
              v-else-if="ui.diffMode === 'unified'"
              v-for="l in [hunks[it.hi].lines[it.ri]]" :key="'u'"
              :data-row="v.index"
              class="flex" :data-kind="l.kind" :class="[lineClass(l, selected.has(key(it.hi, it.ri))), focused !== null && l.newNo === focused ? 'ring-1 ring-accent-2 ring-inset' : '', findSet.has(v.index) ? (findRow === v.index ? 'kg-find-cur' : 'kg-find-row') : '']"
            >
              <span
                class="w-12 shrink-0 pr-2 text-right select-none"
                :class="[numColor(l), canStage && l.kind !== 'context' ? 'cursor-pointer hover:bg-accent/20' : '']"
                :title="canStage && l.kind !== 'context' ? 'Click to select line (shift-click for range)' : undefined"
                @click="toggleLine($event, it.hi, it.ri, l)"
              >{{ l.oldNo ?? '' }}</span>
              <span
                class="mr-3 w-12 shrink-0 pr-2 text-right select-none"
                :class="[numColor(l), canStage && l.kind !== 'context' ? 'cursor-pointer hover:bg-accent/20' : '']"
                @click="toggleLine($event, it.hi, it.ri, l)"
              >{{ l.newNo ?? '' }}</span>
              <!-- eslint-disable-next-line vue/no-v-html -->
              <span class="pr-6 text-fg select-text" :class="ui.diffOptions.wrap ? 'min-w-0 break-all whitespace-pre-wrap' : 'whitespace-pre'" v-html="shown(lineHtml(it.hi, it.ri)) || ' '" />
            </div>

            <div
              v-else
              v-for="row in [splitRows[it.hi][it.ri]]" :key="'s'"
              class="grid grid-cols-2" :class="[ui.diffOptions.wrap ? '' : 'h-[22px]', findSet.has(v.index) ? (findRow === v.index ? 'kg-find-cur' : 'kg-find-row') : '']" :data-row="v.index"
            >
              <div
                v-for="side in (['left', 'right'] as const)" :key="side"
                class="flex min-w-0 overflow-hidden"
                :data-kind="row[side]?.kind"
                :class="[row[side] ? lineClass(row[side]!, selected.has(key(it.hi, row[side]!.index))) : 'bg-surface/40', side === 'left' ? 'border-r border-line' : '']"
              >
                <template v-for="cell in [row[side]]" :key="side">
                  <template v-if="cell">
                    <span
                      class="relative z-[1] mr-3 w-12 shrink-0 bg-inherit pr-2 text-right select-none"
                      :class="[numColor(cell), canStage && cell.kind !== 'context' ? 'cursor-pointer hover:bg-accent/20' : '']"
                      @click="toggleLine($event, it.hi, cell.index, cell)"
                    >{{ side === 'left' ? cell.oldNo : cell.newNo }}</span>
                    <!-- eslint-disable-next-line vue/no-v-html -->
                    <span v-if="ui.diffOptions.wrap" class="min-w-0 break-all whitespace-pre-wrap pr-4 text-fg select-text" v-html="shown(lineHtml(it.hi, cell.index)) || ' '" />
                    <!-- eslint-disable-next-line vue/no-v-html -->
                    <span v-else class="min-w-0 flex-1 overflow-hidden"><span class="split-code inline-block pr-6 whitespace-pre text-fg select-text" v-html="shown(lineHtml(it.hi, cell.index)) || ' '" /></span>
                  </template>
                </template>
              </div>
            </div>
          </template>
        </div>
        </div>
      </div>
      <div v-if="canStage && hunks.length" class="px-3 pb-4 font-sans text-[12px] text-faint">
        Tip: click a line number to select lines (shift-click for a range), then {{ stageVerb.toLowerCase() }} only those lines.
      </div>
    </div>
    <div v-if="changeBlocks.length" class="relative w-4 shrink-0 cursor-pointer border-l border-line bg-surface/60 hover:bg-surface-2/70" title="Change map — click to jump" @click="onRulerClick">
      <button
        v-for="(b, i) in changeBlocks" :key="i" type="button"
        class="absolute right-0.5 left-0.5 min-h-[6px] rounded-sm hover:brightness-125"
        :class="{ 'ring-1 ring-fg': i === currentChange }"
        :style="{ top: `${blockPos[i]?.top ?? (b.row / rowOffsets.total) * 100}%`, height: `${blockPos[i]?.height ?? Math.max((b.len / rowOffsets.total) * 100, 0.4)}%`, background: rulerColor(b) }"
        :title="b.kind === 'mod' ? `Changed · −${b.dels} +${b.adds}` : `${b.kind === 'add' ? 'Added' : 'Removed'} · ${b.len} ${b.len === 1 ? 'line' : 'lines'}`"
        @click.stop="jumpToBlock(i)"
      />
    </div>
    <div
      v-if="splitSideways && maxSplitX > 0"
      ref="hbar"
      class="absolute right-4 bottom-0 left-0 z-20 h-3 overflow-x-auto overflow-y-hidden"
      @scroll="setSplitX(($event.target as HTMLElement).scrollLeft)"
    ><div class="h-px" :style="{ width: `calc(100% + ${maxSplitX}px)` }" /></div>
    </div>
  </div>
    </div>
  </div>
</template>

<style scoped>
@reference '../../styles/main.css';
.find-opt {
  @apply flex h-6 min-w-6 shrink-0 items-center justify-center rounded px-1 font-mono text-[11.5px] text-faint hover:bg-hover hover:text-fg;
}
.find-opt.on {
  @apply bg-accent/20 text-accent ring-1 ring-accent/50 ring-inset;
}
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
