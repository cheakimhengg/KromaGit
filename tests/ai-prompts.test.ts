import { describe, expect, it } from 'vitest'
import {
  buildCommitPrompt, buildReviewPrompt, buildSplitCatalog, buildSplitPrompt, extractJson, featureOf, groupStandup,
  matchHunkHeader, numberPatch, parseCommit, parseHunks, parseReview, parseSplit, standupText,
} from '@/ai/prompts'
import type { AiFileDiff } from '@/types/ai'

const file = (path: string, patch: string, extra: Partial<AiFileDiff> = {}): AiFileDiff => ({
  path, oldPath: null, status: 'M', additions: 1, deletions: 1, patch, truncated: false, redactions: 0, omitted: null, ...extra,
})

const TWO_HUNKS = 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1,3 +1,3 @@\n ctx\n-old one\n+new one\n@@ -20,2 +20,3 @@ fn\n keep\n+added\n'

describe('extractJson', () => {
  it('accepts fenced and chatty replies', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(extractJson('Sure! {"a":{"b":2}} hope this helps')).toEqual({ a: { b: 2 } })
    expect(() => extractJson('no json here')).toThrow(/did not return JSON/)
    expect(() => extractJson('{"a": }')).toThrow(/malformed/)
  })
})

describe('commit message', () => {
  it('includes the convention, branch, recent style and diff', () => {
    const p = buildCommitPrompt({ template: '[{Feature}] {Type}: {summary}', branch: 'feature/cart', recent: ['[Cart] Fix: x\n\nbody'], files: [file('a.ts', TWO_HUNKS)] })
    expect(p.system).toMatch(/JSON only/)
    expect(p.user).toContain('[{Feature}] {Type}: {summary}')
    expect(p.user).toContain('Current branch: feature/cart')
    expect(p.user).toContain('- [Cart] Fix: x')
    expect(p.user).not.toContain('body')
    expect(p.user).toContain('+new one')
  })

  it('uses summaries instead of the diff for big changes, and never sends omitted content', () => {
    const p = buildCommitPrompt({
      template: '', branch: '', recent: [], files: [file('a.ts', TWO_HUNKS), file('.env', '', { omitted: 'sensitive file (not sent)' })],
      summaries: { 'a.ts': '- renamed things' },
    })
    expect(p.user).toContain('infer it from the recent commits')
    expect(p.user).toContain('- renamed things')
    expect(p.user).not.toContain('+new one')
    expect(p.user).toContain('.env (+1 −1) — sensitive file (not sent)')
  })

  it('cleans up the parsed summary', () => {
    expect(parseCommit('{"summary":"\\"feat: add x.\\"\\nmore","description":" body "}')).toEqual({ summary: 'feat: add x', description: 'body' })
    expect(() => parseCommit('{"summary":"","description":""}')).toThrow(/empty summary/)
  })
})

describe('review', () => {
  it('numbers new-side lines so comments can cite them', () => {
    const numbered = numberPatch(TWO_HUNKS)
    expect(numbered).toContain('    2 +new one')
    expect(numbered).toContain('      -old one')
    expect(numbered).toContain('   21 +added')
    expect(numbered).not.toContain('diff --git')
  })

  it('normalises comments: paths, severities, ordering, empty messages', () => {
    const text = JSON.stringify({
      summary: 's',
      comments: [
        { file: 'b/src/a.ts', line: 3.7, severity: 'suggestion', message: 'nit' },
        { file: 'a.ts', line: 1, severity: 'bug', message: 'boom' },
        { file: 'src/a.ts', line: 2, severity: 'weird', message: 'odd' },
        { file: 'src/a.ts', line: 2, severity: 'bug', message: '' },
      ],
    })
    const r = parseReview(text, ['src/a.ts'])
    expect(r.comments.map((c) => [c.file, c.line, c.severity])).toEqual([
      ['src/a.ts', 1, 'bug'],
      ['src/a.ts', 2, 'warning'],
      ['src/a.ts', 3, 'suggestion'],
    ])
    expect(buildReviewPrompt([file('a.ts', TWO_HUNKS)]).system).toMatch(/\[REDACTED\]/)
  })
})

