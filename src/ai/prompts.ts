/**
 * Prompt builders and response parsers for the AI features. Pure functions —
 * no I/O — so every prompt and parser is unit tested.
 */
import type { AiFileDiff, StandupRepo } from '@/types/ai'

export const TEMPLATE_PRESETS = [
  { label: 'Conventional Commits', value: '{type}({scope}): {summary}' },
  { label: '[Feature] Type: summary', value: '[{Feature}] {Type}: {summary}' },
  { label: 'Infer from history', value: '' },
]

const str = { type: 'string' }

export const COMMIT_SCHEMA = {
  type: 'object',
  properties: { summary: str, description: str },
  required: ['summary', 'description'],
  additionalProperties: false,
}

export const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    summary: str,
    comments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: str,
          line: { type: 'integer' },
          severity: { type: 'string', enum: ['bug', 'debug', 'secret', 'warning', 'suggestion'] },
          message: str,
        },
        required: ['file', 'line', 'severity', 'message'],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'comments'],
  additionalProperties: false,
}

export const SPLIT_SCHEMA = {
  type: 'object',
  properties: {
    groups: {
      type: 'array',
      items: {
        type: 'object',
        properties: { summary: str, description: str, files: { type: 'array', items: str }, hunks: { type: 'array', items: str } },
        required: ['summary', 'description', 'files', 'hunks'],
        additionalProperties: false,
      },
    },
  },
  required: ['groups'],
  additionalProperties: false,
}

// ---------- helpers ----------

/** Pulls the first JSON object out of a model reply (tolerates ``` fences and chatter). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced ? fenced[1] : text
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start === -1 || end <= start) throw new Error('The model did not return JSON.')
  try {
    return JSON.parse(body.slice(start, end + 1))
  } catch {
    throw new Error('The model returned malformed JSON. Try again.')
  }
}

export function fileLine(f: AiFileDiff): string {
  const note = f.omitted ? ` — ${f.omitted}` : f.truncated ? ' — truncated' : ''
  const rename = f.oldPath ? ` (from ${f.oldPath})` : ''
  return `${f.status} ${f.path}${rename} (+${f.additions} −${f.deletions})${note}`
}

/** Prefixes new-side line numbers so the model can cite exact lines. */
export function numberPatch(patch: string): string {
  const out: string[] = []
  let next = 0
  for (const line of patch.split('\n')) {
    const m = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    if (m) {
      next = Number(m[1])
      out.push(line)
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      out.push(`${String(next++).padStart(5)} ${line}`)
    } else if (line.startsWith(' ')) {
      out.push(`${String(next++).padStart(5)} ${line}`)
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      out.push(`      ${line}`)
    } else if (!line.startsWith('diff --git') && !line.startsWith('index ') && !line.startsWith('---') && !line.startsWith('+++')) {
      out.push(line)
    }
  }
  return out.join('\n').trim()
}

export function diffBlock(files: AiFileDiff[], numbered = false): string {
  return files
    .filter((f) => !f.omitted && f.patch)
    .map((f) => `### ${f.path}\n${numbered ? numberPatch(f.patch) : f.patch.trim()}`)
    .join('\n\n')
}

const totals = (files: AiFileDiff[]) => files.reduce((a, f) => ({ add: a.add + f.additions, del: a.del + f.deletions }), { add: 0, del: 0 })

// ---------- commit message ----------

export interface CommitContext {
  template: string
  branch: string
  recent: string[]
  files: AiFileDiff[]
  /** per-file summaries replace the diff when it is too large */
  summaries?: Record<string, string>
}

