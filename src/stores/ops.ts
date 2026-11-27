import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'
import { errorMessage, gitApi } from '@/api/git'
import type { GitAction, OpOutcome } from '@/types/git'
import { useReposStore } from './repos'
import { useUiStore } from './ui'

export interface UndoEntry {
  label: string
  undo: GitAction[]
  redo: GitAction[]
  /** HEAD must still be here, otherwise the repo changed underneath us and undo is unsafe */
  guardOid: string | null
}

export interface UndoPlan {
  undo: GitAction[]
  redo: GitAction[]
}

export interface RunOptions {
  /** what to re-read afterwards */
  refresh?: 'status' | 'all'
  /** build an inverse from the outcome; return null when the action cannot be undone */
  undo?: (outcome: OpOutcome) => UndoPlan | null
  /** success toast text; false for none */
  success?: string | false
  /** handle an error yourself; return true when handled (no error toast) */
  onError?: (message: string) => boolean | Promise<boolean>
}

const MAX_UNDO = 50

export const useOpsStore = defineStore('ops', () => {
  const running = ref<string | null>(null)
  const stacks = reactive(new Map<string, { undo: UndoEntry[]; redo: UndoEntry[] }>())

  function stackFor(tabId: string) {
    let s = stacks.get(tabId)
    if (!s) {
      s = { undo: [], redo: [] }
      stacks.set(tabId, s)
    }
    return s
  }

  const activeStack = computed(() => {
    const id = useReposStore().activeTabId
    return id ? stacks.get(id) ?? null : null
  })
  const last = <T,>(arr: T[] | undefined): T | null => (arr && arr.length ? arr[arr.length - 1] : null)
  const nextUndo = computed(() => last(activeStack.value?.undo))
  const nextRedo = computed(() => last(activeStack.value?.redo))

  /**
   * Runs one git action for the active repo. Only ever called from a user click
   * (after any confirmation dialog), never in the background.
   */
  async function run(label: string, action: GitAction, opts: RunOptions = {}): Promise<OpOutcome | null> {
    const repos = useReposStore()
    const ui = useUiStore()
    const tab = repos.activeTab
    if (!tab) return null
    if (running.value) {
      ui.toast({ kind: 'info', title: 'Please wait', detail: `${running.value} is still running.` })
      return null
    }
    running.value = label
    let outcome: OpOutcome | null = null
    try {
      await repos.backgroundDone(tab.id)
      outcome = await gitApi.runAction(tab.path, action)
      const plan = opts.undo?.(outcome) ?? null
      const stack = stackFor(tab.id)
      if (plan) {
        stack.undo.push({ label, ...plan, guardOid: outcome.after.oid })
        if (stack.undo.length > MAX_UNDO) stack.undo.shift()
      }
      stack.redo = []
      const restoreIssue = /conflict with the new code|could not be put back/.test(outcome.output)
      const review = reviewLink(outcome.output)
      const reviewAction = review && { label: review.label, run: () => void gitApi.openUrl(review.url).catch(() => {}) }
      if (restoreIssue) {
        ui.toast({ kind: 'info', title: `${opts.success ?? label}, but your changes need attention`, detail: lastLine(outcome.output) }, 10000)
      } else if (opts.success !== false) {
        ui.toast({ kind: 'success', title: opts.success ?? label, detail: lastLine(outcome.output), ...(reviewAction ? { action: reviewAction } : {}) }, reviewAction ? 8000 : 2500)
      }
    } catch (e) {
      const msg = errorMessage(e)
      running.value = null
      const handled = opts.onError ? await opts.onError(msg) : false
      if (!handled) ui.toast({ kind: 'error', title: `${label} failed`, detail: msg }, 9000)
    } finally {
      running.value = null
      await repos.refresh(tab.id, opts.refresh ?? 'all')
    }
    return outcome
  }

  async function replay(direction: 'undo' | 'redo') {
    const repos = useReposStore()
    const ui = useUiStore()
    const tab = repos.activeTab
    if (!tab || running.value) return
    const stack = stackFor(tab.id)
    const list = direction === 'undo' ? stack.undo : stack.redo
    const entry = list.length ? list[list.length - 1] : null
    if (!entry) return

    running.value = `${direction === 'undo' ? 'Undo' : 'Redo'} ${entry.label}`
    try {
      const status = await gitApi.getStatus(tab.path)
      if ((status.head.oid ?? null) !== entry.guardOid) {
        stack.undo = []
        stack.redo = []
        ui.toast({
          kind: 'error',
          title: `Can't ${direction} “${entry.label}”`,
          detail: 'The repository changed since then (new commits or a checkout), so it is no longer safe. History cleared.',
        }, 8000)
        return
      }
      let last: OpOutcome | null = null
      for (const action of direction === 'undo' ? entry.undo : entry.redo) {
        last = await gitApi.runAction(tab.path, action)
      }
      const guardOid = last ? last.after.oid : entry.guardOid
      if (direction === 'undo') {
        stack.undo.pop()
        stack.redo.push({ ...entry, guardOid })
      } else {
        stack.redo.pop()
        stack.undo.push({ ...entry, guardOid })
      }
      ui.toast({ kind: 'success', title: `${direction === 'undo' ? 'Undid' : 'Redid'}: ${entry.label}` }, 2500)
    } catch (e) {
      ui.toast({ kind: 'error', title: `${direction === 'undo' ? 'Undo' : 'Redo'} failed`, detail: errorMessage(e) }, 9000)
    } finally {
      running.value = null
      await repos.refresh(tab.id, 'all')
    }
  }

  /**
   * Runs a multi-step flow (e.g. applying a split plan) as one operation:
   * one running state, one refresh, and one undo entry built by `fn`.
   * Stops at the first failing step; earlier steps stay applied (and undoable).
   */
  async function batch(
    label: string,
    fn: (exec: (action: GitAction) => Promise<OpOutcome>, startOid: string | null) => Promise<UndoPlan | null>,
    successText?: string,
  ): Promise<boolean> {
    const repos = useReposStore()
    const ui = useUiStore()
    const tab = repos.activeTab
    if (!tab) return false
    if (running.value) {
      ui.toast({ kind: 'info', title: 'Please wait', detail: `${running.value} is still running.` })
      return false
    }
    running.value = label
    const stack = stackFor(tab.id)
    let lastOid: string | null = null
    let plan: UndoPlan | null = null
    let ok = false
    const exec = async (action: GitAction) => {
      const o = await gitApi.runAction(tab.path, action)
      lastOid = o.after.oid
      return o
    }
    try {
      const start = (await gitApi.getStatus(tab.path)).head.oid ?? null
      lastOid = start
      try {
        plan = await fn(exec, start)
        ok = true
        ui.toast({ kind: 'success', title: successText ?? label }, 3000)
      } catch (e) {
        ui.toast({ kind: 'error', title: `${label} stopped`, detail: `${errorMessage(e)}${start !== lastOid ? ' Steps already done are kept; use Undo to roll them back.' : ''}` }, 10000)
        if (start && start !== lastOid) plan = { undo: [{ type: 'reset', target: start, mode: 'mixed' }], redo: [] }
      }
      if (plan) {
        stack.undo.push({ label, ...plan, guardOid: lastOid })
        stack.redo = []
      }
    } catch (e) {
      ui.toast({ kind: 'error', title: `${label} failed`, detail: errorMessage(e) }, 9000)
    } finally {
      running.value = null
      await repos.refresh(tab.id, 'all')
    }
    return ok
  }

  return { running, stacks, nextUndo, nextRedo, run, batch, undo: () => replay('undo'), redo: () => replay('redo') }
})

