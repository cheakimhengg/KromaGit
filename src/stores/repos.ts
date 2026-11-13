import { defineStore } from 'pinia'
import { computed, markRaw, reactive, ref, shallowReactive, watch } from 'vue'
import type { Commit, HeadInfo, RefsPayload, RepoSnapshot, StatusPayload } from '@/types/git'
import { computeGraphLayout, type GraphLayout } from '@/lib/graph-layout'
import { invoke } from '@tauri-apps/api/core'
import { errorMessage, gitApi, inTauri } from '@/api/git'
import { repoNameFromUrl } from '@/lib/format'
import { useUiStore } from './ui'

const groupId = () => `group-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4)}`

export interface TabGroup {
  id: string
  name: string
  color: string
  collapsed?: boolean
}

export interface RepoTab {
  id: string
  name: string
  path: string
  groupId?: string
}

export interface RepoState {
  snapshot: RepoSnapshot
  layout: GraphLayout
  loading: { commits: boolean; refs: boolean; status: boolean }
  commitsComplete: boolean
  /** how many commits are requested; grows as the user scrolls */
  commitLimit: number
  loaded: boolean
  error: string | null
}

export const GROUP_COLORS = ['#7c9cff', '#5eead4', '#f472b6', '#fbbf24', '#a78bfa', '#34d399']
export const FIRST_PAGE = 200
export const MAX_COMMITS = 200_000
const STORAGE_KEY = 'kromagit.workspace.v1'
const RECENT_KEY = 'kromagit.recent.v1'
const MAX_RECENT = 40

export interface RecentRepo {
  name: string
  path: string
  openedAt: number
}

function readRecent(): RecentRepo[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((r) => r && typeof r.path === 'string').slice(0, MAX_RECENT) : []
  } catch {
    return []
  }
}

const EMPTY_HEAD: HeadInfo = { branch: null, oid: null, detached: false, upstream: null, ahead: 0, behind: 0 }

export function describeHead(head: HeadInfo): string {
  if (head.detached) return head.oid ? `detached at ${head.oid.slice(0, 7)}` : 'detached HEAD'
  return head.branch ?? '—'
}

function emptySnapshot(tab: RepoTab): RepoSnapshot {
  return {
    name: tab.name, path: tab.path, head: EMPTY_HEAD, currentBranch: '—', commits: [], branches: [], remotes: [],
    tags: [], stashes: [], worktrees: [], submodules: [], lastFetch: null, workingCopy: { staged: [], unstaged: [] }, operation: null,
  }
}

let seq = 0
const newId = () => `tab-${Date.now().toString(36)}-${++seq}`

const DEMO_TABS: RepoTab[] = [
  { id: 'demo-1', name: 'KromaGit', path: '~/Documents/Projects/kromagit' },
  { id: 'demo-2', name: 'payments-api', path: '~/code/payments-api', groupId: 'backend' },
  { id: 'demo-3', name: 'auth-service', path: '~/code/auth-service', groupId: 'backend' },
  { id: 'demo-4', name: 'web-portal', path: '~/code/web-portal', groupId: 'frontend' },
]
const DEFAULT_GROUPS: TabGroup[] = [
  { id: 'backend', name: 'Backend', color: GROUP_COLORS[0] },
  { id: 'frontend', name: 'Frontend', color: GROUP_COLORS[2] },
]

interface Workspace {
  tabs: RepoTab[]
  groups: TabGroup[]
  activeTabId: string
}

function loadWorkspace(): Workspace {
  if (!inTauri) return { tabs: DEMO_TABS.map((t) => ({ ...t })), groups: DEFAULT_GROUPS, activeTabId: DEMO_TABS[0].id }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const ws = JSON.parse(raw) as Workspace
      if (Array.isArray(ws.tabs) && Array.isArray(ws.groups)) return ws
    }
  } catch {
    /* corrupted workspace: start fresh */
  }
  return { tabs: [], groups: DEFAULT_GROUPS, activeTabId: '' }
}

