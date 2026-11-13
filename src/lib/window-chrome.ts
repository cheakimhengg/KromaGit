/**
 * Space to leave at the top-left for the macOS window buttons. The window uses
 * an overlay title bar, so the buttons sit on top of the tab bar — except in
 * full screen, where macOS hides them and the space would just be empty.
 */
import { ref } from 'vue'
import { isMac } from './shortcuts'

const TRAFFIC_LIGHTS = 78
const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export const titlebarInset = ref(inTauri && isMac ? TRAFFIC_LIGHTS : 0)

let started = false
export async function watchWindowChrome() {
  if (started || !inTauri || !isMac) return
  started = true
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const win = getCurrentWindow()
    const update = async () => {
      titlebarInset.value = (await win.isFullscreen()) ? 0 : TRAFFIC_LIGHTS
    }
    await update()
    await win.onResized(() => void update())
  } catch {
    /* keep the default inset */
  }
}
