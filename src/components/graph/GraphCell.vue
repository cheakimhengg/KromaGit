<script setup lang="ts">
import { computed } from 'vue'
import type { GraphEdge, GraphRow } from '@/lib/graph-layout'
import { ROW_HEIGHT, avatarColors, laneColor, laneX } from '@/lib/lanes'
import { avatarHue, initials } from '@/lib/format'
import { avatarUrl, markAvatarFailed } from '@/lib/avatars'

const props = defineProps<{
  row: GraphRow
  width: number
  laneWidth: number
  authorName: string
  authorEmail: string
  commitHash: string
  hasRefs?: boolean
  band?: boolean
  isHead?: boolean
  edgesHidden?: boolean
}>()

const H = ROW_HEIGHT
const MID = H / 2

/** corner radius for lane changes: straight lines with a small rounded turn */
const CR = 6

/** Comes down lane `from` and turns into the node on lane `to`. */
function upperPath(e: GraphEdge): string {
  const x1 = laneX(e.from, props.laneWidth)
  const x2 = laneX(e.to, props.laneWidth)
  if (x1 === x2) return `M${x1} 0V${MID}`
  const dir = x2 > x1 ? 1 : -1
  return `M${x1} 0V${MID - CR}Q${x1} ${MID} ${x1 + dir * CR} ${MID}H${x2}`
}

/** Leaves the node on lane `from` sideways, then turns down lane `to`. */
function lowerPath(e: GraphEdge): string {
  const x1 = laneX(e.from, props.laneWidth)
  const x2 = laneX(e.to, props.laneWidth)
  if (x1 === x2) return `M${x1} ${MID}V${H}`
  const dir = x2 > x1 ? 1 : -1
  return `M${x1} ${MID}H${x2 - dir * CR}Q${x2} ${MID} ${x2} ${MID + CR}V${H}`
}

const edges = computed(() => {
  if (props.edgesHidden) return []
  return [
    ...props.row.upper.map((e) => ({ d: upperPath(e), color: laneColor(e.color) })),
    ...props.row.lower.map((e) => ({ d: lowerPath(e), color: laneColor(e.color) })),
  ]
})

const cx = computed(() => laneX(props.row.lane, props.laneWidth))
const color = computed(() => laneColor(props.row.color))
const R = 11.5
const photo = computed(() => avatarUrl(props.authorEmail))
const clipId = computed(() => `av-${props.commitHash}`)
const av = computed(() => avatarColors(avatarHue(props.authorEmail || props.authorName)))
</script>

<template>
  <svg :width="width" :height="H" class="block shrink-0 overflow-hidden">
    <defs v-if="band">
      <linearGradient :id="`band-${commitHash}`" x1="0" x2="1" y1="0" y2="0">
        <stop offset="0" :stop-color="color" stop-opacity="0.14" />
        <stop offset="1" :stop-color="color" stop-opacity="0.02" />
      </linearGradient>
    </defs>
    <rect v-if="band" :x="cx" y="4" :width="Math.max(0, width - cx)" :height="H - 8" :fill="`url(#band-${commitHash})`" />
    <line v-if="hasRefs" x1="0" :y1="MID" :x2="cx - (row.isMerge ? 5 : R)" :y2="MID" :stroke="color" stroke-width="1.5" />
    <path v-for="(e, i) in edges" :key="i" :d="e.d" :stroke="e.color" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" />
    <template v-if="row.isMerge">
      <circle :cx="cx" :cy="MID" r="4" fill="var(--gw-bg)" :stroke="color" stroke-width="2" />
    </template>
    <template v-else>
      <circle :cx="cx" :cy="MID" :r="R" :fill="av.bg" />
      <text
        :x="cx" :y="MID" dy="0.35em" text-anchor="middle"
        font-size="10.5" font-weight="700" :fill="av.fg" style="font-family: var(--font-sans)"
      >{{ initials(authorName).charAt(0) }}</text>
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
