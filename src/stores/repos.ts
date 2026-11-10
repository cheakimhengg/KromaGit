import { defineStore } from 'pinia'
import { computed, markRaw, reactive, ref, shallowReactive, watch } from 'vue'
import type { Commit, HeadInfo, RefsPayload, RepoSnapshot, StatusPayload } from '@/types/git'
import { computeGraphLayout, type GraphLayout } from '@/lib/graph-layout'
import { invoke } from '@tauri-apps/api/core'
import { errorMessage, gitApi, inTauri } from '@/api/git'
import { useUiStore } from './ui'

export interface TabGroup {
  id: string
  name: string
  color: string
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
  loaded: boolean
  error: string | null
}

export const GROUP_COLORS = ['#7c9cff', '#5eead4', '#f472b6', '#fbbf24', '#a78bfa', '#34d399']
export const FIRST_PAGE = 1500
export const MAX_COMMITS = 200_000
const STORAGE_KEY = 'kromagit.workspace.v1'

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
  { id: 'demo-1', name: 'kromagit', path: '~/Documents/Projects/kromagit' },
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
      const first = await gitApi.getCommits(tab.path, FIRST_PAGE)
      if (!current()) return
      setCommits(state, first)
      state.commitsComplete = first.length < FIRST_PAGE
      if (!state.commitsComplete) {
        const all = await gitApi.getCommits(tab.path, MAX_COMMITS)
        if (!current()) return
        setCommits(state, all)
        state.commitsComplete = true
      }
    } catch (e) {
      if (current()) reportError(state, e, 'history')
    } finally {
      if (current()) state.loading.commits = false
    }
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
  }

  async function openRepoAt(path: string) {
    const ui = useUiStore()
    try {
      const info = await gitApi.openRepo(path)
      const existing = tabs.value.find((t) => t.path === info.root)
      if (existing) {
        activeTabId.value = existing.id
        return
      }
      const tab: RepoTab = { id: newId(), name: info.name, path: info.root }
      tabs.value.push(tab)
      activeTabId.value = tab.id
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

  function setTabGroup(tabId: string, groupId: string | undefined) {
    const tab = tabs.value.find((t) => t.id === tabId)
    if (tab) tab.groupId = groupId
  }

  return {
    groups, tabs, activeTabId, activeTab, active, busy,
    activate, openRepo, openRepoAt, openStartupPaths, closeTab, setTabGroup, load, refresh, softRefresh,
  }
})
