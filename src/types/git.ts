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
  /** unix seconds */
  date: number
  subject: string
  body: string
  refs: RefLabel[]
}

export interface Branch {
  name: string
  current: boolean
  upstream?: string
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
  isMain: boolean
}

export interface Submodule {
  path: string
  hash: string
  status: 'clean' | 'modified' | 'uninitialized'
}

export type FileStatus = 'M' | 'A' | 'D' | 'R' | '?'

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
  language: string
  hunks: DiffHunk[]
}

export interface RepoSnapshot {
  name: string
  path: string
  currentBranch: string
  commits: Commit[]
  branches: Branch[]
  remotes: Remote[]
  tags: Tag[]
  stashes: Stash[]
  worktrees: Worktree[]
  submodules: Submodule[]
  workingCopy: WorkingCopy
}
