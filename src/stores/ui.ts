import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Component } from 'vue'

export type CenterView = 'graph' | 'diff'
export type DiffMode = 'unified' | 'split'
export type DiffSource = 'unstaged' | 'staged' | 'commit'

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

let toastSeq = 0

export const useUiStore = defineStore('ui', () => {
  const sidebarCollapsed = ref(false)
  const selectedCommit = ref<string | null>(null)
  const centerView = ref<CenterView>('graph')
  const diffPath = ref<string | null>(null)
  const diffSource = ref<DiffSource>('unstaged')
  const diffMode = ref<DiffMode>('unified')
  const fileViewMode = ref<'list' | 'tree'>('list')
  const zoom = ref(100)
  const fetchStatus = ref('Fetched 4 min ago')
  const aiProvider = ref('Ollama · llama3.1')

  const menu = ref<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const toasts = ref<Toast[]>([])

  function selectCommit(hash: string | null) {
    selectedCommit.value = hash
  }

  function openDiff(path: string, source: DiffSource) {
    diffPath.value = path
    diffSource.value = source
    centerView.value = 'diff'
  }

  function closeDiff() {
    centerView.value = 'graph'
    diffPath.value = null
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
    toast({ kind: 'info', title: action, detail: 'Mock UI: wired up in a later phase.' })
  }

  return {
    sidebarCollapsed, selectedCommit, centerView, diffPath, diffSource, diffMode, fileViewMode, zoom,
    fetchStatus, aiProvider, menu, toasts,
    selectCommit, openDiff, closeDiff, openMenu, openMenuBelow, closeMenu, toast, dismissToast, notWired,
  }
})
