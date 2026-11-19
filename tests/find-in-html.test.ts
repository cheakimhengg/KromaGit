import { describe, expect, it } from 'vitest'
import { markMatches } from '@/lib/find-in-html'

describe('markMatches', () => {
  it('marks text but never inside tags', () => {
    expect(markMatches('<span class="hljs-string">"proxy"</span> proxy', 'proxy')).toBe(
      '<span class="hljs-string">&quot;<mark class="kg-find">proxy</mark>&quot;</span> <mark class="kg-find">proxy</mark>',
    )
  })
  it('is case-insensitive and keeps the original case', () => {
    expect(markMatches('APP_Proxy', 'proxy')).toBe('APP_<mark class="kg-find">Proxy</mark>')
  })
  it('matches escaped characters', () => {
    expect(markMatches('a &amp;&amp; b', '&&')).toBe('a <mark class="kg-find">&amp;&amp;</mark> b')
  })
  it('leaves html alone without a query or a match', () => {
    expect(markMatches('<b>x</b>', '')).toBe('<b>x</b>')
    expect(markMatches('<b>x &amp; y</b>', 'zzz')).toBe('<b>x &amp; y</b>')
  })
})
