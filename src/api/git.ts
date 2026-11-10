import { invoke } from '@tauri-apps/api/core'
import type {
  Commit, CommitDetails, DiffTarget, FileDiff, GitAction, OpOutcome, RefLabel, RefsPayload, RepoInfo, StatusPayload,
} from '@/types/git'
import { mockApi } from './mock-backend'

export interface GitApi {
  openRepo(path: string): Promise<RepoInfo>
  getCommits(repo: string, limit?: number): Promise<Commit[]>
  getRefs(repo: string): Promise<RefsPayload>
  getStatus(repo: string): Promise<StatusPayload>
  getCommitDetails(repo: string, hash: string): Promise<CommitDetails>
  getFileDiff(repo: string, target: DiffTarget): Promise<FileDiff>
  runAction(repo: string, action: GitAction): Promise<OpOutcome>
  openInTerminal(path: string): Promise<void>
  openInEditor(path: string): Promise<void>
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
  getCommits: async (repo, limit) => normalizeCommits(await invoke<RawCommit[]>('get_commits', { repo, limit })),
  getRefs: (repo) => invoke<RefsPayload>('get_refs', { repo }),
  getStatus: (repo) => invoke<StatusPayload>('get_status', { repo }),
  getCommitDetails: (repo, hash) => invoke<CommitDetails>('get_commit_details', { repo, hash }),
  getFileDiff: (repo, target) =>
    invoke<FileDiff>('get_file_diff', {
      repo,
      request: {
        path: target.path,
        oldPath: target.oldPath ?? null,
        source: target.source,
        untracked: !!target.untracked,
        commit: target.commit ?? null,
        parent: target.parent ?? null,
      },
    }),
  runAction: (repo, action) => invoke<OpOutcome>('git_action', { repo, action }),
  openInTerminal: (path) => invoke<void>('open_in_terminal', { path }),
  openInEditor: (path) => invoke<void>('open_in_editor', { path }),
}

export const gitApi: GitApi = inTauri ? tauriApi : mockApi

export function errorMessage(e: unknown): string {
  if (typeof e === 'string') return e
  if (e && typeof e === 'object' && 'message' in e) return String((e as AppError).message)
  return 'Unknown error'
}
