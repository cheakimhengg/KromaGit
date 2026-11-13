<script setup lang="ts" generic="T">
import { computed, ref } from 'vue'
import { ChevronRight, Folder, FolderOpen } from '@/lib/icons'
import type { RefTreeNode } from '@/lib/ref-tree'

const props = withDefaults(defineProps<{ nodes: RefTreeNode<T>[]; baseDepth?: number; forceOpen?: boolean }>(), { baseDepth: 0 })
const emit = defineEmits<{ select: [item: T]; menu: [event: MouseEvent, item: T] }>()
defineSlots<{ leaf(props: { item: T; label: string }): unknown }>()

/** folders the user opened; everything starts collapsed */
const expanded = ref(new Set<string>())

interface Row {
  key: string
  depth: number
  node: RefTreeNode<T>
  open: boolean
}

const rows = computed<Row[]>(() => {
  const out: Row[] = []
  const walk = (nodes: RefTreeNode<T>[], depth: number) => {
    for (const node of nodes) {
      const isFolder = node.item === undefined
      const open = props.forceOpen || expanded.value.has(node.path)
      out.push({ key: node.path + (isFolder ? '/' : ''), depth, node, open })
      if (isFolder && open) walk(node.children, depth + 1)
    }
  }
  walk(props.nodes, props.baseDepth)
  return out
})

function toggle(path: string) {
  const next = new Set(expanded.value)
  if (next.has(path)) next.delete(path)
  else next.add(path)
  expanded.value = next
}
</script>

<template>
  <template v-for="row in rows" :key="row.key">
    <button
      v-if="row.node.item === undefined"
      type="button"
      class="flex h-7 w-full items-center gap-1 rounded pr-2 text-left text-[13px] text-muted hover:bg-hover hover:text-fg"
      :style="{ paddingLeft: `${row.depth * 12 + 6}px` }"
      @click="toggle(row.node.path)"
    >
      <ChevronRight :size="14" class="shrink-0 transition-transform" :class="{ 'rotate-90': row.open }" />
      <component :is="row.open ? FolderOpen : Folder" :size="15" class="shrink-0 text-faint" />
      <span class="truncate">{{ row.node.label }}</span>
    </button>
    <div
      v-else
      class="flex h-7 cursor-pointer items-center gap-1.5 rounded pr-2 text-[13px] hover:bg-hover"
      :style="{ paddingLeft: `${row.depth * 12 + 20}px` }"
      @dblclick="emit('select', row.node.item)"
      @contextmenu="emit('menu', $event, row.node.item)"
    >
      <slot name="leaf" :item="row.node.item" :label="row.node.label" />
    </div>
  </template>
</template>
