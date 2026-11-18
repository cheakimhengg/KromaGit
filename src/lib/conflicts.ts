/** Splits a file with git conflict markers into shared text and conflict blocks. */

export interface ConflictBlock {
  kind: 'conflict'
  ours: string[]
  theirs: string[]
  /** the common ancestor, when the file uses diff3 markers (|||||||) */
  base: string[] | null
}
export interface CommonBlock {
  kind: 'common'
  lines: string[]
}
export type Segment = CommonBlock | ConflictBlock

export interface ParsedConflict {
  segments: Segment[]
  /** line ending used by the file, kept when writing the result back */
  eol: '\n' | '\r\n'
  trailingNewline: boolean
}

export function parseConflicts(text: string): ParsedConflict {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const trailingNewline = text.endsWith('\n')
  const lines = text.split(/\r?\n/)
  if (trailingNewline) lines.pop()
  const segments: Segment[] = []
  let common: string[] = []
  let i = 0
  while (i < lines.length) {
    const l = lines[i]
    if (!l.startsWith('<<<<<<<')) {
      common.push(l)
      i++
      continue
    }
    const ours: string[] = []
    const theirs: string[] = []
    let base: string[] | null = null
    let part: 'ours' | 'base' | 'theirs' = 'ours'
    let j = i + 1
    let closed = false
    for (; j < lines.length; j++) {
      const m = lines[j]
      if (part !== 'theirs' && m.startsWith('|||||||')) { part = 'base'; base = []; continue }
      if (part !== 'theirs' && m.startsWith('=======')) { part = 'theirs'; continue }
      if (part === 'theirs' && m.startsWith('>>>>>>>')) { closed = true; break }
      ;(part === 'ours' ? ours : part === 'base' ? base! : theirs).push(m)
    }
    if (!closed) {
      common.push(l)
      i++
      continue
    }
    if (common.length) segments.push({ kind: 'common', lines: common })
    common = []
    segments.push({ kind: 'conflict', ours, theirs, base })
    i = j + 1
  }
  if (common.length) segments.push({ kind: 'common', lines: common })
  return { segments, eol, trailingNewline }
}

export type Choice = { ours: boolean; theirs: boolean }

/** The resolved text; an unpicked conflict keeps its original markers so nothing is lost silently. */
export function buildResult(p: ParsedConflict, choices: Choice[], labels = { ours: 'HEAD', theirs: 'incoming' }): string {
  const out: string[] = []
  let k = 0
  for (const s of p.segments) {
    if (s.kind === 'common') { out.push(...s.lines); continue }
    const c = choices[k++] ?? { ours: false, theirs: false }
    if (!c.ours && !c.theirs) {
      out.push(`<<<<<<< ${labels.ours}`, ...s.ours, '=======', ...s.theirs, `>>>>>>> ${labels.theirs}`)
      continue
    }
    if (c.ours) out.push(...s.ours)
    if (c.theirs) out.push(...s.theirs)
  }
  return out.join(p.eol) + (p.trailingNewline ? p.eol : '')
}

export const hasMarkers = (text: string) => /^(<{7}|={7}|>{7})( |$)/m.test(text)
