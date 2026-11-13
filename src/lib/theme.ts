import { ref } from 'vue'
import type { AccentId, ThemeId, ThemePref } from '@/types/ai'

export type ResolvedTheme = 'dark' | 'light'

/** Swatches mirror the palettes in src/styles/main.css (used for previews). */
export interface ThemeInfo {
  id: ThemeId
  name: string
  kind: ResolvedTheme
  blurb: string
  swatch: { bg: string; surface: string; line: string; text: string; muted: string }
}

export const THEMES: ThemeInfo[] = [
  { id: 'dark', name: 'Kroma Dark', kind: 'dark', blurb: 'Neutral graphite, the default', swatch: { bg: '#1b1d22', surface: '#212329', line: '#42464f', text: '#e4e6eb', muted: '#757b87' } },
  { id: 'midnight', name: 'Midnight', kind: 'dark', blurb: 'Deep navy for dark rooms', swatch: { bg: '#0f1420', surface: '#141a28', line: '#313b52', text: '#e2e8f2', muted: '#646f87' } },
  { id: 'dim', name: 'Dim', kind: 'dark', blurb: 'Soft, low contrast for long sessions', swatch: { bg: '#26272c', surface: '#2c2d33', line: '#4a4b53', text: '#dcdcdf', muted: '#7d7e86' } },
  { id: 'light', name: 'Kroma Light', kind: 'light', blurb: 'Soft grey-white, no glare', swatch: { bg: '#f5f6f8', surface: '#eceef2', line: '#bcc2cc', text: '#1d222b', muted: '#767e8e' } },
  { id: 'paper', name: 'Paper', kind: 'light', blurb: 'Warm cream, less blue light', swatch: { bg: '#f6f1e7', surface: '#eee7da', line: '#c4b8a2', text: '#2b2620', muted: '#8a806f' } },
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
  blue: { name: 'Blue', dark: '#7c9cff', light: '#3a5fd9' },
  violet: { name: 'Violet', dark: '#a78bfa', light: '#7038d0' },
  teal: { name: 'Teal', dark: '#2dd4bf', light: '#0b8178' },
  pink: { name: 'Pink', dark: '#f472b6', light: '#c02a6c' },
  amber: { name: 'Amber', dark: '#fbbf24', light: '#a45f0a' },
  green: { name: 'Green', dark: '#4ade80', light: '#15803d' },
}

export function applyAccent(accent: AccentId) {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.accent = accent in ACCENTS ? accent : 'blue'
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
