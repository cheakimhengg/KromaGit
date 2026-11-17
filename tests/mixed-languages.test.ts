import { describe, expect, it } from 'vitest'
import { mixedLanguages } from '@/lib/highlight'

const hunk = (...lines: string[]) => ({ lines: lines.map((text) => ({ text })) })

describe('mixedLanguages', () => {
  it('follows <script> and <style> blocks inside a hunk', () => {
    const [langs] = mixedLanguages([hunk('<template>', '  <div />', '</template>', '<script setup lang="ts">', 'const a = 1', '</script>', '<style lang="scss">', '.a { color: red; }', '</style>')])
    expect(langs).toEqual(['xml', 'xml', 'xml', 'xml', 'typescript', 'xml', 'xml', 'scss', 'xml'])
  })

  it('guesses a style block when the hunk starts in the middle of one', () => {
    const [langs] = mixedLanguages([hunk('.failure,', '.fc-error {', '  color: rgb(var(--error));', '}', '.secondary {')])
    expect(new Set(langs)).toEqual(new Set(['css']))
  })

  it('guesses a script block from code-looking lines', () => {
    const [langs] = mixedLanguages([hunk('const x = ref(0)', 'watch(x, () => {', '  return 1', '})')])
    expect(new Set(langs)).toEqual(new Set(['typescript']))
  })
})
