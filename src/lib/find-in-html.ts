const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'" }
const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export interface FindOptions {
  caseSensitive?: boolean
  wholeWord?: boolean
}

/** A regex for `query` (taken literally); whole word means no letter, digit or _ right before or after. */
export function findRegex(query: string, opts: FindOptions = {}): RegExp | null {
  if (!query) return null
  const body = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(opts.wholeWord ? `(?<![\\w])${body}(?![\\w])` : body, opts.caseSensitive ? 'g' : 'gi')
}

export function lineMatches(text: string, query: string, opts: FindOptions = {}): boolean {
  const re = findRegex(query, opts)
  return !!re && re.test(text)
}

/** Wraps matches of `query` in <mark>, touching only the text between tags. */
export function markMatches(html: string, query: string, opts: FindOptions = {}): string {
  const re = findRegex(query, opts)
  if (!re) return html
  return html.replace(/(<[^>]*>)|([^<]+)/g, (_m, tag: string | undefined, text: string | undefined) => {
    if (tag) return tag
    const raw = text!.replace(/&(?:amp|lt|gt|quot|#39|#x27);/g, (e) => ENTITIES[e] ?? e)
    let out = ''
    let from = 0
    re.lastIndex = 0
    for (let m = re.exec(raw); m; m = re.exec(raw)) {
      if (!m[0]) {
        re.lastIndex++
        continue
      }
      out += escape(raw.slice(from, m.index)) + `<mark class="kg-find">${escape(m[0])}</mark>`
      from = m.index + m[0].length
    }
    return from === 0 ? text! : out + escape(raw.slice(from))
  })
}
