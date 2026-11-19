/**
 * Space to leave at the top-left for the macOS window buttons. The window uses
 * an overlay title bar, so the buttons sit on top of the tab bar — except in
 * full screen, where macOS hides them and the space would just be empty.
 */
import { computed, ref } from 'vue'
import { isMac } from './shortcuts'
import { zoomFactor } from './theme'

const TRAFFIC_LIGHTS = 78
const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

const fullscreen = ref(false)
/** in CSS pixels, so it shrinks/grows against the page zoom to stay clear of the native buttons */
export const titlebarInset = computed(() => (inTauri && isMac && !fullscreen.value ? Math.ceil(TRAFFIC_LIGHTS / zoomFactor.value) : 0))

let started = false
export async function watchWindowChrome() {
  if (started || !inTauri || !isMac) return
  started = true
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const win = getCurrentWindow()
    const update = async () => {
      fullscreen.value = await win.isFullscreen()
    }
    await update()
    await win.onResized(() => void update())
  } catch {
    /* keep the default inset */
  }
}
