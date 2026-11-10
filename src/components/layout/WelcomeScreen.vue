<script setup lang="ts">
import { Clock, Command, FolderGit2, FolderOpen, Settings, X } from 'lucide-vue-next'
import { useReposStore } from '@/stores/repos'
import { useUiStore } from '@/stores/ui'
import { formatCombo } from '@/lib/shortcuts'
import { relativeTime } from '@/lib/format'

const repos = useReposStore()
const ui = useUiStore()

function shortPath(p: string) {
  return p.replace(/^\/(?:Users|home)\/[^/]+/, '~')
}
</script>

<template>
  <div class="flex flex-1 items-center justify-center overflow-y-auto p-8" data-tauri-drag-region>
    <div class="w-full max-w-[560px]">
      <div class="mb-8 flex items-center gap-4">
        <img src="/favicon.png" alt="" class="h-14 w-14 rounded-2xl shadow-lg" draggable="false" />
        <div>
          <h1 class="text-[22px] font-semibold text-fg">KromaGit</h1>
          <p class="text-[14px] text-muted">A fast, local-first Git client.</p>
        </div>
      </div>

      <div class="mb-8 grid grid-cols-2 gap-3">
        <button
          type="button"
          class="flex items-center gap-3 rounded-xl border border-accent/40 bg-accent/10 px-4 py-3.5 text-left hover:bg-accent/15"
          @click="repos.openRepo()"
        >
          <FolderOpen :size="22" class="shrink-0 text-accent" />
          <span class="flex-1">
            <span class="block text-[14px] font-semibold text-fg">Open repository</span>
            <span class="block text-[12px] text-muted">Pick a folder with a Git repo</span>
          </span>
          <kbd class="rounded border border-line-strong px-1.5 py-0.5 font-mono text-[11px] text-faint">{{ formatCombo('Mod+O') }}</kbd>
        </button>
        <button
          type="button"
          class="flex items-center gap-3 rounded-xl border border-line px-4 py-3.5 text-left hover:bg-hover"
          @click="ui.paletteOpen = true"
        >
          <Command :size="22" class="shrink-0 text-muted" />
          <span class="flex-1">
            <span class="block text-[14px] font-semibold text-fg">Command palette</span>
            <span class="block text-[12px] text-muted">Every action, searchable</span>
          </span>
          <kbd class="rounded border border-line-strong px-1.5 py-0.5 font-mono text-[11px] text-faint">{{ formatCombo('Mod+K') }}</kbd>
        </button>
      </div>

      <div v-if="repos.recent.length">
        <div class="mb-2 flex items-center gap-1.5 text-[12px] font-semibold tracking-wider text-faint uppercase">
          <Clock :size="14" />Recent
        </div>
        <div class="overflow-hidden rounded-xl border border-line">
          <div
            v-for="r in repos.recent" :key="r.path"
            role="button" tabindex="0"
            class="group flex cursor-pointer items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0 hover:bg-hover"
            @click="repos.openRepoAt(r.path)"
            @keydown.enter="repos.openRepoAt(r.path)"
          >
            <FolderGit2 :size="18" class="shrink-0 text-accent-2" />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-[14px] text-fg">{{ r.name }}</span>
              <span class="block truncate font-mono text-[12px] text-faint">{{ shortPath(r.path) }}</span>
            </span>
            <span class="shrink-0 text-[12px] text-faint">{{ relativeTime(r.openedAt / 1000) }}</span>
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
