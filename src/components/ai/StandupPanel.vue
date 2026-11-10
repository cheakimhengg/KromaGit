<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { CalendarClock, Copy, Loader2, Search, Sparkles } from 'lucide-vue-next'
import PanelShell from './PanelShell.vue'
import { useAiStore } from '@/stores/ai'
import { useReposStore } from '@/stores/repos'
import { useSettingsStore } from '@/stores/settings'
import { aiApi } from '@/api/ai'
import * as git from '@/actions/git'

const ai = useAiStore()
const repos = useReposStore()
const settings = useSettingsStore()

type Range = 'today' | 'yesterday' | 'week' | 'custom'
const range = ref<Range>('today')
const author = ref('')
const customFrom = ref('')
const customTo = ref('')

const pad = (n: number) => String(n).padStart(2, '0')
const day = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

function bounds(): { since: string; until: string; label: string } {
  const now = new Date()
  const today = day(now)
  if (range.value === 'today') return { since: `${today} 00:00`, until: `${today} 23:59:59`, label: 'today' }
  if (range.value === 'yesterday') {
    const y = new Date(now)
    y.setDate(now.getDate() - 1)
    return { since: `${day(y)} 00:00`, until: `${day(y)} 23:59:59`, label: 'yesterday' }
  }
  if (range.value === 'week') {
    const m = new Date(now)
    m.setDate(now.getDate() - ((now.getDay() + 6) % 7))
    return { since: `${day(m)} 00:00`, until: `${today} 23:59:59`, label: 'this week' }
  }
  const from = customFrom.value || today
  const to = customTo.value || today
  return { since: `${from} 00:00`, until: `${to} 23:59:59`, label: from === to ? from : `${from} – ${to}` }
}

const s = computed(() => ai.standup)
const shown = computed(() => s.value.aiText || s.value.text)
const commitCount = computed(() => s.value.groups.reduce((n, g) => n + g.features.reduce((m, f) => m + f.subjects.length, 0), 0))

async function run() {
  const b = bounds()
  await ai.loadStandup(b.since, b.until, author.value.trim(), b.label)
}

onMounted(async () => {
  if (!settings.loaded) await settings.load()
  author.value = settings.settings.standup.authorEmail || (repos.activeTab ? await aiApi.gitUserEmail(repos.activeTab.path).catch(() => '') : '')
  customFrom.value = customTo.value = day(new Date())
  if (author.value && s.value.status === 'idle') void run()
})
</script>

<template>
  <PanelShell title="What did I do?" :icon="CalendarClock" :subtitle="`across ${repos.tabs.length} open ${repos.tabs.length === 1 ? 'repository' : 'repositories'}`">
    <div class="space-y-4 p-4">
      <div class="flex flex-wrap items-center gap-2">
        <div class="flex rounded-md border border-line p-0.5">
          <button
            v-for="r in ([['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'This week'], ['custom', 'Custom']] as const)" :key="r[0]"
            type="button" class="rounded px-2.5 py-1 text-[11px]" :class="range === r[0] ? 'bg-surface-3 text-fg' : 'text-muted hover:text-fg'"
            @click="range = r[0]"
          >{{ r[1] }}</button>
        </div>
        <template v-if="range === 'custom'">
          <input v-model="customFrom" type="date" class="gw-input h-7 w-36" />
          <span class="text-faint">to</span>
          <input v-model="customTo" type="date" class="gw-input h-7 w-36" />
        </template>
        <input v-model="author" class="gw-input h-7 w-56 font-mono" placeholder="author email" spellcheck="false" title="Only commits by this author" />
        <button
          type="button" :disabled="!author.trim() || s.status === 'running'"
          class="flex h-7 items-center gap-1 rounded-md bg-accent px-3 text-[12px] font-semibold text-[#0b0e14] disabled:opacity-40"
          @click="run"
        ><Loader2 v-if="s.status === 'running'" :size="12" class="animate-spin" /><Search v-else :size="12" />Find commits</button>
      </div>

      <div v-if="s.status === 'done'" class="space-y-3">
        <div class="flex items-center gap-2">
          <span class="text-[11px] text-muted">{{ commitCount }} commits in {{ s.groups.length }} {{ s.groups.length === 1 ? 'repository' : 'repositories' }}</span>
          <div class="flex-1" />
          <button
            type="button" :disabled="!s.groups.length || !!ai.progress"
            class="flex h-7 items-center gap-1 rounded-md border border-line-strong px-2.5 text-[12px] hover:bg-hover disabled:opacity-40"
            title="Rewrite as a short standup update with AI (sends commit subjects only)"
            @click="ai.writeStandupWithAi()"
          ><Loader2 v-if="ai.progress" :size="12" class="animate-spin" /><Sparkles v-else :size="12" class="text-accent-2" />{{ s.aiText ? 'Rewrite' : 'Write with AI' }}</button>
          <button type="button" class="flex h-7 items-center gap-1 rounded-md border border-line-strong px-2.5 text-[12px] hover:bg-hover" @click="git.copyText(shown, 'Standup copied')">
            <Copy :size="12" />Copy
          </button>
        </div>
        <textarea
          :value="shown"
          class="gw-input h-auto min-h-[220px] resize-y py-2 font-mono text-[12px] leading-relaxed"
          spellcheck="false"
          @input="s.aiText ? (ai.standup.aiText = ($event.target as HTMLTextAreaElement).value) : (ai.standup.text = ($event.target as HTMLTextAreaElement).value)"
        />
        <details v-if="s.groups.length" class="text-[12px]">
          <summary class="cursor-pointer text-muted select-none">Commits by repository and feature</summary>
          <div v-for="g in s.groups" :key="g.repo" class="mt-2">
            <div class="font-semibold text-fg">{{ g.repo }}</div>
            <div v-for="f in g.features" :key="f.name" class="ml-3 mt-1">
              <div class="text-[11px] text-accent">{{ f.name }}</div>
              <div v-for="(subj, i) in f.subjects" :key="i" class="ml-3 truncate text-muted">{{ subj }}</div>
            </div>
          </div>
        </details>
        <div v-for="e in s.errors" :key="e" class="text-[11px] text-warning">{{ e }}</div>
      </div>
    </div>
  </PanelShell>
</template>
