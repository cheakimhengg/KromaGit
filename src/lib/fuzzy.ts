/**
 * Subsequence fuzzy match for the command palette. Returns a score (higher is
 * better) or -1 when the query letters don't appear in order. Rewards
 * consecutive runs, word starts and an early first match.
 */
export function fuzzyScore(query: string, text: string): number {
  const q = query.trim().toLowerCase()
  if (!q) return 0
  const t = text.toLowerCase()
  const direct = t.indexOf(q)
  if (direct !== -1) return 1000 - direct * 2 - (t.length - q.length) * 0.1 + (direct === 0 || /[\s/:._-]/.test(t[direct - 1]) ? 200 : 0)

  let score = 0
  let ti = 0
  let run = 0
  let first = -1
  for (const ch of q) {
    if (ch === ' ') continue
    const found = t.indexOf(ch, ti)
    if (found === -1) return -1
    if (first === -1) first = found
    const wordStart = found === 0 || /[\s/:._-]/.test(t[found - 1])
    run = found === ti ? run + 1 : 0
    score += 10 + run * 8 + (wordStart ? 15 : 0)
    ti = found + 1
  }
  return score - first - (t.length - q.length) * 0.05
}

export function fuzzyFilter<T>(items: T[], query: string, text: (item: T) => string, limit = 60): T[] {
  if (!query.trim()) return items.slice(0, limit)
  return items
    .map((item) => ({ item, score: fuzzyScore(query, text(item)) }))
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.item)
}
