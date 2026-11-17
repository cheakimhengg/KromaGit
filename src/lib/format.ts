const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
]

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'short' })

/** Relative time like "3 hr. ago"; `now` is unix seconds. */
export function relativeTime(unixSeconds: number, now = Date.now() / 1000): string {
  const diff = unixSeconds - now
  const abs = Math.abs(diff)
  if (abs < 60) return 'just now'
  for (const [unit, secs] of UNITS) {
    if (abs >= secs) return rtf.format(Math.round(diff / secs), unit)
  }
  return 'just now'
}

export function compactTime(unixSeconds: number, now = Date.now() / 1000): string {
  const s = Math.max(0, now - unixSeconds)
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 60 * 86400) return `${Math.floor(s / 86400)}d ago`
  if (s < 365 * 86400) return `${Math.floor(s / (30 * 86400))}mo ago`
  return `${Math.floor(s / (365 * 86400))}y ago`
}

const fullFmt = new Intl.DateTimeFormat('en', {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  timeZoneName: 'short',
})

export function fullDate(unixSeconds: number): string {
  return fullFmt.format(new Date(unixSeconds * 1000))
}

export function initials(name: string): string {
  const parts = name.trim().split(/[\s._-]+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** Stable 32-bit FNV-1a hash. */
export function hashString(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export function avatarHue(key: string): number {
  return hashString(key.toLowerCase()) % 360
}

export function languageFromPath(path: string): string {
  if (/(^|\/)dockerfile$/i.test(path)) return 'dockerfile'
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript',
    vue: 'xml', html: 'xml', xml: 'xml', svg: 'xml',
    rs: 'rust', cs: 'csharp', py: 'python', go: 'go', java: 'java', kt: 'kotlin',
    json: 'json', css: 'css', scss: 'scss', md: 'markdown', yml: 'yaml', yaml: 'yaml',
    sql: 'sql', sh: 'bash', toml: 'ini', ini: 'ini', less: 'less', sass: 'scss', swift: 'swift', php: 'php', rb: 'ruby',
    c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', cc: 'cpp', graphql: 'graphql', gql: 'graphql', svelte: 'xml', htm: 'xml', zsh: 'bash', bash: 'bash',
  }
  return map[ext] ?? 'plaintext'
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|ico|avif)$/i
export const isImagePath = (path: string) => IMAGE_EXT.test(path)

export function shortPath(p: string): string {
  return p.replace(/^\/(?:Users|home)\/[^/]+/, '~').replace(/^[A-Za-z]:\\Users\\[^\\]+/, '~')
}

export function shortDate(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000)
  const day = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  return `${day} at ${time}`
}

/** Joins git's hard-wrapped message lines back into paragraphs; keeps blank lines and list items. */
export function reflowMessage(body: string): string[] {
  const out: string[] = []
  let prevBlank = true
  for (const raw of body.split('\n')) {
    const line = raw.trimEnd()
    if (!line.trim()) {
      if (!prevBlank) out.push('')
      prevBlank = true
      continue
    }
    const startsItem = /^\s*([-*•]|\d+[.)]|#)\s/.test(line)
    if (!prevBlank && !startsItem && out.length) out[out.length - 1] += ` ${line.trim()}`
    else out.push(line.trim())
    prevBlank = false
  }
  while (out.length && !out[out.length - 1]) out.pop()
  return out
}

/** Folder name git picks for a clone URL: last path segment without ".git". */
export function repoNameFromUrl(url: string): string {
  const trimmed = url.trim().replace(/[/\\]+$/, '')
  const last = trimmed.split(/[/\\:]/).pop() ?? trimmed
  return last.replace(/\.git$/, '')
}
