<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import {
  AlertTriangle, ChevronDown, Copy, FolderOpen, FolderTree, List, Loader2, Pencil, ScanSearch, Search, Sparkles, X,
} from '@/lib/icons'
import Avatar from '@/components/common/Avatar.vue'
import RefPill from '@/components/graph/RefPill.vue'
import FileList from './FileList.vue'
import { fullDate, reflowMessage, relativeTime, shortDate } from '@/lib/format'
import { laneColor } from '@/lib/lanes'
import { errorMessage, gitApi } from '@/api/git'
import * as git from '@/actions/git'
import { useReposStore } from '@/stores/repos'
import { useUiStore, type MenuItem } from '@/stores/ui'
import { useAiStore } from '@/stores/ai'
import type { CommitDetails, FileChange, FileStatus } from '@/types/git'

const props = defineProps<{ hash: string }>()
const repos = useReposStore()
const ui = useUiStore()
const ai = useAiStore()

const details = ref<CommitDetails | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const statusFilter = ref<FileStatus | 'all'>('all')
const searching = ref(false)
const fileQuery = ref('')
const searchInput = ref<HTMLInputElement | null>(null)
const repoPath = computed(() => repos.activeTab?.path ?? '')

watch(
  () => [props.hash, repoPath.value] as const,
  async ([hash, path], _old, onCleanup) => {
    let cancelled = false
    onCleanup(() => (cancelled = true))
    loading.value = true
    error.value = null
    statusFilter.value = 'all'
    try {
      const d = await gitApi.getCommitDetails(path, hash)
      if (!cancelled) details.value = d
    } catch (e) {
      if (!cancelled) {
        details.value = null
        error.value = errorMessage(e)
      }
    } finally {
      if (!cancelled) loading.value = false
    }
  },
  { immediate: true },
)

const shown = computed(() => (details.value?.hash === props.hash ? details.value : null))
const sameCommitter = computed(() => {
  const d = shown.value
  return !d || (d.committer.email === d.author.email && d.commitDate === d.authorDate)
})
const expanded = ref(false)
watch(() => props.hash, () => (expanded.value = false))
const longBody = computed(() => {
  const b = shown.value?.body ?? ''
  return paragraphs.value.length > 6 || b.length > 420
})

const paragraphs = computed(() => reflowMessage(shown.value?.body ?? ''))

const rowIndex = computed(() => repos.active?.graphCommits.findIndex((c) => c.hash === props.hash) ?? -1)
const refs = computed(() => (rowIndex.value >= 0 ? repos.active!.graphCommits[rowIndex.value].refs : []))
const refColor = computed(() => laneColor(rowIndex.value >= 0 ? repos.active!.layout.rows[rowIndex.value]?.color ?? 0 : 0))

const STATUS_COLOR: Record<string, string> = { M: 'var(--gw-accent)', A: 'var(--gw-success)', D: 'var(--gw-danger)', R: 'var(--gw-info)' }
const STATUS_LABEL: Record<string, string> = { M: 'Modified', A: 'Added', D: 'Deleted', R: 'Renamed', C: 'Copied', T: 'Type changed', U: 'Conflicted', '?': 'Untracked' }
const statusCounts = computed(() => {
  const m = new Map<FileStatus, number>()
  for (const f of shown.value?.files ?? []) m.set(f.status, (m.get(f.status) ?? 0) + 1)
  return [...m].sort((a, b) => b[1] - a[1])
})
/** Browse every file in the commit, not only the changed ones. */
const allFiles = ref(false)
const tree = shallowRef<{ hash: string; paths: string[] } | null>(null)
const treeLoading = ref(false)
async function toggleAllFiles() {
  allFiles.value = !allFiles.value
  if (allFiles.value) {
    ui.fileViewMode = 'tree'
    await loadTree()
  }
}
async function loadTree() {
  const d = shown.value
  if (!d || tree.value?.hash === d.hash) return
  treeLoading.value = true
  try {
    tree.value = { hash: d.hash, paths: await gitApi.listTree(repoPath.value, d.hash) }
  } catch (e) {
    ui.toast({ kind: 'error', title: 'Could not list the files', detail: errorMessage(e) }, 6000)
    allFiles.value = false
  } finally {
    treeLoading.value = false
  }
}
watch(() => shown.value?.hash, () => void (allFiles.value && loadTree()))
const browsing = computed(() => allFiles.value && !!shown.value && tree.value?.hash === shown.value.hash)
const sourceFiles = computed<FileChange[]>(() => {
  const changed = shown.value?.files ?? []
  if (!browsing.value) return changed
  const byPath = new Map(changed.map((f) => [f.path, f]))
  const out: FileChange[] = tree.value!.paths.map((p) => byPath.get(p) ?? { path: p, status: '=' as const, additions: 0, deletions: 0 })
  for (const f of changed) if (f.status === 'D') out.push(f)
  return out
})
const files = computed(() => {
  let list = sourceFiles.value
  if (statusFilter.value !== 'all') list = list.filter((f) => f.status === statusFilter.value)
  const q = fileQuery.value.trim().toLowerCase()
  if (q) list = list.filter((f) => f.path.toLowerCase().includes(q))
  return list
})

