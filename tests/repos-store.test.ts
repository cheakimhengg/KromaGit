import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises } from './helpers'
import type { Commit, HeadInfo, RefsPayload, StatusPayload } from '@/types/git'

const api = vi.hoisted(() => ({
  openRepo: vi.fn(),
  getCommits: vi.fn(),
  getRefs: vi.fn(),
  getStatus: vi.fn(),
  getCommitDetails: vi.fn(),
  getFileDiff: vi.fn(),
}))

vi.mock('@/api/git', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/git')>()
  return { ...actual, gitApi: api, inTauri: false }
})

const { useReposStore, FIRST_PAGE, MAX_COMMITS } = await import('@/stores/repos')
const { useUiStore } = await import('@/stores/ui')

function chain(n: number, prefix = 'c'): Commit[] {
  return Array.from({ length: n }, (_, i) => ({
    hash: `${prefix}${i}`,
    shortHash: `${prefix}${i}`,
    parents: i + 1 < n ? [`${prefix}${i + 1}`] : [],
    author: { name: 'A', email: 'a@x.dev' },
    date: 0,
    subject: `commit ${i}`,
    refs: [],
  }))
}

const head = (oid: string): HeadInfo => ({ branch: 'main', oid, detached: false, upstream: null, ahead: 0, behind: 0 })
const refs = (tip = 'c0'): RefsPayload => ({
  branches: [{ name: 'main', current: true, ahead: 0, behind: 0, tipHash: tip }],
  remotes: [], tags: [], stashes: [], worktrees: [], submodules: [], lastFetch: null,
})
const status = (oid = 'c0'): StatusPayload => ({ head: head(oid), staged: [], unstaged: [{ path: 'a.txt', status: 'M', additions: 1, deletions: 0 }], operation: null })

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

