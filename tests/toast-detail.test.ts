import { describe, expect, it } from 'vitest'
import { lastLine, reviewLink } from '@/stores/ops'

const gitlabPush = [
  'remote: ',
  'remote: To create a merge request for feature/x, visit:',
  'remote:   https://gitlab.example/group/app/-/merge_requests/new?merge_request%5Bsource_branch%5D=feature%2Fx',
  'remote: ',
  'To https://gitlab.example/group/app.git',
  ' * [new branch]      feature/x -> feature/x',
  "branch 'feature/x' set up to track 'origin/feature/x'.",
].join('\n')

const githubPush = [
  'remote: ',
  "remote: Create a pull request for 'feature/x' on GitHub by visiting:",
  'remote:      https://github.example/org/app/pull/new/feature/x',
  'remote: ',
  'To https://github.example/org/app.git',
  '   1a2b3c4..5d6e7f8  feature/x -> feature/x',
].join('\n')

describe('success toast detail', () => {
  it('hides server banners, ref updates and tracking notes', () => {
    expect(lastLine(gitlabPush)).toBeUndefined()
    expect(lastLine(githubPush)).toBeUndefined()
    expect(lastLine('To https://gitlab.example/a.git\n   1a2b..3c4d  main -> main')).toBeUndefined()
  })

  it('keeps meaningful lines and rewords git jargon', () => {
    expect(lastLine('Everything up-to-date')).toBe('The remote already had these commits.')
    expect(lastLine('Updating 1a2b..3c4d\nFast-forward\n 2 files changed, 3 insertions(+)')).toBe('2 files changed, 3 insertions(+)')
    expect(lastLine('Your uncommitted changes came along.')).toBe('Your uncommitted changes came along.')
  })

  it('finds the merge or pull request link a server prints after a push', () => {
    expect(reviewLink(gitlabPush)).toEqual({
      label: 'Create merge request',
      url: 'https://gitlab.example/group/app/-/merge_requests/new?merge_request%5Bsource_branch%5D=feature%2Fx',
    })
    expect(reviewLink(githubPush)).toEqual({ label: 'Create pull request', url: 'https://github.example/org/app/pull/new/feature/x' })
    expect(reviewLink('To https://gitlab.example/a.git\n   1a2b..3c4d  main -> main')).toBeNull()
  })
})

describe('other actions', () => {
  it('hides stash, rebase and reset bookkeeping lines', () => {
    expect(lastLine('Dropped refs/stash@{0} (1a2b3c4d)')).toBeUndefined()
    expect(lastLine('Saved working directory and index state WIP on main: 1a2b c')).toBeUndefined()
    expect(lastLine('Successfully rebased and updated refs/heads/feature/x.')).toBeUndefined()
    expect(lastLine('HEAD is now at 1a2b3c4 message')).toBeUndefined()
    expect(lastLine('[main 1a2b3c4] fix thing\n Date: Thu Nov 26 10:00 2026\n 1 file changed, 2 insertions(+)')).toBe('1 file changed, 2 insertions(+)')
  })
})
