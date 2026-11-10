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
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript',
    vue: 'xml', html: 'xml', xml: 'xml', svg: 'xml',
    rs: 'rust', cs: 'csharp', py: 'python', go: 'go', java: 'java', kt: 'kotlin',
    json: 'json', css: 'css', scss: 'scss', md: 'markdown', yml: 'yaml', yaml: 'yaml',
    sql: 'sql', sh: 'bash', toml: 'ini',
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
