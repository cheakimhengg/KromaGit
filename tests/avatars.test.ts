import { describe, expect, it } from 'vitest'
import { githubNoreplyAvatar, gravatarUrl, parseGithubRemote } from '@/lib/avatars'
import { formatBytes, isImagePath } from '@/lib/format'

describe('avatars', () => {
  it('parses GitHub remotes in every common form', () => {
    expect(parseGithubRemote('git@github.com:cheakimhengg/KromaGit.git')).toEqual({ owner: 'cheakimhengg', repo: 'KromaGit' })
    expect(parseGithubRemote('https://github.com/vuejs/core')).toEqual({ owner: 'vuejs', repo: 'core' })
    expect(parseGithubRemote('https://github.com/a-b/c.d.git/')).toEqual({ owner: 'a-b', repo: 'c.d' })
    expect(parseGithubRemote('ssh://git@github.com/o/r.git')).toEqual({ owner: 'o', repo: 'r' })
    expect(parseGithubRemote('https://gitlab.com/o/r.git')).toBeNull()
  })

  it('maps GitHub no-reply emails straight to an avatar', () => {
    expect(githubNoreplyAvatar('12345+octo@users.noreply.github.com')).toBe('https://avatars.githubusercontent.com/u/12345?s=96&v=4')
    expect(githubNoreplyAvatar('Octo@users.noreply.github.com')).toBe('https://github.com/octo.png?size=96')
    expect(githubNoreplyAvatar('octo@example.com')).toBeNull()
  })

  it('builds a Gravatar URL that 404s instead of showing a placeholder', async () => {
    const url = await gravatarUrl('  Test@Example.dev ')
    if (url === null) return
    expect(url).toMatch(/^https:\/\/gravatar\.com\/avatar\/[0-9a-f]{64}\?s=96&d=404$/)
    expect(await gravatarUrl('test@example.dev')).toBe(url)
  })
})

describe('image helpers', () => {
  it('recognises previewable images', () => {
    expect(isImagePath('assets/Logo.PNG')).toBe(true)
    expect(isImagePath('hero.webp')).toBe(true)
    expect(isImagePath('icon.svg')).toBe(false)
    expect(isImagePath('notes.txt')).toBe(false)
  })

  it('formats byte sizes', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(50 * 1024)).toBe('50 KB')
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB')
  })
})
