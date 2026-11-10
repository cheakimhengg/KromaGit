import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useReposStore } from '@/stores/repos'

describe('repos store', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('loads the active repo snapshot and graph layout', () => {
    const repos = useReposStore()
    expect(repos.active?.snapshot.commits.length).toBeGreaterThan(0)
    expect(repos.active?.layout.rows.length).toBe(repos.active?.snapshot.commits.length)
  })

  it('activates a neighbour when closing the active tab', () => {
    const repos = useReposStore()
    const [first, second] = repos.tabs
    repos.activate(first.id)
    repos.closeTab(first.id)
    expect(repos.activeTabId).toBe(second.id)
  })

  it('moves tabs between groups', () => {
    const repos = useReposStore()
    const tab = repos.tabs[0]
    repos.setTabGroup(tab.id, 'frontend')
    expect(repos.tabs[0].groupId).toBe('frontend')
    repos.setTabGroup(tab.id, undefined)
    expect(repos.tabs[0].groupId).toBeUndefined()
  })
})
