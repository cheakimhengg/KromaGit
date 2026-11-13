import { describe, expect, it } from 'vitest'
import { wordDiffHtml } from '@/lib/word-diff'
import type { DiffLine } from '@/types/git'

const L = (kind: DiffLine['kind'], text: string) => ({ kind, text }) as DiffLine

describe('word diff', () => {
  it('marks only the changed words in paired lines', () => {
    const m = wordDiffHtml([L('context', 'x'), L('del', 'CREATE PROC Foo_1.7.1'), L('add', 'CREATE PROC Foo_1.8.0'), L('add', 'extra')])
    expect(m.get(1)).toBe('CREATE PROC Foo_1.<span class="wd">7</span>.<span class="wd">1</span>')
    expect(m.get(2)).toBe('CREATE PROC Foo_1.<span class="wd">8</span>.<span class="wd">0</span>')
    expect(m.has(3)).toBe(false)
  })
  it('escapes html and skips lines that are entirely different', () => {
    const m = wordDiffHtml([L('del', 'a < b'), L('add', 'a > b'), L('del', 'alpha beta'), L('add', 'gamma delta')])
    expect(m.get(0)).toBe('a <span class="wd">&lt;</span> b')
    expect(m.has(2)).toBe(false)
  })
})
