import { describe, expect, it } from 'vitest'
import { errorMessage, normalizeCommits } from '@/api/git'

describe('api helpers', () => {
  it('fills shortHash and empty refs omitted by the backend', () => {
    const [c] = normalizeCommits([
      { hash: '0123456789abcdef', parents: [], author: { name: 'A', email: 'a@x' }, date: 1, subject: 's' },
    ])
    expect(c.shortHash).toBe('0123456')
    expect(c.refs).toEqual([])
  })

  it('extracts messages from backend errors', () => {
    expect(errorMessage({ kind: 'git', message: 'fatal: bad revision' })).toBe('fatal: bad revision')
    expect(errorMessage('plain')).toBe('plain')
    expect(errorMessage(42)).toBe('Unknown error')
  })
})
