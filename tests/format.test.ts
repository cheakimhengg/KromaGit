import { describe, expect, it } from 'vitest'
import { avatarHue, initials, languageFromPath, relativeTime } from '@/lib/format'
import { toSplitRows } from '@/lib/diff-split'

describe('format', () => {
  it('formats relative times', () => {
    const now = 1_700_000_000
    expect(relativeTime(now - 10, now)).toBe('just now')
    expect(relativeTime(now - 3 * 3600, now)).toMatch(/3 hr/)
    expect(relativeTime(now - 2 * 86400, now)).toMatch(/2 days ago/)
  })

  it('builds initials', () => {
    expect(initials('Mara Okafor')).toBe('MO')
    expect(initials('sun.li')).toBe('SL')
    expect(initials('prince')).toBe('PR')
    expect(initials('')).toBe('?')
  })

  it('gives stable, case-insensitive avatar hues', () => {
    expect(avatarHue('A@x.dev')).toBe(avatarHue('a@x.dev'))
    expect(avatarHue('a@x.dev')).toBeGreaterThanOrEqual(0)
    expect(avatarHue('a@x.dev')).toBeLessThan(360)
  })

  it('maps file extensions to languages', () => {
    expect(languageFromPath('src/a.ts')).toBe('typescript')
    expect(languageFromPath('src-tauri/src/lib.rs')).toBe('rust')
    expect(languageFromPath('README')).toBe('plaintext')
  })
})

describe('toSplitRows', () => {
  it('pairs deletions with additions and mirrors context', () => {
    const rows = toSplitRows([
      { kind: 'context', oldNo: 1, newNo: 1, text: 'a' },
      { kind: 'del', oldNo: 2, text: 'b' },
      { kind: 'del', oldNo: 3, text: 'c' },
      { kind: 'add', newNo: 2, text: 'B' },
      { kind: 'context', oldNo: 4, newNo: 3, text: 'd' },
    ])
    expect(rows).toHaveLength(4)
    expect(rows[0].left?.text).toBe('a')
    expect(rows[1].left?.text).toBe('b')
    expect(rows[1].right?.text).toBe('B')
    expect(rows[2].left?.text).toBe('c')
    expect(rows[2].right).toBeUndefined()
  })
})
