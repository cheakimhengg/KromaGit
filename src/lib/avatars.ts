/**
 * Author profile pictures. Resolution order per email:
 *   1. GitHub no-reply addresses map straight to the GitHub avatar (no request)
 *   2. repos hosted on GitHub: ask GitHub which account made one of their commits
 *   3. Gravatar (sha256 of the email); a 404 falls back to initials
 * Results (including "no picture") are cached on disk so each person is looked
 * up rarely. Everything is skipped when the setting is off.
 */
import { reactive, ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'

const STORE_KEY = 'kromagit.avatars.v1'
const HIT_TTL = 7 * 86_400_000
const MISS_TTL = 86_400_000
const CONCURRENCY = 3

interface Entry {
  url: string | null
  t: number
}

const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

/** email (lower-case) → url, or null for "use initials". Missing = not resolved yet. */
const cache = reactive(new Map<string, string | null>())
const persisted: Record<string, Entry> = readStore()
for (const [k, e] of Object.entries(persisted)) {
  if (Date.now() - e.t < (e.url ? HIT_TTL : MISS_TTL)) cache.set(k, e.url)
}

const enabled = ref(true)
let github: { owner: string; repo: string } | null = null
let shaByEmail = new Map<string, string>()
let githubBudget = 60
let githubBlocked = false
const queue: string[] = []
const queued = new Set<string>()
let active = 0

function readStore(): Record<string, Entry> {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as Record<string, Entry>
  } catch {
    return {}
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
function remember(key: string, url: string | null) {
  cache.set(key, url)
  persisted[key] = { url, t: Date.now() }
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(persisted))
    } catch {
      /* storage full: cache stays in memory */
    }
  }, 500)
}

export function setAvatarsEnabled(on: boolean) {
  enabled.value = on
}

/** `owner/repo` of a GitHub remote URL (ssh or https), or null. */
export function parseGithubRemote(url: string): { owner: string; repo: string } | null {
  const m = url.trim().match(/github\.com[:/]+([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i)
  return m ? { owner: m[1], repo: m[2] } : null
}

/** Direct avatar URL for GitHub's private relay addresses. */
export function githubNoreplyAvatar(email: string): string | null {
  const m = email.toLowerCase().match(/^(?:(\d+)\+)?([a-z0-9-]+)@users\.noreply\.github\.com$/)
  if (!m) return null
  return m[1] ? `https://avatars.githubusercontent.com/u/${m[1]}?s=96&v=4` : `https://github.com/${m[2]}.png?size=96`
}

export async function gravatarUrl(email: string): Promise<string | null> {
  if (typeof crypto === 'undefined' || !crypto.subtle) return null
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email.trim().toLowerCase()))
  const hex = [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `https://gravatar.com/avatar/${hex}?s=96&d=404`
}

/** Called when the active repository's commits change; gives GitHub lookups their context. */
export function setAvatarContext(remoteUrls: string[], commits: { hash: string; author: { email: string } }[]) {
  github = remoteUrls.map(parseGithubRemote).find(Boolean) ?? null
  const map = new Map<string, string>()
  for (const c of commits) {
    const k = c.author.email.toLowerCase()
    if (!map.has(k)) map.set(k, c.hash)
  }
  shaByEmail = map
}

/** Reactive: returns the picture URL once known, null meanwhile or when there is none. */
export function avatarUrl(email: string | undefined | null): string | null {
  if (!enabled.value || !email) return null
  const key = email.trim().toLowerCase()
  if (cache.has(key)) return cache.get(key) ?? null
  if (!queued.has(key)) {
    queued.add(key)
    queue.push(key)
    pump()
  }
  return null
}

/** An image failed to load (e.g. Gravatar 404): remember to use initials. */
export function markAvatarFailed(email: string | undefined | null) {
  if (email) remember(email.trim().toLowerCase(), null)
}

function pump() {
  while (active < CONCURRENCY && queue.length) {
    const key = queue.shift()!
    active++
    resolve(key)
      .then((url) => remember(key, url))
      .catch(() => cache.set(key, null))
      .finally(() => {
        active--
        queued.delete(key)
        pump()
      })
  }
}

async function resolve(key: string): Promise<string | null> {
  const direct = githubNoreplyAvatar(key)
  if (direct) return direct
  const sha = shaByEmail.get(key)
  if (github && sha && isTauri() && !githubBlocked && githubBudget > 0) {
    githubBudget--
    try {
      const url = await invoke<string | null>('github_commit_avatar', { owner: github.owner, repo: github.repo, sha })
      if (url) return url.includes('?') ? `${url}&s=96` : `${url}?s=96`
    } catch {
      githubBlocked = true
    }
  }
  return gravatarUrl(key)
}

/** test helper */
export function _resetAvatars() {
  cache.clear()
  queue.length = 0
  queued.clear()
  githubBudget = 60
  githubBlocked = false
  enabled.value = true
}
