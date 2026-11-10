import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { flushPromises } from './helpers'

const ai = vi.hoisted(() => ({
  getSettings: vi.fn(),
  saveSettings: vi.fn(),
  apiKeyStatus: vi.fn(),
  complete: vi.fn(),
}))

vi.mock('@/api/ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/ai')>()
  return { ...actual, aiApi: { ...actual.aiApi, ...ai } }
})

const { defaultSettings } = await import('@/api/ai')
const { AiCancelled, ensureConsent, ensureReady, summarizeFiles } = await import('@/ai/engine')
const { useSettingsStore } = await import('@/stores/settings')
const { useUiStore } = await import('@/stores/ui')

function withProvider(provider: string, consent = false) {
  const s = defaultSettings()
  s.ai.provider = provider as never
  s.ai.cloudConsent = consent ? { [provider]: true } : {}
  ai.getSettings.mockResolvedValue(s)
}

describe('ai engine', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    ai.apiKeyStatus.mockResolvedValue({ anthropic: true, openai: false, gemini: false })
    ai.saveSettings.mockResolvedValue(undefined)
  })

  it('explains setup instead of running when no provider is configured', async () => {
    withProvider('none')
    const p = ensureReady('AI review')
    await flushPromises()
    const ui = useUiStore()
    expect(ui.dialog?.title).toBe('Set up AI to use AI review')
    ui.closeDialog({ values: {}, checks: {} })
    expect(await p).toBe(false)
    expect(ui.settingsOpen).toBe(true)
  })

  it('requires an API key for cloud providers', async () => {
    withProvider('openai')
    await useSettingsStore().load()
    expect(useSettingsStore().notReadyReason).toMatch(/API key/)
    withProvider('anthropic')
    await useSettingsStore().load()
    expect(useSettingsStore().notReadyReason).toBeNull()
  })

  it('never asks consent for local Ollama', async () => {
    withProvider('ollama')
    await useSettingsStore().load()
    await ensureConsent('code')
    expect(useUiStore().dialog).toBeNull()
  })

  it('shows exactly what will be sent before the first cloud request, and remembers a yes', async () => {
    withProvider('anthropic')
    await useSettingsStore().load()
    const p = ensureConsent('SYSTEM:\nx\n\nUSER:\n+secret-free diff')
    await flushPromises()
    const ui = useUiStore()
    expect(ui.dialog?.preview).toContain('+secret-free diff')
    ui.closeDialog({ values: {}, checks: {} })
    await p
    expect(ai.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ ai: expect.objectContaining({ cloudConsent: { anthropic: true } }) }))
    await ensureConsent('again')
    expect(ui.dialog).toBeNull()
  })

  it('cancels the feature when consent is declined', async () => {
    withProvider('anthropic')
    await useSettingsStore().load()
    const p = ensureConsent('diff')
    await flushPromises()
    useUiStore().closeDialog(null)
    await expect(p).rejects.toBeInstanceOf(AiCancelled)
    expect(ai.saveSettings).not.toHaveBeenCalled()
  })

  it('summarises the largest files first and labels the rest', async () => {
    withProvider('ollama')
    await useSettingsStore().load()
    ai.complete.mockImplementation(async ({ user }: { user: string }) => ({ text: `- sum of ${user.split(' ')[1]}`, provider: 'ollama', model: 'm' }))
    const files = Array.from({ length: 17 }, (_, i) => ({
      path: `f${i}.ts`, oldPath: null, status: 'M' as const, additions: i, deletions: 0, patch: '+x', truncated: false, redactions: 0, omitted: null,
    }))
    const out = await summarizeFiles(files)
    expect(ai.complete).toHaveBeenCalledTimes(15)
    expect(out['f16.ts']).toBe('- sum of f16.ts')
    expect(out['f0.ts']).toMatch(/^\(not summarised\)/)
  })
})
