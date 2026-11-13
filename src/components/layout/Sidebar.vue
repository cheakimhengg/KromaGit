<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  Archive, ArchiveRestore, Boxes, Check, Cloud, Copy, FolderTree, GitBranch, GitBranchPlus, GitMerge, GitPullRequestArrow, Globe,
  ChevronsDownUp, ChevronsUpDown, Pencil, Search, Tag as TagIcon, Trash2, ArrowUpFromLine, CircleDot,
} from 'lucide-vue-next'
import SidebarSection from './SidebarSection.vue'
import RefTree from './RefTree.vue'
import { buildRefTree, matchesFilter } from '@/lib/ref-tree'
import { relativeTime } from '@/lib/format'
import { useReposStore } from '@/stores/repos'
import { useUiStore, type MenuItem } from '@/stores/ui'
import type { Branch, Stash, Tag } from '@/types/git'
import * as git from '@/actions/git'

const repos = useReposStore()
const ui = useUiStore()
const filter = ref('')
const snapshot = computed(() => repos.active?.snapshot ?? null)
const filtering = computed(() => filter.value.trim() !== '')

const localBranches = computed(() => (snapshot.value?.branches ?? []).filter((b) => matchesFilter(b.name, filter.value)))
const branchTree = computed(() => buildRefTree(localBranches.value, (b) => b.name))

const remotes = computed(() =>
  (snapshot.value?.remotes ?? []).map((r) => {
    const names = r.branches.filter((b) => matchesFilter(`${r.name}/${b}`, filter.value))
    return { remote: r, count: names.length, tree: buildRefTree(names, (n) => n) }
  }),
)
const remoteCount = computed(() => remotes.value.reduce((n, r) => n + r.count, 0))
const tags = computed(() => (snapshot.value?.tags ?? []).filter((t) => matchesFilter(t.name, filter.value)))
const stashes = computed(() => (snapshot.value?.stashes ?? []).filter((s) => matchesFilter(s.message, filter.value)))
const worktrees = computed(() => (snapshot.value?.worktrees ?? []).filter((w) => matchesFilter(`${w.path} ${w.branch}`, filter.value)))
const submodules = computed(() => (snapshot.value?.submodules ?? []).filter((s) => matchesFilter(s.path, filter.value)))

function branchMenu(e: MouseEvent, b: Branch) {
  const current = snapshot.value?.currentBranch ?? 'HEAD'
  const items: MenuItem[] = []
  if (!b.current) {
    items.push(
      { label: `Checkout ${b.name}`, icon: Check, action: () => git.checkout(b.name) },
      { separator: true },
      { label: `Merge ${b.name} into ${current}`, icon: GitMerge, action: () => git.merge(b.name) },
      { label: `Rebase ${current} onto ${b.name}`, icon: GitPullRequestArrow, action: () => git.rebase(b.name) },
      { separator: true },
    )
  }
  items.push(
    { label: 'New branch from here…', icon: GitBranchPlus, action: () => git.createBranch({ ref: b.name, label: b.name }) },
    { label: 'Rename…', icon: Pencil, action: () => git.renameBranch(b.name) },
    { label: b.upstream ? 'Push' : 'Push and set upstream', icon: ArrowUpFromLine, action: () => git.pushBranch(b) },
    { label: 'Copy name', icon: Copy, action: () => git.copyText(b.name) },
  )
  if (!b.current) items.push({ separator: true }, { label: `Delete ${b.name}…`, icon: Trash2, danger: true, action: () => git.deleteBranch(b.name) })
  ui.openMenu(e, items)
}

function remoteMenu(e: MouseEvent, remote: string, branch: string) {
  const full = `${remote}/${branch}`
  const current = snapshot.value?.currentBranch ?? 'HEAD'
  ui.openMenu(e, [
    { label: `Checkout ${branch} (tracking ${full})`, icon: Check, action: () => git.checkoutRemote(full, remote) },
    { separator: true },
    { label: `Merge ${full} into ${current}`, icon: GitMerge, action: () => git.merge(full) },
    { label: `Rebase ${current} onto ${full}`, icon: GitPullRequestArrow, action: () => git.rebase(full) },
    { separator: true },
    { label: 'Copy name', icon: Copy, action: () => git.copyText(full) },
    { separator: true },
    { label: `Delete ${full} on remote…`, icon: Trash2, danger: true, action: () => git.deleteRemoteBranch(remote, branch) },
  ])
}

function tagMenu(e: MouseEvent, t: Tag) {
  ui.openMenu(e, [
    { label: `Checkout ${t.name}`, icon: Check, action: () => git.checkoutCommit(t.hash) },
    { label: 'New branch from tag…', icon: GitBranchPlus, action: () => git.createBranch({ ref: t.name, label: t.name }) },
    { label: 'Copy name', icon: Copy, action: () => git.copyText(t.name) },
    { separator: true },
    { label: `Delete ${t.name}…`, icon: Trash2, danger: true, action: () => git.deleteTag(t.name) },
  ])
}

function stashMenu(e: MouseEvent, s: Stash) {
  ui.openMenu(e, [
    { label: 'Pop (apply and remove)', icon: ArchiveRestore, action: () => git.stashPop(s.index) },
    { label: 'Apply (keep stash)', icon: Archive, action: () => git.stashApply(s.index) },
    { separator: true },
    { label: 'Drop…', icon: Trash2, danger: true, action: () => git.stashDrop(s.index, s.message) },
  ])
}

const SECTIONS: [string, boolean][] = [
  ['Branches', true], ['Remotes', true], ['Tags', false], ['Stashes', true], ['Worktrees', false], ['Submodules', false],
]
const anySectionOpen = computed(() => SECTIONS.some(([t, d]) => ui.sidebarSections[t] ?? d))
function toggleAllSections() {
  const open = !anySectionOpen.value
  for (const [t] of SECTIONS) ui.sidebarSections[t] = open
}
</script>

