<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import {
  Check, Cherry, Copy, Columns3, GitBranchPlus, Loader2, Pencil, RotateCcw, Search, Tag, Undo, User, X,
} from 'lucide-vue-next'
import GraphCell from './GraphCell.vue'
import RefPill from './RefPill.vue'
import Avatar from '@/components/common/Avatar.vue'
import { useReposStore } from '@/stores/repos'
import { useUiStore, type MenuItem } from '@/stores/ui'
import { ROW_HEIGHT, graphWidth, laneColor, laneX } from '@/lib/lanes'
import { fullDate, relativeTime } from '@/lib/format'
import type { Commit, RefLabel } from '@/types/git'
import * as git from '@/actions/git'

const repos = useReposStore()
const ui = useUiStore()

const messageQuery = ref('')
const authorQuery = ref('')
const scrollEl = ref<HTMLElement | null>(null)
const searchInput = ref<HTMLInputElement | null>(null)

const snapshot = computed(() => repos.active?.snapshot ?? null)
const layout = computed(() => repos.active?.layout ?? null)
const commits = computed(() => snapshot.value?.commits ?? [])
const gWidth = computed(() => graphWidth(layout.value?.maxLanes ?? 1))
const isFiltered = computed(() => messageQuery.value.trim() !== '' || authorQuery.value.trim() !== '')

const visibleIndexes = computed<number[] | null>(() => {
  if (!isFiltered.value) return null
  const q = messageQuery.value.trim().toLowerCase()
  const a = authorQuery.value.trim().toLowerCase()
  const out: number[] = []
  const list = commits.value
  for (let i = 0; i < list.length; i++) {
    const c = list[i]
    if (q && !c.subject.toLowerCase().includes(q) && !c.hash.startsWith(q)) continue
    if (a && !c.author.name.toLowerCase().includes(a) && !c.author.email.toLowerCase().includes(a)) continue
    out.push(i)
  }
  return out
})

const rowCount = computed(() => visibleIndexes.value?.length ?? commits.value.length)

const virtualizer = useVirtualizer(
  computed(() => ({
    count: rowCount.value,
    getScrollElement: () => scrollEl.value,
    estimateSize: () => ROW_HEIGHT,
    overscan: 16,
  })),
)

watch(() => repos.activeTabId, () => {
  messageQuery.value = ''
  authorQuery.value = ''
  scrollEl.value?.scrollTo({ top: 0 })
})

const headOid = computed(() => snapshot.value?.head.oid ?? null)
const headIndex = computed(() => (headOid.value ? commits.value.findIndex((c) => c.hash === headOid.value) : -1))
const loadingCommits = computed(() => !!repos.active?.loading.commits)
const complete = computed(() => !!repos.active?.commitsComplete)
const headLane = computed(() => (headIndex.value >= 0 ? layout.value?.rows[headIndex.value].lane ?? 0 : 0))
const changeCount = computed(() => {
  const wc = snapshot.value?.workingCopy
  return wc ? wc.unstaged.length + wc.staged.length : 0
})

const rootEl = ref<HTMLElement | null>(null)
const paneWidth = ref(1200)
let resizeObs: ResizeObserver | null = null
onMounted(() => {
  if (!rootEl.value || typeof ResizeObserver === 'undefined') return
  resizeObs = new ResizeObserver(([e]) => (paneWidth.value = e.contentRect.width))
  resizeObs.observe(rootEl.value)
})
onBeforeUnmount(() => resizeObs?.disconnect())

type ColumnId = 'refs' | 'graph' | 'author' | 'hash' | 'date'
const COLUMN_LABELS: Record<ColumnId, string> = { refs: 'Branches and tags', graph: 'Graph', author: 'Author', hash: 'Hash', date: 'Date' }
const COLUMNS_KEY = 'kromagit.columns.v1'
const visible = ref<Record<ColumnId | 'band', boolean>>({
  refs: true, graph: true, author: true, hash: true, date: true, band: true,
  ...(() => {
    try {
      return JSON.parse(localStorage.getItem(COLUMNS_KEY) ?? '{}') as Partial<Record<ColumnId, boolean>>
    } catch {
      return {}
    }
  })(),
})
watch(visible, (v) => localStorage.setItem(COLUMNS_KEY, JSON.stringify(v)), { deep: true })

