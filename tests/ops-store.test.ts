import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises } from './helpers'
import type { GitAction, OpOutcome } from '@/types/git'

const api = vi.hoisted(() => ({
  openRepo: vi.fn(),
  getCommits: vi.fn(),
  getRefs: vi.fn(),
  getStatus: vi.fn(),
  getCommitDetails: vi.fn(),
  getFileDiff: vi.fn(),
  runAction: vi.fn(),
  openInTerminal: vi.fn(),
  openInEditor: vi.fn(),
}))

vi.mock('@/api/git', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/git')>()
  return { ...actual, gitApi: api, inTauri: false }
})

const { useOpsStore } = await import('@/stores/ops')
const { useReposStore } = await import('@/stores/repos')
const { useUiStore } = await import('@/stores/ui')
const git = await import('@/actions/git')

let head = 'h1'
const outcome = (before: string | null, after: string | null, data: string | null = null): OpOutcome => ({
  before: { oid: before, branch: 'main' },
  after: { oid: after, branch: 'main' },
  data,
  output: '',
})
const actions = () => api.runAction.mock.calls.map((c) => c[1] as GitAction)
const lastAction = () => actions()[actions().length - 1]

async function answerDialog(ok: boolean, values: Record<string, string> = {}, checks: Record<string, boolean> = {}) {
  await flushPromises(2)
  const ui = useUiStore()
  expect(ui.dialog).not.toBeNull()
  ui.closeDialog(ok ? { values, checks } : null)
}

