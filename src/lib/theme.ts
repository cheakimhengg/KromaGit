import { ref } from 'vue'
import type { AccentId, ThemePref } from '@/types/ai'

export type ResolvedTheme = 'dark' | 'light'

/** The theme actually on screen; reactive so canvas-like colours (lanes, avatars) re-render. */
export const resolvedTheme = ref<ResolvedTheme>('dark')

let media: MediaQueryList | null = null
let currentPref: ThemePref = 'dark'

function systemTheme(): ResolvedTheme {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

function paint(theme: ResolvedTheme) {
  resolvedTheme.value = theme
  const root = document.documentElement
  root.classList.toggle('light', theme === 'light')
  root.classList.toggle('dark', theme === 'dark')
}

export function resolveTheme(pref: ThemePref, system: ResolvedTheme = systemTheme()): ResolvedTheme {
  return pref === 'system' ? system : pref
}

export function applyTheme(pref: ThemePref) {
  currentPref = pref
  paint(resolveTheme(pref))
  if (!media && typeof window !== 'undefined' && window.matchMedia) {
    media = window.matchMedia('(prefers-color-scheme: light)')
    media.addEventListener('change', () => currentPref === 'system' && paint(systemTheme()))
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
