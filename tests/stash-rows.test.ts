import { describe, expect, it } from 'vitest'
import { withStashRows } from '@/lib/stash-rows'
import type { Commit, Stash } from '@/types/git'

const commit = (hash: string, date: number, parents: string[] = []): Commit => ({
  hash, shortHash: hash.slice(0, 7), parents, author: { name: 'A', email: 'a@x' }, date, subject: hash, refs: [],
})
const stash = (index: number, parent: string, date: number): Stash => ({
  index, message: `WIP ${index}`, date, oid: `s${index}`, parent, authorName: 'B', authorEmail: 'b@x',
})

describe('withStashRows', () => {
  const commits = [commit('c3', 300, ['c2']), commit('c2', 200, ['c1']), commit('c1', 100)]

  it('places a stash by date, above the commit it was made on', () => {
    const rows = withStashRows(commits, [stash(0, 'c1', 250)])
    expect(rows.map((c) => c.hash)).toEqual(['c3', 's0', 'c2', 'c1'])
    expect(rows[1]).toMatchObject({ parents: ['c1'], stash: 0, refs: [{ kind: 'stash', name: 'stash@{0}' }] })
  })

  it('never puts a stash below its base commit, even when it is older', () => {
    expect(withStashRows(commits, [stash(0, 'c2', 50)]).map((c) => c.hash)).toEqual(['c3', 's0', 'c2', 'c1'])
  })

  it('skips stashes whose base commit is not loaded and leaves the list untouched without stashes', () => {
    expect(withStashRows(commits, [stash(0, 'gone', 999)])).toBe(commits)
    expect(withStashRows(commits, [])).toBe(commits)
  })
})
