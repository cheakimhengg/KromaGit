/**
 * Word-level highlighting inside changed lines. Within each block of removed
 * lines followed by added lines, the n-th removed line is compared with the
 * n-th added one word by word; the words that differ get `<span class="wd">`.
 */
import type { DiffLine } from '@/types/git'

const MAX_TOKENS = 400

export function tokenize(s: string): string[] {
  return s.match(/\w+|\s+|[^\w\s]/g) ?? []
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Marks which tokens of `a` and `b` are not part of their longest common subsequence. */
export function diffTokens(a: string[], b: string[]): { a: boolean[]; b: boolean[] } {
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const ca = new Array<boolean>(n).fill(true)
  const cb = new Array<boolean>(m).fill(true)
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ca[i++] = false
      cb[j++] = false
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++
    else j++
  }
  return { a: ca, b: cb }
}

function render(tokens: string[], changed: boolean[]): string {
  const blank = (t: string) => t.trim() === ''
  const mark = tokens.map((t, k) => {
    if (!changed[k]) return false
    if (!blank(t)) return true
    let prev = k - 1
    while (prev >= 0 && blank(tokens[prev])) prev--
    const next = tokens.findIndex((x, n) => n > k && !blank(x))
    return prev >= 0 && next >= 0 && changed[prev] && changed[next]
  })
  let out = ''
  let open = false
  tokens.forEach((t, k) => {
    if (mark[k] && !open) {
      out += '<span class="wd">'
      open = true
    } else if (!mark[k] && open) {
      out += '</span>'
      open = false
    }
    out += escapeHtml(t)
  })
  return open ? `${out}</span>` : out
}

/** line index → html with changed words marked; lines without a partner are left out. */
export function wordDiffHtml(lines: DiffLine[]): Map<number, string> {
  const out = new Map<number, string>()
  let i = 0
  while (i < lines.length) {
    if (lines[i].kind === 'context') {
      i++
      continue
    }
    const dels: number[] = []
    const adds: number[] = []
    while (i < lines.length && lines[i].kind === 'del') dels.push(i++)
    while (i < lines.length && lines[i].kind === 'add') adds.push(i++)
    for (let k = 0; k < Math.min(dels.length, adds.length); k++) {
      const a = tokenize(lines[dels[k]].text)
      const b = tokenize(lines[adds[k]].text)
      if (a.length > MAX_TOKENS || b.length > MAX_TOKENS) continue
      const d = diffTokens(a, b)
      const words = (t: string[]) => t.filter((x) => x.trim() !== '').length
      const same = a.filter((t, k) => !d.a[k] && t.trim() !== '').length
      const sameShare = same / Math.max(words(a), words(b), 1)
      if (sameShare < 0.3) continue
      out.set(dels[k], render(a, d.a))
      out.set(adds[k], render(b, d.b))
    }
  }
  return out
}
