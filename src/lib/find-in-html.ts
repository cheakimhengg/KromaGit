const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'" }
const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Wraps case-insensitive matches of `query` in <mark>, touching only the text between tags. */
export function markMatches(html: string, query: string): string {
  if (!query) return html
  const q = query.toLowerCase()
  return html.replace(/(<[^>]*>)|([^<]+)/g, (_m, tag: string | undefined, text: string | undefined) => {
    if (tag) return tag
    const raw = text!.replace(/&(?:amp|lt|gt|quot|#39|#x27);/g, (e) => ENTITIES[e] ?? e)
    const lower = raw.toLowerCase()
    let out = ''
    let from = 0
    for (let i = lower.indexOf(q); i !== -1; i = lower.indexOf(q, i + q.length)) {
      out += escape(raw.slice(from, i)) + `<mark class="kg-find">${escape(raw.slice(i, i + q.length))}</mark>`
      from = i + q.length
    }
    return from === 0 ? text! : out + escape(raw.slice(from))
  })
}
