<script setup lang="ts">
import { computed } from 'vue'
import { Clock, Command, FolderGit2, FolderOpen, FolderSearch, GitBranchPlus, Settings, X } from '@/lib/icons'
import { useReposStore } from '@/stores/repos'
import { useUiStore } from '@/stores/ui'
import { formatCombo } from '@/lib/shortcuts'
import { relativeTime, shortPath } from '@/lib/format'

const repos = useReposStore()
const ui = useUiStore()

const recent = computed(() =>
  repos.recent.map((r) => ({ ...r, tabId: repos.tabs.find((t) => t.path === r.path)?.id })),
)

function open(r: { path: string; tabId?: string }) {
  if (r.tabId) repos.activate(r.tabId)
  else void repos.openRepoAt(r.path)
}

const actions = computed(() => [
  { icon: FolderOpen, title: 'Open repository', sub: 'Pick a folder with a Git repo', combo: 'Mod+O', run: () => repos.openRepo(), primary: true },
  { icon: FolderSearch, title: 'Switch repository', sub: 'Jump to a recent or open repo', combo: 'Mod+P', run: () => (ui.switcherOpen = true) },
  { icon: GitBranchPlus, title: 'Clone repository', sub: 'Copy a repo from GitHub or a URL', combo: '', run: () => repos.cloneRepo() },
  { icon: Command, title: 'Command palette', sub: 'Every action, searchable', combo: 'Mod+K', run: () => (ui.paletteOpen = true) },
])
</script>

<template>
  <div class="flex flex-1 justify-center overflow-y-auto p-8" data-tauri-drag-region>
    <div class="my-auto w-full max-w-[760px] py-6">
      <div class="mb-8 flex items-center gap-4">
        <img src="/favicon.png" alt="" class="h-14 w-14 rounded-2xl shadow-lg" draggable="false" />
        <div>
          <h1 class="text-[22px] font-semibold text-fg">KromaGit</h1>
          <p class="text-[14px] text-muted">A fast, local-first Git client.</p>
        </div>
      </div>

      <div class="mb-8 grid grid-cols-2 gap-3">
        <button
          v-for="a in actions" :key="a.title"
          type="button"
          class="flex flex-col gap-2 rounded-xl border px-4 py-3.5 text-left transition-colors"
          :class="a.primary ? 'border-accent/40 bg-accent/10 hover:bg-accent/15' : 'border-line hover:bg-hover'"
          @click="a.run()"
        >
          <span class="flex items-center justify-between">
            <component :is="a.icon" :size="22" :class="a.primary ? 'text-accent' : 'text-muted'" />
            <kbd v-if="a.combo" class="rounded border border-line-strong px-1.5 py-0.5 font-mono text-[11px] text-faint">{{ formatCombo(a.combo) }}</kbd>
          </span>
          <span>
            <span class="block text-[14px] font-semibold text-fg">{{ a.title }}</span>
            <span class="block text-[12px] text-muted">{{ a.sub }}</span>
          </span>
        </button>
      </div>

      <div v-if="recent.length">
        <div class="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-muted">
          <Clock :size="14" />Recent
          <span class="ml-auto font-normal tracking-normal normal-case">{{ recent.length }}</span>
        </div>
        <div class="overflow-hidden rounded-xl border border-line">
          <div
            v-for="r in recent" :key="r.path"
            role="button" tabindex="0"
            class="group flex cursor-pointer items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0 hover:bg-hover"
            @click="open(r)"
            @keydown.enter="open(r)"
          >
            <FolderGit2 :size="18" class="shrink-0" :class="r.tabId ? 'text-accent' : 'text-accent-2'" />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-[14px] text-fg">{{ r.name }}</span>
              <span class="block truncate font-mono text-[12px] text-faint">{{ shortPath(r.path) }}</span>
            </span>
            <span v-if="r.tabId" class="shrink-0 rounded-md bg-surface-3 px-2 py-0.5 text-[11px] text-muted">Open tab</span>
            <span class="w-20 shrink-0 text-right text-[12px] text-faint">{{ relativeTime(r.openedAt / 1000) }}</span>
            <button
              type="button" class="rounded p-1 text-faint opacity-0 group-hover:opacity-100 hover:bg-surface-3 hover:text-fg"
              title="Remove from recent" @click.stop="repos.forgetRecent(r.path)"
            ><X :size="14" /></button>
          </div>
        </div>
      </div>
      <p v-else class="text-[13px] text-faint">Repositories you open will show up here.</p>

      <button type="button" class="mt-6 flex items-center gap-1.5 text-[13px] text-muted hover:text-fg" @click="ui.openSettings()">
        <Settings :size="15" />Settings
      </button>
    </div>
  </div>
</template>
