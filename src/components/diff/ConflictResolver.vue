<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { ArrowDown, ArrowUp, Check, GitMerge, Loader2, Pencil, RotateCcw, X } from '@/lib/icons'
import { useUiStore } from '@/stores/ui'
import { useReposStore } from '@/stores/repos'
import { errorMessage, gitApi } from '@/api/git'
import * as git from '@/actions/git'
import { buildResult, hasMarkers, parseConflicts, type Choice, type ParsedConflict } from '@/lib/conflicts'
import { highlightLine } from '@/lib/highlight'
import { languageFromPath } from '@/lib/format'

const ui = useUiStore()
const repos = useReposStore()
const path = computed(() => ui.conflictPath!)
const repo = computed(() => repos.activeTab?.path ?? '')
const language = computed(() => languageFromPath(path.value))

const loading = ref(true)
const error = ref<string | null>(null)
const saving = ref(false)
const parsed = ref<ParsedConflict | null>(null)
const labels = ref({ ours: 'HEAD', theirs: 'incoming' })
const choices = ref<Choice[]>([])
const manual = ref<string | null>(null)
const editing = ref(false)
const current = ref(0)

const blocks = computed(() => parsed.value?.segments.filter((s) => s.kind === 'conflict') ?? [])
const resolvedCount = computed(() => choices.value.filter((c) => c.ours || c.theirs).length)
const resultText = computed(() => manual.value ?? (parsed.value ? buildResult(parsed.value, choices.value, labels.value) : ''))
const canFinish = computed(() => !!parsed.value && !saving.value && !hasMarkers(resultText.value))

async function load() {
  loading.value = true
  error.value = null
  try {
    const f = await gitApi.readConflict(repo.value, path.value)
    parsed.value = parseConflicts(f.text)
    labels.value = { ours: f.ours, theirs: f.theirs }
    choices.value = blocks.value.map(() => ({ ours: false, theirs: false }))
    manual.value = null
    editing.value = false
    current.value = 0
  } catch (e) {
    error.value = errorMessage(e)
  } finally {
    loading.value = false
  }
}

const hl = (text: string) => highlightLine(text, language.value) || ' '

/* ---------- top: both sides, aligned ---------- */
type Cell = { n: number; text: string } | null
type TopRow = { t: 'common'; a: number; b: number; text: string } | { t: 'head'; k: number } | { t: 'c'; k: number; a: Cell; b: Cell; first: boolean }
const top = computed(() => {
  const rows: TopRow[] = []
  const heads: number[] = []
  let a = 1
  let b = 1
  let k = 0
  for (const s of parsed.value?.segments ?? []) {
    if (s.kind === 'common') {
      for (const text of s.lines) rows.push({ t: 'common', a: a++, b: b++, text })
      continue
    }
    heads.push(rows.length)
    rows.push({ t: 'head', k })
    const n = Math.max(s.ours.length, s.theirs.length, 1)
    for (let i = 0; i < n; i++) {
      rows.push({
        t: 'c', k, first: i === 0,
        a: i < s.ours.length ? { n: a++, text: s.ours[i] } : null,
        b: i < s.theirs.length ? { n: b++, text: s.theirs[i] } : null,
      })
    }
    k++
  }
  return { rows, heads }
})

/* ---------- bottom: the result ---------- */
type ResRow = { n: number; text: string; kind: 'common' | 'ours' | 'theirs' | 'open'; k?: number; first?: boolean }
const result = computed(() => {
  const rows: ResRow[] = []
  const starts: number[] = []
  let n = 1
  let k = 0
  for (const s of parsed.value?.segments ?? []) {
    if (s.kind === 'common') {
      for (const text of s.lines) rows.push({ n: n++, text, kind: 'common' })
      continue
    }
    starts.push(rows.length)
    const c = choices.value[k] ?? { ours: false, theirs: false }
    if (!c.ours && !c.theirs) {
      s.ours.forEach((text, i) => rows.push({ n: n++, text, kind: 'open', k, first: i === 0 }))
      if (!s.ours.length) rows.push({ n: n++, text: '', kind: 'open', k, first: true })
    } else {
      if (c.ours) for (const text of s.ours) rows.push({ n: n++, text, kind: 'ours', k })
      if (c.theirs) for (const text of s.theirs) rows.push({ n: n++, text, kind: 'theirs', k })
    }
    k++
  }
  return { rows, starts }
})

