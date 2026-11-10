export interface Person {
  name: string
  email: string
}

export type RefKind = 'head' | 'local' | 'remote' | 'tag'

export interface RefLabel {
  name: string
  kind: RefKind
  current?: boolean
}

export interface Commit {
  hash: string
  shortHash: string
  parents: string[]
  author: Person
  /** unix seconds (author date) */
  date: number
  subject: string
  refs: RefLabel[]
}

export interface Branch {
  name: string
  current: boolean
  upstream?: string | null
  upstreamGone?: boolean
  ahead: number
  behind: number
  tipHash: string
}

export interface Remote {
  name: string
  url: string
  branches: string[]
}

export interface Tag {
  name: string
  hash: string
}

export interface Stash {
  index: number
  message: string
  date: number
}

export interface Worktree {
  path: string
  branch: string
  head?: string
  isMain: boolean
}

export interface Submodule {
  path: string
  hash: string
  status: 'clean' | 'modified' | 'uninitialized' | 'conflict'
}

export type FileStatus = 'M' | 'A' | 'D' | 'R' | '?' | 'U'

export interface FileChange {
  path: string
  oldPath?: string
  status: FileStatus
  additions: number
  deletions: number
}

export interface WorkingCopy {
  unstaged: FileChange[]
  staged: FileChange[]
}

export interface HeadInfo {
  branch: string | null
  oid: string | null
  detached: boolean
  upstream: string | null
  ahead: number
  behind: number
}

export type DiffLineKind = 'context' | 'add' | 'del'

export interface DiffLine {
  kind: DiffLineKind
  oldNo?: number
  newNo?: number
  text: string
}

export interface DiffHunk {
  header: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: DiffLine[]
}

export interface FileDiff {
  path: string
  oldPath?: string
  binary?: boolean
  truncated?: boolean
  hunks: DiffHunk[]
}

export interface CommitDetails {
  hash: string
  parents: string[]
  author: Person
  authorDate: number
  committer: Person
  commitDate: number
  subject: string
  body: string
  files: FileChange[]
}

export interface RepoInfo {
  root: string
  name: string
}

export interface RefsPayload {
  branches: Branch[]
  remotes: Remote[]
  tags: Tag[]
  stashes: Stash[]
  worktrees: Worktree[]
  submodules: Submodule[]
  lastFetch: number | null
}

export interface StatusPayload {
  head: HeadInfo
  staged: FileChange[]
  unstaged: FileChange[]
}

export type DiffSource = 'unstaged' | 'staged' | 'commit'

export interface DiffTarget {
  path: string
  oldPath?: string
  source: DiffSource
  untracked?: boolean
  commit?: string
  parent?: string
}

export interface RepoSnapshot {
  name: string
  path: string
  head: HeadInfo
  /** branch name, or "detached at <sha>" */
  currentBranch: string
  commits: Commit[]
  branches: Branch[]
  remotes: Remote[]
  tags: Tag[]
  stashes: Stash[]
  worktrees: Worktree[]
  submodules: Submodule[]
  lastFetch: number | null
  workingCopy: WorkingCopy
}