describe('ops store', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    head = 'h1'
    api.getCommits.mockResolvedValue([])
    api.getRefs.mockResolvedValue({ branches: [], remotes: [], tags: [], stashes: [], worktrees: [], submodules: [], lastFetch: null })
    api.getStatus.mockImplementation(async () => ({
      head: { branch: 'main', oid: head, detached: false, upstream: null, ahead: 0, behind: 0 },
      staged: [], unstaged: [], operation: null,
    }))
    useReposStore()
    await flushPromises()
  })

  it('runs an action, records undo, then undoes and redoes it', async () => {
    const ops = useOpsStore()
    api.runAction.mockImplementation(async (_repo: string, a: GitAction) => {
      if (a.type === 'commit') {
        head = 'h2'
        return outcome('h1', 'h2')
      }
      if (a.type === 'reset') {
        head = a.target
        return outcome(null, a.target)
      }
      return outcome(head, head)
    })

    await git.commit('feat: x', false)
    expect(ops.nextUndo?.label).toBe('Commit')
    expect(useUiStore().toasts.some((t) => t.title === 'Committed')).toBe(true)

    await ops.undo()
    expect(lastAction()).toEqual({ type: 'reset', target: 'h1', mode: 'soft' })
    expect(ops.nextUndo).toBeNull()
    expect(ops.nextRedo?.label).toBe('Commit')

    await ops.redo()
    expect(lastAction()).toEqual({ type: 'reset', target: 'h2', mode: 'soft' })
    expect(ops.nextUndo?.label).toBe('Commit')
  })

  it('refuses to undo when HEAD moved outside the app', async () => {
    const ops = useOpsStore()
    api.runAction.mockResolvedValue(outcome('h1', 'h2'))
    await git.commit('feat: x', false)
    head = 'someone-else'
    const calls = api.runAction.mock.calls.length
    await ops.undo()
    expect(api.runAction.mock.calls.length).toBe(calls)
    expect(ops.nextUndo).toBeNull()
    expect(useUiStore().toasts.some((t) => t.kind === 'error' && t.title.startsWith("Can't undo"))).toBe(true)
  })

  it('undoes the very first commit by deleting HEAD instead of resetting', async () => {
    const ops = useOpsStore()
    api.runAction.mockResolvedValueOnce(outcome(null, 'h1'))
    await git.commit('first', false)
    api.runAction.mockResolvedValue(outcome('h1', null))
    await ops.undo()
    expect(lastAction()).toEqual({ type: 'deleteHeadRef' })
  })

  it('shows git errors as toasts and records no undo', async () => {
    const ops = useOpsStore()
    api.runAction.mockRejectedValue({ kind: 'git', message: 'fatal: boom' })
    await git.checkout('feature')
    const t = useUiStore().toasts.find((x) => x.kind === 'error')
    expect(t?.title).toBe('Checkout feature failed')
    expect(t?.detail).toBe('fatal: boom')
    expect(ops.nextUndo).toBeNull()
    expect(ops.running).toBeNull()
  })

  it('never discards without confirmation, and splits tracked from untracked', async () => {
    api.runAction.mockResolvedValue(outcome('h1', 'h1', 'backup-oid'))
    const files = [
      { path: 'a.ts', status: 'M' as const, additions: 1, deletions: 0 },
      { path: 'new.ts', status: '?' as const, additions: 3, deletions: 0 },
    ]
    const cancelled = git.discard(files)
    await answerDialog(false)
    await cancelled
    expect(api.runAction).not.toHaveBeenCalled()

    const confirmed = git.discard(files)
    await answerDialog(true)
    await confirmed
    expect(actions()[0]).toEqual({ type: 'discard', paths: ['a.ts'], untracked: ['new.ts'] })
    const ops = useOpsStore()
    expect(ops.nextUndo?.undo).toEqual([{ type: 'stashApplyOid', oid: 'backup-oid' }])
  })

  it('builds the right inverse for each partial-patch direction', async () => {
    const ops = useOpsStore()
    const target = { path: 'f.ts', source: 'unstaged' as const }
    const sel = [{ header: '@@ -1 +1 @@', lines: [1] }]
    api.runAction.mockResolvedValue(outcome('h1', 'h1', 'PATCH'))

    await git.applySelection(target, sel, 'stage')
    expect(ops.nextUndo?.undo).toEqual([{ type: 'applyPatch', patch: 'PATCH', cached: true, reverse: true }])

    await git.applySelection({ ...target, source: 'staged' }, sel, 'unstage')
    expect(ops.nextUndo?.undo).toEqual([{ type: 'applyPatch', patch: 'PATCH', cached: true, reverse: false }])

    const d = git.applySelection(target, sel, 'discard')
    await answerDialog(true)
    await d
    expect(ops.nextUndo?.undo).toEqual([{ type: 'applyPatch', patch: 'PATCH', cached: false, reverse: false }])
    expect(lastAction()).toMatchObject({ type: 'applySelection', source: 'unstaged', discard: true })
  })

  it('asks before force-deleting an unmerged branch', async () => {
    api.runAction
      .mockRejectedValueOnce({ kind: 'git', message: "error: the branch 'x' is not fully merged" })
      .mockResolvedValueOnce(outcome('h1', 'h1', 'tip-oid'))
    const p = git.deleteBranch('x')
    await answerDialog(true)
    await answerDialog(true)
    await p
    expect(actions()).toEqual([
      { type: 'deleteBranch', name: 'x', force: false },
      { type: 'deleteBranch', name: 'x', force: true },
    ])
    expect(useOpsStore().nextUndo?.undo).toEqual([{ type: 'restoreRef', refname: 'refs/heads/x', oid: 'tip-oid' }])
  })

  it('creates a branch from a prompt and undoes by switching back then deleting', async () => {
    api.runAction.mockResolvedValue({ before: { oid: 'h1', branch: 'main' }, after: { oid: 'h1', branch: 'feat/a' }, data: null, output: '' })
    const p = git.createBranch()
    await answerDialog(true, { name: 'feat/a' }, { checkout: true })
    await p
    expect(actions()[0]).toEqual({ type: 'createBranch', name: 'feat/a', start: null, checkout: true })
    expect(useOpsStore().nextUndo?.undo).toEqual([
      { type: 'checkout', branch: 'main' },
      { type: 'deleteBranch', name: 'feat/a', force: true },
    ])
  })

  it('blocks a second action while one is running', async () => {
    let release!: (o: OpOutcome) => void
    api.runAction.mockReturnValueOnce(new Promise<OpOutcome>((r) => (release = r)))
    const first = git.fetchAll()
    await flushPromises(1)
    await git.fetchAll()
    expect(api.runAction).toHaveBeenCalledTimes(1)
    expect(useUiStore().toasts.some((t) => t.title === 'Please wait')).toBe(true)
    release(outcome('h1', 'h1'))
    await first
  })
})