const topEl = ref<HTMLElement | null>(null)
const resEl = ref<HTMLElement | null>(null)
const topV = useVirtualizer(computed(() => ({ count: top.value.rows.length, getScrollElement: () => topEl.value, estimateSize: (i: number) => (top.value.rows[i]?.t === 'head' ? 30 : 22), overscan: 20 })))
const resV = useVirtualizer(computed(() => ({ count: result.value.rows.length, getScrollElement: () => resEl.value, estimateSize: () => 22, overscan: 20 })))
const measureTop = (el: unknown) => el instanceof Element && topV.value.measureElement(el)
const measureRes = (el: unknown) => el instanceof Element && resV.value.measureElement(el)

function goTo(k: number) {
  const n = blocks.value.length
  if (!n) return
  current.value = ((k % n) + n) % n
  void nextTick(() => {
    topV.value.scrollToIndex(top.value.heads[current.value], { align: 'center' })
    if (!editing.value) resV.value.scrollToIndex(result.value.starts[current.value], { align: 'center' })
  })
}
watch(() => parsed.value, (p) => p && blocks.value.length && setTimeout(() => goTo(0), 50))

function toggle(k: number, side: 'ours' | 'theirs') {
  manual.value = null
  const c = { ...choices.value[k] }
  c[side] = !c[side]
  choices.value.splice(k, 1, c)
  current.value = k
  const next = choices.value.findIndex((x, i) => i > k && !x.ours && !x.theirs)
  if ((c.ours || c.theirs) && next !== -1) setTimeout(() => goTo(next), 250)
}
function pickAll(side: 'ours' | 'theirs') {
  manual.value = null
  const on = !choices.value.every((c) => c[side])
  choices.value = choices.value.map((c) => ({ ...c, [side]: on }))
}
const allPicked = (side: 'ours' | 'theirs') => choices.value.length > 0 && choices.value.every((c) => c[side])

function startEdit() {
  manual.value = resultText.value
  editing.value = true
}
function reset() {
  manual.value = null
  editing.value = false
  choices.value = blocks.value.map(() => ({ ours: false, theirs: false }))
}

async function finish() {
  if (!canFinish.value) return
  saving.value = true
  try {
    await gitApi.writeResolved(repo.value, path.value, resultText.value)
    const file = repos.active?.snapshot.workingCopy.unstaged.find((f) => f.path === path.value)
    if (file) await git.stage([file])
    ui.toast({ kind: 'success', title: `Resolved ${path.value.split('/').pop()}`, detail: 'Saved and staged. Continue the merge when every file is resolved.' })
    ui.conflictPath = null
  } catch (e) {
    ui.toast({ kind: 'error', title: "Couldn't save the file", detail: errorMessage(e) })
  } finally {
    saving.value = false
  }
}

function close() {
  ui.conflictPath = null
}
function onKey(e: KeyboardEvent) {
  if (ui.dialog || e.target instanceof HTMLTextAreaElement) return
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() }
}
onMounted(() => {
  window.addEventListener('keydown', onKey, true)
  void load()
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true))
</script>

