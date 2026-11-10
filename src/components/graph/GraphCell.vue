<script setup lang="ts">
import { computed } from 'vue'
import type { GraphEdge, GraphRow } from '@/lib/graph-layout'
import { ROW_HEIGHT, avatarColors, laneColor, laneX } from '@/lib/lanes'
import { avatarHue, initials } from '@/lib/format'
import { avatarUrl, markAvatarFailed } from '@/lib/avatars'

const props = defineProps<{
  row: GraphRow
  width: number
  authorName: string
  authorEmail: string
  commitHash: string
  hasRefs?: boolean
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
const R = 11.5
const photo = computed(() => avatarUrl(props.authorEmail))
const clipId = computed(() => `av-${props.commitHash}`)
const av = computed(() => avatarColors(avatarHue(props.authorEmail || props.authorName)))
</script>

<template>
  <svg :width="width" :height="H" class="block shrink-0 overflow-hidden">
    <line v-if="hasRefs" x1="0" :y1="MID" :x2="cx - (row.isMerge ? 5 : R)" :y2="MID" :stroke="color" stroke-width="2" />
    <path v-for="(e, i) in edges" :key="i" :d="e.d" :stroke="e.color" stroke-width="2" fill="none" stroke-linecap="round" />
    <template v-if="row.isMerge">
      <circle :cx="cx" :cy="MID" r="5" :fill="color" stroke="var(--gw-bg)" stroke-width="2" />
    </template>
    <template v-else>
      <circle v-if="isHead" :cx="cx" :cy="MID" :r="R + 3.5" fill="none" :stroke="color" stroke-width="1.5" stroke-dasharray="2 2" />
      <circle :cx="cx" :cy="MID" :r="R" :fill="av.bg" />
      <text
        :x="cx" :y="MID + 0.5" text-anchor="middle" dominant-baseline="central"
        font-size="8.5" font-weight="700" :fill="av.fg" style="font-family: var(--font-sans)"
      >{{ initials(authorName) }}</text>
      <template v-if="photo">
        <clipPath :id="clipId"><circle :cx="cx" :cy="MID" :r="R - 1" /></clipPath>
        <image
          :href="photo" :x="cx - R" :y="MID - R" :width="R * 2" :height="R * 2"
          preserveAspectRatio="xMidYMid slice" :clip-path="`url(#${clipId})`"
          @error="markAvatarFailed(authorEmail)"
        />
      </template>
      <circle :cx="cx" :cy="MID" :r="R" fill="none" :stroke="color" stroke-width="2" />
    </template>
  </svg>
</template>
