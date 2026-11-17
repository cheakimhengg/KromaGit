/**
 * Every user-facing command in one place: the ⌘K palette lists them and the
 * global key handler triggers the ones with shortcuts. Git-changing commands
 * go through the same action functions (and confirmations) as the buttons.
 */
import { computed } from 'vue'
import type { Component } from 'vue'
import {
  Archive, ArchiveRestore, ArrowDownToLine, ChevronLeft, ChevronRight, ArrowUpFromLine, Brush, CalendarClock, Check, CloudDownload, Code2, FolderOpen, FolderSearch, GitBranch, GitBranchPlus, GitCommitHorizontal, House, Layers, LayoutList, Minus, Moon, PanelLeft, Plus, Redo2, RefreshCw, ScanSearch, Search, Settings, Sparkles, Split, Tag, Terminal, Undo2, X, ZoomIn, ZoomOut,
} from '@/lib/icons'
import * as git from '@/actions/git'
import { useAiStore } from '@/stores/ai'
import { useUpdatesStore } from '@/stores/updates'
import { useOpsStore } from '@/stores/ops'
import { useReposStore } from '@/stores/repos'
import { useSettingsStore } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'

export interface Command {
  id: string
  title: string
  group: string
  icon?: Component
  shortcut?: string
  /** also fire while typing in a text field */
  global?: boolean
  keywords?: string
  enabled?: () => boolean
  run: () => unknown
}

