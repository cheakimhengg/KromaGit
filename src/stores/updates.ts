import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import type { Update } from '@tauri-apps/plugin-updater'
import { inTauri } from '@/api/git'
import { useUiStore } from '@/stores/ui'

export type UpdateStatus = 'idle' | 'checking' | 'upToDate' | 'available' | 'downloading' | 'ready' | 'error'

const AUTO_KEY = 'kromagit.updates.autoCheck'
const SEEN_KEY = 'kromagit.updates.lastSeenVersion'
const RELEASES = 'https://api.github.com/repos/cheakimhengg/KromaGit/releases'
const LAST_KEY = 'kromagit.updates.lastCheck'
const DAY = 24 * 60 * 60 * 1000

/** Only the "What's new" part of the release notes, as plain bullet lines (install help is for the website, not the app). */
export function whatsNew(body: string | null | undefined): string[] {
  if (!body) return []
  const lines = body.replace(/\r/g, '').split('\n')
  const start = lines.findIndex((l) => /^#{1,6}\s*what'?s new/i.test(l.trim()))
  if (start === -1) return []
  const out: string[] = []
  for (const raw of lines.slice(start + 1)) {
    const l = raw.trim()
    if (/^#{1,6}\s/.test(l)) break
    const m = l.match(/^[-*+]\s+(.*)$/)
    if (!m) continue
    out.push(m[1].replace(/\*\*|__|`/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').trim())
  }
  return out.filter(Boolean).slice(0, 10)
}

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
  const whatsNewOpen = ref(false)
  const whatsNewVersion = ref(current)
  const whatsNewItems = ref<string[]>([])
  const whatsNewStatus = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
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
      title: `Update to KromaGit ${pending.version}?`,
      message: `You have ${current}. KromaGit downloads the update and restarts, with your tabs right where you left them.`,
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

  /** Opens the "What's new" window for a version (the one running, by default) and loads its release notes. */
  async function showWhatsNew(version = current) {
    whatsNewVersion.value = version
    whatsNewOpen.value = true
    whatsNewStatus.value = 'loading'
    try {
      const res = await fetch(`${RELEASES}/tags/v${version}`, { headers: { Accept: 'application/vnd.github+json' } })
      if (!res.ok) throw new Error(String(res.status))
      const rel = (await res.json()) as { body?: string }
      whatsNewItems.value = whatsNew(rel.body)
      whatsNewStatus.value = 'ready'
    } catch {
      whatsNewItems.value = []
      whatsNewStatus.value = 'error'
    }
  }

  /** After an update, offer "What's new" once. */
  function announceUpdate() {
    const seen = localStorage.getItem(SEEN_KEY)
    localStorage.setItem(SEEN_KEY, current)
    if (!seen || seen === current) return
    useUiStore().toast(
      { kind: 'success', title: `Updated to KromaGit ${current}`, action: { label: "See what's new", run: () => void showWhatsNew() } },
      12000,
    )
  }

  function checkOnLaunch() {
    if (inTauri) announceUpdate()
    if (!inTauri || !autoCheck.value) return
    if (lastChecked.value && Date.now() - lastChecked.value < DAY) return
    setTimeout(() => void check({ silent: true }), 8000)
  }

  return { current, status, latest, progress, error, lastChecked, autoCheck, check, checkOrInstall, install, checkOnLaunch, showWhatsNew, whatsNewOpen, whatsNewVersion, whatsNewItems, whatsNewStatus }
})
