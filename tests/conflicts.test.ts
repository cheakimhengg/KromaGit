import { describe, expect, it } from 'vitest'
import { buildResult, hasMarkers, parseConflicts } from '@/lib/conflicts'

const file = 'a\n<<<<<<< HEAD\nY\n=======\nX\n>>>>>>> other\nc\n'

describe('parseConflicts', () => {
  it('splits shared lines and conflict blocks', () => {
    const p = parseConflicts(file)
    expect(p.segments).toEqual([
      { kind: 'common', lines: ['a'] },
      { kind: 'conflict', ours: ['Y'], theirs: ['X'], base: null },
      { kind: 'common', lines: ['c'] },
    ])
  })

  it('reads diff3 markers and keeps CRLF line endings', () => {
    const p = parseConflicts('<<<<<<< HEAD\r\nY\r\n||||||| base\r\nB\r\n=======\r\nX\r\n>>>>>>> o\r\n')
    expect(p.segments[0]).toEqual({ kind: 'conflict', ours: ['Y'], theirs: ['X'], base: ['B'] })
    expect(buildResult(p, [{ ours: false, theirs: true }])).toBe('X\r\n')
  })
})

describe('buildResult', () => {
  const p = parseConflicts(file)
  it('keeps the picked sides in order', () => {
    expect(buildResult(p, [{ ours: true, theirs: false }])).toBe('a\nY\nc\n')
    expect(buildResult(p, [{ ours: true, theirs: true }])).toBe('a\nY\nX\nc\n')
  })
  it('leaves the markers in place for an unpicked conflict', () => {
    const r = buildResult(p, [{ ours: false, theirs: false }], { ours: 'main', theirs: 'other' })
    expect(hasMarkers(r)).toBe(true)
  })
})
