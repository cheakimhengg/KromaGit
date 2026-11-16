<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { clone } from '@/lib/clone'
import {
  AppWindow, CalendarClock, Check, CloudDownload, FolderGit2, Keyboard, KeyRound, Loader2, Monitor, Moon, Palette, RefreshCw, Search, ShieldCheck, Sparkles, Sun, X,
} from '@/lib/icons'
import { aiApi } from '@/api/ai'
import { errorMessage } from '@/api/git'
import { PROVIDERS, isCloud, useSettingsStore } from '@/stores/settings'
import { useReposStore } from '@/stores/repos'
import { useUiStore } from '@/stores/ui'
import { useUpdatesStore } from '@/stores/updates'
import { relativeTime } from '@/lib/format'
import { TEMPLATE_PRESETS } from '@/ai/prompts'
import { useCommands } from '@/commands/registry'
import { formatCombo, isMac } from '@/lib/shortcuts'
import { ACCENTS, THEMES, ZOOM_MAX, ZOOM_MIN, resolvePalette, resolvedTheme, themeInfo } from '@/lib/theme'
import ThemePreview from '@/components/settings/ThemePreview.vue'
import type { AccentId, CloudProvider, ProviderId, Settings } from '@/types/ai'

const ui = useUiStore()
const store = useSettingsStore()
const repos = useReposStore()

type Tab = 'appearance' | 'general' | 'ai' | 'repo' | 'workflow' | 'shortcuts' | 'updates'
const tab = ref<Tab>('appearance')
const SECTIONS: { id: Tab; label: string; icon: unknown; desc: string; keywords: string }[] = [
  { id: 'appearance', label: 'Appearance', icon: Palette, desc: 'Theme, accent colour and zoom', keywords: 'dark light system color colour zoom size avatar picture photo gravatar' },
  { id: 'general', label: 'Apps', icon: AppWindow, desc: 'Which terminal and editor KromaGit opens', keywords: 'terminal editor vscode iterm warp cursor zed open' },
  { id: 'ai', label: 'AI assistant', icon: Sparkles, desc: 'Provider, model, API key and privacy', keywords: 'ollama anthropic claude openai gemini api key model consent privacy' },
  { id: 'repo', label: 'This repository', icon: FolderGit2, desc: 'Commit message convention for the open repository', keywords: 'commit message template convention conventional' },
  { id: 'workflow', label: 'Standup & cleanup', icon: CalendarClock, desc: 'Who you are for standups, which branches count as merged', keywords: 'standup email cleanup base branch stale days' },
  { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard, desc: 'Every keyboard shortcut', keywords: 'keyboard keys hotkey shortcut' },
  { id: 'updates', label: 'Updates', icon: CloudDownload, desc: 'Your version and new releases', keywords: 'update upgrade version release new download about' },
]
const updates = useUpdatesStore()
const filter = ref('')
const visibleSections = computed(() => {
  const q = filter.value.trim().toLowerCase()
  if (!q) return SECTIONS
  return SECTIONS.filter((x) => `${x.label} ${x.desc} ${x.keywords}`.toLowerCase().includes(q))
})
watch(visibleSections, (list) => {
  if (list.length && !list.some((x) => x.id === tab.value)) tab.value = list[0].id
})
const current = computed(() => SECTIONS.find((x) => x.id === tab.value)!)
const themeCards = [...THEMES.map((t) => ({ ...t, system: false })), { id: 'system' as const, name: 'System', kind: 'dark' as const, blurb: 'Follows your OS', swatch: THEMES[0].swatch, system: true }]
const themeAccent = computed(() => themeInfo(resolvePalette(store.settings.appearance.theme))!.swatch.accent)
function setAccent(a: AccentId) {
  store.setAccent(a)
  draft.value.appearance.accent = a
}
const { staticCommands } = useCommands()
const shortcutList = computed(() => staticCommands.filter((c) => c.shortcut && !/^tab-[2-8]$/.test(c.id)))
const isMacOS = isMac
const draft = ref<Settings>(clone(store.settings))
const keyInput = ref('')
const busy = ref<string | null>(null)
const testResult = ref<{ ok: boolean; text: string } | null>(null)
const ollamaModels = ref<string[]>([])
const repoRoot = computed(() => repos.activeTab?.path ?? '')
const template = ref('')
const baseBranches = ref('')

