<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { Terminal as XTerm, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { Plus, Terminal as TerminalIcon, X } from '@/lib/icons'
import { inTauri } from '@/api/git'
import { useReposStore } from '@/stores/repos'
import { useUiStore } from '@/stores/ui'
import { resolvedTheme } from '@/lib/theme'

const repos = useReposStore()
const ui = useUiStore()

interface Session {
  key: number
  ptyId: number | null
  repoTabId: string
  title: string
  exited: boolean
  term: XTerm
  fit: FitAddon
  el: HTMLElement | null
}

const sessions = reactive<Session[]>([])
const activeKey = ref<number | null>(null)
let nextKey = 1
const byPty = new Map<number, Session>()

const repoSessions = computed(() => sessions.filter((s) => s.repoTabId === repos.activeTabId))
const active = computed(() => repoSessions.value.find((s) => s.key === activeKey.value) ?? repoSessions.value[0] ?? null)

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}
function theme(): ITheme {
  const light = resolvedTheme.value === 'light'
  return {
    background: cssVar('--gw-bg'),
    foreground: cssVar('--gw-text'),
    cursor: cssVar('--gw-accent'),
    cursorAccent: cssVar('--gw-bg'),
    selectionBackground: light ? '#3a5fd933' : '#7c9cff44',
    black: light ? '#1b202b' : '#2e3440',
    brightBlack: light ? '#6b7385' : '#5c6370',
    red: light ? '#c8304a' : '#f2626f',
    brightRed: light ? '#d9425b' : '#ff7a85',
    green: light ? '#17924f' : '#3fcf8e',
    brightGreen: light ? '#1fa85d' : '#5fe3a4',
    yellow: light ? '#a8690f' : '#f5b843',
    brightYellow: light ? '#c27a12' : '#ffcd66',
    blue: light ? '#3a5fd9' : '#7c9cff',
    brightBlue: light ? '#4d70e6' : '#9db5ff',
    magenta: light ? '#8240e0' : '#b47cff',
    brightMagenta: light ? '#9455ef' : '#c99bff',
    cyan: light ? '#0c8a80' : '#5eead4',
    brightCyan: light ? '#0fa093' : '#86f2e2',
    white: light ? '#d0d5de' : '#c9ccd4',
    brightWhite: light ? '#f5f6f8' : '#ffffff',
  }
}

async function invoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(cmd, args)
}

