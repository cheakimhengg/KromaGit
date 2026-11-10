<script setup lang="ts">
import { computed } from 'vue'
import { ChevronRight, Folder } from 'lucide-vue-next'
import StatusBadge from '@/components/common/StatusBadge.vue'
import { buildRefTree, type RefTreeNode } from '@/lib/ref-tree'
import type { FileChange } from '@/types/git'

const props = defineProps<{
  files: FileChange[]
  mode: 'list' | 'tree'
  checked: boolean
  activePath?: string | null
}>()
const emit = defineEmits<{ open: [FileChange]; toggle: [FileChange]; menu: [MouseEvent, FileChange] }>()

interface Row {
  key: string
  depth: number
  folder?: string
  file?: FileChange
}

const rows = computed<Row[]>(() => {
  if (props.mode === 'list') return props.files.map((f) => ({ key: f.path, depth: 0, file: f }))
  const out: Row[] = []
  const walk = (nodes: RefTreeNode<FileChange>[], depth: number) => {
    for (const n of nodes) {
      if (n.item) out.push({ key: n.path, depth, file: n.item })
      else {
        let label = n.label
        let node = n
        while (node.children.length === 1 && node.children[0].item === undefined) {
          node = node.children[0]
          label += `/${node.label}`
        }
        out.push({ key: `${node.path}/`, depth, folder: label })
        walk(node.children, depth + 1)
      }
    }
  }
  walk(buildRefTree(props.files, (f) => f.path), 0)
  return out
})

function split(path: string) {
  const i = path.lastIndexOf('/')
  return i === -1 ? { dir: '', name: path } : { dir: path.slice(0, i + 1), name: path.slice(i + 1) }
}
</script>

<template>
  <div>
    <template v-for="row in rows" :key="row.key">
      <div v-if="row.folder" class="flex h-6 items-center gap-1 pr-2 text-[11px] text-muted" :style="{ paddingLeft: `${row.depth * 12 + 8}px` }">
        <ChevronRight :size="11" class="rotate-90 text-faint" /><Folder :size="12" class="text-faint" />
        <span class="truncate">{{ row.folder }}</span>
      </div>
      <div
        v-else-if="row.file"
        class="group flex h-6 cursor-pointer items-center gap-1.5 pr-2 text-[12px]"
        :class="activePath === row.file.path ? 'bg-select' : 'hover:bg-hover'"
        :style="{ paddingLeft: `${row.depth * 12 + (mode === 'tree' ? 22 : 8)}px` }"
        @click="emit('open', row.file)"
        @contextmenu="emit('menu', $event, row.file)"
      >
        <input
          type="checkbox"
          :checked="checked"
          class="h-3 w-3 shrink-0 cursor-pointer accent-[var(--gw-accent)]"
          :title="checked ? 'Unstage' : 'Stage'"
          @click.stop="emit('toggle', row.file)"
        />
        <StatusBadge :status="row.file.status" />
        <span class="flex min-w-0 flex-1 items-baseline gap-1 truncate" :title="row.file.oldPath ? `${row.file.oldPath} → ${row.file.path}` : row.file.path">
          <span class="truncate text-fg" :class="{ 'line-through opacity-60': row.file.status === 'D' }">{{ split(row.file.path).name }}</span>
          <span v-if="mode === 'list'" class="truncate text-[10px] text-faint">{{ split(row.file.path).dir }}</span>
        </span>
        <span class="hidden shrink-0 font-mono text-[10px] group-hover:inline">
          <span class="text-success">+{{ row.file.additions }}</span>
          <span class="ml-1 text-danger">−{{ row.file.deletions }}</span>
        </span>
      </div>
    </template>
  </div>
</template>