<template>
  <div class="fixed inset-0 z-[58] flex flex-col bg-bg" role="dialog" aria-label="Resolve conflicts">
    <!-- header -->
    <div class="flex h-14 shrink-0 items-center gap-3 border-b border-line px-4">
      <span class="grid h-9 w-9 place-items-center rounded-lg bg-danger/15 text-danger"><GitMerge :size="18" /></span>
      <div class="min-w-0">
        <div class="text-[11px] font-semibold tracking-wider text-faint uppercase">Resolve conflicts</div>
        <div class="truncate font-mono text-[14px] font-semibold text-fg">{{ path }}</div>
      </div>
      <div v-if="blocks.length" class="ml-4 flex items-center gap-2 text-[12px] text-muted">
        <span class="h-1.5 w-32 overflow-hidden rounded-full bg-surface-3"><span class="block h-full rounded-full bg-success transition-[width]" :style="{ width: `${(resolvedCount / blocks.length) * 100}%` }" /></span>
        {{ manual !== null ? 'Edited by hand' : `${resolvedCount} of ${blocks.length} resolved` }}
      </div>
      <div class="flex-1" />
      <button
        type="button" :disabled="!canFinish"
        class="flex h-8 shrink-0 items-center gap-1 whitespace-nowrap rounded-md bg-accent px-3 text-[13px] font-semibold text-on-accent hover:brightness-110 disabled:opacity-40"
        :title="canFinish ? 'Save the result and stage the file' : 'Pick a side for every conflict (or remove the markers by hand) first'"
        @click="finish"
      >
        <Loader2 v-if="saving" :size="15" class="animate-spin" /><Check v-else :size="15" />Mark resolved
      </button>
      <button type="button" class="rounded-md p-1.5 text-faint hover:bg-hover hover:text-fg" title="Close (Esc)" @click="close"><X :size="18" /></button>
    </div>

    <div v-if="loading" class="flex flex-1 items-center justify-center gap-2 text-[13px] text-muted"><Loader2 :size="16" class="animate-spin" />Reading the file…</div>
    <div v-else-if="error" class="m-6 rounded-md border border-danger/30 bg-danger/10 p-3 text-[13px] text-danger select-text">{{ error }}</div>
    <div v-else-if="!blocks.length" class="flex flex-1 flex-col items-center justify-center gap-2 text-[13px] text-muted">
      No conflict markers left in this file.
      <button type="button" class="rounded-md border border-line-strong px-3 py-1.5 text-fg hover:bg-hover" @click="finish">Stage it as resolved</button>
    </div>

    <template v-else>
      <!-- top: both sides -->
      <div class="grid shrink-0 grid-cols-2 border-b border-line text-[12px]">
        <label v-for="side in (['ours', 'theirs'] as const)" :key="side" class="flex h-10 cursor-pointer items-center gap-2.5 px-3" :class="side === 'ours' ? 'border-r border-line border-t-2 border-t-accent' : 'border-t-2 border-t-success'">
          <input type="checkbox" :checked="allPicked(side)" @change="pickAll(side)" />
          <span class="grid h-5 w-5 place-items-center rounded-full text-[11px] font-bold" :class="side === 'ours' ? 'bg-accent/20 text-accent' : 'bg-success/20 text-success'">{{ side === 'ours' ? 'A' : 'B' }}</span>
          <span class="truncate font-medium" :class="side === 'ours' ? 'text-accent' : 'text-success'">{{ side === 'ours' ? labels.ours : labels.theirs }}</span>
          <span class="ml-auto text-[11px] font-semibold tracking-wider text-faint uppercase">{{ side === 'ours' ? 'Current' : 'Incoming' }}</span>
        </label>
      </div>
      <div ref="topEl" class="min-h-0 flex-[3] overflow-auto font-mono text-[12.5px] leading-[22px]">
        <div class="relative w-full" :style="{ height: `${topV.getTotalSize()}px` }">
          <div v-for="v in topV.getVirtualItems()" :key="v.index" :ref="measureTop" :data-index="v.index" class="absolute top-0 left-0 w-full" :style="{ transform: `translateY(${v.start}px)` }">
            <template v-for="r in [top.rows[v.index]]" :key="v.index">
              <div v-if="r.t === 'head'" class="flex h-[30px] items-center gap-3 border-y border-line px-3 font-sans text-[11px] font-semibold tracking-wider uppercase" :class="r.k === current ? 'bg-surface-3 text-fg' : 'bg-surface-2 text-faint'">
                Conflict {{ r.k + 1 }}
                <span v-if="choices[r.k]?.ours || choices[r.k]?.theirs" class="flex items-center gap-1 text-success normal-case"><Check :size="12" />resolved</span>
              </div>
              <div v-else-if="r.t === 'common'" class="grid grid-cols-2 opacity-45">
                <div class="flex border-r border-line"><span class="w-7 shrink-0" /><span class="w-14 shrink-0 pr-3 text-right text-faint select-none">{{ r.a }}</span><span class="min-w-0 pr-4 break-all whitespace-pre-wrap" v-html="hl(r.text)" /></div>
                <div class="flex"><span class="w-7 shrink-0" /><span class="w-14 shrink-0 pr-3 text-right text-faint select-none">{{ r.b }}</span><span class="min-w-0 pr-4 break-all whitespace-pre-wrap" v-html="hl(r.text)" /></div>
              </div>
              <div v-else class="grid grid-cols-2">
                <div
                  v-for="side in (['ours', 'theirs'] as const)" :key="side"
                  class="flex cursor-pointer"
                  :class="[
                    side === 'ours' ? 'border-r border-line border-l-2 border-l-accent' : 'border-l-2 border-l-success',
                    choices[r.k]?.[side] ? (side === 'ours' ? 'bg-accent/15' : 'bg-success/15') : 'bg-surface-2/60 hover:bg-surface-3/60',
                  ]"
                  @click="toggle(r.k, side)"
                >
                  <template v-for="cell in [side === 'ours' ? r.a : r.b]" :key="side">
                    <span class="flex w-7 shrink-0 justify-center pt-[4px]">
                      <input
                        v-if="r.first"
                        type="checkbox" class="m-0" :checked="choices[r.k]?.[side]" @click.stop="toggle(r.k, side)"
                      />
                    </span>
                    <span class="w-14 shrink-0 pr-3 text-right text-faint select-none">{{ cell?.n ?? '' }}</span>
                    <span v-if="cell" class="min-w-0 pr-4 break-all whitespace-pre-wrap text-fg" v-html="hl(cell.text)" />
                  </template>
                </div>
              </div>
            </template>
          </div>
        </div>
      </div>

      <!-- bottom: result -->
      <div class="flex h-11 shrink-0 items-center gap-3 border-y border-line bg-surface px-3 text-[12px]">
        <span class="font-semibold tracking-wider text-faint uppercase">Result</span>
        <span class="flex items-center rounded-md border border-line-strong">
          <button type="button" class="p-1 text-muted hover:text-fg" title="Previous conflict" @click="goTo(current - 1)"><ArrowUp :size="14" /></button>
          <span class="px-1.5 text-fg">Conflict {{ current + 1 }} of {{ blocks.length }}</span>
          <button type="button" class="p-1 text-muted hover:text-fg" title="Next conflict" @click="goTo(current + 1)"><ArrowDown :size="14" /></button>
        </span>
        <span class="text-faint">Tick A, B or both above. Edit the result by hand if you need to.</span>
        <div class="flex-1" />
        <button v-if="!editing" type="button" class="flex items-center gap-1.5 rounded-md px-2 py-1 text-muted hover:bg-hover hover:text-fg" @click="startEdit"><Pencil :size="14" />Edit</button>
        <button type="button" class="flex items-center gap-1.5 rounded-md px-2 py-1 text-muted hover:bg-hover hover:text-fg" @click="reset"><RotateCcw :size="14" />Reset</button>
      </div>
      <textarea
        v-if="editing" v-model="manual" spellcheck="false"
        class="min-h-0 flex-[2] resize-none bg-bg px-4 py-2 font-mono text-[12.5px] leading-[22px] text-fg outline-none"
      />
      <div v-else ref="resEl" class="min-h-0 flex-[2] overflow-auto font-mono text-[12.5px] leading-[22px]">
        <div class="relative w-full" :style="{ height: `${resV.getTotalSize()}px` }">
          <div v-for="v in resV.getVirtualItems()" :key="v.index" :ref="measureRes" :data-index="v.index" class="absolute top-0 left-0 w-full" :style="{ transform: `translateY(${v.start}px)` }">
            <template v-for="r in [result.rows[v.index]]" :key="v.index">
              <div
                class="flex"
                :class="{
                  'border-l-2 border-l-danger bg-danger/10 italic': r.kind === 'open',
                  'border-l-2 border-l-accent bg-accent/10': r.kind === 'ours',
                  'border-l-2 border-l-success bg-success/10': r.kind === 'theirs',
                }"
              >
                <span class="w-14 shrink-0 pr-3 text-right text-faint select-none">{{ r.n }}</span>
                <span class="min-w-0 flex-1 pr-4 break-all whitespace-pre-wrap" :class="r.kind === 'open' ? 'text-muted' : 'text-fg'" v-html="hl(r.text)" />
                <span v-if="r.kind === 'open' && r.first" class="shrink-0 pr-3 font-sans text-[11px] text-danger not-italic">Conflict {{ (r.k ?? 0) + 1 }} · unresolved</span>
              </div>
            </template>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
