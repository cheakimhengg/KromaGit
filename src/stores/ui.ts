import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import type { Component } from 'vue'
import type { DiffTarget } from '@/types/git'
import { inTauri } from '@/api/git'

export type CenterView = 'graph' | 'diff' | 'review' | 'split' | 'standup' | 'cleanup'
export type DiffMode = 'unified' | 'split'

export interface MenuItem {
  label?: string
  icon?: Component
  danger?: boolean
  separator?: boolean
  heading?: boolean
  shortcut?: string
  /** small colour swatch instead of an icon */
  swatch?: string
  action?: () => void
  disabled?: boolean
  /** monospace heading, e.g. a path */
  mono?: boolean
  /** opens a submenu on hover */
  children?: MenuItem[]
}

export interface Toast {
  id: number
  kind: 'info' | 'success' | 'error'
  title: string
  detail?: string
  action?: { label: string; run: () => void }
  /** stays until closed or acted on */
  sticky?: boolean
}

export interface DialogField {
  key: string
  label: string
  placeholder?: string
  initial?: string
  multiline?: boolean
  optional?: boolean
  mono?: boolean
  validate?: (value: string) => string | null
}

export interface DialogCheckbox {
  key: string
  label: string
  initial?: boolean
}

export interface DialogOptions {
  title: string
  message?: string
  /** monospace details, e.g. the list of files that will be discarded */
  detail?: string[]
  fields?: DialogField[]
  checkboxes?: DialogCheckbox[]
  confirmLabel?: string
  danger?: boolean
  /** large monospace preview, e.g. exactly what will be sent to an AI provider */
  preview?: string
  wide?: boolean
}

export interface DialogResult {
  values: Record<string, string>
  checks: Record<string, boolean>
}

interface OpenDialog extends DialogOptions {
  resolve: (r: DialogResult | null) => void
}

let toastSeq = 0

function stored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  const v = localStorage.getItem(key)
  return allowed.includes(v as T) ? (v as T) : fallback
}

