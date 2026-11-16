import { ref } from 'vue'
import type { AccentId, ThemeId, ThemePref } from '@/types/ai'

export type ResolvedTheme = 'dark' | 'light'

/** Swatches mirror the palettes in src/styles/main.css (used for previews). */
export interface ThemeInfo {
  id: ThemeId
  name: string
  kind: ResolvedTheme
  blurb: string
  swatch: { bg: string; surface: string; line: string; text: string; muted: string; accent: string; accent2: string; success: string; warning: string; danger: string; info: string }
}

export const THEMES: ThemeInfo[] = [
  { id: 'dark', name: 'Kroma Dark', kind: 'dark', blurb: 'Soft ink graphite, the default', swatch: { bg: '#1b1d24', surface: '#21232b', line: '#3e414d', text: '#d9dce1', muted: '#6f7581', accent: '#8aa2f2', accent2: '#e08bb8', success: '#5cc392', warning: '#e2b25c', danger: '#e57580', info: '#66c7c0' } },
  { id: 'midnight', name: 'Kroma Midnight', kind: 'dark', blurb: 'Deep navy for dark rooms', swatch: { bg: '#0f1420', surface: '#141a28', line: '#313b52', text: '#e2e8f2', muted: '#646f87', accent: '#8aa2f2', accent2: '#e08bb8', success: '#5cc392', warning: '#e2b25c', danger: '#e57580', info: '#66c7c0' } },
  { id: 'dim', name: 'Kroma Dim', kind: 'dark', blurb: 'Soft, low contrast for long sessions', swatch: { bg: '#26272c', surface: '#2c2d33', line: '#4a4b53', text: '#dcdcdf', muted: '#7d7e86', accent: '#8aa2f2', accent2: '#e08bb8', success: '#5cc392', warning: '#e2b25c', danger: '#e57580', info: '#66c7c0' } },
  { id: 'light', name: 'Kroma Light', kind: 'light', blurb: 'Soft off-white, no glare', swatch: { bg: '#f4f5f7', surface: '#ebedf0', line: '#bdc2ca', text: '#23272e', muted: '#7a818d', accent: '#3d63c9', accent2: '#b8457f', success: '#1f8a55', warning: '#9c6512', danger: '#c23b4f', info: '#19807a' } },
  { id: 'paper', name: 'Kroma Paper', kind: 'light', blurb: 'Warm cream, less blue light', swatch: { bg: '#f8f4eb', surface: '#f1ebdf', line: '#cbbfa9', text: '#2e2a23', muted: '#8b8172', accent: '#2f5aa8', accent2: '#b0506c', success: '#3c7d3a', warning: '#9c6110', danger: '#b73a3a', info: '#2a7a73' } },
  { id: 'vscode-dark', name: 'VS Code Dark+', kind: 'dark', blurb: 'The classic editor look', swatch: { bg: '#1e1e1e', surface: '#252526', line: '#474749', text: '#d4d4d4', muted: '#6e7681', accent: '#3794ff', accent2: '#c586c0', success: '#89d185', warning: '#cca700', danger: '#f14c4c', info: '#4ec9b0' } },
  { id: 'vscode-light', name: 'VS Code Light+', kind: 'light', blurb: 'Crisp editor white', swatch: { bg: '#ffffff', surface: '#f3f3f3', line: '#c8c8c8', text: '#1f1f1f', muted: '#8a8a8a', accent: '#005fb8', accent2: '#af00db', success: '#388a34', warning: '#a36b00', danger: '#cd3131', info: '#16825d' } },
  { id: 'github-dark', name: 'GitHub Dark', kind: 'dark', blurb: 'Familiar from github.com', swatch: { bg: '#0d1117', surface: '#161b22', line: '#3d444d', text: '#e6edf3', muted: '#6e7681', accent: '#4493f8', accent2: '#ab7df8', success: '#3fb950', warning: '#d29922', danger: '#f85149', info: '#39c5cf' } },
  { id: 'github-light', name: 'GitHub Light', kind: 'light', blurb: 'Clean and neutral', swatch: { bg: '#ffffff', surface: '#f6f8fa', line: '#b7bfc8', text: '#1f2328', muted: '#818b98', accent: '#0969da', accent2: '#8250df', success: '#1a7f37', warning: '#9a6700', danger: '#d1242f', info: '#1b7c83' } },
  { id: 'one-dark', name: 'One Dark Pro', kind: 'dark', blurb: 'Atom’s balanced dark', swatch: { bg: '#21252b', surface: '#282c34', line: '#4b5263', text: '#c8ccd4', muted: '#5c6370', accent: '#61afef', accent2: '#c678dd', success: '#98c379', warning: '#e5c07b', danger: '#e06c75', info: '#56b6c2' } },
  { id: 'tokyo-night', name: 'Tokyo Night', kind: 'dark', blurb: 'Neon city at night', swatch: { bg: '#16161e', surface: '#1a1b26', line: '#3b4261', text: '#c0caf5', muted: '#565f89', accent: '#7aa2f7', accent2: '#bb9af7', success: '#9ece6a', warning: '#e0af68', danger: '#f7768e', info: '#7dcfff' } },
  { id: 'catppuccin-mocha', name: 'Catppuccin Mocha', kind: 'dark', blurb: 'Soothing pastel dark', swatch: { bg: '#181825', surface: '#1e1e2e', line: '#45475a', text: '#cdd6f4', muted: '#6c7086', accent: '#89b4fa', accent2: '#cba6f7', success: '#a6e3a1', warning: '#f9e2af', danger: '#f38ba8', info: '#94e2d5' } },
  { id: 'catppuccin-latte', name: 'Catppuccin Latte', kind: 'light', blurb: 'Soothing pastel light', swatch: { bg: '#eff1f5', surface: '#e6e9ef', line: '#acb0be', text: '#4c4f69', muted: '#8c8fa1', accent: '#1e66f5', accent2: '#8839ef', success: '#40a02b', warning: '#df8e1d', danger: '#d20f39', info: '#179299' } },
  { id: 'dracula', name: 'Dracula', kind: 'dark', blurb: 'Vivid colours on deep purple', swatch: { bg: '#21222c', surface: '#282a36', line: '#4b4e63', text: '#f8f8f2', muted: '#6272a4', accent: '#bd93f9', accent2: '#ff79c6', success: '#50fa7b', warning: '#f1fa8c', danger: '#ff5555', info: '#8be9fd' } },
  { id: 'nord', name: 'Nord', kind: 'dark', blurb: 'Calm arctic blue-grey', swatch: { bg: '#2e3440', surface: '#343b48', line: '#4c566a', text: '#eceff4', muted: '#7b88a1', accent: '#88c0d0', accent2: '#b48ead', success: '#a3be8c', warning: '#ebcb8b', danger: '#bf616a', info: '#8fbcbb' } },
  { id: 'ayu-dark', name: 'Ayu Dark', kind: 'dark', blurb: 'High contrast, warm accents', swatch: { bg: '#0b0e14', surface: '#0f131a', line: '#2d3340', text: '#bfbdb6', muted: '#5a6070', accent: '#e6b450', accent2: '#d2a6ff', success: '#7fd962', warning: '#ffb454', danger: '#d95757', info: '#95e6cb' } },
  { id: 'ayu-light', name: 'Ayu Light', kind: 'light', blurb: 'Bright, warm and airy', swatch: { bg: '#fcfcfc', surface: '#f3f4f5', line: '#c5cad1', text: '#3f4449', muted: '#8a9199', accent: '#e88a1a', accent2: '#a37acc', success: '#4f9a2a', warning: '#c98a1a', danger: '#d64545', info: '#2e9e7a' } },
]

