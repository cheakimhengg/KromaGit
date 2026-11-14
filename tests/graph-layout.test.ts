import { describe, expect, it } from 'vitest'
import { computeGraphLayout } from '@/lib/graph-layout'
import { generateCommits } from '@/mock/data'

describe('computeGraphLayout', () => {
  it('keeps a linear history in a single lane', () => {
    const { rows, maxLanes } = computeGraphLayout([
      { hash: 'c', parents: ['b'] },
      { hash: 'b', parents: ['a'] },
      { hash: 'a', parents: [] },
    ])
    expect(maxLanes).toBe(1)
    expect(rows.map((r) => r.lane)).toEqual([0, 0, 0])
    expect(rows[0].upper).toEqual([])
    expect(rows[2].lower).toEqual([])
  })

  it('opens a second lane for a merge and closes it at the fork point', () => {
    //   m   (merge of b and f)
    //   |\
    //   b f
    //   |/
    //   a
    const { rows, maxLanes } = computeGraphLayout([
      { hash: 'm', parents: ['b', 'f'] },
      { hash: 'b', parents: ['a'] },
      { hash: 'f', parents: ['a'] },
      { hash: 'a', parents: [] },
    ])
    expect(maxLanes).toBe(2)
    expect(rows[0].isMerge).toBe(true)
    expect(rows[0].lower).toContainEqual(expect.objectContaining({ from: 0, to: 1 }))
    expect(rows[1].lane).toBe(0)
    expect(rows[1].lower).toContainEqual(expect.objectContaining({ from: 1, to: 1 }))
    expect(rows[2].lane).toBe(1)
    expect(rows[2].lower).toContainEqual(expect.objectContaining({ from: 1, to: 1 }))
    expect(rows[3].lane).toBe(0)
    expect(rows[3].upper).toContainEqual(expect.objectContaining({ from: 1, to: 0 }))
  })

  it('continues the pass-through line of an existing lane when merging into it', () => {
    const { rows } = computeGraphLayout([
      { hash: 'x', parents: ['p'] },
      { hash: 'y', parents: ['q', 'p'] },
      { hash: 'q', parents: ['p'] },
      { hash: 'p', parents: [] },
    ])
    const lowerY = rows[1].lower
    expect(lowerY).toContainEqual(expect.objectContaining({ from: 1, to: 0 }))
    expect(lowerY).toContainEqual(expect.objectContaining({ from: 0, to: 0 }))
  })

  it('keeps the main branch in its lane when a side branch started from the same commit', () => {
    // m2 merges f1 into main; s1 is a branch that also started from base. main must stay in lane 0.
    const { rows } = computeGraphLayout([
      { hash: 'm2', parents: ['m1', 'f1'] },
      { hash: 's1', parents: ['base'] },
      { hash: 'f1', parents: ['m1'] },
      { hash: 'm1', parents: ['base'] },
      { hash: 'base', parents: [] },
    ])
    expect(rows.map((r) => r.lane)).toEqual([0, 2, 1, 0, 0])
  })

  it('opens a new lane on the right for a stash instead of reusing a free one', () => {
    // after f1 joins main, lane 1 is free but lane 2 (g1) is still busy: the stash goes to lane 3
    const { rows } = computeGraphLayout([
      { hash: 'm2', parents: ['m1', 'f1'] },
      { hash: 'g1', parents: ['base'] },
      { hash: 'f1', parents: ['m1'] },
      { hash: 'st', parents: ['m1'], stash: 0 },
      { hash: 'm1', parents: ['base'] },
      { hash: 'base', parents: [] },
    ])
    expect(rows[1].lane).toBe(2)
    expect(rows[3].lane).toBe(3)
  })

  it('handles 50k commits quickly', () => {
    const { commits } = generateCommits(50_000)
    const t0 = performance.now()
    const layout = computeGraphLayout(commits)
    const ms = performance.now() - t0
    expect(layout.rows).toHaveLength(commits.length)
    expect(ms).toBeLessThan(1000)
  })
})
