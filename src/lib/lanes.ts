export const LANE_COLORS = [
  '#7c9cff', '#5eead4', '#f472b6', '#fbbf24', '#a78bfa',
  '#34d399', '#fb923c', '#60a5fa', '#f87171', '#c084fc',
]

export const laneColor = (i: number) => LANE_COLORS[i % LANE_COLORS.length]

export const ROW_HEIGHT = 30
export const LANE_WIDTH = 16
export const GRAPH_PADDING = 12

export const laneX = (lane: number) => GRAPH_PADDING + lane * LANE_WIDTH

export function graphWidth(maxLanes: number): number {
  return Math.min(Math.max(maxLanes * LANE_WIDTH + GRAPH_PADDING * 2, 72), 280)
}