async function toggleSearch() {
  searching.value = !searching.value
  if (!searching.value) fileQuery.value = ''
  else {
    await nextTick()
    searchInput.value?.focus()
  }
}

function openFile(f: FileChange) {
  const d = shown.value
  if (!d) return
  ui.toggleDiff({ path: f.path, oldPath: f.oldPath, source: 'commit', commit: d.hash, parent: d.parents[0], unchanged: f.status === '=' || undefined })
}

function copy(text: string, what = 'Copied') {
  void navigator.clipboard?.writeText(text)
  ui.toast({ kind: 'success', title: what, detail: text }, 1800)
}

const isHead = computed(() => !!shown.value && shown.value.hash === repos.active?.snapshot.head.oid)
function fileMenu(e: MouseEvent, f: FileChange) {
  const name = f.path.split('/').pop() ?? f.path
  const items: MenuItem[] = [
    { label: 'Copy file name', icon: Copy, action: () => copy(name, 'Copied file name') },
    { label: 'Copy path', icon: Copy, action: () => copy(f.path, 'Copied path') },
  ]
  ui.openMenu(e, items)
}

const editing = ref(false)
const draftSubject = ref('')
const draftBody = ref('')
const subjectInput = ref<HTMLInputElement | null>(null)
function editMessage() {
  const d = shown.value
  if (!d || !isHead.value) return
  draftSubject.value = d.subject
  draftBody.value = d.body.trim()
  editing.value = true
  void nextTick(() => subjectInput.value?.select())
}
async function saveMessage() {
  const subject = draftSubject.value.trim()
  if (!subject) return
  const message = draftBody.value.trim() ? `${subject}\n\n${draftBody.value.trim()}` : subject
  const d = shown.value
  if (d && message === (d.body.trim() ? `${d.subject}\n\n${d.body.trim()}` : d.subject)) {
    editing.value = false
    return
  }
  const outcome = await git.rewordHead(message)
  if (outcome) {
    editing.value = false
    if (outcome.after.oid) ui.selectCommit(outcome.after.oid)
  }
}
watch(() => props.hash, () => (editing.value = false))
const generating = ref(false)
async function generateMessage() {
  const d = shown.value
  if (!d || generating.value) return
  generating.value = true
  try {
    const msg = await ai.generateCommitMessage(d.hash)
    if (msg) {
      draftSubject.value = msg.summary
      draftBody.value = msg.description
    }
  } finally {
    generating.value = false
  }
}

