<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import {
  ArrowUpFromLine, GitPullRequestArrow, Archive, ArchiveRestore, ArrowDown, ArrowUp, Check, Cherry, Copy, GitMerge, SlidersHorizontal, GitBranchPlus, Loader2, Pencil, RotateCcw, Search, Tag, Trash2, Undo, User, X,
} from '@/lib/icons'
import GraphCell from './GraphCell.vue'
import RefPill from './RefPill.vue'
import { useReposStore } from '@/stores/repos'
import { useUiStore, type MenuItem } from '@/stores/ui'
import { ROW_HEIGHT, graphWidth, laneColor, laneSpacing, laneX } from '@/lib/lanes'
import { compactTime, fullDate } from '@/lib/format'
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
const commits = computed(() => repos.active?.graphCommits ?? [])
/** Search never hides commits: matches are highlighted and you jump between them, so the graph stays whole. */
const isSearching = computed(() => messageQuery.value.trim() !== '' || authorQuery.value.trim() !== '')

const matches = computed<number[]>(() => {
  if (!isSearching.value) return []
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
const matchSet = computed(() => new Set(matches.value))
const matchPos = ref(-1)

function goToMatch(pos: number) {
  const list = matches.value
  if (!list.length) return
  matchPos.value = ((pos % list.length) + list.length) % list.length
  const index = list[matchPos.value]
  ui.selectCommit(commits.value[index].hash)
  virtualizer.value.scrollToIndex(index, { align: 'center' })
}
function nextMatch(step: number) {
  if (matchPos.value === -1) goToMatch(step > 0 ? 0 : -1)
  else goToMatch(matchPos.value + step)
}
function onSearchKeydown(e: KeyboardEvent) {
  if (e.key !== 'Enter') return
  e.preventDefault()
  nextMatch(e.shiftKey ? -1 : 1)
}
let searchTimer: ReturnType<typeof setTimeout> | undefined
watch([messageQuery, authorQuery], () => {
  clearTimeout(searchTimer)
  matchPos.value = -1
  searchTimer = setTimeout(() => goToMatch(0), 200)
})
watch(
  () => matches.value.length,
  (n) => {
    if (n && matchPos.value === -1 && isSearching.value) goToMatch(0)
  },
)

const rowCount = computed(() => commits.value.length)

const virtualizer = useVirtualizer(
  computed(() => ({
    count: rowCount.value,
    getScrollElement: () => scrollEl.value,
    estimateSize: () => ROW_HEIGHT,
    overscan: 16,
  })),
)

const visibleLanes = computed(() => {
  const rows = layout.value?.rows
  if (!rows) return 1
  let max = 1
  const top = virtualizer.value.scrollOffset ?? 0
  const bottom = top + (scrollEl.value?.clientHeight ?? 0)
  for (const v of virtualizer.value.getVirtualItems()) {
    if (v.end <= top || v.start >= bottom) continue
    const r = rows[rowIndex(v.index)]
    if (!r) continue
    max = Math.max(max, r.lane + 1)
    for (const e of r.upper) max = Math.max(max, e.from + 1, e.to + 1)
    for (const e of r.lower) max = Math.max(max, e.from + 1, e.to + 1)
  }
  const w = layout.value?.wipRow
  if (w && changeCount.value) {
    max = Math.max(max, w.lane + 1)
    for (const e of w.lower) max = Math.max(max, e.from + 1, e.to + 1)
  }
  return max
})
const gWidth = computed(() => Math.max(graphWidth(visibleLanes.value), paneWidth.value >= 1100 ? 220 : paneWidth.value >= 850 ? 150 : 0))
const gSpacing = computed(() => laneSpacing(visibleLanes.value))

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
const wipRow = computed(() => layout.value?.wipRow ?? null)
/** WIP row edges: leave the node sideways if needed, then run down out of the 32px row */
const wipPaths = computed(() => {
  const w = wipRow.value
  if (!w) return []
  return w.lower.map((e) => {
    const x1 = laneX(e.from, gSpacing.value)
    const x2 = laneX(e.to, gSpacing.value)
    const d = x1 === x2 ? `M${x1} 16V32` : `M${x1} 16H${x2 - Math.sign(x2 - x1) * 6}Q${x2} 16 ${x2} 22V32`
    return { d, color: laneColor(e.color) }
  })
})
const stagedCount = computed(() => snapshot.value?.workingCopy.staged.length ?? 0)
const conflictCount = computed(() => snapshot.value?.workingCopy.unstaged.filter((f) => f.status === 'U').length ?? 0)
const unstagedCount = computed(() => (snapshot.value?.workingCopy.unstaged.length ?? 0) - conflictCount.value)
const wipActive = computed(() => !ui.selectedCommit && ui.centerView !== 'diff')
function openWip() {
  ui.selectCommit(null)
  ui.closeDiff()
}
watch(
  () => { const items = virtualizer.value.getVirtualItems(); return items.length ? items[items.length - 1].index : -1 },
  (last) => {
    if (complete.value || loadingCommits.value) return
    if (last >= rowCount.value - 40) void repos.loadMoreCommits()
  },
)
watch(isSearching, (on) => {
  if (on && !complete.value) void repos.loadAllCommits()
})

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
  author: visible.value.author && spare.value >= 520,
  hash: visible.value.hash && spare.value >= 700,
  date: visible.value.date,
}))
const refsWidth = computed(() => (spare.value >= 760 ? 170 : spare.value >= 640 ? 150 : 130))
const columns = computed(() =>
  [
    show.value.refs ? `${refsWidth.value}px` : null,
    show.value.graph ? `${gWidth.value}px` : null,
    'minmax(160px,1fr)',
    show.value.author ? '124px' : null,
    show.value.hash ? '68px' : null,
    show.value.date ? '84px' : null,
  ]
    .filter(Boolean)
    .join(' '),
)

