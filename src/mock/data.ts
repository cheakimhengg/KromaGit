import type {
  Branch, Commit, FileDiff, Person, RefLabel, RepoSnapshot, Remote, Stash, Submodule, Tag, Worktree,
} from '@/types/git'

function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const AUTHORS: Person[] = [
  { name: 'Mara Okafor', email: 'mara@example.dev' },
  { name: 'Leo Brandt', email: 'leo.brandt@example.dev' },
  { name: 'Sun Li', email: 'sun.li@example.dev' },
  { name: 'Priya Nair', email: 'priya@example.dev' },
  { name: 'Tomás Reyes', email: 'tomas@example.dev' },
  { name: 'Ada Kowalski', email: 'ada.k@example.dev' },
]

const TYPES = ['feat', 'fix', 'refactor', 'perf', 'chore', 'test', 'docs']
const AREAS = ['graph', 'diff', 'sidebar', 'toolbar', 'parser', 'settings', 'tabs', 'stash', 'remote', 'ai']
const ACTIONS = [
  'handle detached HEAD in status',
  'virtualize commit list rendering',
  'parse porcelain v2 rename entries',
  'add keyboard navigation',
  'cache lane layout per repo',
  'show ahead/behind counts',
  'debounce filter input',
  'support hunk staging',
  'fix off-by-one in line numbers',
  'trim trailing whitespace in messages',
  'add context menu actions',
  'improve empty state copy',
  'handle submodule status codes',
  'reduce re-renders on scroll',
  'respect core.quotepath',
]

const FEATURE_NAMES = [
  'feature/commit-graph', 'feature/ai-commit', 'feature/diff-viewer', 'feature/split-suggest',
  'feature/standup', 'fix/tab-close', 'fix/rename-detection', 'chore/deps-bump',
  'feature/worktrees', 'feature/command-palette', 'fix/crlf-diff', 'release/1.4',
]

export const CURRENT_BRANCH = 'feature/commit-graph'

interface GenBranch {
  name: string
  tip: string
}

export function generateCommits(count: number, seed = 42): { commits: Commit[]; branchTips: Map<string, string>; tags: Tag[] } {
  const rand = mulberry32(seed)
  const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)]
  const hex = () => {
    let s = ''
    for (let i = 0; i < 40; i++) s += Math.floor(rand() * 16).toString(16)
    return s
  }

  const created: Commit[] = []
  let t = 1_600_000_000
  const mk = (parents: string[], subject: string, _body = ''): Commit => {
    t += 300 + Math.floor(rand() * 2400)
    const hash = hex()
    const c: Commit = {
      hash, shortHash: hash.slice(0, 7), parents, author: pick(AUTHORS), date: t,
      subject, refs: [],
    }
    created.push(c)
    return c
  }
  const message = () => `${pick(TYPES)}(${pick(AREAS)}): ${pick(ACTIONS)}`

  const main: GenBranch = { name: 'main', tip: mk([], 'chore: initial commit').hash }
  const features: GenBranch[] = []
  const tags: Tag[] = []
  let featureCounter = 0
  let release = 0

  while (created.length < count) {
    const r = rand()
    if (features.length < 4 && r < 0.12) {
      const name = FEATURE_NAMES[featureCounter++ % FEATURE_NAMES.length]
      if (!features.some((f) => f.name === name)) features.push({ name, tip: main.tip })
      continue
    }
    if (features.length > 0 && r < 0.2) {
      const idx = Math.floor(rand() * features.length)
      const f = features[idx]
      if (f.tip !== main.tip) {
        main.tip = mk([main.tip, f.tip], `Merge branch '${f.name}' into main`, `Merged ${f.name} after review.`).hash
        features.splice(idx, 1)
        if (rand() < 0.25) {
          release++
          tags.push({ name: `v1.${Math.floor(release / 10)}.${release % 10}`, hash: main.tip })
        }
        continue
      }
    }
    const target = features.length > 0 && rand() < 0.7 ? pick(features) : main
    target.tip = mk([target.tip], message(), rand() < 0.3 ? 'Details:\n- covers edge cases\n- adds unit tests' : '').hash
  }

  if (!features.some((f) => f.name === CURRENT_BRANCH)) {
    const f = { name: CURRENT_BRANCH, tip: main.tip }
    for (let i = 0; i < 3; i++) f.tip = mk([f.tip], message()).hash
    features.push(f)
  }

  const shift = Math.floor(Date.now() / 1000) - 25 * 60 - created[created.length - 1].date
  for (const c of created) c.date += shift

  const branchTips = new Map<string, string>()
  branchTips.set('main', main.tip)
  for (const f of features) branchTips.set(f.name, f.tip)

  const byHash = new Map(created.map((c) => [c.hash, c]))
  const addRef = (hash: string, ref: RefLabel) => byHash.get(hash)?.refs.push(ref)
  for (const [name, tip] of branchTips) {
    addRef(tip, { name, kind: 'local', current: name === CURRENT_BRANCH })
    if (name === 'main' || name === CURRENT_BRANCH) addRef(tip, { name: `origin/${name}`, kind: 'remote' })
  }
  const stagingTip = created[Math.max(0, created.length - 40)]
  addRef(stagingTip.hash, { name: 'origin/staging', kind: 'remote' })
  branchTips.set('staging', stagingTip.hash)
  for (const tag of tags.slice(-12)) addRef(tag.hash, { name: tag.name, kind: 'tag' })

  return { commits: created.reverse(), branchTips, tags: tags.slice(-12).reverse() }
}

