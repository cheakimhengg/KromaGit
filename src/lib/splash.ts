/** The startup animation lives in index.html so it shows before any JavaScript loads. */
const MIN_MS = 1150

let hidden = false

export function hideSplash() {
  if (hidden) return
  hidden = true
  const el = document.getElementById('kg-splash')
  if (!el) return
  const wait = Math.max(0, MIN_MS - performance.now())
  setTimeout(() => {
    el.classList.add('kg-done')
    setTimeout(() => el.remove(), 400)
  }, wait)
}

/** Remember the theme's background so the next launch's splash matches it. */
export function rememberSplashTheme(kind: 'light' | 'dark') {
  try {
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--gw-bg').trim()
    if (bg) localStorage.setItem('kromagit.splash.bg', bg)
    localStorage.setItem('kromagit.splash.kind', kind)
  } catch {
    /* storage unavailable */
  }
}