export const useUiStore = defineStore('ui', () => {
  const sidebarCollapsed = ref(localStorage.getItem('kromagit.sidebarCollapsed') === '1')
  watch(sidebarCollapsed, (v) => localStorage.setItem('kromagit.sidebarCollapsed', v ? '1' : '0'))
  const SECTIONS_KEY = 'kromagit.sections.v1'
  /** sidebar section title → expanded; missing = the section's default */
  const sidebarSections = ref<Record<string, boolean>>(
    (() => {
      try {
        return JSON.parse(localStorage.getItem(SECTIONS_KEY) ?? '{}') as Record<string, boolean>
      } catch {
        return {}
      }
    })(),
  )
  watch(sidebarSections, (v) => localStorage.setItem(SECTIONS_KEY, JSON.stringify(v)), { deep: true })
  const selectedCommit = ref<string | null>(null)
  const centerView = ref<CenterView>('graph')
  const diffTarget = ref<DiffTarget | null>(null)
  const diffMode = ref<DiffMode>(stored('kromagit.diffMode', ['unified', 'split'] as const, 'unified'))
  watch(diffMode, (v) => localStorage.setItem('kromagit.diffMode', v))
  /** what the file viewer shows: the change, the file's history, or blame */
  const diffView = ref<'diff' | 'history' | 'blame'>('diff')
  const DIFF_OPTS_KEY = 'kromagit.diffOptions.v1'
  const diffOptions = ref({
    wordDiff: true,
    ignoreWhitespace: false,
    wrap: false,
    fullFile: false,
    ...(() => {
      try {
        return JSON.parse(localStorage.getItem(DIFF_OPTS_KEY) ?? '{}') as Record<string, boolean>
      } catch {
        return {}
      }
    })(),
  })
  watch(diffOptions, (v) => localStorage.setItem(DIFF_OPTS_KEY, JSON.stringify(v)), { deep: true })
  const fileViewMode = ref<'list' | 'tree'>(stored('kromagit.fileViewMode', ['list', 'tree'] as const, 'list'))
  watch(fileViewMode, (v) => localStorage.setItem('kromagit.fileViewMode', v))
  const settingsOpen = ref(false)
  const paletteOpen = ref(false)
  const switcherOpen = ref(false)
  const repoMenuOpen = ref(false)
  const terminalOpen = ref(false)
  const terminalHeight = ref(Number(localStorage.getItem('kromagit.terminal.height')) || 280)
  watch(terminalHeight, (h) => localStorage.setItem('kromagit.terminal.height', String(h)))
  /** the Home (welcome) page is showing instead of the active repository */
  /** the desktop app reopens where it was left: on Home, or on the last active repository */
  const home = ref(inTauri && localStorage.getItem('kromagit.home') !== '0')
  watch(home, (v) => localStorage.setItem('kromagit.home', v ? '1' : '0'))
  /** which Settings tab to show next time it opens */
  const settingsTab = ref<'appearance' | 'general' | 'ai' | 'repo' | 'workflow' | 'shortcuts' | 'updates'>('appearance')
  /** bumped to ask components to act (commit box, AI generate, graph search) */
  const commitRequest = ref(0)
  /** set to switch the commit box into amend mode; the commit box clears it */
  const amendPending = ref(false)
  const generateRequest = ref(0)
  const searchRequest = ref(0)
  const previousView = ref<CenterView>('graph')

  const menu = ref<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const toasts = ref<Toast[]>([])
  const dialog = ref<OpenDialog | null>(null)

  const diffPath = computed(() => diffTarget.value?.path ?? null)
  const diffSource = computed(() => diffTarget.value?.source ?? null)

  function selectCommit(hash: string | null) {
    selectedCommit.value = hash
  }

  function openDiff(target: DiffTarget) {
    if (centerView.value !== 'diff') {
      previousView.value = centerView.value
      diffView.value = 'diff'
    }
    diffTarget.value = target
    centerView.value = 'diff'
  }

  /** Opens the file's diff, or closes it when that same diff is already showing. */
  function toggleDiff(target: DiffTarget) {
    const t = diffTarget.value
    if (centerView.value === 'diff' && t && t.path === target.path && t.source === target.source && t.commit === target.commit) closeDiff()
    else openDiff(target)
  }

  function closeDiff() {
    diffView.value = 'diff'
    centerView.value = previousView.value === 'diff' ? 'graph' : previousView.value
    previousView.value = 'graph'
    diffTarget.value = null
  }

  function showPanel(view: CenterView) {
    diffTarget.value = null
    previousView.value = 'graph'
    centerView.value = view
  }

  function resetForRepoSwitch() {
    home.value = false
    selectedCommit.value = null
    diffTarget.value = null
    previousView.value = 'graph'
    if (centerView.value === 'diff' || centerView.value === 'review' || centerView.value === 'split' || centerView.value === 'cleanup') centerView.value = 'graph'
  }

  function openSettings(tab: typeof settingsTab.value = 'appearance') {
    settingsTab.value = tab
    settingsOpen.value = true
  }

  const requestCommit = () => commitRequest.value++
  const requestGenerate = () => generateRequest.value++
  function focusSearch() {
    showPanel('graph')
    searchRequest.value++
  }

  function openMenu(event: MouseEvent, items: MenuItem[]) {
    event.preventDefault()
    menu.value = { x: event.clientX, y: event.clientY, items }
  }

  function openMenuBelow(el: Element, items: MenuItem[]) {
    const rect = el.getBoundingClientRect()
    menu.value = { x: rect.left, y: rect.bottom + 4, items }
  }

  function closeMenu() {
    menu.value = null
  }

  function toast(t: Omit<Toast, 'id'>, ttlMs = 3500) {
    const id = ++toastSeq
    toasts.value.push({ ...t, id })
    if (!t.sticky) setTimeout(() => dismissToast(id), ttlMs)
    return id
  }

  function dismissToast(id: number) {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }

  function notWired(action: string) {
    toast({ kind: 'info', title: action, detail: 'Coming in a later phase.' })
  }

  function openDialog(options: DialogOptions): Promise<DialogResult | null> {
    dialog.value?.resolve(null)
    return new Promise((resolve) => {
      dialog.value = { ...options, resolve }
    })
  }

  function closeDialog(result: DialogResult | null) {
    const d = dialog.value
    dialog.value = null
    d?.resolve(result)
  }

  async function confirm(options: Omit<DialogOptions, 'fields'>): Promise<boolean> {
    return (await openDialog(options)) !== null
  }

  async function prompt(options: DialogOptions): Promise<DialogResult | null> {
    return openDialog(options)
  }

  return {
    sidebarCollapsed, sidebarSections, selectedCommit, centerView, diffTarget, diffPath, diffSource, diffMode, diffView, diffOptions, fileViewMode,
    settingsOpen, settingsTab, paletteOpen, switcherOpen, repoMenuOpen, terminalOpen, terminalHeight, home, commitRequest, amendPending, generateRequest, searchRequest, previousView, menu, toasts, dialog,
    selectCommit, openDiff, toggleDiff, closeDiff, showPanel, openSettings, requestCommit, requestGenerate, focusSearch, resetForRepoSwitch, openMenu, openMenuBelow, closeMenu, toast, dismissToast, notWired,
    openDialog, closeDialog, confirm, prompt,
  }
})
