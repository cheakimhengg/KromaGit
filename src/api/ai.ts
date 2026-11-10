import { invoke } from '@tauri-apps/api/core'
import { inTauri } from './git'
import type {
  AiDiffBundle, AiRequest, AiResponse, CleanupCandidate, CloudProvider, Settings, StandupRepo,
} from '@/types/ai'

export interface AiApi {
  getSettings(): Promise<Settings>
  saveSettings(settings: Settings): Promise<void>
  setApiKey(provider: CloudProvider, key: string): Promise<void>
  deleteApiKey(provider: CloudProvider): Promise<void>
  apiKeyStatus(): Promise<Record<string, boolean>>
  complete(request: AiRequest): Promise<AiResponse>
  ollamaModels(url: string): Promise<string[]>
  collectDiff(repo: string, scope: 'staged' | 'all', perFileCap: number): Promise<AiDiffBundle>
  recentMessages(repo: string, count: number): Promise<string[]>
  gitUserEmail(repo: string): Promise<string>
  standupCommits(paths: string[], since: string, until: string, author: string): Promise<StandupRepo[]>
  cleanupCandidates(repo: string, bases: string[], staleDays: number): Promise<CleanupCandidate[]>
}

export function defaultSettings(): Settings {
  return {
    ai: {
      provider: 'none',
      models: { ollama: '', anthropic: 'claude-opus-5-5', openai: 'gpt-4.1-mini', gemini: 'gemini-2.5-flash' },
      ollamaUrl: 'http://localhost:11434',
      cloudConsent: {},
    },
    repos: {},
    standup: { authorEmail: '' },
    cleanup: { baseBranches: ['main', 'master', 'staging'], staleDays: 90 },
  }
}

const tauriAi: AiApi = {
  getSettings: () => invoke('get_settings'),
  saveSettings: (settings) => invoke('save_settings', { settings }),
  setApiKey: (provider, key) => invoke('set_api_key', { provider, key }),
  deleteApiKey: (provider) => invoke('delete_api_key', { provider }),
  apiKeyStatus: () => invoke('api_key_status'),
  complete: (request) => invoke('ai_complete', { request }),
  ollamaModels: (url) => invoke('ollama_models', { url }),
  collectDiff: (repo, scope, perFileCap) => invoke('ai_collect_diff', { repo, scope, perFileCap }),
  recentMessages: (repo, count) => invoke('recent_messages', { repo, count }),
  gitUserEmail: (repo) => invoke('git_user_email', { repo }),
  standupCommits: (paths, since, until, author) => invoke('standup_commits', { paths, since, until, author }),
  cleanupCandidates: (repo, bases, staleDays) => invoke('cleanup_candidates', { repo, bases, staleDays }),
}

// ---------- browser demo backend ----------

const MOCK_KEY = 'kromagit.mock.settings'
const mockKeys = new Set<string>()
const wait = <T>(v: T, ms = 300) => new Promise<T>((r) => setTimeout(() => r(v), ms))