const explanation = computed(() => (ai.explain.hash === props.hash ? ai.explain : null))
function explain() {
  const d = shown.value
  if (d) void ai.explainCommit({ hash: d.hash, subject: d.subject, body: d.body })
}
function review() {
  const d = shown.value
  if (d) void ai.runReview({ hash: d.hash, parent: d.parents[0], subject: d.subject })
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div class="flex h-11 shrink-0 items-center gap-1 border-b border-line pr-2 pl-4">
      <span class="text-[12px] font-semibold tracking-wider text-muted uppercase">Commit</span>
      <Loader2 v-if="loading" :size="14" class="ml-1 animate-spin text-faint" />
      <div class="flex-1" />
      <button type="button" class="hbtn" :class="{ on: searching }" title="Filter files" @click="toggleSearch"><Search :size="16" /></button>
      <button type="button" class="hbtn" :class="{ on: ui.fileViewMode === 'list' }" title="List view" @click="ui.fileViewMode = 'list'"><List :size="16" /></button>
      <button type="button" class="hbtn" :class="{ on: ui.fileViewMode === 'tree' }" title="Tree view" @click="ui.fileViewMode = 'tree'"><FolderTree :size="16" /></button>
      <button type="button" class="hbtn" :class="{ on: allFiles }" :title="allFiles ? 'Show only the changed files' : 'Browse all files in this commit'" @click="toggleAllFiles">
        <Loader2 v-if="treeLoading" :size="15" class="animate-spin" /><FolderOpen v-else :size="16" />
      </button>
      <div class="mx-1 h-5 w-px bg-line" />
      <button type="button" class="hbtn" title="Close (Esc)" @click="ui.selectCommit(null)"><X :size="16" /></button>
    </div>

    <div v-if="error" class="m-3 rounded-md border border-danger/30 bg-danger/10 p-3 text-[13px] text-danger select-text">{{ error }}</div>

    <div v-else-if="!shown" class="space-y-2 p-4">
      <div class="h-4 w-3/4 animate-pulse rounded bg-surface-3" />
      <div class="h-3 w-1/2 animate-pulse rounded bg-surface-3" />
      <div class="mt-4 h-16 animate-pulse rounded-lg bg-surface-3" />
    </div>

    <template v-else>
      <div class="max-h-[60%] shrink-0 overflow-y-auto border-b border-line px-4 pt-3.5 pb-3">
        <div
          v-if="editing"
          class="overflow-hidden rounded-lg border border-accent bg-surface-2/60 ring-2 ring-accent/25"
          @keydown.meta.enter.prevent="saveMessage" @keydown.ctrl.enter.prevent="saveMessage" @keydown.esc.stop.prevent="editing = false"
        >
          <div class="flex items-center gap-2 border-b border-line px-3">
            <input
              ref="subjectInput" v-model="draftSubject"
              class="h-10 min-w-0 flex-1 bg-transparent text-[14px] font-semibold text-fg outline-none placeholder:text-faint"
              placeholder="Summary" spellcheck="false"
              @keydown.enter.exact.prevent="saveMessage"
            />
            <button
              type="button" class="shrink-0 rounded-md p-1 text-accent-2 hover:bg-accent-2/15 disabled:opacity-40"
              title="Write the message with AI from this commit's changes" :disabled="generating"
              @click="generateMessage"
            >
              <Loader2 v-if="generating" :size="17" class="animate-spin" />
              <Sparkles v-else :size="17" />
            </button>
          </div>
          <textarea
            v-model="draftBody" rows="4"
            class="block w-full resize-y bg-transparent px-3 py-2 text-[13px] leading-relaxed text-fg outline-none placeholder:text-faint"
            placeholder="Description" spellcheck="false"
          />
          <div class="flex items-center gap-2 border-t border-line px-3 py-2">
            <span class="min-w-0 flex-1 text-[12px] text-faint">⌘↵ to save · Esc to cancel</span>
            <button type="button" class="flex h-8 shrink-0 items-center rounded-md px-2.5 text-[13px] text-muted hover:bg-hover hover:text-fg" @click="editing = false">Cancel</button>
            <button
              type="button" :disabled="!draftSubject.trim() || generating"
              class="flex h-8 shrink-0 items-center whitespace-nowrap rounded-md bg-accent px-3 text-[13px] font-semibold text-on-accent hover:brightness-110 disabled:opacity-40"
              @click="saveMessage"
            >Save message</button>
          </div>
        </div>
        <div v-else class="flex items-start gap-2">
          <div
            class="min-w-0 flex-1 text-[15px] leading-snug font-semibold text-fg select-text"
            :title="isHead ? 'Double-click to edit the message' : undefined"
            @dblclick="editMessage"
          >{{ shown.subject }}</div>
          <button
            v-if="isHead" type="button"
            class="-mt-0.5 shrink-0 rounded p-1 text-faint hover:bg-hover hover:text-fg"
            title="Edit this commit's message (amend)"
            @click="editMessage"
          ><Pencil :size="15" /></button>
        </div>

        <template v-if="paragraphs.length && !editing">
          <div
            @dblclick="editMessage"
            class="mt-2 space-y-1.5 text-[13px] leading-relaxed break-words text-muted select-text"
            :class="{ 'line-clamp-4': longBody && !expanded }"
          >
            <p v-for="(para, i) in paragraphs" :key="i" :class="{ 'h-1': !para }">{{ para }}</p>
          </div>
          <button
            v-if="longBody" type="button"
            class="mt-1 flex items-center gap-1 text-[12px] font-medium text-accent hover:underline"
            @click="expanded = !expanded"
          >
            <ChevronDown :size="13" class="transition-transform" :class="{ 'rotate-180': expanded }" />{{ expanded ? 'Show less' : 'Show more' }}
          </button>
        </template>

        <div class="mt-3 rounded-xl border border-line bg-surface-2/50">
          <div class="flex items-center gap-2.5 px-3 py-2.5">
            <Avatar :name="shown.author.name" :email="shown.author.email" :size="32" />
            <div class="min-w-0 flex-1">
              <div class="truncate text-[13px] font-medium text-fg" :title="`${shown.author.name} <${shown.author.email}>`">{{ shown.author.name }}</div>
              <div class="truncate text-[12px] text-faint" :title="fullDate(shown.authorDate)">{{ relativeTime(shown.authorDate) }} · {{ shortDate(shown.authorDate) }}</div>
            </div>
            <button
              type="button" class="flex shrink-0 items-center gap-1 rounded-md border border-line-strong px-1.5 py-0.5 font-mono text-[12px] text-muted hover:border-accent/50 hover:text-fg"
              :title="`Copy ${shown.hash}`" @click="copy(shown.hash, 'Commit id copied')"
            >{{ shown.hash.slice(0, 7) }}<Copy :size="12" /></button>
          </div>
          <div v-if="!sameCommitter" class="px-3 pb-2 text-[12px] text-faint" :title="fullDate(shown.commitDate)">
            Committed by <span class="text-muted">{{ shown.committer.name }}</span> · {{ relativeTime(shown.commitDate) }}
          </div>
          <div class="flex flex-wrap items-center gap-1.5 border-t border-line px-3 py-2 text-[12px]">
            <span class="mr-0.5 text-faint">{{ shown.parents.length > 1 ? 'Parents' : 'Parent' }}</span>
            <button
              v-for="p in shown.parents" :key="p" type="button"
              class="rounded-md border border-line bg-surface px-1.5 font-mono leading-[20px] text-muted hover:border-accent/50 hover:text-accent"
              :title="`Go to ${p.slice(0, 7)}`" @click="ui.selectCommit(p)"
            >{{ p.slice(0, 7) }}</button>
            <span v-if="!shown.parents.length" class="text-faint">none — first commit</span>
            <RefPill v-for="r in refs" :key="r.name" :ref-label="r" :color="refColor" class="max-w-[180px]" />
          </div>
        </div>

        <div class="mt-2.5 flex gap-1">
          <button type="button" class="aibtn" :disabled="explanation?.status === 'running'" @click="explain">
            <Loader2 v-if="explanation?.status === 'running'" :size="15" class="animate-spin text-accent-2" />
            <Sparkles v-else :size="15" class="text-accent-2" />Explain with AI
          </button>
          <button type="button" class="aibtn" @click="review"><ScanSearch :size="15" class="text-accent" />Review with AI</button>
        </div>

        <div v-if="explanation && explanation.status !== 'idle'" class="mt-3 rounded-xl border border-accent-2/30 bg-accent-2/5 p-3 text-[13px] select-text">
          <div v-if="explanation.status === 'running'" class="text-muted">{{ ai.progress ?? 'Explaining…' }}</div>
          <div v-else-if="explanation.status === 'error'" class="text-danger">{{ explanation.error }}</div>
          <template v-else-if="explanation.result">
            <p class="leading-relaxed text-fg">{{ explanation.result.summary }}</p>
            <ul v-if="explanation.result.points.length" class="mt-2 list-disc space-y-1 pl-5 text-muted">
              <li v-for="(pt, i) in explanation.result.points" :key="i">{{ pt }}</li>
            </ul>
            <div v-if="explanation.result.risks.length" class="mt-2.5">
              <div class="flex items-center gap-1 text-[12px] font-semibold text-warning"><AlertTriangle :size="13" />Worth checking</div>
              <ul class="mt-1 list-disc space-y-1 pl-5 text-muted">
                <li v-for="(rk, i) in explanation.result.risks" :key="i">{{ rk }}</li>
              </ul>
            </div>
            <div class="mt-2 text-[11px] text-faint">{{ explanation.model }} · AI can be wrong</div>
          </template>
        </div>
      </div>

      <div class="flex shrink-0 items-center gap-1.5 border-b border-line px-4 py-2">
        <span class="text-[12px] font-semibold tracking-wider text-muted uppercase">Files</span>
        <span v-if="browsing" class="text-[12px] text-faint">{{ sourceFiles.length }} · {{ shown.files.length }} changed</span>
        <span v-else class="text-[12px] text-faint" :title="shown.parents.length > 1 ? 'Compared with the first parent' : undefined">{{ shown.files.length }}</span>
        <div class="flex-1" />
        <button type="button" class="chip" :class="{ on: statusFilter === 'all' }" @click="statusFilter = 'all'">All</button>
        <button
          v-for="[st, n] in statusCounts" :key="st" type="button"
          class="chip font-mono" :class="{ on: statusFilter === st }" :style="{ color: STATUS_COLOR[st] }"
          :title="STATUS_LABEL[st] ?? st"
          @click="statusFilter = statusFilter === st ? 'all' : st"
        >{{ st }} {{ n }}</button>
      </div>
      <div v-if="searching" class="relative shrink-0 px-3 pt-2">
        <Search :size="13" class="gw-search-icon left-5.5 mt-1" />
        <input ref="searchInput" v-model="fileQuery" class="gw-input gw-search" :placeholder="browsing ? 'Find a file…' : 'Filter by path…'" spellcheck="false" />
      </div>
      <div class="min-h-0 flex-1 pt-1">
        <FileList
          :files="files"
          :mode="ui.fileViewMode"
          readonly
          :active-path="ui.centerView === 'diff' && ui.diffSource === 'commit' ? ui.diffPath : null"
          @open="openFile"
          @menu="fileMenu"
        >
          <template #empty>
            <div class="px-4 py-2 text-[12px] text-faint italic">{{ shown.files.length ? 'No files match' : 'No file changes' }}</div>
          </template>
        </FileList>
      </div>
    </template>
  </div>
</template>

<style scoped>
@reference '../../styles/main.css';
.hbtn {
  @apply flex h-7 w-7 items-center justify-center rounded-md text-faint hover:bg-hover hover:text-fg;
}
.hbtn.on {
  @apply bg-surface-3 text-fg;
}
.aibtn {
  @apply flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] whitespace-nowrap text-fg hover:bg-hover disabled:opacity-50;
}
.chip {
  @apply flex h-6 items-center rounded px-1.5 text-[12px] whitespace-nowrap text-muted hover:bg-hover hover:text-fg;
}
.chip.on {
  @apply bg-surface-3 text-fg;
}
</style>