export function buildCommitPrompt(ctx: CommitContext) {
  const system = [
    'You write git commit messages for the staged changes you are given.',
    'Respond with JSON only: {"summary": string, "description": string}.',
    'summary: one line, imperative mood ("add", not "added"), at most 72 characters, no trailing period.',
    'description: optional body explaining what changed and why, wrapped near 72 columns; "- " bullets are fine; use "" for trivial changes.',
    'Follow the repository convention exactly. Describe only changes present in the input; never invent details.',
  ].join('\n')
  const t = totals(ctx.files)
  const convention = ctx.template.trim()
    ? `Commit convention template: ${ctx.template.trim()}\nPlaceholders: {type}/{Type} = feat, fix, refactor, perf, docs, test, chore, build, ci or style (match the template's capitalisation); {scope}/{Feature} = the area or feature, taken from the branch name or the changed paths; {summary} = the summary text. The whole first line, template included, is the "summary" field.`
    : 'Commit convention: none configured — infer it from the recent commits below.'
  const body = ctx.summaries
    ? `The diff is too large to include; per-file summaries:\n${Object.entries(ctx.summaries).map(([p, s]) => `### ${p}\n${s.trim()}`).join('\n\n')}`
    : `Diff:\n${diffBlock(ctx.files)}`
  const user = [
    convention,
    `Current branch: ${ctx.branch || '(detached)'}`,
    ctx.recent.length ? `Recent commit messages, newest first (style reference):\n${ctx.recent.slice(0, 20).map((m) => `- ${m.split('\n')[0]}`).join('\n')}` : 'This repository has no commits yet.',
    `Staged files (${ctx.files.length}, +${t.add} −${t.del}):\n${ctx.files.map(fileLine).join('\n')}`,
    body,
  ].join('\n\n')
  return { system, user }
}