function mockReply(req: AiRequest): string {
  const s = req.system
  if (s.includes('commit message')) {
    return JSON.stringify({ summary: 'feat(graph): draw merge lanes with author avatars', description: '- compute lane layout once per repository\n- color ref pills by lane' })
  }
  if (s.includes('code reviewer')) {
    return JSON.stringify({
      summary: 'One leftover debug statement and a possible off-by-one.',
      comments: [
        { file: 'src/lib/graph-layout.ts', line: 51, severity: 'debug', message: 'console.log left in the lane loop.' },
        { file: 'src/lib/graph-layout.ts', line: 14, severity: 'bug', message: 'maxLanes is reset but never updated for merge rows.' },
      ],
    })
  }
  if (s.includes('split')) {
    const paths = [...req.user.matchAll(/^### [AMDR] (.+?) \(/gm)].map((m) => m[1])
    const half = Math.ceil(paths.length / 2)
    return JSON.stringify({
      groups: [
        { summary: 'refactor(graph): extract lane helpers', description: '', files: paths.slice(0, half), hunks: [] },
        { summary: 'feat(ui): show lane legend', description: '', files: paths.slice(half), hunks: [] },
      ],
    })
  }
  if (s.includes('standup')) return '- KromaGit: built the commit graph and diff viewer\n- web-portal: fixed tab closing'
  if (s.includes('Summarize this diff')) return '- changes lane layout'
  return 'OK'
}

const mockAi: AiApi = {
  getSettings: () => {
    const raw = localStorage.getItem(MOCK_KEY)
    return wait(raw ? { ...defaultSettings(), ...JSON.parse(raw) } : defaultSettings(), 0)
  },
  saveSettings: (s) => wait(void localStorage.setItem(MOCK_KEY, JSON.stringify(s)), 0),
  setApiKey: (p) => wait(void mockKeys.add(p), 50),
  deleteApiKey: (p) => wait(void mockKeys.delete(p), 50),
  apiKeyStatus: () => wait({ anthropic: mockKeys.has('anthropic'), openai: mockKeys.has('openai'), gemini: mockKeys.has('gemini') }, 0),
  complete: (req) => wait({ text: mockReply(req), provider: 'mock', model: 'mock' }, 700),
  ollamaModels: () => wait(['llama3.1:8b', 'qwen2.5-coder:7b']),
  collectDiff: (_repo, scope) =>
    wait({
      redactions: 1,
      files: [
        { path: 'src/lib/graph-layout.ts', oldPath: null, status: 'M' as const, additions: 7, deletions: 3, truncated: false, redactions: 0, omitted: null,
          patch: 'diff --git a/src/lib/graph-layout.ts b/src/lib/graph-layout.ts\n--- a/src/lib/graph-layout.ts\n+++ b/src/lib/graph-layout.ts\n@@ -12,3 +12,4 @@\n const lanes = []\n-let maxLanes = 0\n+let nextColor = 0\n+let maxLanes = 0\n' },
        { path: 'src/components/common/Avatar.vue', oldPath: null, status: 'A' as const, additions: 37, deletions: 0, truncated: false, redactions: 0, omitted: null,
          patch: 'diff --git a/src/components/common/Avatar.vue b/src/components/common/Avatar.vue\nnew file mode 100644\n--- /dev/null\n+++ b/src/components/common/Avatar.vue\n@@ -0,0 +1,2 @@\n+<template>\n+</template>\n' },
        ...(scope === 'all' ? [{ path: '.env', oldPath: null, status: 'M' as const, additions: 1, deletions: 0, truncated: false, redactions: 0, omitted: 'sensitive file (not sent)', patch: '' }] : []),
      ],
    }),
  recentMessages: () => wait(['feat(graph): virtualize rows', 'fix(sidebar): keep filter on refresh', 'chore: bump deps'], 50),
  gitUserEmail: () => wait('mara@example.dev', 0),
  standupCommits: (paths) =>
    wait(paths.map((path, i) => ({
      path,
      error: null,
      commits: i > 1 ? [] : [
        { hash: `a${i}1`, subject: 'feat(graph): curved merge lanes', date: Date.now() / 1000 - 3600, source: 'feature/commit-graph' },
        { hash: `a${i}2`, subject: 'fix(tabs): close button hit area', date: Date.now() / 1000 - 7200, source: 'fix/tab-close' },
      ],
    }))),
  cleanupCandidates: () =>
    wait([
      { name: 'feature/old-sidebar', mergedInto: ['main'], upstreamGone: false, staleDays: null, lastCommit: Date.now() / 1000 - 86400 * 12, remoteBranch: 'origin/feature/old-sidebar' },
      { name: 'fix/tab-close', mergedInto: [], upstreamGone: true, staleDays: null, lastCommit: Date.now() / 1000 - 86400 * 3, remoteBranch: null },
      { name: 'spike/webgl-graph', mergedInto: [], upstreamGone: false, staleDays: 140, lastCommit: Date.now() / 1000 - 86400 * 140, remoteBranch: 'origin/spike/webgl-graph' },
    ]),
}

export const aiApi: AiApi = inTauri ? tauriAi : mockAi