const shownGraph = computed(() => (visible.value.graph ? gWidth.value : 0))
const spare = computed(() => paneWidth.value - shownGraph.value)
const show = computed(() => ({
  refs: visible.value.refs,
  graph: visible.value.graph,
  author: visible.value.author,
  hash: visible.value.hash && spare.value >= 760,
  date: visible.value.date,
}))
const fullAuthor = computed(() => spare.value >= 620)
const refsWidth = computed(() => (spare.value >= 700 ? 180 : 150))
const columns = computed(() =>
  [
    show.value.refs ? `${refsWidth.value}px` : null,
    show.value.graph ? `${gWidth.value}px` : null,
    'minmax(160px,1fr)',
    show.value.author ? (fullAuthor.value ? '150px' : '40px') : null,
    show.value.hash ? '80px' : null,
    show.value.date ? '110px' : null,
  ]
    .filter(Boolean)
    .join(' '),
)

function columnsMenu(e: MouseEvent) {
  e.preventDefault()
  const items: MenuItem[] = (Object.keys(COLUMN_LABELS) as ColumnId[]).map((id) => ({
    label: COLUMN_LABELS[id],
    icon: visible.value[id] ? Check : undefined,
    action: () => (visible.value[id] = !visible.value[id]),
  }))
  items.splice(2, 0, { label: 'Message (always on)' })
  items.push(
    { separator: true },
    { label: 'Tint rows by lane', icon: visible.value.band ? Check : undefined, action: () => (visible.value.band = !visible.value.band) },
    { separator: true },
    { label: 'Show everything', action: () => (Object.keys(visible.value) as (ColumnId | 'band')[]).forEach((k) => (visible.value[k] = true)) },
  )
  if (e.type === 'contextmenu') ui.openMenu(e, items)
  else ui.openMenuBelow(e.currentTarget as Element, items)
}