watch(
  () => ui.settingsOpen,
  async (open) => {
    if (!open) return
    tab.value = ui.settingsTab
    ui.settingsTab = 'appearance'
    filter.value = ''
    if (!store.loaded) await store.load()
    draft.value = clone(store.settings)
    template.value = store.templateFor(repoRoot.value)
    baseBranches.value = draft.value.cleanup.baseBranches.join(', ')
    keyInput.value = ''
    testResult.value = null
    await store.refreshKeys()
    if (!draft.value.standup.authorEmail && repoRoot.value) {
      draft.value.standup.authorEmail = await aiApi.gitUserEmail(repoRoot.value).catch(() => '')
    }
    if (draft.value.ai.provider === 'ollama') void loadOllama()
  },
  { immediate: true },
)

const provider = computed(() => draft.value.ai.provider)
const info = computed(() => PROVIDERS.find((p) => p.id === provider.value)!)
const hasKey = computed(() => isCloud(provider.value) && !!store.keys[provider.value])
const consented = computed(() => isCloud(provider.value) && !!draft.value.ai.cloudConsent[provider.value])

function pick(id: ProviderId) {
  draft.value.ai.provider = id
  testResult.value = null
  keyInput.value = ''
  if (id === 'ollama') void loadOllama()
}

async function loadOllama() {
  busy.value = 'ollama'
  try {
    ollamaModels.value = await aiApi.ollamaModels(draft.value.ai.ollamaUrl)
    if (!draft.value.ai.models.ollama && ollamaModels.value.length) draft.value.ai.models.ollama = ollamaModels.value[0]
  } catch (e) {
    ollamaModels.value = []
    testResult.value = { ok: false, text: errorMessage(e) }
  } finally {
    busy.value = null
  }
}

async function saveKey() {
  if (!isCloud(provider.value) || !keyInput.value.trim()) return
  busy.value = 'key'
  try {
    await aiApi.setApiKey(provider.value as CloudProvider, keyInput.value)
    keyInput.value = ''
    await store.refreshKeys()
  } catch (e) {
    ui.toast({ kind: 'error', title: 'Could not save key', detail: errorMessage(e) })
  } finally {
    busy.value = null
  }
}

async function removeKey() {
  if (!isCloud(provider.value)) return
  const ok = await ui.confirm({ title: `Remove the ${info.value.name} API key?`, message: 'It is deleted from your system keychain.', confirmLabel: 'Remove', danger: true })
  if (!ok) return
  await aiApi.deleteApiKey(provider.value as CloudProvider)
  await store.refreshKeys()
}

function revokeConsent() {
  if (!isCloud(provider.value)) return
  const next = { ...draft.value.ai.cloudConsent }
  delete next[provider.value]
  draft.value.ai.cloudConsent = next
}

function collect(): Settings {
  const s = clone(draft.value)
  s.cleanup.baseBranches = baseBranches.value.split(',').map((b) => b.trim()).filter(Boolean)
  s.cleanup.staleDays = Math.max(1, Math.floor(Number(s.cleanup.staleDays) || 90))
  if (repoRoot.value) s.repos[repoRoot.value] = { commitTemplate: template.value.trim() }
  return s
}

async function test() {
  busy.value = 'test'
  testResult.value = null
  try {
    await store.save(collect())
    const r = await aiApi.complete({ system: 'You are a connectivity check.', user: 'Reply with exactly: OK', maxTokens: 200, effort: 'low' })
    testResult.value = { ok: true, text: `Connected to ${r.model}. Reply: “${r.text.trim().slice(0, 60)}”` }
  } catch (e) {
    testResult.value = { ok: false, text: errorMessage(e) }
  } finally {
    busy.value = null
  }
}

async function save() {
  busy.value = 'save'
  try {
    await store.save(collect())
    ui.settingsOpen = false
    ui.toast({ kind: 'success', title: 'Settings saved' }, 1800)
  } catch (e) {
    ui.toast({ kind: 'error', title: 'Could not save settings', detail: errorMessage(e) })
  } finally {
    busy.value = null
  }
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && !ui.dialog) ui.settingsOpen = false
}
</script>

