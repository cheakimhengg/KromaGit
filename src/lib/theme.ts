import { ref } from 'vue'
import type { ThemePref } from '@/types/ai'

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
