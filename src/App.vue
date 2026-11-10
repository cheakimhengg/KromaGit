<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { AlertTriangle, RotateCw, X } from 'lucide-vue-next'
import TabBar from '@/components/layout/TabBar.vue'
import Toolbar from '@/components/layout/Toolbar.vue'
import Sidebar from '@/components/layout/Sidebar.vue'
import StatusBar from '@/components/layout/StatusBar.vue'
import CommitGraph from '@/components/graph/CommitGraph.vue'
import DiffViewer from '@/components/diff/DiffViewer.vue'
import RightPanel from '@/components/panel/RightPanel.vue'
import ContextMenu from '@/components/common/ContextMenu.vue'
import Toaster from '@/components/common/Toaster.vue'
import Dialog from '@/components/common/Dialog.vue'
import OperationBanner from '@/components/layout/OperationBanner.vue'
import WelcomeScreen from '@/components/layout/WelcomeScreen.vue'
import ResizeHandle from '@/components/layout/ResizeHandle.vue'
import SettingsDialog from '@/components/settings/SettingsDialog.vue'
import ReviewPanel from '@/components/ai/ReviewPanel.vue'
import SplitPanel from '@/components/ai/SplitPanel.vue'
import StandupPanel from '@/components/ai/StandupPanel.vue'
import CleanupPanel from '@/components/ai/CleanupPanel.vue'
import { useSettingsStore } from '@/stores/settings'
import { useReposStore } from '@/stores/repos'
import { useUiStore } from '@/stores/ui'
import CommandPalette from '@/components/common/CommandPalette.vue'
import { useCommands } from '@/commands/registry'
import { isEditable, matchCombo } from '@/lib/shortcuts'
import { setAvatarContext } from '@/lib/avatars'

const repos = useReposStore()
const ui = useUiStore()
const settings = useSettingsStore()

watch(() => repos.activeTabId, () => ui.resetForRepoSwitch())

watch(
  () => [repos.active?.snapshot.remotes, repos.active?.snapshot.commits] as const,
  ([remotes, commits]) => setAvatarContext((remotes ?? []).map((r) => r.url), commits ?? []),
)

const PANES_KEY = 'kromagit.panes.v1'
const PANE_DEFAULTS = { sidebar: 280, right: 380 }
function readPanes() {
  try {
    return { ...PANE_DEFAULTS, ...JSON.parse(localStorage.getItem(PANES_KEY) ?? '{}') }
  } catch {
    return { ...PANE_DEFAULTS }
  }
}
const panes = ref<{ sidebar: number; right: number }>(readPanes())
watch(panes, (v) => localStorage.setItem(PANES_KEY, JSON.stringify(v)), { deep: true })

const { staticCommands } = useCommands()
const shortcutCommands = staticCommands.filter((c) => c.shortcut)

function onKey(e: KeyboardEvent) {
  if (ui.dialog || ui.paletteOpen || ui.settingsOpen) return
  if (e.key === 'Escape' && !ui.menu) {
    if (ui.centerView === 'diff') ui.closeDiff()
    else if (ui.centerView !== 'graph') ui.showPanel('graph')
    return
  }
  const typing = isEditable(e.target)
  for (const c of shortcutCommands) {
    if (!matchCombo(e, c.shortcut!)) continue
    if (typing && !c.global) return
    e.preventDefault()
    if (!c.enabled || c.enabled()) void c.run()
    return
  }
}

let lastFocusRefresh = 0
function onFocus() {
  const now = Date.now()
  if (now - lastFocusRefresh < 2000) return
  lastFocusRefresh = now
  void repos.softRefresh()
}

onMounted(() => {
  void settings.load()
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
        <AlertTriangle :size="30" class="text-warning" />
        <div class="text-[15px] text-fg">Couldn't open {{ repos.activeTab.name }}</div>
        <div class="max-w-lg font-mono text-[12px] text-muted select-text">{{ repos.activeTab.path }}</div>
        <div class="max-w-lg rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger select-text">{{ repos.active.error }}</div>
        <div class="flex gap-2">
          <button type="button" class="flex items-center gap-1 rounded-md border border-line-strong px-3 py-1.5 text-[13px] hover:bg-hover" @click="repos.load(repos.activeTabId)">
            <RotateCw :size="14" />Retry
          </button>
          <button type="button" class="flex items-center gap-1 rounded-md border border-line-strong px-3 py-1.5 text-[13px] hover:bg-hover" @click="repos.closeTab(repos.activeTabId)">
            <X :size="14" />Close tab
          </button>
        </div>
      </div>
      <template v-else>
        <Toolbar />
        <OperationBanner />
        <div class="flex min-h-0 flex-1">
          <Sidebar v-show="!ui.sidebarCollapsed" class="shrink-0" :style="{ width: `${panes.sidebar}px` }" />
          <ResizeHandle
            v-show="!ui.sidebarCollapsed" side="left" :width="panes.sidebar" :min="200" :max="440"
            @update:width="panes.sidebar = $event" @reset="panes.sidebar = PANE_DEFAULTS.sidebar"
          />
          <main class="min-w-0 flex-1">
            <DiffViewer v-if="ui.centerView === 'diff' && ui.diffTarget" :target="ui.diffTarget" />
            <ReviewPanel v-else-if="ui.centerView === 'review'" />
            <SplitPanel v-else-if="ui.centerView === 'split'" />
            <StandupPanel v-else-if="ui.centerView === 'standup'" />
            <CleanupPanel v-else-if="ui.centerView === 'cleanup'" />
            <CommitGraph v-show="ui.centerView === 'graph'" />
          </main>
          <ResizeHandle
            side="right" :width="panes.right" :min="320" :max="600"
            @update:width="panes.right = $event" @reset="panes.right = PANE_DEFAULTS.right"
          />
          <RightPanel class="shrink-0" :style="{ width: `${panes.right}px` }" />
        </div>
      </template>
    </template>
    <WelcomeScreen v-else />
    <StatusBar />
    <ContextMenu />
    <Toaster />
    <SettingsDialog />
    <CommandPalette />
    <Dialog />
  </div>
</template>
