import { invoke } from '@tauri-apps/api/core'
import type {
  BlameLine, Commit, ConflictFile, CommitDetails, DiffTarget, FileDiff, FileHistoryEntry, GitAction, ImagePair, OpOutcome, RefLabel, RefsPayload, RepoInfo, StatusPayload,
} from '@/types/git'
import { mockApi } from './mock-backend'

export interface GitApi {
  openRepo(path: string): Promise<RepoInfo>
  cloneRepo(url: string, parent: string, name: string): Promise<RepoInfo>
  getCommits(repo: string, limit?: number): Promise<Commit[]>
  getRefs(repo: string): Promise<RefsPayload>
  getStatus(repo: string): Promise<StatusPayload>
  getCommitDetails(repo: string, hash: string): Promise<CommitDetails>
  getFileDiff(repo: string, target: DiffTarget, opts?: DiffOptions): Promise<FileDiff>
  getFileImage(repo: string, target: DiffTarget): Promise<ImagePair>
  fileHistory(repo: string, path: string, limit?: number): Promise<FileHistoryEntry[]>
  blame(repo: string, path: string, rev?: string): Promise<BlameLine[]>
  listTree(repo: string, commit: string): Promise<string[]>
  readConflict(repo: string, path: string): Promise<ConflictFile>
  writeResolved(repo: string, path: string, text: string): Promise<void>
  mergeMessage(repo: string): Promise<string | null>
  runAction(repo: string, action: GitAction): Promise<OpOutcome>
  openInTerminal(path: string): Promise<void>
  openInEditor(path: string, file?: string): Promise<void>
}

export interface DiffOptions {
  ignoreWhitespace?: boolean
  fullFile?: boolean
}

function diffRequest(target: DiffTarget, opts: DiffOptions = {}) {
  return {
    ignoreWhitespace: !!opts.ignoreWhitespace,
    fullFile: !!opts.fullFile,
    path: target.path,
    oldPath: target.oldPath ?? null,
    source: target.source,
    untracked: !!target.untracked,
    commit: target.commit ?? null,
    parent: target.parent ?? null,
  }
}

export interface AppError {
  kind: 'gitNotFound' | 'git' | 'notARepo' | 'pathNotFound' | 'io' | 'internal'
  message: string
  command?: string | null
}

export const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

interface RawCommit {
  hash: string
  parents: string[]
  author: { name: string; email: string }
  date: number
  subject: string
  refs?: RefLabel[]
}

/** Fills the fields the backend leaves out to keep the IPC payload small. */
export function normalizeCommits(raw: RawCommit[]): Commit[] {
  const out: Commit[] = new Array(raw.length)
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i] as Commit
    c.shortHash = c.hash.slice(0, 7)
    if (!c.refs) c.refs = []
    out[i] = c
  }
  return out
}

const tauriApi: GitApi = {
  openRepo: (path) => invoke<RepoInfo>('open_repo', { path }),
  cloneRepo: (url, parent, name) => invoke<RepoInfo>('clone_repo', { url, parent, name }),
  getCommits: async (repo, limit) => normalizeCommits(await invoke<RawCommit[]>('get_commits', { repo, limit })),
  getRefs: (repo) => invoke<RefsPayload>('get_refs', { repo }),
  getStatus: (repo) => invoke<StatusPayload>('get_status', { repo }),
  getCommitDetails: (repo, hash) => invoke<CommitDetails>('get_commit_details', { repo, hash }),
  getFileDiff: (repo, target, opts) => invoke<FileDiff>('get_file_diff', { repo, request: diffRequest(target, opts) }),
  getFileImage: (repo, target) => invoke<ImagePair>('get_file_image', { repo, request: diffRequest(target) }),
  fileHistory: async (repo, path, limit) => {
    const raw = await invoke<{ commit: RawCommit; path: string }[]>('file_history', { repo, path, limit: limit ?? null })
    const commits = normalizeCommits(raw.map((r) => r.commit))
    return raw.map((r, i) => ({ commit: commits[i], path: r.path }))
  },
  blame: (repo, path, rev) => invoke<BlameLine[]>('blame_file', { repo, path, rev: rev ?? null }),
  listTree: (repo, commit) => invoke<string[]>('list_tree', { repo, commit }),
  readConflict: (repo, path) => invoke<ConflictFile>('read_conflict', { repo, path }),
  writeResolved: (repo, path, text) => invoke<void>('write_resolved', { repo, path, text }),
  mergeMessage: (repo) => invoke<string | null>('merge_message', { repo }),
  runAction: (repo, action) => invoke<OpOutcome>('git_action', { repo, action }),
  openInTerminal: (path) => invoke<void>('open_in_terminal', { path }),
  openInEditor: (path, file) => invoke<void>('open_in_editor', { path, file: file ?? null }),
}

export const gitApi: GitApi = inTauri ? tauriApi : mockApi

export function errorMessage(e: unknown): string {
  if (typeof e === 'string') return e
  if (e && typeof e === 'object' && 'message' in e) return String((e as AppError).message)
  return 'Unknown error'
}
