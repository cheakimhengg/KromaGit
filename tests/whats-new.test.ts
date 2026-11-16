import { describe, expect, it } from 'vitest'
import { whatsNew } from '@/stores/updates'

describe('whatsNew', () => {
  it('keeps only the bullets under "What\'s new", without markdown', () => {
    const body = "## What's new\n\n- **Faster** graph for `big` repos\n- See [docs](https://x.y)\n\n## Install\n\n- **macOS**: `.dmg`\n"
    expect(whatsNew(body)).toEqual(['Faster graph for big repos', 'See docs'])
  })

  it('returns nothing when the notes have no "What\'s new" section', () => {
    expect(whatsNew('Download the installer for your platform below.\n- **macOS**: `.dmg`')).toEqual([])
    expect(whatsNew(null)).toEqual([])
  })
})
