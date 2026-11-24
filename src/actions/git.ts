/**
 * User-facing git actions: each bundles confirmation (for anything that can lose
 * work), the git action itself, and how to undo it.
 */
import { useOpsStore, type UndoPlan } from '@/stores/ops'
import { useReposStore } from '@/stores/repos'
import { useUiStore } from '@/stores/ui'
import { gitApi, errorMessage } from '@/api/git'
import type { DiffTarget, FileChange, GitAction, HeadState, HunkSelection, OpOutcome, PullMode, ResetMode } from '@/types/git'

const ops = () => useOpsStore()
const ui = () => useUiStore()
const snapshot = () => useReposStore().active?.snapshot ?? null

const pathsOf = (files: FileChange[]) => [...new Set(files.flatMap((f) => (f.oldPath ? [f.path, f.oldPath] : [f.path])))]

function backTo(head: HeadState): GitAction | null {
  if (head.branch) return { type: 'checkout', branch: head.branch }
  if (head.oid) return { type: 'checkoutDetached', target: head.oid }
  return null
}

/** Undo for anything that moves HEAD via commits (merge, pull, cherry-pick…). */
function moveHeadUndo(o: OpOutcome): UndoPlan | null {
  if (!o.before.oid || !o.after.oid || o.before.oid === o.after.oid) return null
  return {
    undo: [{ type: 'reset', target: o.before.oid, mode: 'keep' }],
    redo: [{ type: 'reset', target: o.after.oid, mode: 'keep' }],
  }
}

