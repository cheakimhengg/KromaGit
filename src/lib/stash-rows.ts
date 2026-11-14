import type { Commit, Stash } from '@/types/git'

/** Mixes stashes into the commit list as rows of their own: newest first, never below the commit they were made on. */
export function withStashRows(commits: Commit[], stashes: Stash[]): Commit[] {
  const known = new Set(commits.map((c) => c.hash))
  const rows = stashes.filter((s) => s.parent && known.has(s.parent)).sort((a, b) => b.date - a.date)
  if (!rows.length) return commits
  const out = commits.slice()
  for (const s of rows) {
    const parentAt = out.findIndex((c) => c.hash === s.parent)
    let at = out.findIndex((c, i) => i <= parentAt && c.date < s.date)
    if (at === -1 || at > parentAt) at = parentAt
    out.splice(at, 0, {
      hash: s.oid,
      shortHash: s.oid.slice(0, 7),
      parents: [s.parent!],
      author: { name: s.authorName, email: s.authorEmail },
      date: s.date,
      subject: s.message,
      refs: [{ name: `stash@{${s.index}}`, kind: 'stash' }],
      stash: s.index,
    })
  }
  return out
}
