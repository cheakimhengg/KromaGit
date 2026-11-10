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
    expect(rows[2].lower).toContainEqual(expect.objectContaining({ from: 1, to: 0 }))
    expect(rows[3].lane).toBe(0)
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

  it('handles 50k commits quickly', () => {
    const { commits } = generateCommits(50_000)
    const t0 = performance.now()
    const layout = computeGraphLayout(commits)
    const ms = performance.now() - t0
    expect(layout.rows).toHaveLength(commits.length)
    expect(ms).toBeLessThan(1000)
  })
})
