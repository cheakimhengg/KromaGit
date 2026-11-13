import { describe, expect, it } from 'vitest'
import { resolvePalette, resolveTheme, THEMES } from '@/lib/theme'

describe('themes', () => {
  it('maps a preference to a palette and its light/dark kind', () => {
    expect(resolvePalette('system', 'light')).toBe('light')
    expect(resolvePalette('system', 'dark')).toBe('dark')
    expect(resolvePalette('paper', 'dark')).toBe('paper')
    expect(resolveTheme('paper')).toBe('light')
    expect(resolveTheme('midnight')).toBe('dark')
    expect(resolveTheme('dim')).toBe('dark')
  })

  it('falls back to Kroma Dark for an unknown saved value', () => {
    expect(resolvePalette('neon' as never)).toBe('dark')
  })

  it('has unique ids and both kinds', () => {
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(THEMES.length)
    expect(THEMES.some((t) => t.kind === 'light') && THEMES.some((t) => t.kind === 'dark')).toBe(true)
  })
})
