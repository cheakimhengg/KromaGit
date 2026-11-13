import { describe, expect, it } from 'vitest'
import { avatarHue, compactTime, initials, languageFromPath, relativeTime } from '@/lib/format'
import { toSplitRows } from '@/lib/diff-split'

describe('format', () => {
  it('formats relative times', () => {
    const now = 1_700_000_000
    expect(relativeTime(now - 10, now)).toBe('just now')
    expect(relativeTime(now - 3 * 3600, now)).toMatch(/3 hr/)
    expect(relativeTime(now - 2 * 86400, now)).toMatch(/2 days ago/)
  })

  it('formats compact times', () => {
    const now = 1_700_000_000
    expect(compactTime(now - 10, now)).toBe('now')
    expect(compactTime(now - 55 * 60, now)).toBe('55m ago')
    expect(compactTime(now - 4 * 3600, now)).toBe('4h ago')
    expect(compactTime(now - 18 * 86400, now)).toBe('18d ago')
    expect(compactTime(now - 90 * 86400, now)).toBe('3mo ago')
    expect(compactTime(now - 800 * 86400, now)).toBe('2y ago')
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

describe('reflowMessage', () => {
  it('joins hard-wrapped lines but keeps list items and paragraphs', async () => {
    const { reflowMessage } = await import('@/lib/format')
    const body = '- Home page with recent repos; ⌘W closes\n  the tab (macOS menu)\n- Esc closes the\n  innermost view\n\nPlain paragraph that\nwraps here.\n\n\n# Conflicts:\n# a.sql\n'
    expect(reflowMessage(body)).toEqual([
      '- Home page with recent repos; ⌘W closes the tab (macOS menu)',
      '- Esc closes the innermost view',
      '',
      'Plain paragraph that wraps here.',
      '',
      '# Conflicts:',
      '# a.sql',
    ])
    expect(reflowMessage('')).toEqual([])
  })
})
