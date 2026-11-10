import { describe, expect, it } from 'vitest'
import { formatCombo, isEditable, matchCombo, parseCombo } from '@/lib/shortcuts'
import { fuzzyFilter, fuzzyScore } from '@/lib/fuzzy'
import { clampZoom, resolveTheme } from '@/lib/theme'

const ev = (o: Partial<KeyboardEvent>) => ({ key: '', code: '', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...o })

describe('shortcuts', () => {
  it('parses specs including the plus key', () => {
    expect(parseCombo('Mod+Shift+K')).toEqual({ mod: true, shift: true, alt: false, ctrl: false, key: 'K' })
    expect(parseCombo('Mod+=').key).toBe('=')
    expect(parseCombo('Mod++').key).toBe('+')
  })

  it('maps Mod to ⌘ on macOS and Ctrl elsewhere', () => {
    expect(matchCombo(ev({ key: 'k', code: 'KeyK', metaKey: true }), 'Mod+K', true)).toBe(true)
    expect(matchCombo(ev({ key: 'k', code: 'KeyK', ctrlKey: true }), 'Mod+K', true)).toBe(false)
    expect(matchCombo(ev({ key: 'k', code: 'KeyK', ctrlKey: true }), 'Mod+K', false)).toBe(true)
    expect(matchCombo(ev({ key: 'k', code: 'KeyK', metaKey: true }), 'Mod+K', false)).toBe(false)
  })

  it('requires the exact modifier set and matches physical keys', () => {
    expect(matchCombo(ev({ key: 'Z', code: 'KeyZ', metaKey: true, shiftKey: true }), 'Mod+Z', true)).toBe(false)
    expect(matchCombo(ev({ key: 'Z', code: 'KeyZ', metaKey: true, shiftKey: true }), 'Mod+Shift+Z', true)).toBe(true)
    expect(matchCombo(ev({ key: '}', code: 'BracketRight', metaKey: true, shiftKey: true }), 'Mod+Shift+]', true)).toBe(true)
    expect(matchCombo(ev({ key: '+', code: 'NumpadAdd', metaKey: true }), 'Mod+=', true)).toBe(true)
    expect(matchCombo(ev({ key: 'Enter', code: 'Enter', metaKey: true }), 'Mod+Enter', true)).toBe(true)
    expect(matchCombo(ev({ key: '1', code: 'Digit1', ctrlKey: true }), 'Mod+1', false)).toBe(true)
  })

  it('formats for each platform', () => {
    expect(formatCombo('Mod+Shift+K', true)).toBe('⇧⌘K')
    expect(formatCombo('Mod+Shift+K', false)).toBe('Ctrl+Shift+K')
    expect(formatCombo('Mod+Enter', true)).toBe('⌘↵')
    expect(formatCombo('Mod+=', false)).toBe('Ctrl++')
  })

  it('knows when the user is typing', () => {
    const input = document.createElement('input')
    const box = document.createElement('input')
    box.type = 'checkbox'
    expect(isEditable(input)).toBe(true)
    expect(isEditable(box)).toBe(false)
    expect(isEditable(document.createElement('textarea'))).toBe(true)
    expect(isEditable(document.createElement('div'))).toBe(false)
  })
})

describe('fuzzy', () => {
  it('ranks substring and word-start matches first', () => {
    expect(fuzzyScore('push', 'Force push (with lease)')).toBeGreaterThan(0)
    expect(fuzzyScore('fpsh', 'Force push')).toBeGreaterThan(0)
    expect(fuzzyScore('xyz', 'Force push')).toBe(-1)
    const titles = ['Pull (rebase)', 'Push', 'Push and set upstream', 'Open in editor']
    expect(fuzzyFilter(titles, 'push', (t) => t)).toEqual(['Push', 'Push and set upstream'])
    expect(fuzzyFilter(titles, 'oie', (t) => t)[0]).toBe('Open in editor')
    expect(fuzzyFilter(titles, '', (t) => t)).toEqual(titles)
  })
})

describe('appearance', () => {
  it('resolves system theme and clamps zoom', () => {
    expect(resolveTheme('system', 'light')).toBe('light')
    expect(resolveTheme('dark', 'light')).toBe('dark')
    expect(clampZoom(500)).toBe(150)
    expect(clampZoom(10)).toBe(70)
    expect(clampZoom(104)).toBe(100)
  })
})
