export interface Person {
  name: string
  email: string
}

export type RefKind = 'head' | 'local' | 'remote' | 'tag' | 'stash'

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
  /** set on the stash rows mixed into the graph: the stash@{n} index */
  stash?: number
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
  oid: string
  /** the commit it was made on */
  parent?: string | null
  authorName: string
  authorEmail: string
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

/** '=' is an unchanged file, listed when browsing all files of a commit */
export type FileStatus = 'M' | 'A' | 'D' | 'R' | '?' | 'U' | '='

export interface ConflictFile {
  text: string
  ours: string
  theirs: string
}

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
  noEol?: boolean
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

export type RepoOperation = 'merge' | 'rebase' | 'cherryPick' | 'revert'

export interface StatusPayload {
  head: HeadInfo
  staged: FileChange[]
  unstaged: FileChange[]
  operation: RepoOperation | null
}

export interface ImageSide {
  dataUrl: string
  bytes: number
}

export interface ImagePair {
  before: ImageSide | null
  after: ImageSide | null
  tooLarge: boolean
}

export type DiffSource = 'unstaged' | 'staged' | 'commit'

export interface DiffTarget {
  path: string
  oldPath?: string
  source: DiffSource
  untracked?: boolean
  commit?: string
  parent?: string
  /** new-file line to scroll to (e.g. from a review comment) */
  line?: number
  /** a file the commit did not change; shown in full */
  unchanged?: boolean
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
  operation: RepoOperation | null
}

export interface HunkSelection {
  header: string
  /** line indexes within the hunk; null = whole hunk */
  lines: number[] | null
}

export type PullMode = 'merge' | 'rebase' | 'ffOnly'
export type ResetMode = 'soft' | 'mixed' | 'hard' | 'keep'

/** Mirrors `Action` in src-tauri/src/git/ops.rs. */
export type GitAction =
  | { type: 'stage'; paths: string[] }
  | { type: 'unstage'; paths: string[] }
  | { type: 'stageAll' }
  | { type: 'unstageAll' }
  | { type: 'discard'; paths: string[]; untracked: string[] }
  | { type: 'discardAll' }
  | { type: 'discardStaged'; paths: string[] }
  | { type: 'applySelection'; path: string; source: 'unstaged' | 'staged'; hunks: HunkSelection[]; discard: boolean }
  | { type: 'applyPatch'; patch: string; cached: boolean; reverse: boolean }
  | { type: 'commit'; message: string; amend: boolean }
  | { type: 'rewordHead'; message: string }
  | { type: 'checkout'; branch: string }
  | { type: 'checkoutDetached'; target: string }
  | { type: 'checkoutRemote'; remoteBranch: string; name: string; reset?: boolean }
  | { type: 'createBranch'; name: string; start: string | null; checkout: boolean }
  | { type: 'deleteBranch'; name: string; force: boolean }
  | { type: 'deleteRemoteBranch'; remote: string; branch: string }
  | { type: 'renameBranch'; old: string; new: string }
  | { type: 'createTag'; name: string; target: string | null; message: string | null }
  | { type: 'deleteTag'; name: string }
  | { type: 'submoduleUpdate'; path: string }
  | { type: 'restoreRef'; refname: string; oid: string }
  | { type: 'deleteHeadRef' }
  | { type: 'fetch'; remote: string | null }
  | { type: 'pull'; mode: PullMode; track?: string }
  | { type: 'push'; remote: string | null; branch: string | null; setUpstream: boolean; force: boolean }
  | { type: 'merge'; target: string; mode?: 'noFf' | 'ffOnly' }
  | { type: 'rebase'; onto: string }
  | { type: 'cherryPick'; hash: string }
  | { type: 'cherryPickMany'; hashes: string[] }
  | { type: 'revertMany'; hashes: string[] }
  | { type: 'revert'; hash: string }
  | { type: 'reset'; target: string; mode: ResetMode }
  | { type: 'stashPush'; message: string | null; includeUntracked: boolean }
  | { type: 'stashPop'; index: number }
  | { type: 'stashApply'; index: number }
  | { type: 'stashApplyOid'; oid: string }
  | { type: 'stashDrop'; index: number }
  | { type: 'stashStore'; oid: string; message: string }
  | { type: 'abortOperation' }
  | { type: 'continueOperation' }

export interface HeadState {
  oid: string | null
  branch: string | null
}

export interface OpOutcome {
  before: HeadState
  after: HeadState
  data: string | null
  output: string
}

export interface FileHistoryEntry {
  commit: Commit
  /** the file's path in that commit (differs after a rename) */
  path: string
}

export interface BlameLine {
  line: number
  hash: string
  author: string
  email: string
  /** unix seconds */
  time: number
  summary: string
  content: string
}