/** git's plumbing chatter (branch updates, server banners, tracking notes) is not worth showing in a message */
const CHATTER = /( -> )|^(From |To |remote:|Fetching submodule |warning: redirecting to |branch '.*' set up to track|Switched to (a new )?branch|Your branch is up to date|Already on |Dropped refs\/stash|Saved working directory|Successfully rebased|HEAD is now at |Date: )/
const FRIENDLY: Record<string, string> = {
  'Everything up-to-date': 'The remote already had these commits.',
  'Already up to date.': 'Already up to date.',
}
export function lastLine(output: string): string | undefined {
  const lines = output.split('\n').map((l) => l.trim()).filter((l) => l && (!CHATTER.test(l) || l.startsWith('!')))
  const last = lines[lines.length - 1]
  return last && (FRIENDLY[last] ?? last)
}

/** The "create a merge/pull request" link GitLab, GitHub and Bitbucket print after pushing a branch. */
export function reviewLink(output: string): { label: string; url: string } | null {
  const m = /^remote:\s+(https?:\/\/\S*(?:merge_requests\/new|\/pull\/new\/|pull-requests\/new)\S*)/m.exec(output)
  if (!m) return null
  return { label: m[1].includes('merge_requests') ? 'Create merge request' : 'Create pull request', url: m[1] }
}