export function createMockRepo(name: string, path: string, commitCount = 5000): RepoSnapshot {
  const { commits, branchTips, tags } = generateCommits(commitCount, hashSeed(name))
  const branches: Branch[] = [...branchTips.entries()].map(([b, tip], i) => ({
    name: b,
    current: b === CURRENT_BRANCH,
    upstream: b === 'main' || b === CURRENT_BRANCH || b === 'staging' ? `origin/${b}` : undefined,
    upstreamGone: b === 'fix/tab-close',
    ahead: b === CURRENT_BRANCH ? 3 : i % 3 === 0 ? 0 : i % 4,
    behind: b === CURRENT_BRANCH ? 1 : i % 2,
    tipHash: tip,
  }))

  const remotes: Remote[] = [
    { name: 'origin', url: `git@github.com:kromagit-demo/${name}.git`, branches: ['main', 'staging', CURRENT_BRANCH, 'release/1.3'] },
    { name: 'upstream', url: `https://github.com/upstream-org/${name}.git`, branches: ['main', 'next'] },
  ]
  const stashes: Stash[] = [
    { index: 0, message: 'WIP on feature/commit-graph: lane colors experiment', date: commits[3].date + 60, oid: 'f00dbabe00000000000000000000000000000001', parent: commits[3].hash, authorName: commits[3].author.name, authorEmail: commits[3].author.email },
    { index: 1, message: 'On main: debug logging', date: commits[9].date + 60, oid: 'f00dbabe00000000000000000000000000000002', parent: commits[9].hash, authorName: commits[9].author.name, authorEmail: commits[9].author.email },
  ]
  const worktrees: Worktree[] = [
    { path: path, branch: CURRENT_BRANCH, isMain: true },
    { path: `${path}-hotfix`, branch: 'fix/crlf-diff', isMain: false },
  ]
  const submodules: Submodule[] = [
    { path: 'vendor/themes', hash: 'a1b2c3d', status: 'clean' },
    { path: 'vendor/grammars', hash: '9f8e7d6', status: 'modified' },
  ]

  return {
    name, path, currentBranch: CURRENT_BRANCH, commits, branches, remotes, tags, stashes, worktrees, submodules,
    head: { branch: CURRENT_BRANCH, oid: branchTips.get(CURRENT_BRANCH) ?? null, detached: false, upstream: `origin/${CURRENT_BRANCH}`, ahead: 3, behind: 1 },
    lastFetch: null,
    operation: null,
    workingCopy: {
      unstaged: [
        { path: 'src/components/graph/GraphCell.vue', status: 'M', additions: 24, deletions: 6 },
        { path: 'src/lib/graph-layout.ts', status: 'M', additions: 12, deletions: 3 },
        { path: 'src/stores/ui.ts', status: 'M', additions: 4, deletions: 1 },
        { path: 'public/hero.webp', status: 'M', additions: 0, deletions: 0 },
        { path: 'src/components/graph/LaneLegend.vue', status: '?', additions: 48, deletions: 0 },
        { path: 'docs/old-notes.md', status: 'D', additions: 0, deletions: 31 },
      ],
      staged: [
        { path: 'src/lib/format.ts', status: 'M', additions: 9, deletions: 2 },
        { path: 'src/components/common/Avatar.vue', status: 'A', additions: 37, deletions: 0 },
        { path: 'src/components/graph/RefPill.vue', oldPath: 'src/components/graph/Pill.vue', status: 'R', additions: 3, deletions: 3 },
      ],
    },
  }
}

function hashSeed(s: string): number {
  let h = 7
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return h
}

export function mockDiff(path: string): FileDiff {
  return {
    path,
    hunks: [
      {
        header: '@@ -12,9 +12,13 @@ export function computeGraphLayout(commits: GraphInputCommit[]) {',
        oldStart: 12, oldLines: 9, newStart: 12, newLines: 13,
        lines: lines(12, 12, [
          [' ', '  const lanes: (string | null)[] = []'],
          [' ', '  const laneColors: number[] = []'],
          ['-', '  let maxLanes = 0'],
          ['+', '  let nextColor = 0'],
          ['+', '  let maxLanes = 0'],
          ['+', '  // rows are computed independently so they can be virtualized'],
          [' ', '  const rows: GraphRow[] = new Array(commits.length)'],
          [' ', ''],
          ['-', '  const allocate = (hash: string) => {'],
          ['+', '  const allocate = (hash: string): number => {'],
          ['+', '    let idx = lanes.indexOf(null)'],
          [' ', '    if (idx === -1) {'],
          [' ', '      idx = lanes.length'],
        ]),
      },
      {
        header: '@@ -48,7 +52,8 @@ export function computeGraphLayout(commits: GraphInputCommit[]) {',
        oldStart: 48, oldLines: 7, newStart: 52, newLines: 8,
        lines: lines(48, 52, [
          [' ', '    for (const j of incoming) {'],
          [' ', '      if (j !== lane) lanes[j] = null'],
          [' ', '    }'],
          ['-', '    console.log("lane", lane, lanes)'],
          ['+', '    const color = laneColors[lane]'],
          ['+', '    const isMerge = parents.length > 1'],
          [' ', ''],
          [' ', '    if (parents.length === 0) {'],
          [' ', '      lanes[lane] = null'],
        ]),
      },
    ],
  }
}

function lines(oldStart: number, newStart: number, raw: [string, string][]) {
  let o = oldStart
  let n = newStart
  return raw.map(([k, text]) => {
    if (k === '+') return { kind: 'add' as const, newNo: n++, text }
    if (k === '-') return { kind: 'del' as const, oldNo: o++, text }
    return { kind: 'context' as const, oldNo: o++, newNo: n++, text }
  })
}
