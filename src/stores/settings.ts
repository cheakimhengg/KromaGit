import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { aiApi, defaultSettings } from '@/api/ai'
import { errorMessage, inTauri } from '@/api/git'
import { applyAccent, applyTheme, applyZoom, clampZoom, resolvedTheme } from '@/lib/theme'
import { clone } from '@/lib/clone'
import { setAvatarsEnabled } from '@/lib/avatars'
import type { CloudProvider, ProviderId, Settings, ThemePref } from '@/types/ai'
import { useUiStore } from './ui'

export const PROVIDERS: { id: ProviderId; name: string; cloud: boolean; blurb: string; models: string[] }[] = [
  { id: 'none', name: 'Off', cloud: false, blurb: 'No AI. Everything else works as usual.', models: [] },
  { id: 'ollama', name: 'Ollama', cloud: false, blurb: 'Runs on your machine. Free; nothing leaves your computer.', models: [] },
  { id: 'anthropic', name: 'Anthropic Claude', cloud: true, blurb: 'Bring your own API key.', models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'] },
  { id: 'openai', name: 'OpenAI', cloud: true, blurb: 'Bring your own API key.', models: ['gpt-4.1-mini', 'gpt-4.1', 'gpt-4o'] },
  { id: 'gemini', name: 'Google Gemini', cloud: true, blurb: 'Bring your own API key.', models: ['gemini-2.5-flash', 'gemini-2.5-pro'] },
]

export const isCloud = (p: ProviderId): p is CloudProvider => p === 'anthropic' || p === 'openai' || p === 'gemini'

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<Settings>(defaultSettings())
  const keys = ref<Record<string, boolean>>({})
  const loaded = ref(false)

  async function load() {
    try {
      const s = await aiApi.getSettings()
      const d = defaultSettings()
      settings.value = {
        ...d,
        ...s,
        appearance: { ...d.appearance, ...s.appearance },
        general: { ...d.general, ...s.general },
        ai: { ...d.ai, ...s.ai, models: { ...d.ai.models, ...s.ai?.models } },
        cleanup: { ...d.cleanup, ...s.cleanup },
        standup: { ...d.standup, ...s.standup },
      }
      keys.value = await aiApi.apiKeyStatus().catch(() => ({}))
    } catch (e) {
      useUiStore().toast({ kind: 'error', title: 'Could not load settings', detail: errorMessage(e) })
    } finally {
      loaded.value = true
      applyAppearance()
    }
  }

  function applyAppearance() {
    applyTheme(settings.value.appearance.theme)
    applyAccent(settings.value.appearance.accent)
    setAvatarsEnabled(true)
    void applyZoom(settings.value.appearance.zoom, inTauri).catch(() => {})
  }

  async function save(next: Settings = settings.value) {
    await aiApi.saveSettings(next)
    settings.value = next
    applyAppearance()
  }

  async function patchAppearance(p: Partial<Settings['appearance']>) {
    const next = clone(settings.value)
    next.appearance = { ...next.appearance, ...p }
    next.appearance.zoom = clampZoom(next.appearance.zoom)
    await save(next).catch((e) => useUiStore().toast({ kind: 'error', title: 'Could not save settings', detail: errorMessage(e) }))
  }

  const setTheme = (theme: ThemePref) => patchAppearance({ theme })
  const toggleTheme = () => setTheme(resolvedTheme.value === 'light' ? 'dark' : 'light')
  const zoomBy = (delta: number) => patchAppearance({ zoom: settings.value.appearance.zoom + delta })
  const resetZoom = () => patchAppearance({ zoom: 100 })
  const setAccent = (accent: Settings['appearance']['accent']) => patchAppearance({ accent })

  async function refreshKeys() {
    keys.value = await aiApi.apiKeyStatus().catch(() => keys.value)
  }

  const provider = computed(() => settings.value.ai.provider)
  const model = computed(() => settings.value.ai.models[provider.value] ?? '')
  const providerInfo = computed(() => PROVIDERS.find((p) => p.id === provider.value) ?? PROVIDERS[0])

  /** Why AI cannot run right now, or null when it can. */
  const notReadyReason = computed<string | null>(() => {
    const p = provider.value
    if (p === 'none') return 'No AI provider is set up yet.'
    if (!model.value.trim()) return `Pick a model for ${providerInfo.value.name}.`
    if (isCloud(p) && !keys.value[p]) return `Add your ${providerInfo.value.name} API key.`
    return null
  })

  const statusLabel = computed(() => (provider.value === 'none' ? null : `${providerInfo.value.name} · ${model.value || 'no model'}`))

  function templateFor(repoRoot: string) {
    return settings.value.repos[repoRoot]?.commitTemplate ?? ''
  }

  return { settings, keys, loaded, load, save, refreshKeys, setTheme, setAccent, toggleTheme, zoomBy, resetZoom, provider, model, providerInfo, notReadyReason, statusLabel, templateFor }
})
