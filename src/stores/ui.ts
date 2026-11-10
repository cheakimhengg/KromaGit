import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { Component } from 'vue'
import type { DiffTarget } from '@/types/git'

export type CenterView = 'graph' | 'diff'
export type DiffMode = 'unified' | 'split'

export interface MenuItem {
  label?: string
  icon?: Component
  danger?: boolean
  separator?: boolean
  shortcut?: string
  action?: () => void
}

export interface Toast {
  id: number
  kind: 'info' | 'success' | 'error'
  title: string
  detail?: string
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
}

export interface DialogResult {
  values: Record<string, string>
  checks: Record<string, boolean>
}

interface OpenDialog extends DialogOptions {
  resolve: (r: DialogResult | null) => void
}

let toastSeq = 0

export const useUiStore = defineStore('ui', () => {
  const sidebarCollapsed = ref(false)
  const selectedCommit = ref<string | null>(null)
  const centerView = ref<CenterView>('graph')
  const diffTarget = ref<DiffTarget | null>(null)
  const diffMode = ref<DiffMode>('unified')
  const fileViewMode = ref<'list' | 'tree'>('list')
  const zoom = ref(100)
  const aiProvider = ref<string | null>(null)

  const menu = ref<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const toasts = ref<Toast[]>([])
  const dialog = ref<OpenDialog | null>(null)

  const diffPath = computed(() => diffTarget.value?.path ?? null)
  const diffSource = computed(() => diffTarget.value?.source ?? null)

  function selectCommit(hash: string | null) {
    selectedCommit.value = hash
  }

  function openDiff(target: DiffTarget) {
    diffTarget.value = target
    centerView.value = 'diff'
  }

  function closeDiff() {
    centerView.value = 'graph'
    diffTarget.value = null
  }

  function resetForRepoSwitch() {
    selectedCommit.value = null
    closeDiff()
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
    setTimeout(() => dismissToast(id), ttlMs)
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
    sidebarCollapsed, selectedCommit, centerView, diffTarget, diffPath, diffSource, diffMode, fileViewMode, zoom,
    aiProvider, menu, toasts, dialog,
    selectCommit, openDiff, closeDiff, resetForRepoSwitch, openMenu, openMenuBelow, closeMenu, toast, dismissToast, notWired,
    openDialog, closeDialog, confirm, prompt,
  }
})