export const themeInfo = (id: string) => THEMES.find((t) => t.id === id)

/** The theme actually on screen; reactive so canvas-like colours (lanes, avatars) re-render. */
export const resolvedTheme = ref<ResolvedTheme>('dark')

let media: MediaQueryList | null = null
let currentPref: ThemePref = 'dark'

function systemTheme(): ResolvedTheme {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

/** The palette to show: a theme id, with "system" mapped to Kroma Dark / Kroma Light. */
export function resolvePalette(pref: ThemePref, system: ResolvedTheme = systemTheme()): ThemeId {
  if (pref === 'system') return system
  return themeInfo(pref) ? pref : 'dark'
}

export function resolveTheme(pref: ThemePref, system: ResolvedTheme = systemTheme()): ResolvedTheme {
  return themeInfo(resolvePalette(pref, system))!.kind
}

function paint(pref: ThemePref) {
  const palette = resolvePalette(pref)
  const kind = themeInfo(palette)!.kind
  resolvedTheme.value = kind
  const root = document.documentElement
  root.classList.toggle('light', kind === 'light')
  root.classList.toggle('dark', kind === 'dark')
  root.dataset.theme = palette
}

export function applyTheme(pref: ThemePref) {
  currentPref = pref
  paint(pref)
  if (!media && typeof window !== 'undefined' && window.matchMedia) {
    media = window.matchMedia('(prefers-color-scheme: light)')
    media.addEventListener('change', () => currentPref === 'system' && paint('system'))
  }
}

/** Accent colours: [dark theme, light theme]. */
export const ACCENTS: Record<AccentId, { name: string; dark: string; light: string }> = {
  theme: { name: 'Theme', dark: '', light: '' },
  blue: { name: 'Blue', dark: '#7c9cff', light: '#3a5fd9' },
  violet: { name: 'Violet', dark: '#a78bfa', light: '#7038d0' },
  teal: { name: 'Teal', dark: '#2dd4bf', light: '#0b8178' },
  pink: { name: 'Pink', dark: '#f472b6', light: '#c02a6c' },
  amber: { name: 'Amber', dark: '#fbbf24', light: '#a45f0a' },
  green: { name: 'Green', dark: '#4ade80', light: '#15803d' },
}

export function applyAccent(accent: AccentId) {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.accent = accent in ACCENTS ? accent : 'theme'
}

export const ZOOM_MIN = 70
export const ZOOM_MAX = 150
export const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z / 10) * 10))

/** Native webview zoom inside the app (keeps click coordinates right); CSS zoom in the browser demo. */
export async function applyZoom(percent: number, inTauri: boolean) {
  const z = clampZoom(percent)
  if (inTauri) {
    const { getCurrentWebview } = await import('@tauri-apps/api/webview')
    await getCurrentWebview().setZoom(z / 100)
  } else {
    ;(document.body.style as CSSStyleDeclaration & { zoom: string }).zoom = `${z}%`
  }
}
