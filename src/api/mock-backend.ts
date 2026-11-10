import type { GitApi } from './git'
import type { CommitDetails, FileChange, FileStatus, GitAction, OpOutcome } from '@/types/git'
import { createMockRepo, mockDiff } from '@/mock/data'
import { hashString } from '@/lib/format'

/** In-browser stand-in for the Rust backend (used by `pnpm dev` and screenshots). */
const repos = new Map<string, ReturnType<typeof createMockRepo>>()
const repo = (path: string) => {
  let r = repos.get(path)
  if (!r) {
    r = createMockRepo(path.split('/').pop() || path, path)
    repos.set(path, r)
  }
  return r
}
const delay = <T>(v: T, ms = 60) => new Promise<T>((res) => setTimeout(() => res(v), ms))

const POOL = [
  'src/lib/graph-layout.ts', 'src/components/graph/GraphCell.vue', 'src/stores/repos.ts', 'src-tauri/src/git/log.rs',
  'src-tauri/src/git/status.rs', 'src/components/panel/CommitBox.vue', 'tests/graph-layout.test.ts', 'README.md',
]
const STATUSES: FileStatus[] = ['M', 'M', 'M', 'A', 'D']

export const mockApi: GitApi = {
  openRepo: (path) => delay({ root: path, name: path.split('/').pop() || path }),
  getCommits: (path, limit) => {
    const all = repo(path).commits
    return delay(limit ? all.slice(0, limit) : all, limit ? 40 : 250)
  },
  getRefs: (path) => {
    const r = repo(path)
    return delay({
      branches: r.branches, remotes: r.remotes, tags: r.tags, stashes: r.stashes,
      worktrees: r.worktrees, submodules: r.submodules, lastFetch: Math.floor(Date.now() / 1000) - 240,
    })
  },
  getStatus: (path) => {
    const r = repo(path)
    return delay({ head: r.head, staged: [...r.workingCopy.staged], unstaged: [...r.workingCopy.unstaged], operation: null })
  },
  getCommitDetails: (path, hash) => {
    const c = repo(path).commits.find((x) => x.hash === hash)
    if (!c) return Promise.reject({ kind: 'git', message: `unknown revision ${hash}` })
    const h = hashString(hash)
    const files: FileChange[] = Array.from({ length: 1 + (h % 5) }, (_, i) => ({
      path: POOL[(h + i * 3) % POOL.length],
      status: STATUSES[(h >>> i) % STATUSES.length],
      additions: (h >>> (i + 2)) % 60,
      deletions: (h >>> (i + 4)) % 25,
    })).filter((f, i, arr) => arr.findIndex((x) => x.path === f.path) === i)
    const details: CommitDetails = {
      hash: c.hash, parents: c.parents, author: c.author, authorDate: c.date, committer: c.author, commitDate: c.date,
      subject: c.subject, body: c.parents.length > 1 ? 'Merged after review.' : '', files,
    }
    return delay(details)
  },
  getFileDiff: (_path, target) => delay({ ...mockDiff(target.path), path: target.path }),
  runAction: (path, action) => delay(mockAction(path, action), 150),
  openInTerminal: () => delay(undefined),
  openInEditor: () => delay(undefined),
}

/** Simulates the working-copy effects of a few actions so the browser demo stays interactive. */
function mockAction(path: string, action: GitAction): OpOutcome {
  const r = repo(path)
  const wc = r.workingCopy
  const head = { oid: r.head.oid, branch: r.head.branch }
  const move = (paths: string[], from: FileChange[], to: FileChange[]) => {
    for (const p of paths) {
      const i = from.findIndex((f) => f.path === p)
      if (i !== -1) to.push(...from.splice(i, 1))
    }
  }
  switch (action.type) {
    case 'stage': move(action.paths, wc.unstaged, wc.staged); break
    case 'unstage': move(action.paths, wc.staged, wc.unstaged); break
    case 'stageAll': wc.staged.push(...wc.unstaged.splice(0)); break
    case 'unstageAll': wc.unstaged.push(...wc.staged.splice(0)); break
    case 'discard': wc.unstaged = wc.unstaged.filter((f) => !action.paths.includes(f.path) && !action.untracked.includes(f.path)); break
    case 'discardAll': wc.unstaged = []; break
    case 'commit': wc.staged = []; break
  }
  return { before: head, after: head, data: null, output: '' }
}