export function parseCommit(text: string): { summary: string; description: string } {
  const v = extractJson(text) as { summary?: unknown; description?: unknown }
  const summary = String(v.summary ?? '').split('\n')[0].trim().replace(/^["'`]+|["'`]+$/g, '').replace(/\.$/, '')
  if (!summary) throw new Error('The model returned an empty summary.')
  return { summary, description: String(v.description ?? '').trim() }
}

// ---------- big diffs ----------

export function buildFileSummaryPrompt(f: AiFileDiff) {
  return {
    system: 'Summarize this diff of one file in 1-3 short "- " bullet points: what changed and why it matters. Plain text, no preamble.',
    user: `${fileLine(f)}\n\n${f.patch.trim()}`,
  }
}

// ---------- review ----------

export type Severity = 'bug' | 'debug' | 'secret' | 'warning' | 'suggestion'
export interface ReviewComment {
  file: string
  line: number
  severity: Severity
  message: string
}

export function buildReviewPrompt(files: AiFileDiff[], commitSubject?: string) {
  const what = commitSubject ? 'commit' : 'staged diff'
  const system = [
    `You are a careful code reviewer. Review only the ${what} you are given.`,
    'Report real problems: likely bugs, leftover debug code (console.log, print, dbg!, debugger, commented-out code), committed secrets or credentials, and risky changes. Skip style nitpicks and praise.',
    'Lines are prefixed with their line number in the new file. Values shown as [REDACTED] were removed locally before sending — still flag that a secret was committed there.',
    'Respond with JSON only: {"summary": string, "comments": [{"file": string, "line": number, "severity": "bug"|"debug"|"secret"|"warning"|"suggestion", "message": string}]}.',
    'Use the new-file line number, or 0 when no single line applies. At most 25 comments. With nothing to report, return an empty list and a one-sentence summary.',
  ].join('\n')
  const head = commitSubject ? `Commit: ${commitSubject}\n\nFiles in this commit:` : 'Staged files:'
  const user = `${head}\n${files.map(fileLine).join('\n')}\n\nDiff:\n${diffBlock(files, true)}`
  return { system, user }
}

// ---------- explain a commit ----------

export const EXPLAIN_SCHEMA = {
  type: 'object',
  properties: {
    summary: str,
    points: { type: 'array', items: str },
    risks: { type: 'array', items: str },
  },
  required: ['summary', 'points', 'risks'],
  additionalProperties: false,
}

export interface CommitExplanation {
  summary: string
  points: string[]
  risks: string[]
}

export function buildExplainPrompt(ctx: { subject: string; body: string; files: AiFileDiff[]; summaries?: Record<string, string> }) {
  const system = [
    'You explain a single git commit to a teammate who has not seen it.',
    'Describe what the change does and why it was likely made, in plain language. Be concrete: name the behaviour, data or API that changed, not just the files.',
    'Respond with JSON only: {"summary": string, "points": string[], "risks": string[]}.',
    '"summary" is one or two sentences. "points" lists 2-6 key changes, each one short sentence. "risks" lists anything a reviewer or tester should double-check (behaviour changes, migrations, missing handling); return an empty list when there is nothing notable.',
    'Values shown as [REDACTED] were removed locally before sending.',
  ].join('\n')
  const diff = ctx.summaries
    ? `The diff is too large to include; per-file summaries:\n${Object.entries(ctx.summaries).map(([p, s]) => `### ${p}\n${s.trim()}`).join('\n\n')}`
    : `Diff:\n${diffBlock(ctx.files)}`
  const message = ctx.body ? `${ctx.subject}\n\n${ctx.body}` : ctx.subject
  const user = `Commit message:\n${message}\n\nFiles:\n${ctx.files.map(fileLine).join('\n')}\n\n${diff}`
  return { system, user }
}

export function parseExplanation(text: string): CommitExplanation {
  const v = extractJson(text) as { summary?: unknown; points?: unknown; risks?: unknown }
  const list = (x: unknown) => (Array.isArray(x) ? x.map((i) => String(i ?? '').trim()).filter(Boolean).slice(0, 8) : [])
  return { summary: String(v.summary ?? '').trim(), points: list(v.points), risks: list(v.risks) }
}

const SEVERITIES: Severity[] = ['bug', 'secret', 'debug', 'warning', 'suggestion']

export function parseReview(text: string, knownFiles: string[]): { summary: string; comments: ReviewComment[] } {
  const v = extractJson(text) as { summary?: unknown; comments?: unknown }
  const raw = Array.isArray(v.comments) ? v.comments : []
  const comments: ReviewComment[] = []
  for (const c of raw as Record<string, unknown>[]) {
    const message = String(c.message ?? '').trim()
    if (!message) continue
    let file = String(c.file ?? '').trim().replace(/^[ab]\//, '')
    if (!knownFiles.includes(file)) file = knownFiles.find((k) => k.endsWith(file) || file.endsWith(k)) ?? file
    const severity = SEVERITIES.includes(c.severity as Severity) ? (c.severity as Severity) : 'warning'
    comments.push({ file, line: Math.max(0, Math.floor(Number(c.line) || 0)), severity, message })
  }
  comments.sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity) || a.file.localeCompare(b.file) || a.line - b.line)
  return { summary: String(v.summary ?? '').trim(), comments: comments.slice(0, 25) }
}

// ---------- split ----------

export interface PlannedHunk {
  id: string
  path: string
  header: string
  /** the +/- lines, used to find the same hunk again when applying */
  changes: string[]
}

export interface SplitCatalog {
  files: AiFileDiff[]
  hunks: PlannedHunk[]
}

export function parseHunks(path: string, patch: string): PlannedHunk[] {
  const hunks: PlannedHunk[] = []
  let current: PlannedHunk | null = null
  for (const line of patch.split('\n')) {
    if (line.startsWith('@@')) {
      current = { id: `${path}#${hunks.length + 1}`, path, header: line, changes: [] }
      hunks.push(current)
    } else if (current && (line.startsWith('+') || line.startsWith('-')) && !line.startsWith('+++') && !line.startsWith('---')) {
      current.changes.push(line)
    }
  }
  return hunks
}

export function buildSplitCatalog(files: AiFileDiff[]): SplitCatalog {
  const hunks = files
    .filter((f) => f.status === 'M' && !f.omitted && !f.truncated)
    .flatMap((f) => parseHunks(f.path, f.patch))
  return { files, hunks }
}

export function buildSplitPrompt(catalog: SplitCatalog, template: string, recent: string[]) {
  const system = [
    'You split a set of uncommitted changes into a few logical, self-contained commits (a split plan).',
    'Respond with JSON only: {"groups": [{"summary": string, "description": string, "files": [path], "hunks": [hunkId]}]}.',
    'Every file must be covered exactly once: either list the whole file in "files", or list each of its hunk ids in "hunks". Split a file into hunks only when it clearly mixes unrelated changes; files marked [whole file only] cannot be split.',
    'Use 2-6 groups, ordered so each commit makes sense on top of the previous one (refactors and dependencies first).',
    `Commit messages follow ${template.trim() ? `the template "${template.trim()}"` : 'the style of the recent commits'}: "summary" is the whole first line (max 72 chars), "description" an optional body.`,
  ].join('\n')
  const hunksByFile = new Map<string, PlannedHunk[]>()
  for (const h of catalog.hunks) hunksByFile.set(h.path, [...(hunksByFile.get(h.path) ?? []), h])
  const sections = catalog.files.map((f) => {
    const hs = hunksByFile.get(f.path)
    if (f.omitted || !f.patch) return `### ${fileLine(f)} [whole file only]`
    if (!hs || hs.length < 2) return `### ${fileLine(f)} [whole file only]\n${f.patch.split('\n').filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---)/.test(l)).slice(0, 60).join('\n')}`
    return `### ${fileLine(f)}\n${hs.map((h) => `[hunk ${h.id}] ${h.header}\n${h.changes.slice(0, 40).join('\n')}`).join('\n')}`
  })
  const user = [
    recent.length ? `Recent commit messages:\n${recent.slice(0, 10).map((m) => `- ${m.split('\n')[0]}`).join('\n')}` : '',
    `Changes (${catalog.files.length} files):`,
    sections.join('\n\n'),
  ].filter(Boolean).join('\n\n')
  return { system, user }
}

export interface SplitItem {
  path: string
  /** set when only this hunk of the file belongs to the group */
  hunkId?: string
}

export interface SplitGroup {
  id: number
  summary: string
  description: string
  items: SplitItem[]
}

/**
 * Validates the model's plan: unknown paths/hunks are dropped, nothing is
 * assigned twice, and anything the model forgot lands in a final group so no
 * change is silently left out.
 */
export function parseSplit(text: string, catalog: SplitCatalog): SplitGroup[] {
  const v = extractJson(text) as { groups?: unknown }
  const raw = Array.isArray(v.groups) ? (v.groups as Record<string, unknown>[]) : []
  const filePaths = new Set(catalog.files.map((f) => f.path))
  const hunkById = new Map(catalog.hunks.map((h) => [h.id, h]))
  const takenFiles = new Set<string>()
  const takenHunks = new Set<string>()
  const groups: SplitGroup[] = []

  for (const g of raw) {
    const items: SplitItem[] = []
    for (const p of Array.isArray(g.files) ? (g.files as unknown[]).map(String) : []) {
      if (filePaths.has(p) && !takenFiles.has(p)) {
        takenFiles.add(p)
        items.push({ path: p })
      }
    }
    for (const id of Array.isArray(g.hunks) ? (g.hunks as unknown[]).map(String) : []) {
      const h = hunkById.get(id)
      if (h && !takenFiles.has(h.path) && !takenHunks.has(id)) {
        takenHunks.add(id)
        items.push({ path: h.path, hunkId: id })
      }
    }
    if (items.length) {
      groups.push({ id: groups.length + 1, summary: String(g.summary ?? '').split('\n')[0].trim() || `Commit ${groups.length + 1}`, description: String(g.description ?? '').trim(), items })
    }
  }

  // a file assigned whole in one group wins over stray hunks of it elsewhere
  for (const g of groups) g.items = g.items.filter((it) => !it.hunkId || !takenFiles.has(it.path))
  const kept = groups.filter((g) => g.items.length)
  groups.length = 0
  kept.forEach((g, i) => groups.push({ ...g, id: i + 1 }))
  const leftovers: SplitItem[] = []
  for (const f of catalog.files) {
    const fileHunks = catalog.hunks.filter((h) => h.path === f.path)
    const anyHunkTaken = fileHunks.some((h) => takenHunks.has(h.id))
    if (takenFiles.has(f.path)) continue
    if (anyHunkTaken) {
      for (const h of fileHunks) if (!takenHunks.has(h.id)) leftovers.push({ path: f.path, hunkId: h.id })
    } else {
      leftovers.push({ path: f.path })
    }
  }
  if (leftovers.length) groups.push({ id: groups.length + 1, summary: 'chore: remaining changes', description: '', items: leftovers })
  return groups
}

/** Finds the hunk in a fresh diff whose +/- lines match a planned hunk. */
export function matchHunkHeader(planned: PlannedHunk, current: { header: string; lines: { kind: string; text: string }[] }[]): string | null {
  const key = planned.changes.join('\n')
  for (const h of current) {
    const changes = h.lines.filter((l) => l.kind !== 'context').map((l) => `${l.kind === 'add' ? '+' : '-'}${l.text}`)
    if (changes.join('\n') === key) return h.header
  }
  return null
}

// ---------- standup ----------

export interface StandupGroup {
  repo: string
  features: { name: string; subjects: string[] }[]
}

const MAIN_BRANCHES = /^(?:[^/]+\/)?(main|master|develop|dev|staging|HEAD)$/

export function featureOf(subject: string, source: string): string {
  const scope = subject.match(/^\w+\(([^)]+)\)!?:/)?.[1] ?? subject.match(/^\[([^\]]+)\]/)?.[1]
  if (scope) return scope
  const branch = source.replace(/^[^/]+\/(?=.+\/)/, '')
  if (branch && !MAIN_BRANCHES.test(source) && !MAIN_BRANCHES.test(branch)) return branch.replace(/^(feature|feat|fix|bugfix|chore|hotfix)\//, '')
  return 'general'
}

