import { describe, expect, it } from 'vitest'
import { buildRefTree, countLeaves, matchesFilter } from '@/lib/ref-tree'

describe('buildRefTree', () => {
  it('groups by prefix with folders first', () => {
    const tree = buildRefTree(['main', 'feature/b', 'feature/a', 'fix/x'], (n) => n)
    expect(tree.map((n) => n.label)).toEqual(['feature', 'fix', 'main'])
    expect(tree[0].children.map((n) => n.label)).toEqual(['a', 'b'])
    expect(tree[2].item).toBe('main')
    expect(countLeaves(tree)).toBe(4)
  })

  it('keeps a branch and a folder with the same name separate', () => {
    const tree = buildRefTree(['release', 'release/1.4'], (n) => n)
    expect(tree).toHaveLength(2)
    expect(tree[0].item).toBeUndefined()
    expect(tree[0].children[0].item).toBe('release/1.4')
    expect(tree[1].item).toBe('release')
  })

  it('builds nested folders', () => {
    const tree = buildRefTree(['team/alice/spike'], (n) => n)
    expect(tree[0].label).toBe('team')
    expect(tree[0].children[0].label).toBe('alice')
    expect(tree[0].children[0].children[0].path).toBe('team/alice/spike')
  })
})

describe('matchesFilter', () => {
  it('is case-insensitive and treats blank as match-all', () => {
    expect(matchesFilter('Feature/Graph', 'graph')).toBe(true)
    expect(matchesFilter('main', '  ')).toBe(true)
    expect(matchesFilter('main', 'dev')).toBe(false)
  })
})
