<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  Archive, Boxes, Check, Cloud, Copy, FolderTree, GitBranch, GitMerge, GitPullRequestArrow, Globe,
  PanelLeftClose, Pencil, Search, Tag as TagIcon, Trash2, ArrowUpFromLine, CircleDot,
} from 'lucide-vue-next'
import SidebarSection from './SidebarSection.vue'
import RefTree from './RefTree.vue'
import { buildRefTree, matchesFilter } from '@/lib/ref-tree'
import { relativeTime } from '@/lib/format'
import { useReposStore } from '@/stores/repos'
import { useUiStore, type MenuItem } from '@/stores/ui'
import type { Branch } from '@/types/git'

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

function copy(text: string) {
  void navigator.clipboard?.writeText(text)
  ui.toast({ kind: 'success', title: 'Copied', detail: text }, 1800)
}

function refMenu(e: MouseEvent, name: string, opts: { remote?: boolean; current?: boolean } = {}) {
  const current = snapshot.value?.currentBranch ?? ''
  const items: MenuItem[] = [
    { label: `Checkout ${name}`, icon: Check, action: () => ui.notWired(`Checkout ${name}`) },
    { separator: true },
    { label: `Merge ${name} into ${current}`, icon: GitMerge, action: () => ui.notWired('Merge') },
    { label: `Rebase ${current} onto ${name}`, icon: GitPullRequestArrow, action: () => ui.notWired('Rebase') },
    { separator: true },
  ]
  if (!opts.remote) {
    items.push(
      { label: 'Rename…', icon: Pencil, action: () => ui.notWired('Rename branch') },
      { label: 'Push', icon: ArrowUpFromLine, action: () => ui.notWired('Push branch') },
    )
  }
  items.push(
    { label: 'Copy name', icon: Copy, action: () => copy(name) },
    { separator: true },
    { label: opts.remote ? `Delete ${name} on remote…` : `Delete ${name}…`, icon: Trash2, danger: true, action: () => ui.notWired('Delete branch') },
  )
  if (opts.current) items.splice(0, 2)
  ui.openMenu(e, items)
}
</script>

<template>
  <aside class="flex h-full flex-col border-r border-line bg-surface">
    <div class="flex items-center gap-1 p-2">
      <div class="relative flex-1">
        <Search :size="12" class="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-faint" />
        <input v-model="filter" class="gw-input pl-6" placeholder="Filter refs…" spellcheck="false" />
      </div>
      <button type="button" class="rounded p-1 text-faint hover:bg-hover hover:text-fg" title="Collapse sidebar" @click="ui.sidebarCollapsed = true">
        <PanelLeftClose :size="14" />
      </button>
    </div>

    <div v-if="snapshot" class="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
      <SidebarSection title="Branches" :icon="GitBranch" :count="localBranches.length">
        <RefTree
          :nodes="branchTree"
          :force-open="filtering"
          @select="(b: Branch) => ui.notWired(`Checkout ${b.name}`)"
          @menu="(e: MouseEvent, b: Branch) => refMenu(e, b.name, { current: b.current })"
        >
          <template #leaf="{ item, label }">
            <CircleDot v-if="item.current" :size="12" class="shrink-0 text-accent" />
            <GitBranch v-else :size="12" class="shrink-0 text-faint" />
            <span class="flex-1 truncate" :class="item.current ? 'font-semibold text-fg' : 'text-fg/85'">{{ label }}</span>
            <span v-if="item.upstreamGone" class="rounded bg-danger/15 px-1 text-[9px] text-danger" title="Upstream branch was deleted">gone</span>
            <span v-if="item.ahead" class="font-mono text-[10px] text-success" :title="`${item.ahead} ahead of ${item.upstream ?? 'upstream'}`">↑{{ item.ahead }}</span>
            <span v-if="item.behind" class="font-mono text-[10px] text-warning" :title="`${item.behind} behind ${item.upstream ?? 'upstream'}`">↓{{ item.behind }}</span>
          </template>
        </RefTree>
      </SidebarSection>

      <SidebarSection title="Remotes" :icon="Cloud" :count="remoteCount">
        <div v-for="r in remotes" :key="r.remote.name">
          <div class="flex h-6 items-center gap-1.5 px-2 text-[12px] text-muted" :title="r.remote.url">
            <Globe :size="12" class="text-faint" /><span class="flex-1 truncate">{{ r.remote.name }}</span>
          </div>
          <RefTree
            :nodes="r.tree"
            :base-depth="1"
            :force-open="filtering"
            @menu="(e: MouseEvent, n: string) => refMenu(e, `${r.remote.name}/${n}`, { remote: true })"
          >
            <template #leaf="{ label }">
              <GitBranch :size="12" class="shrink-0 text-faint" /><span class="truncate text-fg/85">{{ label }}</span>
            </template>
          </RefTree>
        </div>
      </SidebarSection>

      <SidebarSection title="Tags" :icon="TagIcon" :count="tags.length" :default-open="false">
        <div
          v-for="t in tags" :key="t.name"
          class="flex h-6 items-center gap-1.5 rounded pr-2 pl-5 text-[12px] hover:bg-hover"
          @contextmenu="ui.openMenu($event, [
            { label: 'Checkout tag', icon: Check, action: () => ui.notWired('Checkout tag') },
            { label: 'Copy name', icon: Copy, action: () => copy(t.name) },
            { separator: true },
            { label: `Delete ${t.name}…`, icon: Trash2, danger: true, action: () => ui.notWired('Delete tag') },
          ])"
        >
          <TagIcon :size="12" class="shrink-0 text-faint" /><span class="flex-1 truncate text-fg/85">{{ t.name }}</span>
          <span class="font-mono text-[10px] text-faint">{{ t.hash.slice(0, 7) }}</span>
        </div>
      </SidebarSection>

      <SidebarSection title="Stashes" :icon="Archive" :count="stashes.length">
        <div v-for="s in stashes" :key="s.index" class="flex h-6 items-center gap-1.5 rounded pr-2 pl-5 text-[12px] hover:bg-hover" :title="s.message">
          <Archive :size="12" class="shrink-0 text-faint" />
          <span class="flex-1 truncate text-fg/85">{{ s.message }}</span>
          <span class="shrink-0 text-[10px] text-faint">{{ relativeTime(s.date) }}</span>
        </div>
      </SidebarSection>

      <SidebarSection title="Worktrees" :icon="FolderTree" :count="worktrees.length" :default-open="false">
        <div v-for="w in worktrees" :key="w.path" class="flex h-6 items-center gap-1.5 rounded pr-2 pl-5 text-[12px] hover:bg-hover" :title="w.path">
          <FolderTree :size="12" class="shrink-0 text-faint" />
          <span class="flex-1 truncate text-fg/85">{{ w.path.split('/').pop() }}</span>
          <span class="truncate text-[10px] text-faint">{{ w.branch }}</span>
        </div>
      </SidebarSection>

      <SidebarSection title="Submodules" :icon="Boxes" :count="submodules.length" :default-open="false">
        <div v-for="s in submodules" :key="s.path" class="flex h-6 items-center gap-1.5 rounded pr-2 pl-5 text-[12px] hover:bg-hover">
          <Boxes :size="12" class="shrink-0 text-faint" />
          <span class="flex-1 truncate text-fg/85">{{ s.path }}</span>
          <span v-if="s.status === 'modified'" class="h-1.5 w-1.5 rounded-full bg-warning" title="Modified" />
        </div>
      </SidebarSection>
    </div>
  </aside>
</template>