export function groupStandup(repos: StandupRepo[], nameOf: (path: string) => string): StandupGroup[] {
  return repos
    .filter((r) => r.commits.length)
    .map((r) => {
      const features = new Map<string, string[]>()
      for (const c of [...r.commits].sort((a, b) => a.date - b.date)) {
        const f = featureOf(c.subject, c.source)
        features.set(f, [...(features.get(f) ?? []), c.subject])
      }
      return { repo: nameOf(r.path), features: [...features].map(([name, subjects]) => ({ name, subjects })) }
    })
}

/** Plain summary used without AI (and as the AI's input). */
export function standupText(groups: StandupGroup[], rangeLabel: string): string {
  if (!groups.length) return `No commits found for ${rangeLabel}.`
  const lines = [`What I did (${rangeLabel}):`]
  for (const g of groups) {
    lines.push('', `${g.repo}`)
    for (const f of g.features) {
      const subjects = f.subjects.map((s) => s.replace(/^\w+(\([^)]*\))?!?:\s*/, '').replace(/^\[[^\]]+\]\s*(\w+:\s*)?/, ''))
      lines.push(`- ${f.name === 'general' ? '' : `${f.name}: `}${[...new Set(subjects)].join('; ')}`)
    }
  }
  return lines.join('\n')
}

export function buildStandupPrompt(groups: StandupGroup[], rangeLabel: string) {
  return {
    system: 'You write a short standup update from a developer\'s commit subjects. Group by repository; 1-3 plain-language bullets per repository saying what was done (merge related commits, no hashes, no jargon like "refactor(x)"). Start with a one-line heading "What I did (<range>)". Plain text, ready to paste into chat.',
    user: standupText(groups, rangeLabel),
  }
}
