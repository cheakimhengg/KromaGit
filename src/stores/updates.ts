import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import type { Update } from '@tauri-apps/plugin-updater'
import { inTauri } from '@/api/git'
import { useUiStore } from '@/stores/ui'

export type UpdateStatus = 'idle' | 'checking' | 'upToDate' | 'available' | 'downloading' | 'ready' | 'error'

const AUTO_KEY = 'kromagit.updates.autoCheck'
const LAST_KEY = 'kromagit.updates.lastCheck'
const DAY = 24 * 60 * 60 * 1000

function errorText(e: unknown): string {
  const s = e instanceof Error ? e.message : String(e)
  if (/pubkey|public key|signature/i.test(s)) return 'Updates are not set up in this build yet.'
  if (/404|not found|latest\.json|release json|valid release/i.test(s)) return "No release has been published yet, so there's nothing to update to."
  if (/network|dns|connect|timed? ?out|offline/i.test(s)) return 'Could not reach GitHub. Check your internet connection.'
  return s
}

export const useUpdatesStore = defineStore('updates', () => {
  const current = __APP_VERSION__
  const status = ref<UpdateStatus>('idle')
  const latest = ref<string | null>(null)
  const notes = ref<string | null>(null)
  const progress = ref(0)
  const error = ref<string | null>(null)
  const lastChecked = ref<number | null>(Number(localStorage.getItem(LAST_KEY)) || null)
  const autoCheck = ref(localStorage.getItem(AUTO_KEY) !== '0')
  watch(autoCheck, (v) => localStorage.setItem(AUTO_KEY, v ? '1' : '0'))
  let pending: Update | null = null

  async function check(opts: { silent?: boolean } = {}): Promise<UpdateStatus> {
    if (status.value === 'checking' || status.value === 'downloading') return status.value
    const ui = useUiStore()
    status.value = 'checking'
    error.value = null
    try {
      if (!inTauri) {
        await new Promise((r) => setTimeout(r, 600))
        pending = null
      } else {
        const { check: checkForUpdate } = await import('@tauri-apps/plugin-updater')
        pending = await checkForUpdate()
      }
      lastChecked.value = Date.now()
      localStorage.setItem(LAST_KEY, String(lastChecked.value))
      if (pending) {
        latest.value = pending.version
        notes.value = pending.body?.trim() || null
        status.value = 'available'
        if (!opts.silent) void promptInstall()
      } else {
        latest.value = current
        status.value = 'upToDate'
        if (!opts.silent) ui.toast({ kind: 'success', title: 'KromaGit is up to date', detail: `You have the latest version, ${current}.` })
      }
    } catch (e) {
      error.value = errorText(e)
      const noRelease = error.value.startsWith('No release')
      status.value = noRelease ? 'upToDate' : opts.silent ? 'idle' : 'error'
      if (!opts.silent) {
        ui.toast({ kind: noRelease ? 'info' : 'error', title: noRelease ? 'No updates yet' : "Couldn't check for updates", detail: error.value })
      }
    }
    return status.value
  }

  async function promptInstall() {
    if (!pending) return
    const ui = useUiStore()
    const ok = await ui.confirm({
      title: `KromaGit ${pending.version} is available`,
      message: `You have ${current}. The update downloads in the background, then KromaGit restarts. Your open tabs come back where you left them.`,
      detail: notes.value ? notes.value.split('\n').filter(Boolean).slice(0, 12) : undefined,
      confirmLabel: 'Update and restart',
    })
    if (ok) await install()
  }

  async function install() {
    if (!pending) return
    const ui = useUiStore()
    status.value = 'downloading'
    progress.value = 0
    let total = 0
    let got = 0
    try {
      await pending.downloadAndInstall((ev) => {
        if (ev.event === 'Started') total = ev.data.contentLength ?? 0
        else if (ev.event === 'Progress') {
          got += ev.data.chunkLength
          progress.value = total ? Math.min(1, got / total) : 0
        } else if (ev.event === 'Finished') progress.value = 1
      })
      status.value = 'ready'
      const { relaunch } = await import('@tauri-apps/plugin-process')
      await relaunch()
    } catch (e) {
      status.value = 'error'
      error.value = errorText(e)
      ui.toast({ kind: 'error', title: 'Update failed', detail: error.value })
    }
  }

  /** the version button and Settings both use this: show the waiting update, or look for one */
  function checkOrInstall() {
    if (status.value === 'available') return promptInstall()
    return check()
  }

  function checkOnLaunch() {
    if (!inTauri || !autoCheck.value) return
    if (lastChecked.value && Date.now() - lastChecked.value < DAY) return
    setTimeout(() => void check({ silent: true }), 8000)
  }

  return { current, status, latest, notes, progress, error, lastChecked, autoCheck, check, checkOrInstall, install, checkOnLaunch }
})