<template>
  <aside class="flex h-full flex-col border-r border-line bg-surface">
    <div class="flex items-center gap-1 p-2">
      <div class="relative flex-1">
        <Search :size="14" class="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-faint" />
        <input v-model="filter" class="gw-input pl-6" placeholder="Filter refs…" spellcheck="false" />
      </div>
      <button
        type="button" class="rounded p-1.5 text-faint hover:bg-hover hover:text-fg"
        :title="anySectionOpen ? 'Collapse all sections' : 'Expand all sections'"
        @click="toggleAllSections"
      >
        <component :is="anySectionOpen ? ChevronsDownUp : ChevronsUpDown" :size="16" />
      </button>
    </div>

    <div v-if="snapshot" class="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
      <SidebarSection title="Branches" :icon="GitBranch" :count="localBranches.length">
        <RefTree
          :nodes="branchTree"
          :force-open="filtering"
          @select="(b: Branch) => !b.current && git.checkout(b.name)"
          @menu="(e: MouseEvent, b: Branch) => branchMenu(e, b)"
        >
          <template #leaf="{ item, label }">
            <CircleDot v-if="item.current" :size="14" class="shrink-0 text-accent" />
            <GitBranch v-else :size="14" class="shrink-0 text-faint" />
            <span class="flex-1 truncate" :class="item.current ? 'font-semibold text-fg' : 'text-fg/85'">{{ label }}</span>
            <span v-if="item.upstreamGone" class="rounded bg-danger/15 px-1 text-[10px] text-danger" title="Upstream branch was deleted">gone</span>
            <span v-if="item.ahead" class="font-mono text-[11px] text-success" :title="`${item.ahead} ahead of ${item.upstream ?? 'upstream'}`">↑{{ item.ahead }}</span>
            <span v-if="item.behind" class="font-mono text-[11px] text-warning" :title="`${item.behind} behind ${item.upstream ?? 'upstream'}`">↓{{ item.behind }}</span>
          </template>
        </RefTree>
      </SidebarSection>

      <SidebarSection title="Remotes" :icon="Cloud" :count="remoteCount">
        <div v-for="r in remotes" :key="r.remote.name">
          <div class="flex h-7 shrink-0 items-center whitespace-nowrap gap-1.5 px-2 text-[13px] text-muted" :title="r.remote.url">
            <Globe :size="14" class="text-faint" /><span class="flex-1 truncate">{{ r.remote.name }}</span>
          </div>
          <RefTree
            :nodes="r.tree"
            :base-depth="1"
            :force-open="filtering"
            @select="(n: string) => git.checkoutRemote(`${r.remote.name}/${n}`, r.remote.name)"
            @menu="(e: MouseEvent, n: string) => remoteMenu(e, r.remote.name, n)"
          >
            <template #leaf="{ label }">
              <GitBranch :size="14" class="shrink-0 text-faint" /><span class="truncate text-fg/85">{{ label }}</span>
            </template>
          </RefTree>
        </div>
      </SidebarSection>

      <SidebarSection title="Tags" :icon="TagIcon" :count="tags.length" :default-open="false">
        <div
          v-for="t in tags" :key="t.name"
          class="flex h-7 shrink-0 items-center whitespace-nowrap gap-1.5 rounded pr-2 pl-5 text-[13px] hover:bg-hover"
          @contextmenu="tagMenu($event, t)"
          @dblclick="git.checkoutCommit(t.hash)"
        >
          <TagIcon :size="14" class="shrink-0 text-faint" /><span class="flex-1 truncate text-fg/85">{{ t.name }}</span>
          <span class="font-mono text-[11px] text-faint">{{ t.hash.slice(0, 7) }}</span>
        </div>
      </SidebarSection>

      <SidebarSection title="Stashes" :icon="Archive" :count="stashes.length">
        <div v-for="s in stashes" :key="s.index" class="flex h-7 cursor-pointer items-center gap-1.5 rounded pr-2 pl-5 text-[13px] hover:bg-hover" :title="`${s.message} — right-click for actions`" @contextmenu="stashMenu($event, s)">
          <Archive :size="14" class="shrink-0 text-faint" />
          <span class="flex-1 truncate text-fg/85">{{ s.message }}</span>
          <span class="shrink-0 text-[11px] text-faint">{{ relativeTime(s.date) }}</span>
        </div>
      </SidebarSection>

      <SidebarSection title="Worktrees" :icon="FolderTree" :count="worktrees.length" :default-open="false">
        <div v-for="w in worktrees" :key="w.path" class="flex h-7 shrink-0 items-center whitespace-nowrap gap-1.5 rounded pr-2 pl-5 text-[13px] hover:bg-hover" :title="w.path">
          <FolderTree :size="14" class="shrink-0 text-faint" />
          <span class="flex-1 truncate text-fg/85">{{ w.path.split('/').pop() }}</span>
          <span class="truncate text-[11px] text-faint">{{ w.branch }}</span>
        </div>
      </SidebarSection>

      <SidebarSection title="Submodules" :icon="Boxes" :count="submodules.length" :default-open="false">
        <div v-for="s in submodules" :key="s.path" class="flex h-7 shrink-0 items-center whitespace-nowrap gap-1.5 rounded pr-2 pl-5 text-[13px] hover:bg-hover">
          <Boxes :size="14" class="shrink-0 text-faint" />
          <span class="flex-1 truncate text-fg/85">{{ s.path }}</span>
          <span v-if="s.status === 'modified'" class="h-1.5 w-1.5 rounded-full bg-warning" title="Modified" />
        </div>
      </SidebarSection>
    </div>
  </aside>
</template>
