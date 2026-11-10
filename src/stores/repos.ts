import { defineStore } from 'pinia'
import { computed, markRaw, ref } from 'vue'
import type { RepoSnapshot } from '@/types/git'
import { computeGraphLayout, type GraphLayout } from '@/lib/graph-layout'
import { createMockRepo } from '@/mock/data'

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

export const GROUP_COLORS = ['#7c9cff', '#5eead4', '#f472b6', '#fbbf24', '#a78bfa', '#34d399']

interface LoadedRepo {
  snapshot: RepoSnapshot
  layout: GraphLayout
}

let tabSeq = 0
const newId = () => `tab-${++tabSeq}`

export const useReposStore = defineStore('repos', () => {
  const groups = ref<TabGroup[]>([
    { id: 'backend', name: 'Backend', color: GROUP_COLORS[0] },
    { id: 'frontend', name: 'Frontend', color: GROUP_COLORS[2] },
  ])

  const tabs = ref<RepoTab[]>([
    { id: newId(), name: 'kromagit', path: '~/Documents/Projects/kromagit' },
    { id: newId(), name: 'payments-api', path: '~/code/payments-api', groupId: 'backend' },
    { id: newId(), name: 'auth-service', path: '~/code/auth-service', groupId: 'backend' },
    { id: newId(), name: 'web-portal', path: '~/code/web-portal', groupId: 'frontend' },
  ])

  const activeTabId = ref<string>(tabs.value[0].id)
  const cache = new Map<string, LoadedRepo>()

  const activeTab = computed(() => tabs.value.find((t) => t.id === activeTabId.value) ?? null)

  function load(tab: RepoTab): LoadedRepo {
    let repo = cache.get(tab.id)
    if (!repo) {
      const snapshot = createMockRepo(tab.name, tab.path)
      repo = markRaw({ snapshot: markRaw(snapshot), layout: markRaw(computeGraphLayout(snapshot.commits)) })
      cache.set(tab.id, repo)
    }
    return repo
  }

  const active = computed<LoadedRepo | null>(() => (activeTab.value ? load(activeTab.value) : null))

  function activate(id: string) {
    activeTabId.value = id
  }

  function openMockRepo() {
    const name = `repo-${tabSeq + 1}`
    const tab: RepoTab = { id: newId(), name, path: `~/code/${name}` }
    tabs.value.push(tab)
    activeTabId.value = tab.id
  }

  function closeTab(id: string) {
    const idx = tabs.value.findIndex((t) => t.id === id)
    if (idx === -1) return
    tabs.value.splice(idx, 1)
    cache.delete(id)
    if (activeTabId.value === id) {
      const fallback = tabs.value[idx] ?? tabs.value[idx - 1]
      activeTabId.value = fallback?.id ?? ''
    }
  }

  function setTabGroup(tabId: string, groupId: string | undefined) {
    const tab = tabs.value.find((t) => t.id === tabId)
    if (tab) tab.groupId = groupId
  }

  return { groups, tabs, activeTabId, activeTab, active, activate, openMockRepo, closeTab, setTabGroup }
})