describe('repos store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    api.getRefs.mockResolvedValue(refs())
    api.getStatus.mockResolvedValue(status())
  })

  it('loads a small repo in a single page', async () => {
    api.getCommits.mockResolvedValue(chain(5))
    const repos = useReposStore()
    await flushPromises()
    expect(api.getCommits).toHaveBeenCalledTimes(1)
    expect(api.getCommits).toHaveBeenCalledWith(repos.activeTab!.path, FIRST_PAGE)
    const s = repos.active!
    expect(s.snapshot.commits).toHaveLength(5)
    expect(s.layout.rows).toHaveLength(5)
    expect(s.commitsComplete).toBe(true)
    expect(s.snapshot.currentBranch).toBe('main')
    expect(s.snapshot.workingCopy.unstaged).toHaveLength(1)
    expect(s.loaded).toBe(true)
  })

  it('loads one page, then more only when asked (scrolling)', async () => {
    const total = 1000
    api.getCommits.mockImplementation((_p: string, limit: number) => Promise.resolve(chain(Math.min(limit, total))))
    const repos = useReposStore()
    await flushPromises()
    expect(api.getCommits).toHaveBeenCalledTimes(1)
    expect(repos.active!.snapshot.commits).toHaveLength(FIRST_PAGE)
    expect(repos.active!.commitsComplete).toBe(false)
    expect(repos.active!.loading.commits).toBe(false)

    await repos.loadMoreCommits()
    expect(api.getCommits).toHaveBeenLastCalledWith(expect.any(String), FIRST_PAGE * 2)
    expect(repos.active!.snapshot.commits).toHaveLength(FIRST_PAGE * 2)
    expect(repos.active!.layout.rows).toHaveLength(FIRST_PAGE * 2)

    await repos.loadMoreCommits()
    await repos.loadMoreCommits()
    expect(repos.active!.snapshot.commits).toHaveLength(total)
    expect(repos.active!.commitsComplete).toBe(true)
    const calls = api.getCommits.mock.calls.length
    await repos.loadMoreCommits()
    expect(api.getCommits.mock.calls.length).toBe(calls)
  })

  it('loads the whole history on demand (search)', async () => {
    api.getCommits.mockImplementation((_p: string, limit: number) => Promise.resolve(chain(Math.min(limit, 3000))))
    const repos = useReposStore()
    await flushPromises()
    await repos.loadAllCommits()
    expect(api.getCommits).toHaveBeenLastCalledWith(expect.any(String), MAX_COMMITS)
    expect(repos.active!.snapshot.commits).toHaveLength(3000)
    expect(repos.active!.commitsComplete).toBe(true)
  })

  it('ignores a stale response that arrives after a newer load', async () => {
    const slow = deferred<Commit[]>()
    api.getCommits.mockReturnValueOnce(slow.promise).mockResolvedValue(chain(3, 'new'))
    const repos = useReposStore()
    await flushPromises()
    await repos.load(repos.activeTabId)
    expect(repos.active!.snapshot.commits[0].hash).toBe('new0')
    slow.resolve(chain(2, 'old'))
    await flushPromises()
    expect(repos.active!.snapshot.commits[0].hash).toBe('new0')
  })

  it('surfaces load errors on the tab and as a toast', async () => {
    api.getCommits.mockRejectedValue({ kind: 'notARepo', message: 'Not a Git repository: /x' })
    const repos = useReposStore()
    const ui = useUiStore()
    await flushPromises()
    expect(repos.active!.error).toBe('Not a Git repository: /x')
    expect(ui.toasts.some((t) => t.kind === 'error')).toBe(true)
  })

  it('soft refresh reloads history only when HEAD moved', async () => {
    api.getCommits.mockResolvedValue(chain(3))
    const repos = useReposStore()
    await flushPromises()
    expect(api.getCommits).toHaveBeenCalledTimes(1)

    await repos.softRefresh()
    expect(api.getCommits).toHaveBeenCalledTimes(1)

    api.getStatus.mockResolvedValue(status('moved'))
    await repos.softRefresh()
    expect(api.getCommits).toHaveBeenCalledTimes(2)
  })

  it('opens a repo once and re-activates an existing tab', async () => {
    api.getCommits.mockResolvedValue(chain(1))
    api.openRepo.mockResolvedValue({ root: '/work/new-repo', name: 'new-repo' })
    const repos = useReposStore()
    const before = repos.tabs.length
    await repos.openRepoAt('/work/new-repo/src')
    await repos.openRepoAt('/work/new-repo')
    expect(repos.tabs).toHaveLength(before + 1)
    expect(repos.activeTab!.name).toBe('new-repo')
  })

  it('activates a neighbour when closing the active tab, and regroups tabs', async () => {
    api.getCommits.mockResolvedValue(chain(1))
    const repos = useReposStore()
    const [first, second] = repos.tabs
    repos.activate(first.id)
    repos.closeTab(first.id)
    expect(repos.activeTabId).toBe(second.id)
    repos.setTabGroup(second.id, 'frontend')
    expect(repos.tabs.find((t) => t.id === second.id)!.groupId).toBe('frontend')
  })

  it('keeps group members together and manages groups', async () => {
    api.getCommits.mockResolvedValue(chain(1))
    const repos = useReposStore()
    const loose = repos.tabs.find((t) => !t.groupId)!
    repos.setTabGroup(loose.id, 'backend')
    const order = repos.tabs.map((t) => t.groupId ?? '-')
    expect(order.lastIndexOf('backend') - order.indexOf('backend')).toBe(order.filter((g) => g === 'backend').length - 1)

    const gid = repos.createGroup('Infra')
    expect(repos.groups.find((g) => g.id === gid)?.name).toBe('Infra')
    repos.setTabGroup(loose.id, gid)
    repos.toggleGroupCollapsed(gid)
    expect(repos.groups.find((g) => g.id === gid)?.collapsed).toBe(true)
    repos.setGroupColor(gid, '#123456')
    expect(repos.groups.find((g) => g.id === gid)?.color).toBe('#123456')

    repos.ungroup(gid)
    expect(repos.groups.some((g) => g.id === gid)).toBe(false)
    expect(repos.tabs.find((t) => t.id === loose.id)?.groupId).toBeUndefined()

    const [a, b] = repos.tabs
    repos.moveTab(b.id, a.id, null)
    expect(repos.tabs[0].id).toBe(b.id)
    expect(repos.tabs[0].groupId).toBeUndefined()
    repos.moveTab(b.id, null)
    expect(repos.tabs[repos.tabs.length - 1].id).toBe(b.id)
  })
})