const branchName = (v: string) => (/\s/.test(v) ? 'Branch names cannot contain spaces' : /^[-/.]|[/.]$|\.\.|[~^:?*[\\]/.test(v) ? 'Not a valid name' : null)

// ---------- working copy ----------

export function stage(files: FileChange[]) {
  const paths = pathsOf(files)
  return ops().run(files.length === 1 ? `Stage ${files[0].path}` : `Stage ${files.length} files`, { type: 'stage', paths }, {
    refresh: 'status', success: false,
    undo: () => ({ undo: [{ type: 'unstage', paths }], redo: [{ type: 'stage', paths }] }),
  })
}

export function unstage(files: FileChange[]) {
  const paths = pathsOf(files)
  return ops().run(files.length === 1 ? `Unstage ${files[0].path}` : `Unstage ${files.length} files`, { type: 'unstage', paths }, {
    refresh: 'status', success: false,
    undo: () => ({ undo: [{ type: 'stage', paths }], redo: [{ type: 'unstage', paths }] }),
  })
}

export function stageAll() {
  const paths = pathsOf(snapshot()?.workingCopy.unstaged ?? [])
  return ops().run('Stage all', { type: 'stageAll' }, {
    refresh: 'status', success: false,
    undo: () => ({ undo: [{ type: 'unstage', paths }], redo: [{ type: 'stageAll' }] }),
  })
}

export function unstageAll() {
  const paths = pathsOf(snapshot()?.workingCopy.staged ?? [])
  return ops().run('Unstage all', { type: 'unstageAll' }, {
    refresh: 'status', success: false,
    undo: () => ({ undo: [{ type: 'stage', paths }], redo: [{ type: 'unstageAll' }] }),
  })
}

export async function discard(files: FileChange[]) {
  if (!files.length) return
  const untracked = files.filter((f) => f.status === '?').map((f) => f.path)
  const tracked = files.filter((f) => f.status !== '?').map((f) => f.path)
  const ok = await ui().confirm({
    title: files.length === 1 ? `Discard changes to ${files[0].path}?` : `Discard changes in ${files.length} files?`,
    message: untracked.length ? `New files are deleted for good.` : 'You can undo this.',
    confirmLabel: 'Discard',
    danger: true,
  })
  if (!ok) return
  const action: GitAction = { type: 'discard', paths: tracked, untracked }
  return ops().run(files.length === 1 ? `Discard ${files[0].path}` : `Discard ${files.length} files`, action, {
    refresh: 'status',
    undo: (o) => (o.data ? { undo: [{ type: 'stashApplyOid', oid: o.data }], redo: [action] } : null),
  })
}

export async function discardAll() {
  const files = snapshot()?.workingCopy.unstaged ?? []
  if (!files.length) return
  const untracked = files.filter((f) => f.status === '?').length
  const ok = await ui().confirm({
    title: `Discard all ${files.length} unstaged changes?`,
    message: untracked ? 'New files are deleted for good.' : 'You can undo this.',
    confirmLabel: 'Discard all',
    danger: true,
  })
  if (!ok) return
  return ops().run('Discard all changes', { type: 'discardAll' }, {
    refresh: 'status',
    undo: (o) => (o.data ? { undo: [{ type: 'stashApplyOid', oid: o.data }], redo: [{ type: 'discardAll' }] } : null),
  })
}

export async function discardStaged() {
  const files = snapshot()?.workingCopy.staged ?? []
  if (!files.length) return
  const ok = await ui().confirm({
    title: `Discard all ${files.length} staged ${files.length === 1 ? 'change' : 'changes'}?`,
    message: 'You can undo this.',
    confirmLabel: 'Discard all',
    danger: true,
  })
  if (!ok) return
  const paths = [...new Set(files.flatMap((f) => (f.oldPath ? [f.path, f.oldPath] : [f.path])))]
  const action: GitAction = { type: 'discardStaged', paths }
  return ops().run('Discard staged changes', action, {
    refresh: 'status',
    undo: (o) => {
      if (!o.data) return null
      const b = JSON.parse(o.data) as { index: string; worktree: string }
      const undo: GitAction[] = []
      if (b.worktree) undo.push({ type: 'applyPatch', patch: b.worktree, cached: false, reverse: false })
      if (b.index) undo.push({ type: 'applyPatch', patch: b.index, cached: true, reverse: false })
      return undo.length ? { undo, redo: [action] } : null
    },
  })
}

/** Stage / unstage / discard selected hunks or lines of one file. */
export async function applySelection(target: DiffTarget, hunks: HunkSelection[], mode: 'stage' | 'unstage' | 'discard') {
  if (mode === 'discard') {
    const lines = hunks.reduce((n, h) => n + (h.lines?.length ?? 0), 0)
    const ok = await ui().confirm({
      title: lines ? `Discard ${lines} selected lines?` : `Discard ${hunks.length === 1 ? 'this hunk' : `${hunks.length} hunks`}?`,
      message: `From ${target.path}. You can restore them with Undo.`,
      confirmLabel: 'Discard',
      danger: true,
    })
    if (!ok) return null
  }
  const action: GitAction = {
    type: 'applySelection', path: target.path, source: mode === 'unstage' ? 'staged' : 'unstaged', hunks, discard: mode === 'discard',
  }
  const verb = { stage: 'Stage', unstage: 'Unstage', discard: 'Discard' }[mode]
  return ops().run(`${verb} lines in ${target.path}`, action, {
    refresh: 'status', success: false,
    undo: (o) => {
      if (!o.data) return null
      const patch = o.data
      const cached = mode !== 'discard'
      const appliedReverse = mode !== 'stage'
      return {
        undo: [{ type: 'applyPatch', patch, cached, reverse: !appliedReverse }],
        redo: [{ type: 'applyPatch', patch, cached, reverse: appliedReverse }],
      }
    },
  })
}

export function commit(message: string, amend: boolean) {
  return ops().run(amend ? 'Amend commit' : 'Commit', { type: 'commit', message, amend }, {
    success: amend ? 'Commit amended' : 'Committed',
    undo: (o) => ({
      undo: [o.before.oid ? { type: 'reset', target: o.before.oid, mode: 'soft' } : { type: 'deleteHeadRef' }],
      redo: o.after.oid ? [{ type: 'reset', target: o.after.oid, mode: 'soft' }] : [],
    }),
  })
}

/** Changes the latest commit's message in place; staged changes are not added to it. */
export async function rewordHead(message: string) {
  const head = snapshot()?.head
  if (head?.upstream && head.ahead === 0) {
    const ok = await ui().confirm({
      title: 'This commit is already pushed',
      message: 'Changing it means you have to force push.',
      confirmLabel: 'Change anyway',
    })
    if (!ok) return
  }
  return ops().run('Edit commit message', { type: 'rewordHead', message }, {
    success: 'Commit message updated',
    undo: (o) => ({
      undo: o.before.oid ? [{ type: 'reset', target: o.before.oid, mode: 'soft' }] : [],
      redo: o.after.oid ? [{ type: 'reset', target: o.after.oid, mode: 'soft' }] : [],
    }),
  })
}

// ---------- branches & checkout ----------

function checkoutUndo(redo: GitAction) {
  return (o: OpOutcome): UndoPlan | null => {
    const back = backTo(o.before)
    return back ? { undo: [back], redo: [redo] } : null
  }
}

/** Uncommitted changes are stashed and restored automatically, but a file that is still conflicted can't be stashed. */
function blockedByConflicts(what: string) {
  const conflicted = snapshot()?.workingCopy.unstaged.filter((f) => f.status === 'U') ?? []
  if (!conflicted.length) return false
  ui().toast({
    kind: 'info',
    title: `Can't ${what} yet`,
    detail: conflicted.length === 1 ? `${conflicted[0].path.split('/').pop()} still has a conflict. Resolve it first.` : `${conflicted.length} files still have conflicts. Resolve them first.`,
    action: { label: 'Resolve', run: () => (ui().conflictPath = conflicted[0].path) },
  }, 7000)
  return true
}

/** git refuses most commands mid-merge/rebase; say so plainly and offer the way out. */
function blockedByOperation(what: string) {
  const op = snapshot()?.operation
  if (!op) return blockedByConflicts(what)
  const name = ({ merge: 'merge', rebase: 'rebase', cherryPick: 'cherry-pick', revert: 'revert' })[op]
  ui().toast({
    kind: 'error',
    title: `Can't ${what} during a ${name}`,
    detail: `Commit or abort the ${name} first.`,
    action: { label: `Abort ${name}`, run: () => void abortOperation() },
  }, 8000)
  return true
}

export function checkout(branch: string) {
  if (blockedByOperation('switch branch')) return
  const action: GitAction = { type: 'checkout', branch }
  return ops().run(`Checkout ${branch}`, action, { success: `Switched to ${branch}`, undo: checkoutUndo(action) })
}

export async function checkoutRemote(remoteBranch: string, remote: string) {
  if (blockedByOperation('switch branch')) return
  const name = remoteBranch.slice(remote.length + 1)
  const local = useReposStore().active?.snapshot.branches.find((b) => b.name === name)
  if (local?.current && !local.behind) return
  const diverged = !!local && local.upstream === remoteBranch && local.ahead > 0 && local.behind > 0
  if (diverged) {
    const ok = await ui().confirm({
      title: `Switch to ${remoteBranch}?`,
      message: `Your local ${name} has ${local!.ahead} ${local!.ahead === 1 ? 'commit' : 'commits'} not on ${remoteBranch}. You can undo this.`,
      confirmLabel: `Use ${remoteBranch}`,
      danger: true,
    })
    if (!ok) return
  }
  const action: GitAction = { type: 'checkoutRemote', remoteBranch, name, reset: diverged }
  const oldTip = local?.tipHash
  return ops().run(`Checkout ${remoteBranch}`, action, {
    success: `Switched to ${name}`,
    undo: diverged && oldTip
      ? (o) => {
          const back = backTo(o.before)
          return { undo: [{ type: 'reset', target: oldTip, mode: 'keep' }, ...(back ? [back] : [])], redo: [action] }
        }
      : checkoutUndo(action),
  })
}

export function checkoutCommit(hash: string) {
  if (blockedByOperation('check out a commit')) return
  const action: GitAction = { type: 'checkoutDetached', target: hash }
  return ops().run(`Checkout ${hash.slice(0, 7)}`, action, { success: `Detached HEAD at ${hash.slice(0, 7)}`, undo: checkoutUndo(action) })
}

export async function createBranch(start?: { ref: string; label: string }) {
  const r = await ui().prompt({
    title: start ? `Create branch at ${start.label}` : 'Create branch',
    fields: [{ key: 'name', label: 'Branch name', placeholder: 'feature/my-change', mono: true, validate: branchName }],
    checkboxes: [{ key: 'checkout', label: 'Check out the new branch', initial: true }],
    confirmLabel: 'Create branch',
  })
  if (!r) return
  const name = r.values.name.trim()
  const checkoutAfter = r.checks.checkout
  const action: GitAction = { type: 'createBranch', name, start: start?.ref ?? null, checkout: checkoutAfter }
  return ops().run(`Create branch ${name}`, action, {
    success: checkoutAfter ? `Created and switched to ${name}` : `Created ${name}`,
    undo: (o) => {
      const back = checkoutAfter ? backTo(o.before) : null
      const undo: GitAction[] = [...(back ? [back] : []), { type: 'deleteBranch', name, force: true }]
      return { undo, redo: [action] }
    },
  })
}

export async function deleteBranch(name: string) {
  const ok = await ui().confirm({
    title: `Delete branch ${name}?`,
    message: 'Deletes the local branch only. You can restore it with Undo.',
    confirmLabel: 'Delete',
    danger: true,
  })
  if (!ok) return
  const undo = (o: OpOutcome): UndoPlan | null =>
    o.data ? { undo: [{ type: 'restoreRef', refname: `refs/heads/${name}`, oid: o.data }], redo: [{ type: 'deleteBranch', name, force: true }] } : null
  return ops().run(`Delete branch ${name}`, { type: 'deleteBranch', name, force: false }, {
    undo,
    onError: async (msg) => {
      if (!/not fully merged/i.test(msg)) return false
      const force = await ui().confirm({
        title: `${name} is not fully merged`,
        message: 'Its commits are not on any other branch. Deleting it anyway can be undone with Undo while KromaGit is open.',
        confirmLabel: 'Delete anyway',
        danger: true,
      })
      if (force) await ops().run(`Delete branch ${name}`, { type: 'deleteBranch', name, force: true }, { undo })
      return true
    },
  })
}

export async function deleteRemoteBranch(remote: string, branch: string) {
  const ok = await ui().confirm({
    title: `Delete ${remote}/${branch} on the remote?`,
    message: `This removes the branch from “${remote}” for everyone. It cannot be undone from here.`,
    confirmLabel: 'Delete on remote',
    danger: true,
  })
  if (!ok) return
  return ops().run(`Delete ${remote}/${branch}`, { type: 'deleteRemoteBranch', remote, branch })
}

export async function renameBranch(old: string) {
  const r = await ui().prompt({
    title: `Rename ${old}`,
    fields: [{ key: 'name', label: 'New name', initial: old, mono: true, validate: (v) => branchName(v) ?? (v.trim() === old ? 'Choose a different name' : null) }],
    confirmLabel: 'Rename',
  })
  if (!r) return
  const name = r.values.name.trim()
  return ops().run(`Rename ${old} → ${name}`, { type: 'renameBranch', old, new: name }, {
    undo: () => ({ undo: [{ type: 'renameBranch', old: name, new: old }], redo: [{ type: 'renameBranch', old, new: name }] }),
  })
}

export async function createTag(target?: { ref: string; label: string }) {
  const r = await ui().prompt({
    title: target ? `Create tag at ${target.label}` : 'Create tag at HEAD',
    fields: [
      { key: 'name', label: 'Tag name', placeholder: 'v1.0.0', mono: true, validate: branchName },
      { key: 'message', label: 'Message (creates an annotated tag)', optional: true, multiline: true },
    ],
    confirmLabel: 'Create tag',
  })
  if (!r) return
  const name = r.values.name.trim()
  const action: GitAction = { type: 'createTag', name, target: target?.ref ?? null, message: r.values.message.trim() || null }
  return ops().run(`Create tag ${name}`, action, {
    undo: () => ({ undo: [{ type: 'deleteTag', name }], redo: [action] }),
  })
}

export async function deleteTag(name: string) {
  const ok = await ui().confirm({
    title: `Delete tag ${name}?`,
    message: 'Deletes the local tag only. You can restore it with Undo.',
    confirmLabel: 'Delete',
    danger: true,
  })
  if (!ok) return
  return ops().run(`Delete tag ${name}`, { type: 'deleteTag', name }, {
    undo: (o) => (o.data ? { undo: [{ type: 'restoreRef', refname: `refs/tags/${name}`, oid: o.data }], redo: [{ type: 'deleteTag', name }] } : null),
  })
}

// ---------- submodules ----------

export function updateSubmodule(path: string) {
  return ops().run(`Update ${path}`, { type: 'submoduleUpdate', path }, { success: `Checked out the recorded commit in ${path}` })
}

// ---------- remotes ----------

export function fetchAll() {
  return ops().run('Fetch', { type: 'fetch', remote: null }, { success: 'Fetched all remotes' })
}

export function pull(mode: PullMode = 'merge') {
  if (blockedByOperation('pull')) return
  const label = { merge: 'Pull', rebase: 'Pull (rebase)', ffOnly: 'Pull (fast-forward only)' }[mode]
  const snap = snapshot()
  const branch = snap?.head.branch
  const local = snap?.branches.find((x) => x.name === branch)
  if (branch && local?.upstreamGone) {
    ui().toast({
      kind: 'info',
      title: 'Nothing to pull',
      detail: `${snap?.head.upstream ?? branch} was deleted on the remote, usually because it was merged. Switch to the branch it was merged into, or push to publish it again.`,
      action: { label: 'Push again', run: () => void push({ setUpstream: true }) },
    }, 9000)
    return
  }
  let track: string | undefined
  if (branch && !snap?.head.upstream) {
    const remote = snap?.remotes.find((r) => r.name === 'origin' && r.branches.includes(branch)) ?? snap?.remotes.find((r) => r.branches.includes(branch))
    if (!remote) {
      ui().toast({
        kind: 'info',
        title: 'Nothing to pull yet',
        detail: `${branch} isn't on the remote. Push it first.`,
        action: { label: 'Push', run: () => void push() },
      }, 6000)
      return
    }
    track = `${remote.name}/${branch}`
  }
  return ops().run(label, { type: 'pull', mode, ...(track ? { track } : {}) }, { undo: moveHeadUndo })
}

export async function push(opts: { force?: boolean; setUpstream?: boolean } = {}) {
  const snap = snapshot()
  const branch = snap?.head.branch ?? null
  if (!branch) {
    ui().toast({ kind: 'error', title: 'Cannot push', detail: 'HEAD is detached. Check out a branch first.' })
    return
  }
  const remote = snap?.remotes.find((r) => r.name === 'origin')?.name ?? snap?.remotes[0]?.name ?? null
  if (!remote) {
    ui().toast({ kind: 'error', title: 'Cannot push', detail: 'This repository has no remotes.' })
    return
  }
  if (opts.force) {
    const ok = await ui().confirm({
      title: `Force push ${branch}?`,
      message: `Overwrites ${snap?.head.upstream ?? `${remote}/${branch}`} with your local branch. Uses --force-with-lease, so it refuses if someone else pushed in the meantime. Commits only on the remote may be lost.`,
      confirmLabel: 'Force push',
      danger: true,
    })
    if (!ok) return
  }
  const setUpstream = opts.setUpstream || !snap?.head.upstream
  const action: GitAction = setUpstream
    ? { type: 'push', remote, branch, setUpstream: true, force: !!opts.force }
    : { type: 'push', remote: null, branch: null, setUpstream: false, force: !!opts.force }
  return ops().run(opts.force ? `Force push ${branch}` : `Push ${branch}`, action, {
    success: setUpstream ? `Pushed ${branch} to ${remote} and set upstream` : `Pushed ${branch}`,
    onError: async (msg) => {
      if (!/\[rejected\]|non-fast-forward|fetch first/i.test(msg)) return false
      ui().toast({ kind: 'error', title: 'Push rejected', detail: 'The remote has commits you do not have. Pull first, or force push if you meant to rewrite history.' }, 9000)
      return true
    },
  })
}

// ---------- history ----------

/** Always records a merge commit, so the merge shows up as its own line in the graph. */
export async function merge(target: string) {
  if (blockedByOperation('merge')) return
  const current = snapshot()?.currentBranch ?? 'HEAD'
  return ops().run(`Merge ${target} into ${current}`, { type: 'merge', target, mode: 'noFf' }, { undo: moveHeadUndo, onError: conflictHandler })
}

/** Moves the current branch forward to `target` without a merge commit; refuses if the branches have split. */
export function fastForward(target: string) {
  if (blockedByOperation('fast-forward')) return
  const current = snapshot()?.currentBranch ?? 'HEAD'
  return ops().run(`Fast-forward ${current} to ${target}`, { type: 'merge', target, mode: 'ffOnly' }, {
    success: `${current} is now at ${target}`,
    undo: moveHeadUndo,
  })
}

export async function rebase(onto: string) {
  if (blockedByOperation('rebase')) return
  const current = snapshot()?.currentBranch ?? 'HEAD'
  const ok = await ui().confirm({
    title: `Rebase ${current} onto ${onto}?`,
    message: 'Rewrites the commits of your branch on top of the other one. You can undo it while KromaGit is open.',
    confirmLabel: 'Rebase',
  })
  if (!ok) return
  return ops().run(`Rebase onto ${onto}`, { type: 'rebase', onto }, { undo: moveHeadUndo, onError: conflictHandler })
}

export function cherryPick(hash: string) {
  if (blockedByOperation('cherry-pick')) return
  return ops().run(`Cherry-pick ${hash.slice(0, 7)}`, { type: 'cherryPick', hash }, { undo: moveHeadUndo, onError: conflictHandler })
}

export function revert(hash: string) {
  if (blockedByOperation('revert')) return
  return ops().run(`Revert ${hash.slice(0, 7)}`, { type: 'revert', hash }, { undo: moveHeadUndo, onError: conflictHandler })
}

export async function reset(hash: string, mode: Exclude<ResetMode, 'keep'>) {
  const branch = snapshot()?.currentBranch ?? 'HEAD'
  const messages = {
    soft: 'Moves the branch; all changes since then stay staged.',
    mixed: 'Moves the branch; all changes since then stay in your working copy, unstaged.',
    hard: 'Moves the branch and DISCARDS all uncommitted changes and every commit after this one. A backup of uncommitted tracked changes is kept so Undo can bring them back while KromaGit is open.',
  }
  const ok = await ui().confirm({
    title: `Reset ${branch} to ${hash.slice(0, 7)} (${mode})?`,
    message: messages[mode],
    confirmLabel: `Reset ${mode}`,
    danger: mode === 'hard',
  })
  if (!ok) return
  return ops().run(`Reset ${mode} to ${hash.slice(0, 7)}`, { type: 'reset', target: hash, mode }, {
    undo: (o) => {
      if (!o.before.oid) return null
      const undo: GitAction[] = [{ type: 'reset', target: o.before.oid, mode: mode === 'hard' ? 'keep' : mode }]
      if (o.data) undo.push({ type: 'stashApplyOid', oid: o.data })
      return { undo, redo: [{ type: 'reset', target: hash, mode: mode === 'hard' ? 'keep' : mode }] }
    },
  })
}

/** Conflicts are not an error: the Conflicts section in the working copy shows them. */
async function conflictHandler(msg: string): Promise<boolean> {
  return /conflict/i.test(msg)
}

export async function abortOperation() {
  const op = snapshot()?.operation
  const ok = await ui().confirm({
    title: `Abort the ${op === 'cherryPick' ? 'cherry-pick' : op}?`,
    message: 'Returns to the state before it started. Conflict resolutions you made will be lost.',
    confirmLabel: 'Abort',
    danger: true,
  })
  if (!ok) return
  return ops().run('Abort', { type: 'abortOperation' })
}

export function continueOperation() {
  return ops().run('Continue', { type: 'continueOperation' }, { onError: conflictHandler })
}

// ---------- stash ----------

export async function stashPush() {
  const r = await ui().prompt({
    title: 'Stash changes',
    fields: [{ key: 'message', label: 'Message', optional: true, placeholder: 'WIP: …' }],
    checkboxes: [{ key: 'untracked', label: 'Include untracked files', initial: true }],
    confirmLabel: 'Stash',
  })
  if (!r) return
  return ops().run('Stash', { type: 'stashPush', message: r.values.message.trim() || null, includeUntracked: r.checks.untracked }, {
    undo: () => ({ undo: [{ type: 'stashPop', index: 0 }], redo: [{ type: 'stashPush', message: r.values.message.trim() || null, includeUntracked: r.checks.untracked }] }),
  })
}

export function stashPop(index = 0) {
  return ops().run(`Pop stash@{${index}}`, { type: 'stashPop', index }, { onError: conflictHandler })
}

export function stashApply(index: number) {
  return ops().run(`Apply stash@{${index}}`, { type: 'stashApply', index }, { onError: conflictHandler })
}

export async function stashDrop(index: number, message: string) {
  const ok = await ui().confirm({
    title: `Drop stash@{${index}}?`,
    message: `“${message}”\nYou can restore it with Undo while KromaGit is open.`,
    confirmLabel: 'Drop',
    danger: true,
  })
  if (!ok) return
  return ops().run(`Drop stash@{${index}}`, { type: 'stashDrop', index }, {
    undo: (o) => {
      if (!o.data) return null
      const [oid, ...rest] = o.data.split('\n')
      return { undo: [{ type: 'stashStore', oid, message: rest.join('\n') || 'restored stash' }], redo: [{ type: 'stashDrop', index: 0 }] }
    },
  })
}

// ---------- external apps ----------

export async function openInTerminal() {
  const path = useReposStore().activeTab?.path
  if (!path) return
  await gitApi.openInTerminal(path).catch((e) => ui().toast({ kind: 'error', title: 'Could not open terminal', detail: errorMessage(e) }))
}

/** Opens the repository, plus `file` or the working-copy file shown in the diff. */
export async function openInEditor(file?: string) {
  const path = useReposStore().activeTab?.path
  if (!path) return
  const u = ui()
  const shownFile = u.centerView === 'diff' && u.diffSource !== 'commit' ? u.diffPath ?? undefined : undefined
  await gitApi.openInEditor(path, file ?? shownFile).catch((e) => ui().toast({ kind: 'error', title: 'Could not open editor', detail: errorMessage(e) }))
}

export async function copyText(text: string, what = 'Copied') {
  await navigator.clipboard?.writeText(text).catch(() => {})
  ui().toast({ kind: 'success', title: what, detail: text }, 1800)
}

export function pushBranch(branch: { name: string; upstream?: string | null }) {
  const snap = snapshot()
  const remote = branch.upstream?.split('/')[0] ?? snap?.remotes.find((r) => r.name === 'origin')?.name ?? snap?.remotes[0]?.name
  if (!remote) {
    ui().toast({ kind: 'error', title: 'Cannot push', detail: 'This repository has no remotes.' })
    return
  }
  return ops().run(`Push ${branch.name}`, { type: 'push', remote, branch: branch.name, setUpstream: !branch.upstream, force: false })
}
