/**
 * Shared AI plumbing: setup checks, first-use consent for cloud providers,
 * size budgets, and per-file summarisation for big diffs.
 */
import { aiApi } from '@/api/ai'
import { clone } from '@/lib/clone'
import { isCloud, useSettingsStore } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'
import type { AiFileDiff, AiRequest } from '@/types/ai'
import { buildFileSummaryPrompt, fileLine } from './prompts'

export class AiCancelled extends Error {
  constructor() {
    super('cancelled')
  }
}

/** Per-file and total character budgets (local models get smaller contexts). */
export function budgets() {
  const local = useSettingsStore().provider === 'ollama'
  return { perFile: local ? 6_000 : 12_000, total: local ? 24_000 : 60_000, maxSummaries: local ? 15 : 30 }
}

/** Explains how to set AI up when it is not ready; resolves false if not ready. */
export async function ensureReady(feature: string): Promise<boolean> {
  const settings = useSettingsStore()
  if (!settings.loaded) await settings.load()
  const reason = settings.notReadyReason
  if (!reason) return true
  const ui = useUiStore()
  const open = await ui.confirm({
    title: `Set up AI to use ${feature}`,
    message: `${reason}\n\nKromaGit works fully without AI. To turn it on, open Settings → AI and choose:\n• Ollama — free and local; nothing leaves your machine (install from ollama.com, then \`ollama pull qwen2.5-coder\`)\n• Anthropic, OpenAI or Gemini — bring your own API key (stored in your system keychain)`,
    confirmLabel: 'Open AI settings',
  })
  if (open) ui.settingsOpen = true
  return false
}

/**
 * Before code goes to a cloud provider for the first time, show exactly what
 * would be sent and ask. Local providers never need consent.
 */
export async function ensureConsent(preview: string): Promise<void> {
  const settings = useSettingsStore()
  const provider = settings.provider
  if (!isCloud(provider) || settings.settings.ai.cloudConsent[provider]) return
  const ui = useUiStore()
  const ok = await ui.confirm({
    title: `Send code to ${settings.providerInfo.name}?`,
    message: `This is the first time KromaGit would send repository content to ${settings.providerInfo.name} (${settings.model}). Below is exactly what will be sent. Likely secrets are already replaced with [REDACTED] and sensitive files (.env, keys) are left out.\n\nIf you allow it, KromaGit won't ask again for this provider; you can revoke it in Settings → AI.`,
    preview,
    confirmLabel: 'Allow and send',
    wide: true,
  })
  if (!ok) throw new AiCancelled()
  const next = clone(settings.settings)
  next.ai.cloudConsent = { ...next.ai.cloudConsent, [provider]: true }
  await settings.save(next)
}

export function previewOf(req: Pick<AiRequest, 'system' | 'user'>): string {
  return `SYSTEM:\n${req.system}\n\nUSER:\n${req.user}`
}

export async function complete(req: AiRequest): Promise<string> {
  const res = await aiApi.complete(req)
  return res.text
}

export const diffChars = (files: AiFileDiff[]) => files.reduce((n, f) => n + f.patch.length, 0)

/**
 * For diffs over the budget, summarise each file first (one request per file),
 * then the caller sends the summaries instead of the raw diff.
 */
export async function summarizeFiles(files: AiFileDiff[], onProgress?: (done: number, total: number) => void): Promise<Record<string, string>> {
  const { maxSummaries } = budgets()
  const withPatch = [...files].filter((f) => f.patch && !f.omitted).sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions))
  const chosen = withPatch.slice(0, maxSummaries)
  const out: Record<string, string> = {}
  let done = 0
  for (const f of chosen) {
    const p = buildFileSummaryPrompt(f)
    out[f.path] = (await complete({ ...p, maxTokens: 1500, effort: 'low' })).trim()
    onProgress?.(++done, chosen.length)
  }
  for (const f of files) if (!(f.path in out)) out[f.path] = `(not summarised) ${fileLine(f)}`
  return out
}