export function useCommands() {
  const repos = useReposStore()
  const ui = useUiStore()
  const ops = useOpsStore()
  const ai = useAiStore()
  const settings = useSettingsStore()

  const hasRepo = () => !!repos.active
  const idle = () => hasRepo() && !ops.running
  const snap = () => repos.active?.snapshot
  const hasRemote = () => idle() && (snap()?.remotes.length ?? 0) > 0

  const cycleTab = (dir: 1 | -1) => {
    const ts = repos.tabs
    if (ts.length < 2) return
    const i = ts.findIndex((t) => t.id === repos.activeTabId)
    repos.activate(ts[(i + dir + ts.length) % ts.length].id)
  }

  const staticCommands: Command[] = [
    { id: 'palette', title: 'Command palette', group: 'General', icon: Search, shortcut: 'Mod+K', global: true, run: () => (ui.paletteOpen = true) },
    { id: 'settings', title: 'Settings', group: 'General', icon: Settings, shortcut: 'Mod+,', global: true, run: () => (ui.settingsOpen = true) },
    { id: 'theme', title: 'Toggle light / dark theme', group: 'View', icon: Moon, keywords: 'appearance dark light mode', run: () => settings.toggleTheme() },
    { id: 'zoom-in', title: 'Zoom in', group: 'View', icon: ZoomIn, shortcut: 'Mod+=', global: true, run: () => settings.zoomBy(10) },
    { id: 'zoom-out', title: 'Zoom out', group: 'View', icon: ZoomOut, shortcut: 'Mod+-', global: true, run: () => settings.zoomBy(-10) },
    { id: 'zoom-reset', title: 'Reset zoom', group: 'View', icon: ZoomIn, shortcut: 'Mod+0', global: true, run: () => settings.resetZoom() },
    { id: 'sidebar', title: 'Toggle sidebar', group: 'View', icon: PanelLeft, shortcut: 'Mod+B', run: () => (ui.sidebarCollapsed = !ui.sidebarCollapsed) },
    { id: 'graph', title: 'Show commit graph', group: 'View', icon: LayoutList, keywords: 'history log', enabled: hasRepo, run: () => ui.showPanel('graph') },
    { id: 'search', title: 'Search commits', group: 'View', icon: Search, shortcut: 'Mod+F', enabled: hasRepo, run: () => ui.focusSearch() },

    { id: 'open', title: 'Open repository…', group: 'Repository', icon: FolderOpen, shortcut: 'Mod+O', global: true, run: () => repos.openRepo() },
    { id: 'clone', title: 'Clone repository…', group: 'Repository', icon: GitBranchPlus, keywords: 'git clone url download', run: () => repos.cloneRepo() },
    { id: 'switch-repo', title: 'Switch repository…', group: 'Repository', icon: FolderSearch, keywords: 'recent project open quick', shortcut: 'Mod+P', global: true, run: () => (ui.switcherOpen = true) },
    { id: 'home', title: 'Home', group: 'Repository', icon: House, keywords: 'welcome start recent', shortcut: 'Mod+Shift+H', global: true, run: () => (ui.home = !!repos.activeTab && !ui.home) },
    { id: 'close-tab', title: 'Close tab', group: 'Repository', icon: X, shortcut: 'Mod+W', global: true, enabled: () => hasRepo() && !ui.home, run: () => repos.closeTab(repos.activeTabId) },
    { id: 'next-tab', title: 'Next tab', group: 'Repository', icon: ChevronRight, shortcut: 'Mod+Shift+]', global: true, run: () => cycleTab(1) },
    { id: 'prev-tab', title: 'Previous tab', group: 'Repository', icon: ChevronLeft, shortcut: 'Mod+Shift+[', global: true, run: () => cycleTab(-1) },
    { id: 'new-group', title: 'New tab group…', group: 'Repository', icon: Layers, enabled: hasRepo, run: () => repos.promptNewGroup(repos.activeTabId) },
    { id: 'refresh', title: 'Refresh', group: 'Repository', icon: RefreshCw, shortcut: 'Mod+R', global: true, enabled: idle, run: () => repos.load(repos.activeTabId) },
    { id: 'terminal', title: 'Toggle terminal', group: 'Repository', icon: Terminal, keywords: 'shell console command line', shortcut: 'Ctrl+`', global: true, enabled: hasRepo, run: () => (ui.terminalOpen = !ui.terminalOpen) },
    { id: 'external-terminal', title: 'Open in external terminal app', group: 'Repository', icon: Terminal, keywords: 'iterm warp shell', enabled: hasRepo, run: () => git.openInTerminal() },
    { id: 'editor', title: 'Open in editor', group: 'Repository', icon: Code2, enabled: hasRepo, run: () => git.openInEditor() },

    { id: 'commit', title: 'Commit staged changes', group: 'Changes', icon: GitCommitHorizontal, shortcut: 'Mod+Enter', global: true, enabled: idle, run: () => ui.requestCommit() },
    { id: 'stage-all', title: 'Stage all changes', group: 'Changes', icon: Plus, shortcut: 'Mod+Shift+A', enabled: () => idle() && !!snap()?.workingCopy.unstaged.length, run: () => git.stageAll() },
    { id: 'unstage-all', title: 'Unstage all changes', group: 'Changes', icon: Minus, shortcut: 'Mod+Shift+U', enabled: () => idle() && !!snap()?.workingCopy.staged.length, run: () => git.unstageAll() },
    { id: 'discard-all', title: 'Discard all unstaged changes…', group: 'Changes', icon: Undo2, enabled: () => idle() && !!snap()?.workingCopy.unstaged.length, run: () => git.discardAll() },
    { id: 'undo', title: 'Undo last git action', group: 'Changes', icon: Undo2, shortcut: 'Mod+Z', enabled: () => idle() && !!ops.nextUndo, run: () => ops.undo() },
    { id: 'redo', title: 'Redo', group: 'Changes', icon: Redo2, shortcut: 'Mod+Shift+Z', enabled: () => idle() && !!ops.nextRedo, run: () => ops.redo() },
    { id: 'stash', title: 'Stash changes…', group: 'Changes', icon: Archive, shortcut: 'Mod+Shift+S', enabled: idle, run: () => git.stashPush() },
    { id: 'pop', title: 'Pop latest stash', group: 'Changes', icon: ArchiveRestore, enabled: () => idle() && !!snap()?.stashes.length, run: () => git.stashPop(0) },

    { id: 'fetch', title: 'Fetch all remotes', group: 'Remote', icon: CloudDownload, shortcut: 'Mod+Shift+F', enabled: hasRemote, run: () => git.fetchAll() },
    { id: 'pull', title: 'Pull (merge)', group: 'Remote', icon: ArrowDownToLine, shortcut: 'Mod+Shift+L', enabled: hasRemote, run: () => git.pull('merge') },
    { id: 'pull-rebase', title: 'Pull (rebase)', group: 'Remote', icon: ArrowDownToLine, enabled: hasRemote, run: () => git.pull('rebase') },
    { id: 'pull-ff', title: 'Pull (fast-forward only)', group: 'Remote', icon: ArrowDownToLine, enabled: hasRemote, run: () => git.pull('ffOnly') },
    { id: 'push', title: 'Push', group: 'Remote', icon: ArrowUpFromLine, shortcut: 'Mod+Shift+P', enabled: hasRemote, run: () => git.push() },
    { id: 'push-upstream', title: 'Push and set upstream', group: 'Remote', icon: ArrowUpFromLine, enabled: hasRemote, run: () => git.push({ setUpstream: true }) },
    { id: 'push-force', title: 'Force push (with lease)…', group: 'Remote', icon: ArrowUpFromLine, enabled: hasRemote, run: () => git.push({ force: true }) },

    { id: 'branch', title: 'Create branch…', group: 'Branches', icon: GitBranchPlus, shortcut: 'Mod+Shift+B', enabled: idle, run: () => git.createBranch() },
    { id: 'tag', title: 'Create tag at HEAD…', group: 'Branches', icon: Tag, enabled: () => idle() && !!snap()?.head.oid, run: () => git.createTag() },
    { id: 'cleanup', title: 'Branch cleanup', group: 'Branches', icon: Brush, keywords: 'merged gone stale delete', enabled: hasRepo, run: () => ui.showPanel('cleanup') },

    { id: 'ai-message', title: 'AI: generate commit message', group: 'AI', icon: Sparkles, shortcut: 'Mod+Shift+M', global: true, enabled: () => idle() && !!snap()?.workingCopy.staged.length, run: () => ui.requestGenerate() },
    { id: 'ai-review', title: 'AI: review staged changes', group: 'AI', icon: ScanSearch, enabled: () => idle() && !!snap()?.workingCopy.staged.length, run: () => ai.runReview() },
    { id: 'ai-split', title: 'AI: split changes into commits', group: 'AI', icon: Split, enabled: idle, run: () => ai.suggestSplit() },
    { id: 'whats-new', title: "What's new in KromaGit", group: 'Help', icon: Sparkles, keywords: 'release notes changelog version update new', run: () => void useUpdatesStore().showWhatsNew() },
    { id: 'check-updates', title: 'Check for updates', group: 'Help', icon: CloudDownload, keywords: 'update upgrade version release', run: () => void useUpdatesStore().checkOrInstall() },
    { id: 'standup', title: 'Standup: what did I do?', group: 'AI', icon: CalendarClock, keywords: 'summary report today week', run: () => ui.showPanel('standup') },
  ]

  for (let i = 1; i <= 9; i++) {
    staticCommands.push({
      id: `tab-${i}`, title: `Go to tab ${i}`, group: 'Repository', shortcut: `Mod+${i}`, global: true,
      enabled: () => repos.tabs.length >= i, run: () => repos.activate(repos.tabs[i - 1].id),
    })
  }

  /** Context-dependent entries: switch to a tab, check out a branch. */
  const dynamicCommands = computed<Command[]>(() => {
    const out: Command[] = repos.tabs
      .filter((t) => t.id !== repos.activeTabId)
      .map((t) => ({ id: `switch:${t.id}`, title: `Switch to ${t.name}`, group: 'Tabs', icon: FolderOpen, keywords: t.path, run: () => repos.activate(t.id) }))
    for (const b of snap()?.branches ?? []) {
      if (b.current) continue
      out.push({ id: `checkout:${b.name}`, title: `Checkout ${b.name}`, group: 'Checkout', icon: GitBranch, enabled: idle, run: () => git.checkout(b.name) })
    }
    out.push({ id: 'checkout-current', title: `On ${snap()?.currentBranch ?? '—'}`, group: 'Checkout', icon: Check, enabled: () => false, run: () => {} })
    return out
  })

  const all = computed(() => [...staticCommands.filter((c) => !c.id.startsWith('tab-')), ...dynamicCommands.value])
  return { staticCommands, all }
}
