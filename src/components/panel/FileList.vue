<script setup lang="ts">
import { computed, ref } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { ChevronRight, Folder } from 'lucide-vue-next'
import StatusBadge from '@/components/common/StatusBadge.vue'
import { buildRefTree, type RefTreeNode } from '@/lib/ref-tree'
import type { FileChange } from '@/types/git'

const props = withDefaults(
  defineProps<{
    files: FileChange[]
    mode: 'list' | 'tree'
    checked?: boolean
    activePath?: string | null
    /** commit view: no stage checkboxes, stats always visible */
    readonly?: boolean
  }>(),
  { checked: false, activePath: null, readonly: false },
)
const emit = defineEmits<{ open: [FileChange]; toggle: [FileChange]; menu: [MouseEvent, FileChange] }>()

const ROW = 28
const scrollEl = ref<HTMLElement | null>(null)

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

const virtualizer = useVirtualizer(
  computed(() => ({
    count: rows.value.length,
    getScrollElement: () => scrollEl.value,
    estimateSize: () => ROW,
    overscan: 12,
  })),
)

function split(path: string) {
  const i = path.lastIndexOf('/')
  return i === -1 ? { dir: '', name: path } : { dir: path.slice(0, i + 1), name: path.slice(i + 1) }
}
</script>

<template>
  <div ref="scrollEl" class="h-full overflow-y-auto">
    <div class="relative w-full" :style="{ height: `${virtualizer.getTotalSize()}px` }">
      <template v-for="v in virtualizer.getVirtualItems()" :key="rows[v.index].key">
        <div
          v-if="rows[v.index].folder"
          class="absolute left-0 flex w-full items-center gap-1 pr-2 text-[12px] text-muted"
          :style="{ height: `${ROW}px`, transform: `translateY(${v.start}px)`, paddingLeft: `${rows[v.index].depth * 12 + 8}px` }"
        >
          <ChevronRight :size="12" class="rotate-90 text-faint" /><Folder :size="14" class="text-faint" />
          <span class="truncate">{{ rows[v.index].folder }}</span>
        </div>
        <div
          v-else
          class="group absolute left-0 flex w-full cursor-pointer items-center gap-1.5 pr-2 text-[13px]"
          :class="activePath === rows[v.index].file!.path ? 'bg-select' : 'hover:bg-hover'"
          :style="{ height: `${ROW}px`, transform: `translateY(${v.start}px)`, paddingLeft: `${rows[v.index].depth * 12 + (mode === 'tree' ? 22 : 8)}px`, paddingRight: '10px' }"
          @click="emit('open', rows[v.index].file!)"
          @contextmenu="emit('menu', $event, rows[v.index].file!)"
        >
          <input
            v-if="!readonly"
            type="checkbox"
            :checked="checked"
            class="h-3 w-3 shrink-0 cursor-pointer accent-[var(--gw-accent)]"
            :title="checked ? 'Unstage' : 'Stage'"
            @click.stop.prevent="emit('toggle', rows[v.index].file!)"
          />
          <StatusBadge :status="rows[v.index].file!.status" />
          <span
            class="flex min-w-0 flex-1 items-baseline gap-1 truncate"
            :title="rows[v.index].file!.oldPath ? `${rows[v.index].file!.oldPath} → ${rows[v.index].file!.path}` : rows[v.index].file!.path"
          >
            <span class="truncate text-fg" :class="{ 'line-through opacity-60': rows[v.index].file!.status === 'D' }">{{ split(rows[v.index].file!.path).name }}</span>
            <span v-if="mode === 'list'" class="truncate text-[11px] text-faint">{{ split(rows[v.index].file!.path).dir }}</span>
          </span>
          <span class="shrink-0 font-mono text-[11px]" :class="readonly ? '' : 'hidden group-hover:inline'">
            <span class="text-success">+{{ rows[v.index].file!.additions }}</span>
            <span class="ml-1 text-danger">−{{ rows[v.index].file!.deletions }}</span>
          </span>
        </div>
      </template>
    </div>
    <slot v-if="!files.length" name="empty" />
  </div>
</template>
