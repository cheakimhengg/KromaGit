<script setup lang="ts">
import { computed } from 'vue'
import type { GraphEdge, GraphRow } from '@/lib/graph-layout'
import { ROW_HEIGHT, avatarColors, laneColor, laneX } from '@/lib/lanes'
import { avatarHue, initials } from '@/lib/format'

const props = defineProps<{
  row: GraphRow
  width: number
  authorName: string
  authorEmail: string
  isHead?: boolean
  edgesHidden?: boolean
}>()

const H = ROW_HEIGHT
const MID = H / 2

function upperPath(e: GraphEdge): string {
  const x1 = laneX(e.from)
  const x2 = laneX(e.to)
  if (x1 === x2) return `M${x1} 0V${MID}`
  return `M${x1} 0Q${x1} ${MID} ${x2} ${MID}`
}

function lowerPath(e: GraphEdge): string {
  const x1 = laneX(e.from)
  const x2 = laneX(e.to)
  if (x1 === x2) return `M${x1} ${MID}V${H}`
  return `M${x1} ${MID}Q${x2} ${MID} ${x2} ${H}`
}

const edges = computed(() => {
  if (props.edgesHidden) return []
  return [
    ...props.row.upper.map((e) => ({ d: upperPath(e), color: laneColor(e.color) })),
    ...props.row.lower.map((e) => ({ d: lowerPath(e), color: laneColor(e.color) })),
  ]
})

const cx = computed(() => laneX(props.row.lane))
const color = computed(() => laneColor(props.row.color))
const av = computed(() => avatarColors(avatarHue(props.authorEmail || props.authorName)))
</script>

<template>
  <svg :width="width" :height="H" class="block shrink-0 overflow-hidden">
    <path v-for="(e, i) in edges" :key="i" :d="e.d" :stroke="e.color" stroke-width="2" fill="none" stroke-linecap="round" />
    <template v-if="row.isMerge">
      <circle :cx="cx" :cy="MID" r="4.5" :fill="color" stroke="var(--gw-bg)" stroke-width="2" />
    </template>
    <template v-else>
      <circle v-if="isHead" :cx="cx" :cy="MID" r="12.5" fill="none" :stroke="color" stroke-width="1.5" stroke-dasharray="2 2" />
      <circle :cx="cx" :cy="MID" r="9.5" :fill="av.bg" :stroke="color" stroke-width="2" />
      <text
        :x="cx" :y="MID + 0.5" text-anchor="middle" dominant-baseline="central"
        font-size="7.5" font-weight="700" :fill="av.fg" style="font-family: var(--font-sans)"
      >{{ initials(authorName) }}</text>
    </template>
  </svg>
</template>
