import { defineStore } from 'pinia'
import { reactive, ref } from 'vue'
import { aiApi } from '@/api/ai'
import { errorMessage, gitApi } from '@/api/git'
import { AiCancelled, budgets, complete, diffChars, ensureConsent, ensureReady, previewOf, summarizeFiles } from '@/ai/engine'
import {
  buildCommitPrompt, buildExplainPrompt, buildReviewPrompt, EXPLAIN_SCHEMA, parseExplanation, buildSplitCatalog, buildSplitPrompt, buildStandupPrompt, COMMIT_SCHEMA, groupStandup,
  matchHunkHeader, parseCommit, parseReview, parseSplit, REVIEW_SCHEMA, SPLIT_SCHEMA, standupText,
  type CommitExplanation, type ReviewComment, type SplitCatalog, type SplitGroup, type StandupGroup,
} from '@/ai/prompts'
import type { AiFileDiff, CleanupCandidate } from '@/types/ai'
import type { GitAction } from '@/types/git'
import { useOpsStore, type UndoPlan } from './ops'
import { useReposStore } from './repos'
import { useSettingsStore } from './settings'
import { useUiStore } from './ui'

type Status = 'idle' | 'running' | 'done' | 'error'

export const useAiStore = defineStore('ai', () => {
  const progress = ref<string | null>(null)

  const review = reactive({
    status: 'idle' as Status, summary: '', comments: [] as ReviewComment[], files: [] as AiFileDiff[], error: '', model: '',
    /** null = staged changes */
    commit: null as { hash: string; parent?: string; subject: string } | null,
  })
  const explain = reactive({ hash: '', status: 'idle' as Status, result: null as CommitExplanation | null, error: '', model: '' })
  const split = reactive({ status: 'idle' as Status, groups: [] as SplitGroup[], catalog: null as SplitCatalog | null, error: '' })
  const standup = reactive({ status: 'idle' as Status, groups: [] as StandupGroup[], text: '', aiText: '', errors: [] as string[], rangeLabel: '' })
  const cleanup = reactive({ status: 'idle' as Status, candidates: [] as CleanupCandidate[], error: '' })

  const repo = () => useReposStore().activeTab
  const fail = (e: unknown, what: string) => {
    if (e instanceof AiCancelled) return
    useUiStore().toast({ kind: 'error', title: `${what} failed`, detail: e instanceof Error ? e.message : errorMessage(e) }, 9000)
  }

  async function collect(scope: 'staged' | 'all' | `commit:${string}`) {
    const tab = repo()
    if (!tab) throw new Error('No repository open.')
    return aiApi.collectDiff(tab.path, scope, budgets().perFile)
  }

  /** Full diff when it fits, otherwise per-file summaries (asks consent once for everything). */
  async function diffOrSummaries(files: AiFileDiff[], buildPreview: (files: AiFileDiff[]) => string) {
    if (diffChars(files) <= budgets().total) {
      await ensureConsent(buildPreview(files))
      return { summaries: undefined }
    }
    await ensureConsent(`The diff is large, so each file is first summarised separately (one request per file), then a final request is sent with the summaries.\n\n${files.filter((f) => f.patch).map((f) => `### ${f.path}\n${f.patch}`).join('\n\n')}`)
    progress.value = 'Summarising files…'
    const summaries = await summarizeFiles(files, (d, t) => (progress.value = `Summarising files ${d}/${t}…`))
    return { summaries }
  }

  // ---------- commit message ----------

  async function generateCommitMessage(): Promise<{ summary: string; description: string } | null> {
    if (!(await ensureReady('AI commit messages'))) return null
    const tab = repo()
    const snap = useReposStore().active?.snapshot
    if (!tab || !snap) return null
    progress.value = 'Reading staged changes…'
    try {
      const bundle = await collect('staged')
      if (!bundle.files.length) throw new Error('Nothing is staged. Stage the changes you want to commit first.')
      const recent = await aiApi.recentMessages(tab.path, 20)
      const ctx = { template: useSettingsStore().templateFor(tab.path), branch: snap.head.branch ?? '', recent, files: bundle.files }
      const { summaries } = await diffOrSummaries(bundle.files, (files) => previewOf(buildCommitPrompt({ ...ctx, files })))
      progress.value = 'Writing commit message…'
      const p = buildCommitPrompt({ ...ctx, summaries })
      return parseCommit(await complete({ ...p, schema: COMMIT_SCHEMA, maxTokens: 4000, effort: 'low' }))
    } catch (e) {
      fail(e, 'AI commit message')
      return null
    } finally {
      progress.value = null
    }
  }

  // ---------- review ----------

  /** Reviews the staged changes, or one commit when `commit` is given (or kept from the last run with `again`). */
  async function runReview(commit?: { hash: string; parent?: string; subject: string } | null, again = false) {
    if (!(await ensureReady('AI review'))) return
    const ui = useUiStore()
    const target = again ? review.commit : (commit ?? null)
    ui.showPanel('review')
    Object.assign(review, { status: 'running', summary: '', comments: [], error: '', commit: target })
    progress.value = target ? 'Reading the commit…' : 'Reading staged changes…'
    try {
      const bundle = await collect(target ? `commit:${target.hash}` : 'staged')
      if (!bundle.files.length) throw new Error(target ? 'This commit has no file changes to review.' : 'Nothing is staged. Stage the changes you want reviewed first.')
      review.files = bundle.files
      const reviewable = bundle.files.filter((f) => f.patch)
      if (diffChars(reviewable) > budgets().total) {
        throw new Error(
          target
            ? `This commit is too large to review in one request (${Math.round(diffChars(reviewable) / 1000)}k characters).`
            : `The staged diff is too large to review in one request (${Math.round(diffChars(reviewable) / 1000)}k characters). Stage fewer files and review in parts.`,
        )
      }
      const p = buildReviewPrompt(reviewable, target?.subject)
      await ensureConsent(previewOf(p))
      progress.value = 'Reviewing…'
      const parsed = parseReview(await complete({ ...p, schema: REVIEW_SCHEMA, maxTokens: 8000, effort: 'medium' }), bundle.files.map((f) => f.path))
      Object.assign(review, { status: 'done', ...parsed, model: useSettingsStore().statusLabel ?? '' })
    } catch (e) {
      if (e instanceof AiCancelled) {
        review.status = 'idle'
        ui.closeDiff()
        ui.showPanel('graph')
      } else {
        Object.assign(review, { status: 'error', error: e instanceof Error ? e.message : errorMessage(e) })
      }
    } finally {
      progress.value = null
    }
  }

  // ---------- split ----------

  async function suggestSplit() {
    if (!(await ensureReady('split suggestions'))) return
    const tab = repo()
    if (!tab) return
    const ui = useUiStore()
    ui.showPanel('split')
    Object.assign(split, { status: 'running', groups: [], error: '', catalog: null })
    progress.value = 'Reading changes…'
    try {
      const bundle = await collect('all')
      if (bundle.files.length < 2) throw new Error('Split suggestions need changes in at least two files.')
      const catalog = buildSplitCatalog(bundle.files)
      const recent = await aiApi.recentMessages(tab.path, 10)
      const p = buildSplitPrompt(catalog, useSettingsStore().templateFor(tab.path), recent)
      if (p.user.length > budgets().total) {
        throw new Error(`Too many changes to plan in one request (${Math.round(p.user.length / 1000)}k characters). Commit some files first.`)
      }
      await ensureConsent(previewOf(p))
      progress.value = 'Planning commits…'
      const groups = parseSplit(await complete({ ...p, schema: SPLIT_SCHEMA, maxTokens: 6000, effort: 'medium' }), catalog)
      Object.assign(split, { status: 'done', groups, catalog })
    } catch (e) {
      if (e instanceof AiCancelled) {
        split.status = 'idle'
        ui.showPanel('graph')
      } else {
        Object.assign(split, { status: 'error', error: e instanceof Error ? e.message : errorMessage(e) })
      }
    } finally {
      progress.value = null
    }
  }

  /** Stages and commits each group in order. Only runs after the user clicks Apply. */
  async function applySplit(groups: SplitGroup[]) {
    const tab = repo()
    const catalog = split.catalog
    if (!tab || !catalog || !groups.length) return
    const ui = useUiStore()
    const ok = await ui.confirm({
      title: `Create ${groups.length} ${groups.length === 1 ? 'commit' : 'commits'}?`,
      message: 'KromaGit will unstage everything, then for each group stage its files or hunks and commit it, in this order. One Undo rolls back all of them (your changes return to the working copy).',
      detail: groups.map((g, i) => `${i + 1}. ${g.summary}  (${g.items.length} ${g.items.length === 1 ? 'item' : 'items'})`),
      confirmLabel: 'Create commits',
    })
    if (!ok) return
    const hunks = new Map(catalog.hunks.map((h) => [h.id, h]))
    const fileInfo = new Map(catalog.files.map((f) => [f.path, f]))
    const done = await useOpsStore().batch(`Split into ${groups.length} commits`, async (exec, startOid) => {
      const staged = useReposStore().active?.snapshot.workingCopy.staged.length ?? 0
      if (staged) await exec({ type: 'unstageAll' })
      for (const [i, g] of groups.entries()) {
        progress.value = `Committing ${i + 1}/${groups.length}…`
        const whole = g.items.filter((it) => !it.hunkId)
        if (whole.length) {
          const paths = whole.flatMap((it) => [it.path, fileInfo.get(it.path)?.oldPath].filter((p): p is string => !!p))
          await exec({ type: 'stage', paths: [...new Set(paths)] })
        }
        const byFile = new Map<string, string[]>()
        for (const it of g.items.filter((x) => x.hunkId)) byFile.set(it.path, [...(byFile.get(it.path) ?? []), it.hunkId!])
        for (const [path, ids] of byFile) {
          const fresh = await gitApi.getFileDiff(tab.path, { path, source: 'unstaged' })
          const headers = ids.map((id) => {
            const header = matchHunkHeader(hunks.get(id)!, fresh.hunks)
            if (!header) throw new Error(`Could not find hunk ${id} any more — the file changed. Re-run the suggestion.`)
            return header
          })
          await exec({ type: 'applySelection', path, source: 'unstaged', hunks: headers.map((header) => ({ header, lines: null })), discard: false })
        }
        const message = g.description.trim() ? `${g.summary.trim()}\n\n${g.description.trim()}` : g.summary.trim()
        await exec({ type: 'commit', message, amend: false })
      }
      return startOid ? ({ undo: [{ type: 'reset', target: startOid, mode: 'mixed' }], redo: [] } as UndoPlan) : null
    }, `Created ${groups.length} commits`)
    progress.value = null
    if (done) {
      Object.assign(split, { status: 'idle', groups: [], catalog: null })
      ui.showPanel('graph')
    }
  }

  // ---------- standup ----------

  async function loadStandup(since: string, until: string, author: string, rangeLabel: string) {
    const repos = useReposStore()
    Object.assign(standup, { status: 'running', groups: [], text: '', aiText: '', errors: [], rangeLabel })
    try {
      const paths = repos.tabs.map((t) => t.path)
      const res = await aiApi.standupCommits(paths, since, until, author)
      const nameOf = (p: string) => repos.tabs.find((t) => t.path === p)?.name ?? p
      standup.groups = groupStandup(res, nameOf)
      standup.text = standupText(standup.groups, rangeLabel)
      standup.errors = res.filter((r) => r.error).map((r) => `${nameOf(r.path)}: ${r.error}`)
      standup.status = 'done'
    } catch (e) {
      standup.status = 'error'
      fail(e, 'Standup')
    }
  }

  async function writeStandupWithAi() {
    if (!standup.groups.length || !(await ensureReady('AI standup summaries'))) return
    progress.value = 'Writing standup…'
    try {
      const p = buildStandupPrompt(standup.groups, standup.rangeLabel)
      await ensureConsent(previewOf(p))
      standup.aiText = (await complete({ ...p, maxTokens: 2000, effort: 'low' })).trim()
    } catch (e) {
      fail(e, 'AI standup')
    } finally {
      progress.value = null
    }
  }

  // ---------- branch cleanup ----------

  async function loadCleanup() {
    const tab = repo()
    if (!tab) return
    const s = useSettingsStore().settings.cleanup
    Object.assign(cleanup, { status: 'running', candidates: [], error: '' })
    try {
      cleanup.candidates = await aiApi.cleanupCandidates(tab.path, s.baseBranches, s.staleDays)
      cleanup.status = 'done'
    } catch (e) {
      Object.assign(cleanup, { status: 'error', error: errorMessage(e) })
    }
  }

  async function deleteBranches(selected: CleanupCandidate[], local: boolean, remote: boolean) {
    const remoteOnes = remote ? selected.filter((c) => c.remoteBranch) : []
    if (!selected.length || (!local && !remoteOnes.length)) return
    const unmerged = selected.filter((c) => !c.mergedInto.length)
    const ui = useUiStore()
    const ok = await ui.confirm({
      title: `Delete ${selected.length} ${selected.length === 1 ? 'branch' : 'branches'}?`,
      message: [
        local ? `Local branches are deleted${unmerged.length ? `; ${unmerged.length} not merged anywhere will be force-deleted` : ''}. Undo restores them while KromaGit is open.` : '',
        remoteOnes.length ? `${remoteOnes.length} remote ${remoteOnes.length === 1 ? 'branch is' : 'branches are'} deleted for everyone — this cannot be undone from here.` : '',
      ].filter(Boolean).join('\n'),
      detail: selected.map((c) => `${c.name}${remote && c.remoteBranch ? `  + ${c.remoteBranch}` : ''}`),
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return
    await useOpsStore().batch(`Delete ${selected.length} branches`, async (exec) => {
      const restore: GitAction[] = []
      if (local) {
        for (const c of selected) {
          const o = await exec({ type: 'deleteBranch', name: c.name, force: !c.mergedInto.length })
          if (o.data) restore.push({ type: 'restoreRef', refname: `refs/heads/${c.name}`, oid: o.data })
        }
      }
      for (const c of remoteOnes) {
        const [r, ...rest] = c.remoteBranch!.split('/')
        await exec({ type: 'deleteRemoteBranch', remote: r, branch: rest.join('/') })
      }
      return restore.length ? { undo: restore, redo: selected.map((c) => ({ type: 'deleteBranch', name: c.name, force: true }) as GitAction) } : null
    }, `Deleted ${selected.length} ${selected.length === 1 ? 'branch' : 'branches'}`)
    await loadCleanup()
  }

  // ---------- explain a commit ----------

  async function explainCommit(c: { hash: string; subject: string; body: string }) {
    if (!(await ensureReady('Explain with AI'))) return
    Object.assign(explain, { hash: c.hash, status: 'running', result: null, error: '' })
    progress.value = 'Reading the commit…'
    try {
      const bundle = await collect(`commit:${c.hash}`)
      const ctx = { subject: c.subject, body: c.body, files: bundle.files }
      const { summaries } = await diffOrSummaries(bundle.files, (files) => previewOf(buildExplainPrompt({ ...ctx, files })))
      progress.value = 'Explaining…'
      const text = await complete({ ...buildExplainPrompt({ ...ctx, summaries }), schema: EXPLAIN_SCHEMA, maxTokens: 3000, effort: 'low' })
      if (explain.hash !== c.hash) return
      Object.assign(explain, { status: 'done', result: parseExplanation(text), model: useSettingsStore().statusLabel ?? '' })
    } catch (e) {
      if (explain.hash !== c.hash) return
      if (e instanceof AiCancelled) explain.status = 'idle'
      else Object.assign(explain, { status: 'error', error: e instanceof Error ? e.message : errorMessage(e) })
    } finally {
      progress.value = null
    }
  }

  return {
    progress, review, split, standup, cleanup, explain,
    generateCommitMessage, runReview, explainCommit, suggestSplit, applySplit, loadStandup, writeStandupWithAi, loadCleanup, deleteBranches,
  }
})
