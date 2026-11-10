import type { DiffLine } from '@/types/git'

export interface SplitRow {
  left?: DiffLine & { index: number }
  right?: DiffLine & { index: number }
}

/**
 * Pairs unified diff lines into side-by-side rows: context lines appear on
 * both sides; within each change block deletions pair with additions in order.
 */
export function toSplitRows(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.kind === 'context') {
      rows.push({ left: { ...line, index: i }, right: { ...line, index: i } })
      i++
      continue
    }
    const dels: (DiffLine & { index: number })[] = []
    const adds: (DiffLine & { index: number })[] = []
    while (i < lines.length && lines[i].kind === 'del') dels.push({ ...lines[i], index: i++ })
    while (i < lines.length && lines[i].kind === 'add') adds.push({ ...lines[i], index: i++ })
    const n = Math.max(dels.length, adds.length)
    for (let k = 0; k < n; k++) rows.push({ left: dels[k], right: adds[k] })
  }
  return rows
}
