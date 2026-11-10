<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { clone } from '@/lib/clone'
import { Check, KeyRound, Loader2, RefreshCw, ShieldCheck, Sparkles, X } from 'lucide-vue-next'
import { aiApi } from '@/api/ai'
import { errorMessage } from '@/api/git'
import { PROVIDERS, isCloud, useSettingsStore } from '@/stores/settings'
import { useReposStore } from '@/stores/repos'
import { useUiStore } from '@/stores/ui'
import { TEMPLATE_PRESETS } from '@/ai/prompts'
import type { CloudProvider, ProviderId, Settings } from '@/types/ai'

const ui = useUiStore()
const store = useSettingsStore()
const repos = useReposStore()

type Tab = 'ai' | 'repo' | 'workflow'
const tab = ref<Tab>('ai')
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
  <div v-if="ui.settingsOpen" class="fixed inset-0 z-[55] flex items-start justify-center bg-black/55 pt-[7vh] backdrop-blur-[2px]" @mousedown.self="ui.settingsOpen = false" @keydown="onKey">
    <div class="flex max-h-[84vh] w-[720px] max-w-[94vw] flex-col rounded-xl border border-line-strong bg-surface-2 shadow-2xl shadow-black/60" role="dialog" aria-modal="true">
      <div class="flex items-center gap-2 border-b border-line px-5 py-3">
        <h2 class="text-[14px] font-semibold">Settings</h2>
        <div class="ml-4 flex gap-1">
          <button
            v-for="t in ([['ai', 'AI'], ['repo', 'This repository'], ['workflow', 'Standup & cleanup']] as const)" :key="t[0]"
            type="button" class="rounded-md px-2.5 py-1 text-[12px]" :class="tab === t[0] ? 'bg-surface-3 text-fg' : 'text-muted hover:text-fg'"
            @click="tab = t[0]"
          >{{ t[1] }}</button>
        </div>
        <button type="button" class="ml-auto rounded p-1 text-faint hover:bg-hover hover:text-fg" @click="ui.settingsOpen = false"><X :size="15" /></button>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto px-5 py-4 text-[12px]">
        <template v-if="tab === 'ai'">
          <p class="mb-3 text-muted">AI is optional. Pick where requests go; API keys are stored in your system keychain, never in a file.</p>
          <div class="grid grid-cols-5 gap-2">
            <button
              v-for="p in PROVIDERS" :key="p.id" type="button"
              class="flex flex-col items-start gap-1 rounded-lg border p-2.5 text-left transition-colors"
              :class="provider === p.id ? 'border-accent bg-accent/10' : 'border-line hover:border-line-strong hover:bg-hover'"
              @click="pick(p.id)"
            >
              <span class="flex items-center gap-1 font-semibold text-fg"><Sparkles v-if="p.id !== 'none'" :size="12" class="text-accent-2" />{{ p.name }}</span>
              <span class="text-[10px] leading-snug text-muted">{{ p.blurb }}</span>
            </button>
          </div>

          <div v-if="provider !== 'none'" class="mt-5 space-y-4">
            <div v-if="provider === 'ollama'" class="grid grid-cols-[110px_1fr] items-center gap-x-3 gap-y-3">
              <label class="text-muted">Server URL</label>
              <div class="flex gap-2">
                <input v-model="draft.ai.ollamaUrl" class="gw-input h-8 font-mono" spellcheck="false" />
                <button type="button" class="flex h-8 shrink-0 items-center gap-1 rounded-md border border-line-strong px-2.5 hover:bg-hover" @click="loadOllama">
                  <Loader2 v-if="busy === 'ollama'" :size="12" class="animate-spin" /><RefreshCw v-else :size="12" />Load models
                </button>
              </div>
              <label class="text-muted">Model</label>
              <div>
                <select v-if="ollamaModels.length" v-model="draft.ai.models.ollama" class="gw-input h-8">
                  <option v-for="m in ollamaModels" :key="m" :value="m">{{ m }}</option>
                </select>
                <input v-else v-model="draft.ai.models.ollama" class="gw-input h-8 font-mono" placeholder="e.g. qwen2.5-coder:7b" spellcheck="false" />
                <p class="mt-1 text-[11px] text-faint">Install from ollama.com, then run <code class="text-muted">ollama pull qwen2.5-coder</code>. A coding-tuned model gives the best results.</p>
              </div>
            </div>

            <div v-else class="grid grid-cols-[110px_1fr] items-center gap-x-3 gap-y-3">
              <label class="text-muted">Model</label>
              <div>
                <input v-model="draft.ai.models[provider]" :list="`models-${provider}`" class="gw-input h-8 font-mono" spellcheck="false" />
                <datalist :id="`models-${provider}`"><option v-for="m in info.models" :key="m" :value="m" /></datalist>
                <p class="mt-1 text-[11px] text-faint">Any model id your account can use. Suggestions: {{ info.models.join(', ') }}.</p>
              </div>
              <label class="text-muted">API key</label>
              <div>
                <div v-if="hasKey" class="flex items-center gap-2">
                  <span class="flex items-center gap-1 text-success"><KeyRound :size="13" />Saved in your system keychain</span>
                  <button type="button" class="ml-auto rounded-md px-2 py-1 text-danger hover:bg-danger/10" @click="removeKey">Remove</button>
                </div>
                <div class="flex gap-2" :class="{ 'mt-2': hasKey }">
                  <input v-model="keyInput" type="password" class="gw-input h-8 font-mono" :placeholder="hasKey ? 'Replace key…' : 'Paste your API key'" autocomplete="off" spellcheck="false" @keydown.enter="saveKey" />
                  <button type="button" :disabled="!keyInput.trim() || busy === 'key'" class="h-8 shrink-0 rounded-md bg-accent px-3 font-semibold text-[#0b0e14] disabled:opacity-40" @click="saveKey">Save key</button>
                </div>
              </div>
              <label class="text-muted">Privacy</label>
              <div class="flex items-center gap-2 text-muted">
                <ShieldCheck :size="13" :class="consented ? 'text-success' : 'text-faint'" />
                <span v-if="consented">You allowed sending code to {{ info.name }}.</span>
                <span v-else>Before the first request, KromaGit shows exactly what will be sent and asks.</span>
                <button v-if="consented" type="button" class="ml-auto rounded-md px-2 py-1 hover:bg-hover hover:text-fg" @click="revokeConsent">Revoke</button>
              </div>
            </div>

            <div class="flex items-center gap-3 rounded-lg border border-line bg-bg px-3 py-2">
              <button type="button" :disabled="!!busy" class="flex h-7 shrink-0 items-center gap-1 rounded-md border border-line-strong px-2.5 hover:bg-hover disabled:opacity-40" @click="test">
                <Loader2 v-if="busy === 'test'" :size="12" class="animate-spin" /><Check v-else :size="12" />Test connection
              </button>
              <span v-if="testResult" class="min-w-0 truncate" :class="testResult.ok ? 'text-success' : 'text-danger'" :title="testResult.text">{{ testResult.text }}</span>
              <span v-else class="text-faint">Sends a one-line test prompt (no code).</span>
            </div>
            <p class="text-[11px] text-faint">Before anything is sent: likely secrets are replaced with [REDACTED], .env and key files are skipped, and large diffs are capped or summarised per file.</p>
          </div>
        </template>

        <template v-else-if="tab === 'repo'">
          <p v-if="!repoRoot" class="text-muted">Open a repository to configure it.</p>
          <template v-else>
            <p class="mb-1 text-muted">Commit message convention for <span class="font-mono text-fg">{{ repos.activeTab?.name }}</span>, used by AI commit messages and split suggestions.</p>
            <div class="mb-2 flex flex-wrap gap-1.5">
              <button
                v-for="p in TEMPLATE_PRESETS" :key="p.label" type="button"
                class="rounded-full border px-2.5 py-1 text-[11px]" :class="template === p.value ? 'border-accent bg-accent/10 text-fg' : 'border-line text-muted hover:text-fg'"
                @click="template = p.value"
              >{{ p.label }}</button>
            </div>
            <input v-model="template" class="gw-input h-8 font-mono" placeholder="Empty = learn the style from the last 20 commits" spellcheck="false" />
            <p class="mt-2 text-[11px] text-faint">Placeholders: <code>{type}</code>/<code>{Type}</code>, <code>{scope}</code>/<code>{Feature}</code>, <code>{summary}</code>. Example: <code>[{Feature}] {Type}: {summary}</code> → “[Checkout] Fix: handle empty cart”.</p>
          </template>
        </template>

        <template v-else>
          <div class="grid grid-cols-[150px_1fr] items-center gap-x-3 gap-y-3">
            <label class="text-muted">Standup author email</label>
            <input v-model="draft.standup.authorEmail" class="gw-input h-8 font-mono" placeholder="you@example.com" spellcheck="false" />
            <label class="text-muted">Cleanup: base branches</label>
            <input v-model="baseBranches" class="gw-input h-8 font-mono" placeholder="main, staging" spellcheck="false" />
            <label class="text-muted">Cleanup: stale after</label>
            <div class="flex items-center gap-2"><input v-model.number="draft.cleanup.staleDays" type="number" min="1" class="gw-input h-8 w-24" /> days without commits</div>
          </div>
        </template>
      </div>

      <div class="flex justify-end gap-2 border-t border-line px-5 py-3">
        <button type="button" class="h-8 rounded-md border border-line-strong px-3 text-[12px] hover:bg-hover" @click="ui.settingsOpen = false">Cancel</button>
        <button type="button" :disabled="busy === 'save'" class="h-8 rounded-md bg-accent px-3 text-[12px] font-semibold text-[#0b0e14] hover:brightness-110 disabled:opacity-40" @click="save">Save</button>
      </div>
    </div>
  </div>
</template>
