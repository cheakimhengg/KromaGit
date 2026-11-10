/**
 * Keyboard shortcuts written as "Mod+Shift+K". "Mod" is ⌘ on macOS and Ctrl
 * elsewhere. Letters, digits and punctuation match on the physical key
 * (KeyboardEvent.code) so Shift or keyboard layouts don't break them.
 */

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent)

export interface Combo {
  mod: boolean
  shift: boolean
  alt: boolean
  ctrl: boolean
  key: string
}

export function parseCombo(spec: string): Combo {
  const parts = spec.split('+')
  // "Mod+=" / "Mod++" style: a trailing empty part means the key itself was "+"
  let key = parts.pop() || '+'
  if (key === '' && parts.length) key = '+'
  const mods = new Set(parts.map((p) => p.toLowerCase()))
  return { mod: mods.has('mod'), shift: mods.has('shift'), alt: mods.has('alt'), ctrl: mods.has('ctrl'), key }
}

const CODE_FOR: Record<string, string> = {
  '[': 'BracketLeft', ']': 'BracketRight', '=': 'Equal', '+': 'Equal', '-': 'Minus', ',': 'Comma', '.': 'Period', '/': 'Slash', '`': 'Backquote',
}

function codeFor(key: string): string | null {
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`
  if (/^[0-9]$/.test(key)) return `Digit${key}`
  return CODE_FOR[key] ?? null
}

export function matchCombo(e: Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>, spec: string, mac = isMac): boolean {
  const c = parseCombo(spec)
  const wantMeta = mac && c.mod
  const wantCtrl = mac ? c.ctrl : c.mod || c.ctrl
  if (e.metaKey !== wantMeta || e.ctrlKey !== wantCtrl || e.shiftKey !== c.shift || e.altKey !== c.alt) return false
  const code = codeFor(c.key)
  if (code) return e.code === code || (c.key === '+' && e.key === '+') || (c.key === '=' && e.key === '+')
  return e.key.toLowerCase() === c.key.toLowerCase()
}

const MAC_SYMBOLS: Record<string, string> = { mod: '⌘', shift: '⇧', alt: '⌥', ctrl: '⌃' }
const KEY_LABELS: Record<string, string> = { Enter: '↵', Escape: 'Esc', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Tab: 'Tab', '=': '+' }

export function formatCombo(spec: string, mac = isMac): string {
  const c = parseCombo(spec)
  const key = KEY_LABELS[c.key] ?? (c.key.length === 1 ? c.key.toUpperCase() : c.key)
  if (mac) {
    return `${c.ctrl ? MAC_SYMBOLS.ctrl : ''}${c.alt ? MAC_SYMBOLS.alt : ''}${c.shift ? MAC_SYMBOLS.shift : ''}${c.mod ? MAC_SYMBOLS.mod : ''}${key}`
  }
  return [c.mod || c.ctrl ? 'Ctrl' : '', c.alt ? 'Alt' : '', c.shift ? 'Shift' : '', key].filter(Boolean).join('+')
}

export function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag === 'INPUT') {
    const type = (target as HTMLInputElement).type
    return !['checkbox', 'radio', 'button', 'submit', 'range'].includes(type)
  }
  return false
}