<template>
  <div v-if="ui.settingsOpen" class="fixed inset-0 z-[55] flex items-center justify-center bg-black/55 backdrop-blur-[2px]" @mousedown.self="ui.settingsOpen = false" @keydown="onKey">
    <div class="flex h-[min(720px,88vh)] w-[960px] max-w-[95vw] overflow-hidden rounded-2xl border border-line-strong bg-surface-2 shadow-2xl shadow-black/60" role="dialog" aria-modal="true" aria-label="Settings">
      <nav class="flex w-[236px] shrink-0 flex-col border-r border-line bg-surface">
        <div class="px-4 pt-4 pb-3">
          <h2 class="mb-3 text-[16px] font-semibold text-fg">Settings</h2>
          <div class="relative">
            <Search :size="14" class="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint" />
            <input v-model="filter" class="gw-input h-9 pl-8" placeholder="Search settings…" spellcheck="false" />
          </div>
        </div>
        <div class="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2">
          <button
            v-for="x in visibleSections" :key="x.id" type="button"
            class="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[14px] transition-colors"
            :class="tab === x.id ? 'bg-accent/15 font-medium text-fg' : 'text-muted hover:bg-hover hover:text-fg'"
            @click="tab = x.id"
          >
            <component :is="x.icon" :size="17" :class="tab === x.id ? 'text-accent' : ''" />{{ x.label }}
          </button>
          <p v-if="!visibleSections.length" class="px-2.5 py-2 text-[13px] text-faint">Nothing matches “{{ filter }}”.</p>
        </div>
        <div class="flex items-center gap-2 border-t border-line px-4 py-3 text-[12px] text-faint">
          <img src="/favicon.png" alt="" class="h-5 w-5 rounded" />KromaGit
        </div>
      </nav>

      <section class="flex min-w-0 flex-1 flex-col">
        <header class="flex items-start gap-3 border-b border-line px-6 py-4">
          <div class="min-w-0 flex-1">
            <h3 class="text-[17px] font-semibold text-fg">{{ current.label }}</h3>
            <p class="mt-0.5 text-[13px] text-muted">{{ current.desc }}</p>
          </div>
          <button type="button" class="rounded-md p-1.5 text-faint hover:bg-hover hover:text-fg" title="Close (Esc)" @click="ui.settingsOpen = false"><X :size="18" /></button>
        </header>

        <div class="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5 text-[13px]">
          <template v-if="tab === 'appearance'">
            <div class="card">
              <div class="card-title">Theme</div>
              <p class="card-desc">Kroma palettes are tuned for low glare; the rest follow popular editor themes. Pick what feels easiest on your eyes.</p>
              <div class="mt-3 grid grid-cols-3 gap-3">
                <button
                  v-for="t in themeCards" :key="t.id" type="button"
                  class="overflow-hidden rounded-xl border-2 text-left transition-colors"
                  :class="store.settings.appearance.theme === t.id ? 'border-accent' : 'border-line hover:border-line-strong'"
                  @click="store.setTheme(t.id); draft.appearance.theme = t.id"
                >
                  <div class="relative h-[80px]">
                    <ThemePreview :swatch="t.swatch" />
                    <div v-if="t.system" class="absolute inset-0" style="clip-path: polygon(100% 0, 100% 100%, 0 100%)">
                      <ThemePreview :swatch="THEMES[3].swatch" />
                    </div>
                  </div>
                  <div class="bg-surface px-3 py-2">
                    <div class="flex items-center justify-between text-[13px]">
                      <span class="truncate font-medium" :class="store.settings.appearance.theme === t.id ? 'text-accent' : 'text-fg'">{{ t.name }}</span>
                      <Check v-if="store.settings.appearance.theme === t.id" :size="15" class="shrink-0 text-accent" />
                      <component :is="t.system ? Monitor : t.kind === 'light' ? Sun : Moon" v-else :size="14" class="shrink-0 text-faint" />
                    </div>
                    <div class="truncate text-[11px] text-faint">{{ t.blurb }}</div>
                  </div>
                </button>
              </div>
            </div>

            <div class="card">
              <div class="card-title">Accent colour</div>
              <p class="card-desc">Used for selection, buttons and highlights. “Theme” uses the palette’s own colour.</p>
              <div class="mt-3 flex flex-wrap gap-2">
                <button
                  v-for="(a, id) in ACCENTS" :key="id" type="button"
                  class="flex items-center gap-2 rounded-full border py-1 pr-3 pl-1 text-[13px] transition-colors"
                  :class="store.settings.appearance.accent === id ? 'border-accent bg-accent/10 text-fg' : 'border-line text-muted hover:border-line-strong hover:text-fg'"
                  @click="setAccent(id)"
                >
                  <span class="flex h-5 w-5 items-center justify-center rounded-full" :style="{ background: id === 'theme' ? themeAccent : resolvedTheme === 'light' ? a.light : a.dark }">
                    <Check v-if="store.settings.appearance.accent === id" :size="12" class="text-on-accent" :stroke-width="3" />
                  </span>{{ a.name }}
                </button>
              </div>
            </div>

            <div class="card">
              <div class="flex items-center gap-4">
                <div class="min-w-0 flex-1">
                  <div class="card-title">Zoom</div>
                  <p class="card-desc">Makes everything bigger or smaller. {{ formatCombo('Mod+=') }} / {{ formatCombo('Mod+-') }} / {{ formatCombo('Mod+0') }}</p>
                </div>
                <input
                  type="range" :min="ZOOM_MIN" :max="ZOOM_MAX" step="10" class="w-44 accent-[var(--gw-accent)]"
                  :value="store.settings.appearance.zoom"
                  @change="store.zoomBy(Number(($event.target as HTMLInputElement).value) - store.settings.appearance.zoom); draft.appearance.zoom = Number(($event.target as HTMLInputElement).value)"
                />
                <span class="w-12 text-right font-mono text-fg">{{ store.settings.appearance.zoom }}%</span>
              </div>
            </div>

          </template>

          <template v-else-if="tab === 'general'">
            <div class="card">
              <div class="card-title">Terminal</div>
              <p class="card-desc">Used by “Open in terminal”.</p>
              <input v-model="draft.general.terminalApp" class="gw-input mt-3 h-9 font-mono" :placeholder="isMacOS ? 'Terminal (default) — e.g. iTerm, Warp, Ghostty' : 'System default — e.g. wezterm start --cwd {path}'" spellcheck="false" />
            </div>
            <div class="card">
              <div class="card-title">Editor</div>
              <p class="card-desc">Used by “Open in editor”.</p>
              <input v-model="draft.general.editorApp" class="gw-input mt-3 h-9 font-mono" :placeholder="isMacOS ? 'VS Code / Cursor if installed — e.g. Zed, Sublime Text' : 'code (default) — e.g. zed {path}'" spellcheck="false" />
            </div>
            <p class="text-[12px] text-faint">{{ isMacOS ? 'An application name, or a full command line.' : 'A command line;' }} <code>{path}</code> is replaced by the repository folder (appended if omitted).</p>
          </template>

          <template v-else-if="tab === 'updates'">
            <div class="card">
              <div class="flex items-center gap-4">
                <img src="/favicon.png" alt="" class="h-12 w-12 rounded-xl" />
                <div class="min-w-0 flex-1">
                  <div class="text-[15px] font-semibold text-fg">KromaGit {{ updates.current }}</div>
                  <p class="card-desc !mt-0.5">
                    <template v-if="updates.status === 'checking'">Checking for updates…</template>
                    <template v-else-if="updates.status === 'available'"><span class="text-accent">Version {{ updates.latest }} is available.</span></template>
                    <template v-else-if="updates.status === 'downloading'">Downloading {{ updates.latest }}… {{ Math.round(updates.progress * 100) }}%</template>
                    <template v-else-if="updates.status === 'ready'">Installed. Restarting…</template>
                    <template v-else-if="updates.status === 'error'"><span class="text-danger">{{ updates.error }}</span></template>
                    <template v-else-if="updates.status === 'upToDate'">You have the latest version.</template>
                    <template v-else-if="updates.lastChecked">Last checked {{ relativeTime(updates.lastChecked / 1000) }}.</template>
                    <template v-else>Updates come from the project's GitHub releases.</template>
                  </p>
                </div>
                <button
                  type="button"
                  class="flex h-9 shrink-0 items-center gap-2 rounded-lg px-3.5 text-[13px] font-medium disabled:opacity-60"
                  :class="updates.status === 'available' ? 'bg-accent text-on-accent hover:opacity-90' : 'border border-line-strong text-fg hover:bg-hover'"
                  :disabled="updates.status === 'checking' || updates.status === 'downloading' || updates.status === 'ready'"
                  @click="updates.checkOrInstall()"
                >
                  <Loader2 v-if="updates.status === 'checking' || updates.status === 'downloading'" :size="15" class="animate-spin" />
                  <CloudDownload v-else :size="15" />
                  {{ updates.status === 'available' ? 'Update and restart' : 'Check for updates' }}
                </button>
              </div>
              <div v-if="updates.status === 'downloading'" class="mt-4 h-1.5 overflow-hidden rounded-full bg-surface-3">
                <div class="h-full rounded-full bg-accent transition-[width]" :style="{ width: `${Math.round(updates.progress * 100)}%` }" />
              </div>
            </div>
            <div class="card">
              <label class="flex cursor-pointer items-center justify-between gap-4">
                <span>
                  <span class="card-title block">Check automatically</span>
                  <span class="card-desc block">Look for a new version once a day when KromaGit opens. You're always asked before anything is installed.</span>
                </span>
                <input v-model="updates.autoCheck" type="checkbox" class="toggle" />
              </label>
            </div>
            <div class="card">
              <div class="flex items-center justify-between gap-4">
                <span>
                  <span class="card-title block">What's new in {{ updates.current }}</span>
                  <span class="card-desc block">See what changed in the version you're running.</span>
                </span>
                <button type="button" class="flex h-9 shrink-0 items-center gap-2 rounded-lg border border-line-strong px-3.5 text-[13px] font-medium text-fg hover:bg-hover" @click="updates.showWhatsNew()">
                  <Sparkles :size="15" />What's new
                </button>
              </div>
            </div>
            <p class="text-[12px] text-faint">You can also click the version number in the status bar to check.</p>
          </template>

          <template v-else-if="tab === 'shortcuts'">
            <p class="text-muted">Press <kbd class="kbd">{{ formatCombo('Mod+K') }}</kbd> to search every command, or <kbd class="kbd">{{ formatCombo('Mod+P') }}</kbd> to switch repository.</p>
            <div class="card !p-0">
              <div class="grid grid-cols-2">
                <div v-for="c in shortcutList" :key="c.id" class="flex items-center justify-between gap-3 border-b border-line px-4 py-2 odd:border-r">
                  <span class="truncate text-fg/90">{{ c.id === 'tab-1' ? 'Go to tab 1–9' : c.title }}</span>
                  <kbd class="kbd shrink-0">{{ c.id === 'tab-1' ? formatCombo('Mod+1') + '…9' : formatCombo(c.shortcut!) }}</kbd>
                </div>
                <div class="flex items-center justify-between gap-3 border-b border-line px-4 py-2 odd:border-r"><span class="text-fg/90">Move through commits</span><kbd class="kbd">↑ ↓ / j k</kbd></div>
                <div class="flex items-center justify-between gap-3 border-b border-line px-4 py-2 odd:border-r"><span class="text-fg/90">Close commit, diff or panel</span><kbd class="kbd">Esc</kbd></div>
              </div>
            </div>
          </template>

          <template v-else-if="tab === 'ai'">
            <div class="card">
              <div class="card-title">Provider</div>
              <p class="card-desc">AI is optional. API keys are stored in your system keychain, never in a file.</p>
              <div class="mt-3 grid grid-cols-3 gap-2">
                <button
                  v-for="p in PROVIDERS" :key="p.id" type="button"
                  class="flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors"
                  :class="provider === p.id ? 'border-accent bg-accent/10' : 'border-line hover:border-line-strong hover:bg-hover'"
                  @click="pick(p.id)"
                >
                  <span class="flex items-center gap-1.5 font-semibold text-fg"><Sparkles v-if="p.id !== 'none'" :size="14" class="text-accent-2" />{{ p.name }}</span>
                  <span class="text-[12px] leading-snug text-muted">{{ p.blurb }}</span>
                </button>
              </div>
            </div>

            <div v-if="provider !== 'none'" class="card space-y-4">
              <div v-if="provider === 'ollama'" class="grid grid-cols-[110px_1fr] items-center gap-x-3 gap-y-3">
                <label class="text-muted">Server URL</label>
                <div class="flex gap-2">
                  <input v-model="draft.ai.ollamaUrl" class="gw-input h-9 font-mono" spellcheck="false" />
                  <button type="button" class="flex h-9 shrink-0 items-center gap-1 rounded-md border border-line-strong px-2.5 whitespace-nowrap hover:bg-hover" @click="loadOllama">
                    <Loader2 v-if="busy === 'ollama'" :size="14" class="animate-spin" /><RefreshCw v-else :size="14" />Load models
                  </button>
                </div>
                <label class="text-muted">Model</label>
                <div>
                  <select v-if="ollamaModels.length" v-model="draft.ai.models.ollama" class="gw-input h-9">
                    <option v-for="m in ollamaModels" :key="m" :value="m">{{ m }}</option>
                  </select>
                  <input v-else v-model="draft.ai.models.ollama" class="gw-input h-9 font-mono" placeholder="e.g. qwen2.5-coder:7b" spellcheck="false" />
                  <p class="mt-1 text-[12px] text-faint">Install from ollama.com, then run <code class="text-muted">ollama pull qwen2.5-coder</code>. A coding-tuned model gives the best results.</p>
                </div>
              </div>

              <div v-else class="grid grid-cols-[110px_1fr] items-center gap-x-3 gap-y-3">
                <label class="text-muted">Model</label>
                <div>
                  <input v-model="draft.ai.models[provider]" :list="`models-${provider}`" class="gw-input h-9 font-mono" spellcheck="false" />
                  <datalist :id="`models-${provider}`"><option v-for="m in info.models" :key="m" :value="m" /></datalist>
                  <p class="mt-1 text-[12px] text-faint">Any model id your account can use. Suggestions: {{ info.models.join(', ') }}.</p>
                </div>
                <label class="text-muted">API key</label>
                <div>
                  <div v-if="hasKey" class="flex items-center gap-2">
                    <span class="flex items-center gap-1 text-success"><KeyRound :size="15" />Saved in your system keychain</span>
                    <button type="button" class="ml-auto rounded-md px-2 py-1 text-danger hover:bg-danger/10" @click="removeKey">Remove</button>
                  </div>
                  <div class="flex gap-2" :class="{ 'mt-2': hasKey }">
                    <input v-model="keyInput" type="password" class="gw-input h-9 font-mono" :placeholder="hasKey ? 'Replace key…' : 'Paste your API key'" autocomplete="off" spellcheck="false" @keydown.enter="saveKey" />
                    <button type="button" :disabled="!keyInput.trim() || busy === 'key'" class="h-9 shrink-0 rounded-md bg-accent px-3 font-semibold whitespace-nowrap text-on-accent disabled:opacity-40" @click="saveKey">Save key</button>
                  </div>
                </div>
                <label class="text-muted">Privacy</label>
                <div class="flex items-center gap-2 text-muted">
                  <ShieldCheck :size="15" :class="consented ? 'text-success' : 'text-faint'" />
                  <span v-if="consented">You allowed sending code to {{ info.name }}.</span>
                  <span v-else>Before the first request, KromaGit shows exactly what will be sent and asks.</span>
                  <button v-if="consented" type="button" class="ml-auto rounded-md px-2 py-1 hover:bg-hover hover:text-fg" @click="revokeConsent">Revoke</button>
                </div>
              </div>

              <div class="flex items-center gap-3 rounded-lg border border-line bg-bg px-3 py-2">
                <button type="button" :disabled="!!busy" class="flex h-8 shrink-0 items-center gap-1 rounded-md border border-line-strong px-2.5 whitespace-nowrap hover:bg-hover disabled:opacity-40" @click="test">
                  <Loader2 v-if="busy === 'test'" :size="14" class="animate-spin" /><Check v-else :size="14" />Test connection
                </button>
                <span v-if="testResult" class="min-w-0 truncate" :class="testResult.ok ? 'text-success' : 'text-danger'" :title="testResult.text">{{ testResult.text }}</span>
                <span v-else class="text-faint">Sends a one-line test prompt (no code).</span>
              </div>
            </div>
            <p v-if="provider !== 'none'" class="text-[12px] text-faint">Before anything is sent: likely secrets are replaced with [REDACTED], .env and key files are skipped, and large diffs are capped or summarised per file.</p>
          </template>

          <template v-else-if="tab === 'repo'">
            <div v-if="!repoRoot" class="card text-muted">Open a repository to configure it.</div>
            <div v-else class="card">
              <div class="card-title">Commit message convention</div>
              <p class="card-desc">For <span class="font-mono text-fg">{{ repos.activeTab?.name }}</span>; used by AI commit messages and split suggestions.</p>
              <div class="mt-3 mb-2 flex flex-wrap gap-1.5">
                <button
                  v-for="p in TEMPLATE_PRESETS" :key="p.label" type="button"
                  class="rounded-full border px-2.5 py-1 text-[12px]" :class="template === p.value ? 'border-accent bg-accent/10 text-fg' : 'border-line text-muted hover:text-fg'"
                  @click="template = p.value"
                >{{ p.label }}</button>
              </div>
              <input v-model="template" class="gw-input h-9 font-mono" placeholder="Empty = learn the style from the last 20 commits" spellcheck="false" />
              <p class="mt-2 text-[12px] text-faint">Placeholders: <code>{type}</code>/<code>{Type}</code>, <code>{scope}</code>/<code>{Feature}</code>, <code>{summary}</code>. Example: <code>[{Feature}] {Type}: {summary}</code> → “[Checkout] Fix: handle empty cart”.</p>
            </div>
          </template>

          <template v-else>
            <div class="card">
              <div class="card-title">Standup</div>
              <p class="card-desc">Commits by this email count as yours.</p>
              <input v-model="draft.standup.authorEmail" class="gw-input mt-3 h-9 font-mono" placeholder="you@example.com" spellcheck="false" />
            </div>
            <div class="card">
              <div class="card-title">Branch cleanup</div>
              <p class="card-desc">Branches merged into these are offered for deletion, as are branches with no commits for a while.</p>
              <div class="mt-3 grid grid-cols-[120px_1fr] items-center gap-x-3 gap-y-3">
                <label class="text-muted">Base branches</label>
                <input v-model="baseBranches" class="gw-input h-9 font-mono" placeholder="main, staging" spellcheck="false" />
                <label class="text-muted">Stale after</label>
                <div class="flex items-center gap-2"><input v-model.number="draft.cleanup.staleDays" type="number" min="1" class="gw-input h-9 w-24" /> days without commits</div>
              </div>
            </div>
          </template>
        </div>

        <footer class="flex items-center justify-end gap-2 border-t border-line px-6 py-3">
          <span class="mr-auto text-[12px] text-faint">Theme, accent and zoom apply right away.</span>
          <button type="button" class="h-9 rounded-md border border-line-strong px-3 text-[13px] hover:bg-hover" @click="ui.settingsOpen = false">Cancel</button>
          <button type="button" :disabled="busy === 'save'" class="h-9 rounded-md bg-accent px-4 text-[13px] font-semibold text-on-accent hover:brightness-110 disabled:opacity-40" @click="save">Save</button>
        </footer>
      </section>
    </div>
  </div>
</template>

<style scoped>
@reference '../../styles/main.css';
.card {
  @apply rounded-xl border border-line bg-surface p-4;
}
.card-title {
  @apply text-[14px] font-semibold text-fg;
}
.card-desc {
  @apply mt-0.5 text-[12px] leading-relaxed text-muted;
}
.kbd {
  @apply rounded border border-line bg-surface px-1.5 font-mono text-[12px] text-muted;
}
.toggle {
  @apply relative h-6 w-10 shrink-0 cursor-pointer appearance-none rounded-full bg-surface-3 transition-colors checked:bg-accent;
}
.toggle::after {
  content: '';
  @apply absolute top-1 left-1 h-4 w-4 rounded-full bg-white shadow transition-transform;
}
.toggle:checked::after {
  @apply translate-x-4;
}
</style>
