<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from 'vue'
import { AlertTriangle, FolderOpen, RotateCw, X } from 'lucide-vue-next'
import TabBar from '@/components/layout/TabBar.vue'
import Toolbar from '@/components/layout/Toolbar.vue'
import Sidebar from '@/components/layout/Sidebar.vue'
import StatusBar from '@/components/layout/StatusBar.vue'
import CommitGraph from '@/components/graph/CommitGraph.vue'
import DiffViewer from '@/components/diff/DiffViewer.vue'
import RightPanel from '@/components/panel/RightPanel.vue'
import ContextMenu from '@/components/common/ContextMenu.vue'
import Toaster from '@/components/common/Toaster.vue'
import { useReposStore } from '@/stores/repos'
import { useUiStore } from '@/stores/ui'

const repos = useReposStore()
const ui = useUiStore()

watch(() => repos.activeTabId, () => ui.resetForRepoSwitch())

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && !ui.menu && ui.centerView === 'diff') ui.closeDiff()
}

let lastFocusRefresh = 0
function onFocus() {
  const now = Date.now()
  if (now - lastFocusRefresh < 2000) return
  lastFocusRefresh = now
  void repos.softRefresh()
}

onMounted(() => {
  void repos.openStartupPaths()
  window.addEventListener('keydown', onKey)
  window.addEventListener('focus', onFocus)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('focus', onFocus)
})
</script>

<template>
  <div class="flex h-full flex-col" @contextmenu.prevent>
    <TabBar />
    <template v-if="repos.active && repos.activeTab">
      <div v-if="repos.active.error && !repos.active.loaded" class="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <AlertTriangle :size="28" class="text-warning" />
        <div class="text-[14px] text-fg">Couldn't open {{ repos.activeTab.name }}</div>
        <div class="max-w-lg font-mono text-[11px] text-muted select-text">{{ repos.activeTab.path }}</div>
        <div class="max-w-lg rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger select-text">{{ repos.active.error }}</div>
        <div class="flex gap-2">
          <button type="button" class="flex items-center gap-1 rounded-md border border-line-strong px-3 py-1.5 text-[12px] hover:bg-hover" @click="repos.load(repos.activeTabId)">
            <RotateCw :size="12" />Retry
          </button>
          <button type="button" class="flex items-center gap-1 rounded-md border border-line-strong px-3 py-1.5 text-[12px] hover:bg-hover" @click="repos.closeTab(repos.activeTabId)">
            <X :size="12" />Close tab
          </button>
        </div>
      </div>
      <template v-else>
        <Toolbar />
        <div class="flex min-h-0 flex-1">
          <Sidebar v-show="!ui.sidebarCollapsed" class="w-[260px] shrink-0" />
          <main class="min-w-0 flex-1">
            <DiffViewer v-if="ui.centerView === 'diff' && ui.diffTarget" :target="ui.diffTarget" />
            <CommitGraph v-show="ui.centerView === 'graph'" />
          </main>
          <RightPanel class="w-[340px] shrink-0" />
        </div>
      </template>
    </template>
    <div v-else class="flex flex-1 flex-col items-center justify-center gap-3 text-muted" data-tauri-drag-region>
      <div class="text-[15px] text-fg">No repository open</div>
      <div class="text-[12px]">Open a folder that contains a Git repository to get started.</div>
      <button type="button" class="mt-1 flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-[#0b0e14] hover:brightness-110" @click="repos.openRepo()">
        <FolderOpen :size="14" />Open a repository
      </button>
    </div>
    <StatusBar />
    <ContextMenu />
    <Toaster />
  </div>
</template>