function columnsMenu(e: MouseEvent) {
  e.preventDefault()
  const toggle = (id: ColumnId | 'band', label: string): MenuItem => ({
    label,
    icon: visible.value[id] ? Check : undefined,
    action: () => (visible.value[id] = !visible.value[id]),
  })
  const items: MenuItem[] = [
    { heading: true, label: 'Show in graph' },
    toggle('refs', 'Branches and tags'),
    { label: 'Commit message', icon: Check },
    toggle('author', 'Author'),
    toggle('hash', 'Hash'),
    toggle('date', 'Date'),
    toggle('band', 'Lane color band'),
  ]
  if (e.type === 'contextmenu') ui.openMenu(e, items)
  else ui.openMenuBelow(e.currentTarget as Element, items)
}

function displayRefs(c: Commit): { ref: RefLabel; hasRemote: boolean; label: string }[] {
  const strip = (n: string) => n.replace(/^[^/]+\//, '')
  const locals = new Set(c.refs.filter((r) => r.kind === 'local').map((r) => r.name))
  const remotes = c.refs.filter((r) => r.kind === 'remote' && !r.name.endsWith('/HEAD'))
  const hasCurrentLocal = c.refs.some((r) => r.kind === 'local' && r.current)
  const out: { ref: RefLabel; hasRemote: boolean; label: string }[] = []
  const seenRemote = new Set<string>()
  for (const r of c.refs) {
    if (r.kind === 'head' && hasCurrentLocal) continue
    if (r.kind === 'remote') {
      const short = strip(r.name)
      if (locals.has(short) || seenRemote.has(short) || r.name.endsWith('/HEAD')) continue
      seenRemote.add(short)
      out.push({ ref: r, hasRemote: true, label: short })
      continue
    }
    if (r.kind === 'stash') {
      out.push({ ref: r, hasRemote: false, label: c.subject })
      continue
    }
    out.push({ ref: r, hasRemote: r.kind === 'local' && remotes.some((x) => strip(x.name) === r.name), label: r.kind === 'head' ? 'HEAD' : r.name })
  }
  const rank = (x: { ref: RefLabel }) => (x.ref.current ? 0 : x.ref.kind === 'local' ? 1 : x.ref.kind === 'remote' ? 2 : 3)
  return out.sort((a, b) => rank(a) - rank(b))
}

/** Double-click: check out a branch at this commit (local first, else create a local branch from the remote one). */
function checkoutRef(r: RefLabel) {
  if (r.current || r.kind === 'tag' || r.kind === 'stash') return
  if (r.kind === 'local') return git.checkout(r.name)
  if (r.kind === 'remote') {
    const remote = r.name.split('/')[0]
    const branch = r.name.slice(remote.length + 1)
    const owner = commits.value.find((x) => x.refs.includes(r))
    // Already on this branch: "go back to the server's version" means moving the branch, not checking out
    if (branch === snapshot.value?.currentBranch && owner) {
      if (owner.hash === headOid.value) return
      return git.reset(owner.hash, 'hard')
    }
    return git.checkoutRemote(r.name, remote)
  }
}
function refMenu(e: MouseEvent, r: RefLabel, _label?: string) {
  const owner = commits.value.find((x) => x.refs.includes(r))
  if (r.kind === 'stash') {
    if (owner) stashMenu(e, owner)
    return
  }
  const current = snapshot.value?.currentBranch ?? 'HEAD'
  const items: MenuItem[] = [{ heading: true, mono: true, label: r.name }]
  const copy: MenuItem = { label: 'Copy name', icon: Copy, action: () => git.copyText(r.name, 'Copied name') }

  if (r.kind === 'local') {
    const branch = snapshot.value?.branches.find((b) => b.name === r.name)
    if (!r.current) {
      items.push(
        { label: `Checkout ${r.name}`, icon: Check, action: () => checkoutRef(r) },
        { separator: true },
        { label: `Merge ${r.name} into ${current}`, icon: GitMerge, action: () => git.merge(r.name) },
        { label: `Fast-forward ${current} to ${r.name}`, icon: ArrowUpFromLine, action: () => git.fastForward(r.name) },
        { label: `Rebase ${current} onto ${r.name}`, icon: GitPullRequestArrow, action: () => git.rebase(r.name) },
        { separator: true },
      )
    }
    items.push(
      { label: 'New branch from here…', icon: GitBranchPlus, action: () => git.createBranch({ ref: r.name, label: r.name }) },
      { label: 'New tag here…', icon: Tag, action: () => git.createTag({ ref: r.name, label: r.name }) },
      { label: 'Rename…', icon: Pencil, action: () => git.renameBranch(r.name) },
    )
    if (branch) items.push({ label: branch.upstream ? 'Push' : 'Push and set upstream', icon: ArrowUpFromLine, action: () => git.pushBranch(branch) })
    items.push(copy)
    if (!r.current) items.push({ separator: true }, { label: `Delete ${r.name}…`, icon: Trash2, danger: true, action: () => git.deleteBranch(r.name) })
  } else if (r.kind === 'remote') {
    const slash = r.name.indexOf('/')
    const remote = r.name.slice(0, slash)
    const branch = r.name.slice(slash + 1)
    if (branch === current && owner) {
      items.push(
        { label: `Reset ${current} to ${r.name}…`, icon: RotateCcw, action: () => git.reset(owner.hash, 'hard') },
        { separator: true },
      )
    } else items.push({ label: `Checkout ${branch}`, icon: Check, action: () => checkoutRef(r) }, { separator: true })
    items.push(
      { label: `Merge ${r.name} into ${current}`, icon: GitMerge, action: () => git.merge(r.name) },
      { label: `Fast-forward ${current} to ${r.name}`, icon: ArrowUpFromLine, action: () => git.fastForward(r.name) },
      { label: `Rebase ${current} onto ${r.name}`, icon: GitPullRequestArrow, action: () => git.rebase(r.name) },
      { separator: true },
      { label: 'New branch from here…', icon: GitBranchPlus, action: () => git.createBranch({ ref: r.name, label: r.name }) },
      copy,
      { separator: true },
      { label: `Delete ${r.name} on remote…`, icon: Trash2, danger: true, action: () => git.deleteRemoteBranch(remote, branch) },
    )
  } else if (r.kind === 'tag') {
    if (owner) items.push({ label: `Checkout ${r.name}`, icon: Check, action: () => git.checkoutCommit(owner.hash) })
    items.push(
      { label: `Merge ${r.name} into ${current}`, icon: GitMerge, action: () => git.merge(r.name) },
      { separator: true },
      { label: 'New branch from tag…', icon: GitBranchPlus, action: () => git.createBranch({ ref: r.name, label: r.name }) },
      copy,
      { separator: true },
      { label: `Delete ${r.name}…`, icon: Trash2, danger: true, action: () => git.deleteTag(r.name) },
    )
  } else {
    items.push(copy)
  }
  ui.openMenu(e, items)
}

function onRowDblClick(c: Commit) {
  if (c.stash !== undefined) return
  if (c.hash === headOid.value) return
  const refs = displayRefs(c).map((x) => x.ref)
  const target = refs.find((r) => r.kind === 'local') ?? refs.find((r) => r.kind === 'remote')
  if (target) void checkoutRef(target)
}

function stashMenu(e: MouseEvent, c: Commit) {
  const index = c.stash!
  ui.openMenu(e, [
    { heading: true, label: c.subject },
    { label: 'Pop (apply and remove)', icon: ArchiveRestore, action: () => git.stashPop(index) },
    { label: 'Apply (keep stash)', icon: Archive, action: () => git.stashApply(index) },
    { separator: true },
    { label: 'Copy hash', icon: Copy, shortcut: c.shortHash, action: () => git.copyText(c.hash, 'Copied hash') },
    { separator: true },
    { label: 'Drop…', icon: Trash2, danger: true, action: () => git.stashDrop(index, c.subject) },
  ])
}

/** ⌘/Ctrl-click adds or removes commits, Shift-click selects a range; used for cherry-picking or reverting several at once. */
const picked = ref(new Set<string>())
const pickable = (c: Commit | undefined) => !!c && c.stash === undefined

function onRowClick(e: MouseEvent, c: Commit) {
  if (!pickable(c) || !(e.metaKey || e.ctrlKey || e.shiftKey)) {
    picked.value = new Set()
    ui.selectCommit(c.hash)
    return
  }
  const anchor = ui.selectedCommit
  if (e.shiftKey && anchor) {
    const [a, b] = [displayIndexOf(anchor), displayIndexOf(c.hash)].sort((x, y) => x - y)
    if (a >= 0) {
      picked.value = new Set(commits.value.slice(a, b + 1).filter(pickable).map((x) => x.hash))
      return
    }
  }
  const next = new Set(picked.value)
  if (!next.size && anchor && pickable(commits.value[displayIndexOf(anchor)])) next.add(anchor)
  if (next.has(c.hash)) next.delete(c.hash)
  else next.add(c.hash)
  picked.value = next
  ui.selectCommit(c.hash)
}

watch(() => repos.activeTabId, () => (picked.value = new Set()))
function onWindowEsc(ev: KeyboardEvent) {
  if (ev.key !== 'Escape' || !picked.value.size || document.querySelector('[role="dialog"]')) return
  picked.value = new Set()
}
onMounted(() => window.addEventListener('keydown', onWindowEsc))
onBeforeUnmount(() => window.removeEventListener('keydown', onWindowEsc))

function multiMenu(e: MouseEvent) {
  const newestFirst = commits.value.filter((c) => picked.value.has(c.hash)).map((c) => c.hash)
  const n = newestFirst.length
  const branch = snapshot.value?.currentBranch ?? 'HEAD'
  ui.openMenu(e, [
    { label: `Cherry-pick ${n} commits onto ${branch}`, icon: Cherry, action: () => git.cherryPickMany([...newestFirst].reverse()) },
    { label: `Revert ${n} commits`, icon: Undo, action: () => git.revertMany(newestFirst) },
    { separator: true },
    { label: `Copy ${n} hashes`, icon: Copy, action: () => git.copyText([...newestFirst].reverse().join('\n'), `Copied ${n} hashes`) },
    { label: 'Clear selection', icon: X, action: () => (picked.value = new Set()) },
  ])
}

function commitMenu(e: MouseEvent, c: Commit) {
  if (picked.value.size > 1 && picked.value.has(c.hash)) return multiMenu(e)
  if (picked.value.size) picked.value = new Set()
  if (c.stash !== undefined) return stashMenu(e, c)
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
  else if (e.key === 'Escape' && picked.value.size) {
    picked.value = new Set()
    e.stopPropagation()
    return
  } else if (e.key === 'Escape' && ui.selectedCommit) {
    ui.selectCommit(null)
    e.stopPropagation()
    return
  } else return
  e.preventDefault()
  if (next < 0) next = 0
  picked.value = new Set()
  ui.selectCommit(commits.value[rowIndex(next)].hash)
  virtualizer.value.scrollToIndex(next, { align: 'auto' })
}

function displayIndexOf(hash: string): number {
  return commits.value.findIndex((c) => c.hash === hash)
}

function rowIndex(virtualIndex: number) {
  return virtualIndex
}
</script>

<template>
  <div ref="rootEl" class="flex h-full min-w-0 flex-col bg-bg">
    <div class="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
      <div class="relative w-64 min-w-28 shrink">
        <Search :size="13" class="gw-search-icon" />
        <input ref="searchInput" v-model="messageQuery" class="gw-input gw-search" placeholder="Search commits…" title="Search by message or commit hash — Enter for the next match, Shift+Enter for the previous" spellcheck="false" @keydown="onSearchKeydown" />
      </div>
      <div class="relative w-44 min-w-24 shrink">
        <User :size="13" class="gw-search-icon" />
        <input v-model="authorQuery" class="gw-input gw-search" placeholder="Find author…" title="Enter for the next commit by this author, Shift+Enter for the previous" spellcheck="false" @keydown="onSearchKeydown" />
      </div>
      <template v-if="isSearching">
        <span class="shrink-0 font-mono text-[12px] whitespace-nowrap" :class="matches.length ? 'text-muted' : 'text-danger'">
          {{ matches.length ? `${matchPos + 1 || '–'} of ${matches.length.toLocaleString()}` : 'No matches' }}
        </span>
        <button type="button" class="rounded p-1 text-muted hover:bg-hover hover:text-fg disabled:opacity-30" :disabled="!matches.length" title="Previous match (Shift+Enter)" @click="nextMatch(-1)"><ArrowUp :size="14" /></button>
        <button type="button" class="rounded p-1 text-muted hover:bg-hover hover:text-fg disabled:opacity-30" :disabled="!matches.length" title="Next match (Enter)" @click="nextMatch(1)"><ArrowDown :size="14" /></button>
        <button type="button" class="flex items-center gap-1 rounded px-1.5 py-1 text-[12px] text-muted hover:bg-hover hover:text-fg" @click="messageQuery = ''; authorQuery = ''">
          <X :size="14" />Clear
        </button>
      </template>
      <div class="flex-1" />
      <span class="shrink-0 font-mono text-[12px] whitespace-nowrap text-muted">
        {{ commits.length.toLocaleString() }}{{ complete ? '' : '+' }} commits
      </span>
      <span v-if="loadingCommits" class="flex items-center gap-1 text-[12px] text-faint">
        <Loader2 :size="14" class="animate-spin" />{{ !commits.length ? 'loading' : isSearching ? 'searching full history' : 'loading more' }}
      </span>
      <button
        type="button" class="flex shrink-0 items-center rounded-md p-1 text-muted hover:bg-hover hover:text-fg"
        title="Choose columns" @click="columnsMenu"
      ><SlidersHorizontal :size="16" /></button>
    </div>

    <div
      class="grid h-8 shrink-0 items-center overflow-y-hidden border-b border-line bg-surface [scrollbar-gutter:stable] text-[12px] font-medium text-faint"
      :style="{ gridTemplateColumns: columns }"
      title="Right-click to choose columns"
      @contextmenu="columnsMenu"
    >
      <span v-if="show.refs" class="truncate px-3">Branch / Tag</span>
      <span v-if="show.graph" class="px-2">Graph</span>
      <span class="px-2" :class="{ 'pl-3': !show.refs && !show.graph }">Message</span>
      <span v-if="show.author" class="truncate px-2">Author</span>
      <span v-if="show.hash" class="px-2">Hash</span>
      <span v-if="show.date" class="px-3 text-right">Date</span>
    </div>

    <div
      v-if="changeCount"
      role="button" tabindex="0"
      class="grid h-8 shrink-0 cursor-pointer items-center overflow-y-hidden [scrollbar-gutter:stable] border-b border-dashed border-line transition-colors"
      :class="wipActive ? 'bg-select' : 'bg-surface/50 hover:bg-surface-2'"
      :style="{ gridTemplateColumns: columns }"
      title="Show uncommitted changes"
      @click="openWip"
      @keydown.enter="openWip"
    >
      <span v-if="show.refs" class="px-3">
        <span class="inline-flex h-[21px] items-center rounded-full border border-dashed border-faint px-2 text-[12px] text-muted">WIP</span>
      </span>
      <svg v-if="show.graph" :width="gWidth" height="32" class="block">
        <template v-if="wipRow">
          <path v-for="(p, i) in wipPaths" :key="i" :d="p.d" :stroke="p.color" stroke-width="2" fill="none" stroke-dasharray="3 3" />
          <circle :cx="laneX(wipRow.lane, gSpacing)" cy="16" r="9" fill="var(--gw-bg)" :stroke="laneColor(wipRow.color)" stroke-width="2" stroke-dasharray="3 2.5" />
        </template>
        <circle v-else :cx="laneX(headLane, gSpacing)" cy="16" r="9" fill="none" :stroke="laneColor(layout?.rows[headIndex]?.color ?? 0)" stroke-width="2" stroke-dasharray="3 2.5" />
      </svg>
      <span class="flex items-center gap-2 px-2 text-[13px] whitespace-nowrap" :class="{ 'pl-3': !show.refs && !show.graph }">
        <Pencil :size="14" class="shrink-0 text-accent" />
        <span class="text-fg">{{ changeCount }} uncommitted {{ changeCount === 1 ? 'change' : 'changes' }}</span>
        <span v-if="conflictCount" class="rounded-full bg-danger/15 px-2 py-px text-[12px] font-medium text-danger">{{ conflictCount }} conflicted</span>
        <span v-if="stagedCount" class="rounded-full bg-success/15 px-2 py-px text-[12px] font-medium text-success">{{ stagedCount }} staged</span>
        <span v-if="unstagedCount" class="rounded-full bg-accent/15 px-2 py-px text-[12px] font-medium text-accent">{{ unstagedCount }} modified</span>
      </span>
    </div>

    <div ref="scrollEl" class="min-h-0 flex-1 overflow-auto outline-none [scrollbar-gutter:stable]" tabindex="0" :data-esc-clears="picked.size ? '' : undefined" @keydown="onListKey">
      <div class="relative w-full" :style="{ height: `${virtualizer.getTotalSize()}px` }">
        <!-- one moving block of rows in normal flow: rows share edges, so no hairline gaps at fractional zoom -->
        <div class="absolute top-0 left-0 w-full" :style="{ transform: `translateY(${virtualizer.getVirtualItems()[0]?.start ?? 0}px)` }">
        <template v-for="v in virtualizer.getVirtualItems()" :key="v.index">
          <div
            v-for="c in [commits[rowIndex(v.index)]]"
            :key="c.hash"
            class="grid w-full cursor-pointer items-center text-[13px]"
            :class="[ui.selectedCommit === c.hash || picked.has(c.hash) ? 'bg-select' : 'hover:bg-surface-2', isSearching && !matchSet.has(rowIndex(v.index)) ? 'opacity-35' : '']"
            :style="{ height: `${ROW_HEIGHT}px`, gridTemplateColumns: columns, '--lane': laneColor(layout!.rows[rowIndex(v.index)].color) }"
            @click="onRowClick($event, c)"
            @dblclick="onRowDblClick(c)"
            @contextmenu="commitMenu($event, c)"
          >
            <span v-if="show.refs" class="flex min-w-0 items-center gap-1 overflow-hidden pl-3">
              <template v-for="(r, i) in displayRefs(c)" :key="r.ref.name">
                <RefPill v-if="i < 1" class="min-w-0 shrink cursor-pointer" :label="r.label" :title="r.ref.kind === 'stash' ? r.label : r.ref.name" @dblclick.stop="checkoutRef(r.ref)" @contextmenu.stop.prevent="refMenu($event, r.ref, r.label)" :ref-label="r.ref" :has-remote="r.hasRemote" :color="laneColor(layout!.rows[rowIndex(v.index)].color)" />
              </template>
              <span v-if="displayRefs(c).length > 1" class="shrink-0 rounded-full bg-surface-3 px-1.5 text-[11px] leading-[18px] text-muted" :title="displayRefs(c).slice(1).map((r) => r.label).join(', ')">
                +{{ displayRefs(c).length - 1 }}
              </span>
              <span
                v-if="displayRefs(c).length && show.graph" class="ml-1 h-[1.5px] min-w-[6px] flex-1"
                :style="{ background: laneColor(layout!.rows[rowIndex(v.index)].color) }"
              />
            </span>
            <GraphCell
              v-if="show.graph"
              :row="layout!.rows[rowIndex(v.index)]"
              :width="gWidth"
              :lane-width="gSpacing"
              :author-name="c.author.name"
              :author-email="c.author.email"
              :commit-hash="c.hash"
              :has-refs="displayRefs(c).length > 0 && show.refs"
              :band="visible.band"
              :is-head="c.hash === headOid"
              :stash="c.stash !== undefined"
            />
            <span
              class="flex h-full min-w-0 items-center gap-1.5 truncate px-2.5 text-[14px]" :class="[c.parents.length > 1 || c.stash !== undefined ? 'text-muted' : 'text-fg', { 'pl-3': !show.refs && !show.graph }]"
            >
              <template v-if="!show.refs">
                <RefPill
                  v-for="r in displayRefs(c).slice(0, 2)" :key="r.ref.name" class="shrink-0" :label="r.label"
                  @contextmenu.stop.prevent="refMenu($event, r.ref, r.label)"
                  :ref-label="r.ref" :has-remote="r.hasRemote" :color="laneColor(layout!.rows[rowIndex(v.index)].color)"
                />
              </template>
              <GitMerge v-if="c.parents.length > 1" :size="15" class="shrink-0 text-faint" />
              <span class="truncate">{{ c.subject }}</span>
            </span>
            <span v-if="show.author" class="flex min-w-0 items-center gap-1.5 px-2 text-muted">
              <span class="truncate" :title="`${c.author.name} <${c.author.email}>`">{{ c.author.name }}</span>
            </span>
            <span v-if="show.hash" class="px-2 font-mono text-[12px] text-faint">{{ c.shortHash }}</span>
            <span v-if="show.date" class="truncate px-3 text-right font-mono text-[12px] text-muted tabular-nums" :title="fullDate(c.date)">{{ compactTime(c.date) }}</span>
          </div>
        </template>
        </div>
      </div>
      <div v-if="!commits.length && loadingCommits" class="gw-skel-wrap space-y-3 p-4" role="status" aria-label="Loading history">
        <div v-for="i in 8" :key="i" class="flex items-center gap-3">
          <div class="gw-skel h-4 w-4 rounded-full" />
          <div class="gw-skel h-3" :style="{ width: `${30 + ((i * 37) % 45)}%` }" />
        </div>
      </div>
      <div v-else-if="!commits.length" class="p-8 text-center text-[13px] text-faint">No commits yet — make your first commit to see history here.</div>
    </div>
  </div>
</template>
