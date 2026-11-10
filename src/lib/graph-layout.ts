export interface GraphInputCommit {
  hash: string
  parents: string[]
}

/** A segment within one half of a row. Columns are lane indexes. */
export interface GraphEdge {
  from: number
  to: number
  color: number
}

export interface GraphRow {
  lane: number
  color: number
  /** edges from row top (y=0) to row middle */
  upper: GraphEdge[]
  /** edges from row middle to row bottom */
  lower: GraphEdge[]
  isMerge: boolean
}

export interface GraphLayout {
  rows: GraphRow[]
  maxLanes: number
}

/**
 * Assigns each commit to a lane and computes the edge segments needed to draw
 * the graph one row at a time (so rows can be virtualized independently).
 *
 * Input must be in topological order, newest first (as `git log --topo-order`).
 * Lanes keep their column for their whole lifetime; freed columns are reused.
 */
export function computeGraphLayout(commits: GraphInputCommit[], paletteSize = 10): GraphLayout {
  const lanes: (string | null)[] = []
  const laneColors: number[] = []
  let nextColor = 0
  let maxLanes = 0
  const rows: GraphRow[] = new Array(commits.length)

  const allocate = (hash: string): number => {
    let idx = lanes.indexOf(null)
    if (idx === -1) {
      idx = lanes.length
      lanes.push(null)
    }
    lanes[idx] = hash
    laneColors[idx] = nextColor++ % paletteSize
    return idx
  }

  for (let i = 0; i < commits.length; i++) {
    const { hash, parents } = commits[i]
    const upper: GraphEdge[] = []
    const lower: GraphEdge[] = []

    const incoming: number[] = []
    for (let j = 0; j < lanes.length; j++) {
      if (lanes[j] === hash) incoming.push(j)
    }

    for (let j = 0; j < lanes.length; j++) {
      const h = lanes[j]
      if (h === null || h === hash) continue
      upper.push({ from: j, to: j, color: laneColors[j] })
    }

    const lane = incoming.length > 0 ? incoming[0] : allocate(hash)
    const color = laneColors[lane]
    for (const j of incoming) upper.push({ from: j, to: lane, color: laneColors[j] })

    for (const j of incoming) {
      if (j !== lane) lanes[j] = null
    }

    const newLanes = new Set<number>()
    if (parents.length === 0) {
      lanes[lane] = null
    } else {
      const existing = lanes.indexOf(parents[0])
      if (existing !== -1 && existing !== lane) {
        lanes[lane] = null
        lower.push({ from: lane, to: existing, color: laneColors[existing] })
      } else {
        lanes[lane] = parents[0]
        lower.push({ from: lane, to: lane, color })
      }
      for (let p = 1; p < parents.length; p++) {
        const parent = parents[p]
        let target = lanes.indexOf(parent)
        if (target === -1) {
          target = allocate(parent)
          newLanes.add(target)
        }
        lower.push({ from: lane, to: target, color: laneColors[target] })
      }
    }

    for (let j = 0; j < lanes.length; j++) {
      const h = lanes[j]
      if (h === null || j === lane || newLanes.has(j)) continue
      lower.push({ from: j, to: j, color: laneColors[j] })
    }

    while (lanes.length > 0 && lanes[lanes.length - 1] === null) {
      lanes.pop()
      laneColors.pop()
    }

    const used = Math.max(lane + 1, ...upper.map((e) => Math.max(e.from, e.to) + 1), ...lower.map((e) => Math.max(e.from, e.to) + 1))
    if (used > maxLanes) maxLanes = used

    rows[i] = { lane, color, upper, lower, isMerge: parents.length > 1 }
  }

  return { rows, maxLanes }
}