function decode(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function newSession() {
  const tab = repos.activeTab
  if (!tab) return
  const term = new XTerm({
    fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
    fontSize: 13,
    lineHeight: 1.25,
    cursorBlink: true,
    allowProposedApi: true,
    scrollback: 5000,
    theme: theme(),
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  term.loadAddon(new WebLinksAddon())
  term.attachCustomKeyEventHandler((e) => !(e.ctrlKey && e.code === 'Backquote') && !(e.metaKey && ['KeyK', 'KeyP', 'KeyW', 'KeyO', 'Comma'].includes(e.code)))
  const s = reactive<Session>({ key: nextKey++, ptyId: null, repoTabId: tab.id, title: tab.name, exited: false, term, fit, el: null }) as Session
  sessions.push(s)
  activeKey.value = s.key
  await nextTick()
  if (!s.el) return
  term.open(s.el)
  fit.fit()
  term.focus()
  if (!inTauri) {
    term.write('\x1b[2mThe built-in terminal runs in the desktop app (pnpm tauri dev).\x1b[0m\r\n')
    return
  }
  try {
    s.ptyId = await invoke<number>('terminal_open', { cwd: tab.path, cols: term.cols, rows: term.rows })
    byPty.set(s.ptyId, s)
    term.onData((data) => s.ptyId !== null && !s.exited && void invoke('terminal_write', { id: s.ptyId, data }).catch(() => {}))
    term.onResize(({ cols, rows }) => s.ptyId !== null && !s.exited && void invoke('terminal_resize', { id: s.ptyId, cols, rows }).catch(() => {}))
  } catch (e) {
    term.write(`\x1b[31mCould not start a shell: ${e instanceof Error ? e.message : JSON.stringify(e)}\x1b[0m\r\n`)
    s.exited = true
  }
}

function closeSession(s: Session) {
  if (s.ptyId !== null) {
    byPty.delete(s.ptyId)
    if (!s.exited) void invoke('terminal_close', { id: s.ptyId }).catch(() => {})
  }
  s.term.dispose()
  const i = sessions.indexOf(s)
  if (i >= 0) sessions.splice(i, 1)
  if (!repoSessions.value.length) ui.terminalOpen = false
}

function setEl(s: Session, el: unknown) {
  if (el instanceof HTMLElement) s.el = el
}

const fitActive = () => {
  const s = active.value
  if (s?.el && s.el.offsetParent) {
    try {
      s.fit.fit()
    } catch {
      /* not laid out yet */
    }
  }
}

let unlisten: Array<() => void> = []
const resizeObs = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => fitActive()) : null
const body = ref<HTMLElement | null>(null)

onMounted(async () => {
  if (body.value) resizeObs?.observe(body.value)
  if (!inTauri) return
  const { listen } = await import('@tauri-apps/api/event')
  unlisten.push(
    await listen<{ id: number; data: string }>('terminal://data', (e) => byPty.get(e.payload.id)?.term.write(decode(e.payload.data))),
    await listen<{ id: number }>('terminal://exit', (e) => {
      const s = byPty.get(e.payload.id)
      if (!s || s.exited) return
      s.exited = true
      s.term.write('\r\n\x1b[2m[process exited — press + for a new terminal]\x1b[0m\r\n')
    }),
  )
})
onBeforeUnmount(() => {
  unlisten.forEach((u) => u())
  resizeObs?.disconnect()
  for (const s of [...sessions]) closeSession(s)
})

watch(
  () => [ui.terminalOpen, repos.activeTabId] as const,
  async ([open]) => {
    if (!open) return
    if (!repoSessions.value.length) await newSession()
    await nextTick()
    fitActive()
    active.value?.term.focus()
  },
  { immediate: true },
)
watch(activeKey, async () => {
  await nextTick()
  fitActive()
  active.value?.term.focus()
})
watch(
  () => repos.tabs.map((t) => t.id),
  (ids) => [...sessions].filter((s) => !ids.includes(s.repoTabId)).forEach(closeSession),
)
watch(resolvedTheme, () => sessions.forEach((s) => (s.term.options.theme = theme())))
watch(() => ui.terminalHeight, () => nextTick(fitActive))

let startY = 0
let startH = 0
function startResize(e: PointerEvent) {
  startY = e.clientY
  startH = ui.terminalHeight
  const move = (ev: PointerEvent) => (ui.terminalHeight = Math.round(Math.min(Math.max(startH + startY - ev.clientY, 120), window.innerHeight * 0.75)))
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    document.body.style.cursor = ''
  }
  document.body.style.cursor = 'row-resize'
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}
</script>

<template>
  <section v-show="ui.terminalOpen" class="relative flex shrink-0 flex-col border-t border-line bg-bg" :style="{ height: `${ui.terminalHeight}px` }">
    <div class="absolute inset-x-0 -top-[3px] z-10 h-[6px] cursor-row-resize hover:bg-accent/40" title="Drag to resize" @pointerdown.prevent="startResize" @dblclick="ui.terminalHeight = 280" />
    <div class="flex h-9 shrink-0 items-center gap-1 border-b border-line px-2">
      <TerminalIcon :size="15" class="mx-1 text-muted" />
      <button
        v-for="(s, i) in repoSessions" :key="s.key" type="button"
        class="group flex h-7 items-center gap-1.5 rounded-md pr-1 pl-2.5 text-[12px]"
        :class="s.key === active?.key ? 'bg-surface-2 text-fg' : 'text-muted hover:bg-hover hover:text-fg'"
        @click="activeKey = s.key"
      >
        <span :class="{ 'line-through opacity-60': s.exited }">{{ s.title }}{{ repoSessions.length > 1 ? ` ${i + 1}` : '' }}</span>
        <span class="flex h-5 w-5 items-center justify-center rounded opacity-0 group-hover:opacity-100 hover:bg-surface-3" title="Close terminal" @click.stop="closeSession(s)"><X :size="12" /></span>
      </button>
      <button type="button" class="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg" title="New terminal" @click="newSession"><Plus :size="15" /></button>
      <div class="flex-1" />
      <span class="mr-1 text-[11px] text-faint">⌃`</span>
      <button type="button" class="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-fg" title="Hide terminal (⌃`)" @click="ui.terminalOpen = false"><X :size="15" /></button>
    </div>
    <div ref="body" class="relative min-h-0 flex-1">
      <div
        v-for="s in sessions" v-show="s.key === active?.key" :key="s.key"
        :ref="(el) => setEl(s, el)"
        class="absolute inset-0 py-1.5 pl-3"
      />
    </div>
  </section>
</template>

<style scoped>
:deep(.xterm) {
  height: 100%;
}
:deep(.xterm-viewport) {
  background-color: transparent !important;
}
</style>
