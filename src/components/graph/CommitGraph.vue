<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import {
  Check, Cherry, Copy, GitBranchPlus, Loader2, PanelLeftOpen, Pencil, RotateCcw, Search, Tag, Undo, User, X,
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

const showHash = computed(() => paneWidth.value - gWidth.value >= 760)
const fullAuthor = computed(() => paneWidth.value - gWidth.value >= 620)
const refsWidth = computed(() => (paneWidth.value - gWidth.value >= 700 ? 180 : 150))
const columns = computed(() =>
  [`${refsWidth.value}px`, `${gWidth.value}px`, 'minmax(160px,1fr)', fullAuthor.value ? '150px' : '40px', showHash.value ? '80px' : null, '110px']
    .filter(Boolean)
    .join(' '),
)

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
      <button
        v-if="ui.sidebarCollapsed" type="button" class="rounded p-1 text-faint hover:bg-hover hover:text-fg" title="Show sidebar"
        @click="ui.sidebarCollapsed = false"
      >
        <PanelLeftOpen :size="16" />
      </button>
      <div class="relative w-64">
        <Search :size="14" class="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-faint" />
        <input ref="searchInput" v-model="messageQuery" class="gw-input pl-6" placeholder="Search commits… (message or hash)" spellcheck="false" />
      </div>
      <div class="relative w-44">
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
      <span class="font-mono text-[12px] text-muted">
        <template v-if="isFiltered">{{ rowCount.toLocaleString() }} of </template>{{ commits.length.toLocaleString() }}{{ complete ? '' : '+' }} commits
      </span>
      <span v-if="loadingCommits" class="flex items-center gap-1 text-[12px] text-faint">
        <Loader2 :size="14" class="animate-spin" />{{ commits.length ? 'loading full history' : 'loading' }}
      </span>
    </div>

    <div
      class="grid h-8 shrink-0 items-center border-b border-line bg-surface text-[11px] font-semibold tracking-wider text-faint uppercase"
      :style="{ gridTemplateColumns: columns }"
    >
      <span class="px-3">Branch / Tag</span>
      <span class="px-2">Graph</span>
      <span class="px-2">Message</span>
      <span class="truncate px-2">{{ fullAuthor ? 'Author' : '' }}</span>
      <span v-if="showHash" class="px-2">Hash</span>
      <span class="px-2">Date</span>
    </div>

    <div
      v-if="!isFiltered"
      class="grid h-[38px] shrink-0 items-center border-b border-dashed border-line bg-surface/50"
      :style="{ gridTemplateColumns: columns }"
    >
      <span class="px-3">
        <span class="inline-flex h-[21px] items-center rounded-full border border-dashed border-faint px-2 text-[12px] text-muted">WIP</span>
      </span>
      <svg :width="gWidth" height="38" class="block">
        <circle :cx="laneX(headLane)" cy="19" r="10" fill="none" :stroke="laneColor(layout?.rows[headIndex]?.color ?? 0)" stroke-width="2" stroke-dasharray="3 2.5" />
      </svg>
      <span class="flex items-center gap-2 px-2 text-[13px] whitespace-nowrap">
        <span v-if="changeCount" class="text-muted italic">{{ changeCount }} uncommitted {{ changeCount === 1 ? 'change' : 'changes' }}</span>
        <span v-else class="text-faint italic">Working tree clean</span>
        <button
          v-if="changeCount"
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
            :class="ui.selectedCommit === c.hash ? 'bg-select' : 'hover:bg-surface-2'"
            :style="{ height: `${ROW_HEIGHT}px`, transform: `translateY(${v.start}px)`, gridTemplateColumns: columns }"
            @click="ui.selectCommit(c.hash)"
            @contextmenu="commitMenu($event, c)"
          >
            <span class="flex min-w-0 items-center gap-1 overflow-hidden pl-3">
              <template v-for="(r, i) in displayRefs(c)" :key="r.ref.name">
                <RefPill v-if="i < 2" :ref-label="r.ref" :has-remote="r.hasRemote" :color="laneColor(layout!.rows[rowIndex(v.index)].color)" />
              </template>
              <span v-if="displayRefs(c).length > 2" class="shrink-0 text-[11px] text-faint" :title="displayRefs(c).slice(2).map((r) => r.ref.name).join(', ')">
                +{{ displayRefs(c).length - 2 }}
              </span>
              <span
                v-if="c.refs.length" class="h-[2px] min-w-[6px] flex-1"
                :style="{ background: laneColor(layout!.rows[rowIndex(v.index)].color) }"
              />
            </span>
            <GraphCell
              :row="layout!.rows[rowIndex(v.index)]"
              :width="gWidth"
              :author-name="c.author.name"
              :author-email="c.author.email"
              :commit-hash="c.hash"
              :has-refs="c.refs.length > 0"
              :is-head="c.hash === headOid"
              :edges-hidden="isFiltered"
            />
            <span class="truncate px-2" :class="c.parents.length > 1 ? 'text-muted' : 'text-fg'">{{ c.subject }}</span>
            <span class="flex min-w-0 items-center gap-1.5 px-2 text-muted">
              <Avatar :name="c.author.name" :email="c.author.email" :size="20" />
              <span v-if="fullAuthor" class="truncate">{{ c.author.name }}</span>
            </span>
            <span v-if="showHash" class="px-2 font-mono text-[12px] text-faint">{{ c.shortHash }}</span>
            <span class="truncate px-2 text-muted" :title="fullDate(c.date)">{{ relativeTime(c.date) }}</span>
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
