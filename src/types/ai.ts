export type ProviderId = 'none' | 'ollama' | 'anthropic' | 'openai' | 'gemini'
export type CloudProvider = 'anthropic' | 'openai' | 'gemini'

export interface AiSettings {
  provider: ProviderId
  models: Record<string, string>
  ollamaUrl: string
  cloudConsent: Record<string, boolean>
}

export type ThemePref = 'dark' | 'light' | 'system'

export type AccentId = 'blue' | 'violet' | 'teal' | 'pink' | 'amber' | 'green'

export interface Settings {
  appearance: { theme: ThemePref; zoom: number; accent: AccentId }
  general: { terminalApp: string; editorApp: string; showAvatars: boolean }
  ai: AiSettings
  /** keyed by repository root */
  repos: Record<string, { commitTemplate: string }>
  standup: { authorEmail: string }
  cleanup: { baseBranches: string[]; staleDays: number }
}

export interface AiFileDiff {
  path: string
  oldPath: string | null
  status: 'A' | 'M' | 'D' | 'R'
  additions: number
  deletions: number
  patch: string
  truncated: boolean
  redactions: number
  omitted: string | null
}

export interface AiDiffBundle {
  files: AiFileDiff[]
  redactions: number
}

export interface AiRequest {
  system: string
  user: string
  schema?: Record<string, unknown> | null
  maxTokens?: number
  effort?: 'low' | 'medium' | 'high'
}

export interface AiResponse {
  text: string
  provider: string
  model: string
}

export interface StandupCommit {
  hash: string
  subject: string
  date: number
  source: string
}

export interface StandupRepo {
  path: string
  commits: StandupCommit[]
  error: string | null
}

export interface CleanupCandidate {
  name: string
  mergedInto: string[]
  upstreamGone: boolean
  staleDays: number | null
  lastCommit: number
  remoteBranch: string | null
}
