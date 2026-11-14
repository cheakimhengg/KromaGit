import { resolvedTheme } from './theme'

export const LANE_COLORS = [
  '#7c9cff', '#5eead4', '#f472b6', '#fbbf24', '#a78bfa',
  '#34d399', '#fb923c', '#60a5fa', '#f87171', '#c084fc',
]

/** Deeper variants that keep contrast on a white background. */
export const LANE_COLORS_LIGHT = [
  '#3a5fd9', '#0c8a80', '#d02670', '#b06f12', '#7438d6',
  '#14875a', '#d0560f', '#2563eb', '#cf2f46', '#9233ea',
]

export const laneColor = (i: number) => {
  const palette = resolvedTheme.value === 'light' ? LANE_COLORS_LIGHT : LANE_COLORS
  return palette[i % palette.length]
}

/** Avatar fill/text for a hue, tuned per theme. */
export const avatarColors = (hue: number) =>
  resolvedTheme.value === 'light'
    ? { bg: `hsl(${hue} 60% 84%)`, fg: `hsl(${hue} 55% 26%)` }
    : { bg: `hsl(${hue} 40% 36%)`, fg: `hsl(${hue} 90% 90%)` }

export const ROW_HEIGHT = 32
export const LANE_WIDTH = 26
export const GRAPH_PADDING = 17

export const MIN_LANE_WIDTH = 14
export const MAX_GRAPH_WIDTH = 380

export const laneX = (lane: number, spacing = LANE_WIDTH) => GRAPH_PADDING + lane * spacing

export function laneSpacing(maxLanes: number): number {
  if (maxLanes <= 1) return LANE_WIDTH
  const fit = (MAX_GRAPH_WIDTH - GRAPH_PADDING * 2) / (maxLanes - 1)
  return Math.max(MIN_LANE_WIDTH, Math.min(LANE_WIDTH, fit))
}

export function graphWidth(maxLanes: number): number {
  const content = (maxLanes - 1) * laneSpacing(maxLanes) + GRAPH_PADDING * 2
  return Math.ceil(Math.max(content, 72))
}