export const useReposStore = defineStore('repos', () => {
  const ws = loadWorkspace()
  const groups = ref<TabGroup[]>(ws.groups)
  const tabs = ref<RepoTab[]>(ws.tabs)
  const activeTabId = ref<string>(ws.tabs.some((t) => t.id === ws.activeTabId) ? ws.activeTabId : (ws.tabs[0]?.id ?? ''))
  const states = shallowReactive(new Map<string, RepoState>())
  const generations = new Map<string, { commits: number; refs: number; status: number }>()

  if (inTauri) {
    watch(
      [tabs, groups, activeTabId],
      () => localStorage.setItem(STORAGE_KEY, JSON.stringify({ tabs: tabs.value, groups: groups.value, activeTabId: activeTabId.value })),
      { deep: true },
    )
  }

  const activeTab = computed(() => tabs.value.find((t) => t.id === activeTabId.value) ?? null)
  const active = computed<RepoState | null>(() => (activeTab.value ? states.get(activeTab.value.id) ?? null : null))
  const busy = computed(() => {
    const l = active.value?.loading
    return !!l && (l.commits || l.refs || l.status)
  })

  function ensureState(tab: RepoTab): RepoState {
    let s = states.get(tab.id)
    if (!s) {
      s = shallowReactive<RepoState>({
        snapshot: markRaw(emptySnapshot(tab)),
        layout: markRaw({ rows: [], maxLanes: 1 }),
        loading: reactive({ commits: false, refs: false, status: false }),
        commitsComplete: false,
        commitLimit: FIRST_PAGE,
        loaded: false,
        error: null,
      })
      states.set(tab.id, s)
      generations.set(tab.id, { commits: 0, refs: 0, status: 0 })
    }
    return s
  }

  function patch(state: RepoState, partial: Partial<RepoSnapshot>) {
    const next = { ...state.snapshot, ...partial }
    next.currentBranch = describeHead(next.head)
    state.snapshot = markRaw(next)
  }

  function setCommits(state: RepoState, commits: Commit[]) {
    state.layout = markRaw(computeGraphLayout(commits))
    patch(state, { commits: markRaw(commits) })
  }

  function reportError(state: RepoState, e: unknown, what: string) {
    const msg = errorMessage(e)
    if (!state.loaded) state.error = msg
    useUiStore().toast({ kind: 'error', title: `Could not load ${what}`, detail: msg }, 6000)
  }

  async function loadCommits(tab: RepoTab) {
    const state = ensureState(tab)
    const gen = ++generations.get(tab.id)!.commits
    const current = () => generations.get(tab.id)?.commits === gen
    state.loading.commits = true
    try {
      const limit = Math.min(state.commitLimit, MAX_COMMITS)
      const list = await gitApi.getCommits(tab.path, limit)
      if (!current()) return
      setCommits(state, list)
      state.commitsComplete = list.length < limit || limit >= MAX_COMMITS
    } catch (e) {
      if (current()) reportError(state, e, 'history')
    } finally {
      if (current()) state.loading.commits = false
    }
  }

  /** Next page of history (pages double: 200, 400, 800…). */
  async function loadMoreCommits(tabId: string = activeTabId.value) {
    const tab = tabs.value.find((t) => t.id === tabId)
    const state = states.get(tabId)
    if (!tab || !state || state.loading.commits || state.commitsComplete) return
    state.commitLimit = Math.min(state.commitLimit * 2, MAX_COMMITS)
    await loadCommits(tab)
  }

  /** Whole history, e.g. so a search can find old commits. */
  async function loadAllCommits(tabId: string = activeTabId.value) {
    const tab = tabs.value.find((t) => t.id === tabId)
    const state = states.get(tabId)
    if (!tab || !state || state.commitsComplete || state.commitLimit >= MAX_COMMITS) return
    state.commitLimit = MAX_COMMITS
    await loadCommits(tab)
  }

  async function loadRefs(tab: RepoTab) {
    const state = ensureState(tab)
    const gen = ++generations.get(tab.id)!.refs
    state.loading.refs = true
    try {
      const refs: RefsPayload = await gitApi.getRefs(tab.path)
      if (generations.get(tab.id)?.refs !== gen) return
      patch(state, { ...refs })
    } catch (e) {
      reportError(state, e, 'branches')
    } finally {
      if (generations.get(tab.id)?.refs === gen) state.loading.refs = false
    }
  }

  async function loadStatus(tab: RepoTab): Promise<StatusPayload | null> {
    const state = ensureState(tab)
    const gen = ++generations.get(tab.id)!.status
    state.loading.status = true
    try {
      const status = await gitApi.getStatus(tab.path)
      if (generations.get(tab.id)?.status !== gen) return null
      patch(state, { head: status.head, workingCopy: { staged: status.staged, unstaged: status.unstaged }, operation: status.operation ?? null })
      return status
    } catch (e) {
      reportError(state, e, 'working copy')
      return null
    } finally {
      if (generations.get(tab.id)?.status === gen) state.loading.status = false
    }
  }

  async function load(tabId: string) {
    const tab = tabs.value.find((t) => t.id === tabId)
    if (!tab) return
    const state = ensureState(tab)
    state.error = null
    await Promise.all([loadCommits(tab), loadRefs(tab), loadStatus(tab)])
    state.loaded = true
  }

  /** Cheap refresh (e.g. on window focus): reload history only if HEAD or branch tips moved. */
  /** Re-reads repository state after a write action without clearing what is on screen. */
  async function refresh(tabId: string, scope: 'status' | 'all') {
    const tab = tabs.value.find((t) => t.id === tabId)
    if (!tab) return
    if (scope === 'status') await loadStatus(tab)
    else await Promise.all([loadStatus(tab), loadRefs(tab), loadCommits(tab)])
  }

  async function softRefresh(tabId = activeTabId.value) {
    const tab = tabs.value.find((t) => t.id === tabId)
    const state = tab && states.get(tab.id)
    if (!tab || !state?.loaded || state.loading.commits) return
    const before = state.snapshot
    const tipsBefore = before.branches.map((b) => `${b.name}:${b.tipHash}`).join('|')
    const [status] = await Promise.all([loadStatus(tab), loadRefs(tab)])
    const after = state.snapshot
    const tipsAfter = after.branches.map((b) => `${b.name}:${b.tipHash}`).join('|')
    if ((status && status.head.oid !== before.head.oid) || tipsBefore !== tipsAfter || after.tags.length !== before.tags.length) {
      await loadCommits(tab)
    }
  }

  watch(
    activeTabId,
    (id) => {
      const tab = tabs.value.find((t) => t.id === id)
      if (tab && !states.get(id)?.loaded && !states.get(id)?.loading.commits) void load(id)
    },
    { immediate: true },
  )

  function activate(id: string) {
    activeTabId.value = id
    useUiStore().home = false
    const tab = tabs.value.find((t) => t.id === id)
    if (tab) rememberRecent(tab.name, tab.path)
  }

  const recent = ref<RecentRepo[]>(readRecent())
  function saveRecent() {
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(recent.value))
    } catch {
      /* ignore */
    }
  }
  function rememberRecent(name: string, path: string) {
    recent.value = [{ name, path, openedAt: Date.now() }, ...recent.value.filter((r) => r.path !== path)].slice(0, MAX_RECENT)
    saveRecent()
  }
  for (const t of tabs.value) {
    if (!recent.value.some((r) => r.path === t.path)) recent.value.push({ name: t.name, path: t.path, openedAt: Date.now() })
  }
  function forgetRecent(path: string) {
    recent.value = recent.value.filter((r) => r.path !== path)
    saveRecent()
  }

  async function openRepoAt(path: string) {
    const ui = useUiStore()
    try {
      const info = await gitApi.openRepo(path)
      const existing = tabs.value.find((t) => t.path === info.root)
      if (existing) {
        activate(existing.id)
        return
      }
      const tab: RepoTab = { id: newId(), name: info.name, path: info.root }
      tabs.value.push(tab)
      activate(tab.id)
    } catch (e) {
      ui.toast({ kind: 'error', title: 'Could not open repository', detail: errorMessage(e) }, 6000)
    }
  }

  async function openStartupPaths() {
    if (!inTauri) return
    const paths = await invoke<string[]>('startup_paths').catch(() => [] as string[])
    for (const p of paths) await openRepoAt(p)
  }

  async function openRepo() {
    if (!inTauri) {
      await openRepoAt(`~/code/repo-${tabs.value.length + 1}`)
      return
    }
    const { open } = await import('@tauri-apps/plugin-dialog')
    const dir = await open({ directory: true, multiple: false, title: 'Open a Git repository' })
    if (typeof dir === 'string') await openRepoAt(dir)
  }

  const cloning = ref<string | null>(null)

  async function cloneRepo() {
    const ui = useUiStore()
    const first = await ui.prompt({
      title: 'Clone repository',
      message: 'Paste an HTTPS or SSH URL. You will choose where to put it next.',
      fields: [{ key: 'url', label: 'Repository URL', placeholder: 'https://github.com/owner/repo.git', mono: true, validate: (v) => (v.trim() ? null : 'Enter a URL') }],
      confirmLabel: 'Next',
    })
    if (!first) return
    const url = first.values.url.trim()
    let parent = '~/code'
    if (inTauri) {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const dir = await open({ directory: true, multiple: false, title: 'Choose where to clone it' })
      if (typeof dir !== 'string') return
      parent = dir
    }
    const second = await ui.prompt({
      title: 'Clone repository',
      message: `Into ${parent}`,
      fields: [{ key: 'name', label: 'Folder name', initial: repoNameFromUrl(url), mono: true, validate: (v) => (/^[^/\\]+$/.test(v.trim()) && !['.', '..'].includes(v.trim()) ? null : 'Use a plain folder name') }],
      confirmLabel: 'Clone',
    })
    if (!second) return
    const name = second.values.name.trim()
    cloning.value = url
    ui.toast({ kind: 'info', title: `Cloning ${name}…`, detail: url }, 4000)
    try {
      const info = await gitApi.cloneRepo(url, parent, name)
      ui.toast({ kind: 'success', title: `Cloned ${info.name}` }, 2500)
      await openRepoAt(info.root)
    } catch (e) {
      ui.toast({ kind: 'error', title: 'Clone failed', detail: errorMessage(e) }, 9000)
    } finally {
      cloning.value = null
    }
  }

  function closeTab(id: string) {
    const idx = tabs.value.findIndex((t) => t.id === id)
    if (idx === -1) return
    tabs.value.splice(idx, 1)
    states.delete(id)
    generations.delete(id)
    if (activeTabId.value === id) {
      const fallback = tabs.value[idx] ?? tabs.value[idx - 1]
      activeTabId.value = fallback?.id ?? ''
    }
  }

  function setTabGroup(tabId: string, gid: string | undefined) {
    const tab = tabs.value.find((t) => t.id === tabId)
    if (!tab) return
    tab.groupId = gid
    // keep group members next to each other in tab order
    if (gid) {
      const idx = tabs.value.indexOf(tab)
      tabs.value.splice(idx, 1)
      let last = -1
      tabs.value.forEach((t, i) => {
        if (t.groupId === gid) last = i
      })
      tabs.value.splice(last === -1 ? idx : last + 1, 0, tab)
    }
  }

  function createGroup(name: string, color?: string): string {
    const used = new Set(groups.value.map((g) => g.color))
    const g: TabGroup = { id: groupId(), name: name.trim() || 'Group', color: color ?? GROUP_COLORS.find((c) => !used.has(c)) ?? GROUP_COLORS[groups.value.length % GROUP_COLORS.length] }
    groups.value.push(g)
    return g.id
  }

  async function promptNewGroup(tabId?: string) {
    const r = await useUiStore().prompt({
      title: 'New tab group',
      fields: [{ key: 'name', label: 'Group name', placeholder: 'Backend', validate: (v) => (v.trim().length > 24 ? 'Keep it under 24 characters' : null) }],
      confirmLabel: 'Create group',
    })
    if (!r) return
    const gid = createGroup(r.values.name)
    if (tabId) setTabGroup(tabId, gid)
  }

  /** Display name only; the folder on disk is untouched. Empty = back to the folder name. */
  async function renameTab(id: string) {
    const tab = tabs.value.find((t) => t.id === id)
    if (!tab) return
    const folder = tab.path.split(/[\\/]/).filter(Boolean).pop() ?? tab.name
    const r = await useUiStore().prompt({
      title: 'Rename tab',
      message: `Only changes how “${folder}” is shown in KromaGit. Leave empty to use the folder name.`,
      fields: [{ key: 'name', label: 'Tab name', initial: tab.name }],
      confirmLabel: 'Rename',
    })
    if (!r) return
    tab.name = r.values.name.trim() || folder
    rememberRecent(tab.name, tab.path)
  }

  async function renameGroup(gid: string) {
    const g = groups.value.find((x) => x.id === gid)
    if (!g) return
    const r = await useUiStore().prompt({ title: 'Rename group', fields: [{ key: 'name', label: 'Group name', initial: g.name }], confirmLabel: 'Rename' })
    if (r) g.name = r.values.name.trim() || g.name
  }

  function setGroupColor(gid: string, color: string) {
    const g = groups.value.find((x) => x.id === gid)
    if (g) g.color = color
  }

  function toggleGroupCollapsed(gid: string) {
    const g = groups.value.find((x) => x.id === gid)
    if (g) g.collapsed = !g.collapsed
  }

  /** Removes the group; its tabs stay open, ungrouped. */
  function ungroup(gid: string) {
    for (const t of tabs.value) if (t.groupId === gid) t.groupId = undefined
    groups.value = groups.value.filter((g) => g.id !== gid)
  }

  async function closeGroup(gid: string) {
    const members = tabs.value.filter((t) => t.groupId === gid)
    const g = groups.value.find((x) => x.id === gid)
    if (!g) return
    if (members.length) {
      const ok = await useUiStore().confirm({ title: `Close ${members.length} ${members.length === 1 ? 'tab' : 'tabs'} in “${g.name}”?`, message: 'The repositories are not changed; you can reopen them any time.', confirmLabel: 'Close tabs' })
      if (!ok) return
    }
    for (const t of members) closeTab(t.id)
    groups.value = groups.value.filter((x) => x.id !== gid)
  }

  /** Drag-and-drop: put `tabId` before `beforeId` (or at the end) and adopt the target's group. */
  function moveTab(tabId: string, beforeId: string | null, gid?: string | null) {
    const from = tabs.value.findIndex((t) => t.id === tabId)
    if (from === -1 || tabId === beforeId) return
    const [tab] = tabs.value.splice(from, 1)
    const to = beforeId ? tabs.value.findIndex((t) => t.id === beforeId) : -1
    if (to === -1) tabs.value.push(tab)
    else tabs.value.splice(to, 0, tab)
    if (gid !== undefined) tab.groupId = gid ?? undefined
  }

  function closeOtherTabs(keepId: string) {
    for (const t of tabs.value.filter((x) => x.id !== keepId)) closeTab(t.id)
  }

  return {
    groups, tabs, activeTabId, activeTab, active, busy, recent, forgetRecent,
    activate, openRepo, openRepoAt, cloneRepo, cloning, loadMoreCommits, loadAllCommits, openStartupPaths, closeTab, setTabGroup, load, refresh, softRefresh,
    createGroup, promptNewGroup, renameTab, renameGroup, setGroupColor, toggleGroupCollapsed, ungroup, closeGroup, moveTab, closeOtherTabs,
  }
})