describe('split', () => {
  const files = [file('a.ts', TWO_HUNKS), file('b.ts', '@@ -1 +1 @@\n-x\n+y\n'), file('new.md', '+hi', { status: 'A' })]
  const catalog = buildSplitCatalog(files)

  it('catalogs hunks only for modified files with several hunks worth splitting', () => {
    expect(catalog.hunks.map((h) => h.id)).toEqual(['a.ts#1', 'a.ts#2', 'b.ts#1'])
    const p = buildSplitPrompt(catalog, '{type}: {summary}', [])
    expect(p.user).toContain('[hunk a.ts#1]')
    expect(p.user).toContain('b.ts (+1 −1) [whole file only]')
    expect(p.user).toContain('new.md (+1 −1) [whole file only]')
  })

  it('drops unknowns and duplicates, and collects anything left over', () => {
    const groups = parseSplit(
      JSON.stringify({
        groups: [
          { summary: 'feat: one', description: '', files: ['b.ts', 'ghost.ts'], hunks: ['a.ts#1'] },
          { summary: 'feat: two', description: 'd', files: ['b.ts'], hunks: ['a.ts#1', 'nope#9'] },
        ],
      }),
      catalog,
    )
    expect(groups.map((g) => g.summary)).toEqual(['feat: one', 'chore: remaining changes'])
    expect(groups[0].items).toEqual([{ path: 'b.ts' }, { path: 'a.ts', hunkId: 'a.ts#1' }])
    expect(groups[1].items).toEqual([{ path: 'a.ts', hunkId: 'a.ts#2' }, { path: 'new.md' }])
  })

  it('lets a whole-file assignment win over stray hunks of the same file', () => {
    const groups = parseSplit(
      JSON.stringify({ groups: [{ summary: 'a', description: '', files: [], hunks: ['a.ts#1'] }, { summary: 'b', description: '', files: ['a.ts', 'b.ts', 'new.md'], hunks: [] }] }),
      catalog,
    )
    expect(groups).toHaveLength(1)
    expect(groups[0].items.map((i) => i.path)).toEqual(['a.ts', 'b.ts', 'new.md'])
  })

  it('finds a planned hunk again in a fresh diff even when line numbers moved', () => {
    const planned = parseHunks('a.ts', TWO_HUNKS)[1]
    const header = matchHunkHeader(planned, [
      { header: '@@ -1 +1 @@', lines: [{ kind: 'del', text: 'zzz' }] },
      { header: '@@ -19,2 +19,3 @@ fn', lines: [{ kind: 'context', text: 'keep' }, { kind: 'add', text: 'added' }] },
    ])
    expect(header).toBe('@@ -19,2 +19,3 @@ fn')
    expect(matchHunkHeader(planned, [])).toBeNull()
  })
})

describe('standup', () => {
  it('derives a feature from scope, bracket tag or branch', () => {
    expect(featureOf('feat(auth): login', 'main')).toBe('auth')
    expect(featureOf('[Checkout] Fix: total', 'main')).toBe('Checkout')
    expect(featureOf('wip', 'feature/search-bar')).toBe('search-bar')
    expect(featureOf('wip', 'origin/main')).toBe('general')
  })

  it('groups by repo and feature and writes a plain summary', () => {
    const groups = groupStandup(
      [
        { path: '/r/api', error: null, commits: [
          { hash: '1', subject: 'feat(auth): login form', date: 2, source: 'feature/login' },
          { hash: '2', subject: 'fix(auth): typo', date: 3, source: 'feature/login' },
          { hash: '3', subject: 'bump deps', date: 1, source: 'main' },
        ] },
        { path: '/r/empty', error: null, commits: [] },
      ],
      (p) => p.split('/').pop()!,
    )
    expect(groups).toHaveLength(1)
    expect(groups[0].features).toEqual([
      { name: 'general', subjects: ['bump deps'] },
      { name: 'auth', subjects: ['feat(auth): login form', 'fix(auth): typo'] },
    ])
    const text = standupText(groups, 'today')
    expect(text).toContain('What I did (today):')
    expect(text).toContain('- auth: login form; typo')
    expect(standupText([], 'today')).toBe('No commits found for today.')
  })
})
