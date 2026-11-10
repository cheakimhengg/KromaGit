export interface RefTreeNode<T = unknown> {
  /** segment label, e.g. "commit-graph" for "feature/commit-graph" */
  label: string
  /** full path, e.g. "feature" for a folder or "feature/commit-graph" for a leaf */
  path: string
  children: RefTreeNode<T>[]
  item?: T
}

/**
 * Turns flat ref names ("feature/a", "feature/b", "main") into a folder tree.
 * Folders are sorted before leaves; both alphabetically (case-insensitive).
 */
export function buildRefTree<T>(items: T[], getName: (item: T) => string): RefTreeNode<T>[] {
  const root: RefTreeNode<T> = { label: '', path: '', children: [] }

  for (const item of items) {
    const parts = getName(item).split('/').filter(Boolean)
    let node = root
    parts.forEach((part, idx) => {
      const path = parts.slice(0, idx + 1).join('/')
      const isLeaf = idx === parts.length - 1
      let child = isLeaf ? undefined : node.children.find((c) => c.label === part && c.item === undefined)
      if (!child) {
        child = { label: part, path, children: [] }
        node.children.push(child)
      }
      if (isLeaf) child.item = item
      node = child
    })
  }

  sortTree(root.children)
  return root.children
}

function sortTree<T>(nodes: RefTreeNode<T>[]): void {
  nodes.sort((a, b) => {
    const aFolder = a.item === undefined
    const bFolder = b.item === undefined
    if (aFolder !== bFolder) return aFolder ? -1 : 1
    return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })
  })
  for (const n of nodes) sortTree(n.children)
}

export function countLeaves<T>(nodes: RefTreeNode<T>[]): number {
  let n = 0
  for (const node of nodes) n += node.item !== undefined ? 1 : countLeaves(node.children)
  return n
}

export function matchesFilter(name: string, filter: string): boolean {
  const f = filter.trim().toLowerCase()
  return f === '' || name.toLowerCase().includes(f)
}
