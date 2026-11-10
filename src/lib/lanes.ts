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
    ? { bg: `hsl(${hue} 70% 88%)`, fg: `hsl(${hue} 55% 28%)` }
    : { bg: `hsl(${hue} 45% 30%)`, fg: `hsl(${hue} 90% 88%)` }

export const ROW_HEIGHT = 34
export const LANE_WIDTH = 19
export const GRAPH_PADDING = 14

export const laneX = (lane: number) => GRAPH_PADDING + lane * LANE_WIDTH

export function graphWidth(maxLanes: number): number {
  return Math.min(Math.max(maxLanes * LANE_WIDTH + GRAPH_PADDING * 2, 84), 320)
}