function displayRefs(c: Commit): { ref: RefLabel; hasRemote: boolean }[] {
  const remotes = new Set(c.refs.filter((r) => r.kind === 'remote').map((r) => r.name))
  const locals = new Set(c.refs.filter((r) => r.kind === 'local').map((r) => r.name))
  const out: { ref: RefLabel; hasRemote: boolean }[] = []
  for (const r of c.refs) {
    if (r.kind === 'remote' && locals.has(r.name.replace(/^[^/]+\//, ''))) continue
    out.push({ ref: r, hasRemote: r.kind === 'local' && [...remotes].some((n) => n.endsWith(`/${r.name}`)) })
  }
  return out.sort((a, b) => Number(!!b.ref.current) - Number(!!a.ref.current))
}

function commitMenu(e: MouseEvent, c: Commit) {
  const isHead = c.hash === headOid.value
  const label = c.shortHash
  const branch = snapshot.value?.currentBranch ?? 'HEAD'
  const items: MenuItem[] = []
  if (!isHead) items.push({ label: 'Checkout this commit (detached)', icon: Check, action: () => git.checkoutCommit(c.hash) })
  items.push(
    { label: 'Create branch here…', icon: GitBranchPlus, action: () => git.createBranch({ ref: c.hash, label }) },
    { label: 'Create tag here…', icon: Tag, action: () => git.createTag({ ref: c.hash, label }) },
    { separator: true },
  )
  if (!isHead) items.push({ label: `Cherry-pick onto ${branch}`, icon: Cherry, action: () => git.cherryPick(c.hash) })
  items.push({ label: 'Revert commit', icon: Undo, action: () => git.revert(c.hash) })
  if (!isHead) {
    items.push(
      { separator: true },
      { label: `Reset ${branch} here — soft…`, icon: RotateCcw, action: () => git.reset(c.hash, 'soft') },
      { label: `Reset ${branch} here — mixed…`, icon: RotateCcw, action: () => git.reset(c.hash, 'mixed') },
      { label: `Reset ${branch} here — hard…`, icon: RotateCcw, danger: true, action: () => git.reset(c.hash, 'hard') },
    )
  }
  items.push(
    { separator: true },
    { label: 'Copy hash', icon: Copy, shortcut: c.shortHash, action: () => git.copyText(c.hash, 'Copied hash') },
    { label: 'Copy message', icon: Copy, action: () => git.copyText(c.subject, 'Copied message') },
  )
  ui.openMenu(e, items)
}

watch(() => ui.searchRequest, async () => {
  await nextTick()
  searchInput.value?.focus()
  searchInput.value?.select()
})

/** Arrow keys / j k move the selection; the details panel follows. */
function onListKey(e: KeyboardEvent) {
  if (e.metaKey || e.ctrlKey || e.altKey) return
  const count = rowCount.value
  if (!count) return
  const current = ui.selectedCommit ? displayIndexOf(ui.selectedCommit) : -1
  let next = current
  if (e.key === 'ArrowDown' || e.key === 'j') next = Math.min(count - 1, current + 1)
  else if (e.key === 'ArrowUp' || e.key === 'k') next = Math.max(0, current - 1)
  else if (e.key === 'Home') next = 0
  else if (e.key === 'End') next = count - 1
  else if (e.key === 'PageDown') next = Math.min(count - 1, current + 20)
  else if (e.key === 'PageUp') next = Math.max(0, current - 20)
  else if (e.key === 'Escape' && ui.selectedCommit) {
    ui.selectCommit(null)
    e.stopPropagation()
    return
  } else return
  e.preventDefault()
  if (next < 0) next = 0
  ui.selectCommit(commits.value[rowIndex(next)].hash)
  virtualizer.value.scrollToIndex(next, { align: 'auto' })
}

function displayIndexOf(hash: string): number {
  const i = commits.value.findIndex((c) => c.hash === hash)
  if (i === -1) return -1
  return visibleIndexes.value ? visibleIndexes.value.indexOf(i) : i
}

function rowIndex(virtualIndex: number) {
  return visibleIndexes.value ? visibleIndexes.value[virtualIndex] : virtualIndex
}
</script>

<template>
  <div ref="rootEl" class="flex h-full min-w-0 flex-col bg-bg">
    <div class="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
      <div class="relative w-64 min-w-28 shrink">
        <Search :size="14" class="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-faint" />
        <input ref="searchInput" v-model="messageQuery" class="gw-input pl-6" placeholder="Search commits…" title="Search by message or commit hash" spellcheck="false" />
      </div>
      <div class="relative w-44 min-w-24 shrink">
        <User :size="14" class="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-faint" />
        <input v-model="authorQuery" class="gw-input pl-6" placeholder="Find author…" spellcheck="false" />
      </div>
      <button
        v-if="isFiltered" type="button" class="flex items-center gap-1 rounded px-1.5 py-1 text-[12px] text-muted hover:bg-hover hover:text-fg"
        @click="messageQuery = ''; authorQuery = ''"
      >
        <X :size="14" />Clear
      </button>
      <div class="flex-1" />
      <button
        type="button" class="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[12px] whitespace-nowrap text-muted hover:bg-hover hover:text-fg"
        title="Choose columns" @click="columnsMenu"
      ><Columns3 :size="15" />Columns</button>
      <span class="shrink-0 font-mono text-[12px] whitespace-nowrap text-muted">
        <template v-if="isFiltered">{{ rowCount.toLocaleString() }} of </template>{{ commits.length.toLocaleString() }}{{ complete ? '' : '+' }} commits
      </span>
      <span v-if="loadingCommits" class="flex items-center gap-1 text-[12px] text-faint">
        <Loader2 :size="14" class="animate-spin" />{{ commits.length ? 'loading full history' : 'loading' }}
      </span>
    </div>

    <div
      class="grid h-8 shrink-0 items-center border-b border-line bg-surface text-[12px] font-medium text-faint"
      :style="{ gridTemplateColumns: columns }"
      title="Right-click to choose columns"
      @contextmenu="columnsMenu"
    >
      <span v-if="show.refs" class="truncate px-3">Branch / Tag</span>
      <span v-if="show.graph" class="px-2">Graph</span>
      <span class="px-2" :class="{ 'pl-3': !show.refs && !show.graph }">Message</span>
      <span v-if="show.author" class="truncate px-2">{{ fullAuthor ? 'Author' : '' }}</span>
      <span v-if="show.hash" class="px-2">Hash</span>
      <span v-if="show.date" class="px-2">Date</span>
    </div>

    <div
      v-if="!isFiltered && changeCount"
      class="grid h-[38px] shrink-0 items-center border-b border-dashed border-line bg-surface/50"
      :style="{ gridTemplateColumns: columns }"
    >
      <span v-if="show.refs" class="px-3">
        <span class="inline-flex h-[21px] items-center rounded-full border border-dashed border-faint px-2 text-[12px] text-muted">WIP</span>
      </span>
      <svg v-if="show.graph" :width="gWidth" height="38" class="block">
        <circle :cx="laneX(headLane)" cy="19" r="10" fill="none" :stroke="laneColor(layout?.rows[headIndex]?.color ?? 0)" stroke-width="2" stroke-dasharray="3 2.5" />
      </svg>
      <span class="flex items-center gap-2 px-2 text-[13px] whitespace-nowrap" :class="{ 'pl-3': !show.refs && !show.graph }">
        <span class="text-muted italic">{{ changeCount }} uncommitted {{ changeCount === 1 ? 'change' : 'changes' }}</span>
        <button
          type="button" class="rounded-md border border-line-strong px-2 py-0.5 text-[12px] text-fg hover:border-accent/60 hover:bg-accent/10"
          @click="ui.selectCommit(null); ui.closeDiff()"
        >
          <Pencil :size="11" class="mr-1 inline" />View changes
        </button>
      </span>
    </div>

    <div ref="scrollEl" class="min-h-0 flex-1 overflow-auto outline-none" tabindex="0" @keydown="onListKey">
      <div class="relative w-full" :style="{ height: `${virtualizer.getTotalSize()}px` }">
        <template v-for="v in virtualizer.getVirtualItems()" :key="v.index">
          <div
            v-for="c in [commits[rowIndex(v.index)]]"
            :key="c.hash"
            class="absolute left-0 grid w-full items-center text-[13px]"
            :class="ui.selectedCommit === c.hash ? 'bg-select' : ['hover:bg-surface-2', { 'row-tint': visible.band && !isFiltered }]"
            :style="{ height: `${ROW_HEIGHT}px`, transform: `translateY(${v.start}px)`, gridTemplateColumns: columns, '--lane': laneColor(layout!.rows[rowIndex(v.index)].color) }"
            @click="ui.selectCommit(c.hash)"
            @contextmenu="commitMenu($event, c)"
          >
            <span v-if="show.refs" class="flex min-w-0 items-center gap-1 overflow-hidden pl-3">
              <template v-for="(r, i) in displayRefs(c)" :key="r.ref.name">
                <RefPill v-if="i < 2" :ref-label="r.ref" :has-remote="r.hasRemote" :color="laneColor(layout!.rows[rowIndex(v.index)].color)" />
              </template>
              <span v-if="displayRefs(c).length > 2" class="shrink-0 text-[11px] text-faint" :title="displayRefs(c).slice(2).map((r) => r.ref.name).join(', ')">
                +{{ displayRefs(c).length - 2 }}
              </span>
              <span
                v-if="c.refs.length && show.graph" class="h-[2px] min-w-[6px] flex-1"
                :style="{ background: laneColor(layout!.rows[rowIndex(v.index)].color) }"
              />
            </span>
            <GraphCell
              v-if="show.graph"
              :row="layout!.rows[rowIndex(v.index)]"
              :width="gWidth"
              :author-name="c.author.name"
              :author-email="c.author.email"
              :commit-hash="c.hash"
              :has-refs="c.refs.length > 0 && show.refs"
              :is-head="c.hash === headOid"
              :edges-hidden="isFiltered"
            />
            <span
              class="flex h-full min-w-0 items-center gap-1.5 truncate px-2" :class="[c.parents.length > 1 ? 'text-muted' : 'text-fg', { 'pl-3': !show.refs && !show.graph }]"
            >
              <template v-if="!show.refs">
                <RefPill
                  v-for="r in displayRefs(c).slice(0, 2)" :key="r.ref.name" class="shrink-0"
                  :ref-label="r.ref" :has-remote="r.hasRemote" :color="laneColor(layout!.rows[rowIndex(v.index)].color)"
                />
              </template>
              <span class="truncate">{{ c.subject }}</span>
            </span>
            <span v-if="show.author" class="flex min-w-0 items-center gap-1.5 px-2 text-muted">
              <Avatar :name="c.author.name" :email="c.author.email" :size="20" />
              <span v-if="fullAuthor" class="truncate">{{ c.author.name }}</span>
            </span>
            <span v-if="show.hash" class="px-2 font-mono text-[12px] text-faint">{{ c.shortHash }}</span>
            <span v-if="show.date" class="truncate px-2 text-muted" :title="fullDate(c.date)">{{ relativeTime(c.date) }}</span>
          </div>
        </template>
      </div>
      <div v-if="isFiltered && rowCount === 0" class="p-8 text-center text-[13px] text-faint">No commits match these filters.</div>
      <div v-else-if="!commits.length && loadingCommits" class="space-y-3 p-4">
        <div v-for="i in 8" :key="i" class="flex items-center gap-3">
          <div class="h-4 w-4 animate-pulse rounded-full bg-surface-3" />
          <div class="h-3 animate-pulse rounded bg-surface-3" :style="{ width: `${30 + ((i * 37) % 45)}%` }" />
        </div>
      </div>
      <div v-else-if="!commits.length" class="p-8 text-center text-[13px] text-faint">No commits yet — make your first commit to see history here.</div>
    </div>
  </div>
</template>
