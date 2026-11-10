<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
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

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && !ui.menu && ui.centerView === 'diff') ui.closeDiff()
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <div class="flex h-full flex-col" @contextmenu.prevent>
    <TabBar />
    <template v-if="repos.active">
      <Toolbar />
      <div class="flex min-h-0 flex-1">
        <Sidebar v-show="!ui.sidebarCollapsed" class="w-[260px] shrink-0" />
        <main class="min-w-0 flex-1">
          <DiffViewer v-if="ui.centerView === 'diff' && ui.diffPath" />
          <CommitGraph v-show="ui.centerView === 'graph'" />
        </main>
        <RightPanel class="w-[340px] shrink-0" />
      </div>
    </template>
    <div v-else class="flex flex-1 flex-col items-center justify-center gap-3 text-muted">
      <div class="text-[15px] text-fg">No repository open</div>
      <button type="button" class="rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-[#0b0e14]" @click="repos.openMockRepo()">
        Open a repository
      </button>
    </div>
    <StatusBar />
    <ContextMenu />
    <Toaster />
  </div>
</template>
