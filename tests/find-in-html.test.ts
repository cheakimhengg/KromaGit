import { describe, expect, it } from 'vitest'
import { lineMatches, markMatches } from '@/lib/find-in-html'

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

describe('find options', () => {
  it('match case only marks the same case', () => {
    expect(markMatches('Host host HOST', 'host', { caseSensitive: true })).toBe('Host <mark class="kg-find">host</mark> HOST')
  })
  it('whole word skips matches inside longer words', () => {
    expect(markMatches('host hostname _host localhost host.', 'host', { wholeWord: true })).toBe(
      '<mark class="kg-find">host</mark> hostname _host localhost <mark class="kg-find">host</mark>.',
    )
  })
  it('lineMatches follows the same rules', () => {
    expect(lineMatches('var hostName', 'host', { wholeWord: true })).toBe(false)
    expect(lineMatches('Host: x', 'host', { caseSensitive: true })).toBe(false)
    expect(lineMatches('a.b(c)', '.b(', {})).toBe(true)
  })
})
