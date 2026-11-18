<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { Check, Loader2, Play, ScanSearch, Sparkles, X } from '@/lib/icons'
import { useUiStore } from '@/stores/ui'
import { useReposStore } from '@/stores/repos'
import { useOpsStore } from '@/stores/ops'
import { gitApi } from '@/api/git'
import * as git from '@/actions/git'
import { useAiStore } from '@/stores/ai'

const props = defineProps<{ stagedCount: number }>()
const emit = defineEmits<{ amending: [boolean] }>()
const ui = useUiStore()
const repos = useReposStore()
const ops = useOpsStore()
const ai = useAiStore()
const generating = ref(false)
const summaryInput = ref<HTMLInputElement | null>(null)

interface Draft {
  summary: string
  description: string
  amend: boolean
  prefilled: string | null
}
/** Drafts are kept per repository tab so switching tabs never loses a message. */
const drafts = reactive(new Map<string, Draft>())
watch(
  () => repos.activeTabId,
  (id) => {
    if (!drafts.has(id)) drafts.set(id, { summary: '', description: '', amend: false, prefilled: null })
  },
  { immediate: true },
)
const draft = computed<Draft>(() => drafts.get(repos.activeTabId)!)
watch(() => draft.value.amend, (on) => emit('amending', on), { immediate: true })
watch(
  () => ui.amendPending,
  (pending) => {
    if (!pending) return
    ui.amendPending = false
    if (!repos.active?.snapshot.head.oid) return
    draft.value.amend = true
    setTimeout(() => summaryInput.value?.focus(), 50)
  },
  { immediate: true },
)

const SOFT_LIMIT = 72
const loadingAmend = ref(false)
const summaryLen = computed(() => draft.value.summary.length)
const hasHead = computed(() => !!repos.active?.snapshot.head.oid)
const operation = computed(() => repos.active?.snapshot.operation ?? null)
const isMerge = computed(() => operation.value === 'merge')
const conflictCount = computed(() => repos.active?.snapshot.workingCopy.unstaged.filter((f) => f.status === 'U').length ?? 0)
const opNames = { merge: 'merge', rebase: 'rebase', cherryPick: 'cherry-pick', revert: 'revert' } as const
const opName = computed(() => (operation.value ? opNames[operation.value] : ''))
const canCommit = computed(
  () =>
    !ops.running &&
    draft.value.summary.trim() !== '' &&
    (isMerge.value ? conflictCount.value === 0 && !draft.value.amend : !operation.value && (props.stagedCount > 0 || draft.value.amend)),
)
const commitTitle = computed(() => {
  if (canCommit.value) return `${draft.value.amend ? 'Amend' : 'Commit'} (⌘/Ctrl+Enter)`
  if (isMerge.value && conflictCount.value) return 'Resolve the conflicted files first'
  if (props.stagedCount === 0 && !draft.value.amend) return 'Stage some changes first'
  return 'Write a summary'
})
watch(
  () => [repos.activeTabId, operation.value] as const,
  async ([, op]) => {
    const d = draft.value
    if (op !== 'merge' || !repos.activeTab || d.summary.trim() || d.description.trim()) return
    const msg = await gitApi.mergeMessage(repos.activeTab.path).catch(() => null)
    if (!msg || d.summary.trim() || d.description.trim()) return
    const [summary, ...rest] = msg.split('\n')
    d.summary = summary
    d.description = rest.join('\n').trim()
    d.prefilled = message(d)
  },
  { immediate: true },
)

function message(d: Draft) {
  return d.description.trim() ? `${d.summary.trim()}\n\n${d.description.trim()}` : d.summary.trim()
}

watch(
  () => draft.value.amend,
  async (on) => {
    const d = draft.value
    if (on && !d.summary.trim() && !d.description.trim() && repos.activeTab && repos.active?.snapshot.head.oid) {
      loadingAmend.value = true
      try {
        const head = await gitApi.getCommitDetails(repos.activeTab.path, repos.active.snapshot.head.oid)
        d.summary = head.subject
        d.description = head.body
        d.prefilled = message(d)
      } catch {
        /* keep the box empty; the user can type the message */
      } finally {
        loadingAmend.value = false
      }
    } else if (!on && d.prefilled !== null && message(d) === d.prefilled) {
      d.summary = ''
      d.description = ''
      d.prefilled = null
    }
  },
)

async function generate() {
  if (generating.value) return
  const d = draft.value
  if ((d.summary.trim() || d.description.trim()) && d.prefilled === null) {
    const ok = await ui.confirm({ title: 'Replace your message?', message: 'The AI suggestion will overwrite the summary and description you typed.', confirmLabel: 'Replace' })
    if (!ok) return
  }
  generating.value = true
  try {
    const msg = await ai.generateCommitMessage()
    if (msg) {
      d.summary = msg.summary
      d.description = msg.description
      d.prefilled = null
    }
  } finally {
    generating.value = false
  }
}

async function submit() {
  if (!canCommit.value) return
  const d = draft.value
  const outcome = await git.commit(message(d), d.amend)
  if (outcome) {
    d.summary = ''
    d.description = ''
    d.amend = false
    d.prefilled = null
  }
}

watch(() => ui.commitRequest, () => {
  if (canCommit.value) void submit()
  else if (!props.stagedCount && !draft.value.amend) ui.toast({ kind: 'info', title: 'Nothing to commit', detail: 'Stage some changes first.' }, 2500)
  else if (!draft.value.summary.trim()) {
    ui.toast({ kind: 'info', title: 'Write a summary first' }, 2500)
    summaryInput.value?.focus()
  }
})
watch(() => ui.generateRequest, () => void generate())
</script>

<template>
  <div class="border-t border-line bg-surface p-3">
    <div class="relative">
      <input
        ref="summaryInput"
        v-model="draft.summary"
        class="gw-input h-9 pr-16 text-[14px]"
        :placeholder="operation && !isMerge ? `Continue or abort the ${opName} first` : 'Summary (required)'"
        spellcheck="false"
      />
      <span
        class="pointer-events-none absolute top-1/2 right-9 -translate-y-1/2 font-mono text-[11px]"
        :class="summaryLen > SOFT_LIMIT ? 'text-danger' : summaryLen > 50 ? 'text-warning' : 'text-faint'"
        :title="`${SOFT_LIMIT} characters is the conventional limit`"
      >{{ summaryLen }}</span>
      <button
        type="button"
        class="absolute top-1/2 right-1 -translate-y-1/2 rounded-md p-1 text-accent-2 hover:bg-accent-2/15"
        :title="stagedCount ? 'Generate message with AI from the staged changes' : 'Stage changes first'"
        :disabled="generating || !stagedCount"
        @click="generate"
      >
        <Loader2 v-if="generating" :size="17" class="animate-spin" />
        <Sparkles v-else :size="17" />
      </button>
    </div>
    <textarea
      v-model="draft.description"
      rows="3"
      class="gw-input mt-2 h-auto resize-none py-1.5 leading-relaxed"
      placeholder="Description"
      spellcheck="false"
    />
    <div class="mt-2 flex items-center gap-2">
      <label v-if="!operation" class="flex cursor-pointer items-center gap-1.5 text-[13px] text-muted select-none" :class="{ 'opacity-40': !hasHead }" :title="hasHead ? 'Rewrite the last commit' : 'No commit to amend yet'">
        <input v-model="draft.amend" type="checkbox" :disabled="!hasHead" />Amend
        <Loader2 v-if="loadingAmend" :size="12" class="animate-spin" />
      </label>
      <div class="flex-1" />
      <button
        type="button"
        class="flex h-8 shrink-0 items-center whitespace-nowrap gap-1 rounded-md border border-line-strong px-2.5 text-[13px] text-fg hover:bg-hover disabled:opacity-40"
        :title="stagedCount ? 'AI review of the staged changes' : 'Stage changes first'"
        :disabled="!stagedCount || ai.review.status === 'running'"
        @click="ai.runReview()"
      >
        <ScanSearch :size="15" />Review
      </button>
      <button
        v-if="operation"
        type="button" :disabled="!!ops.running"
        :title="`Abort the ${opName} and go back to where you were`"
        class="flex h-8 shrink-0 items-center whitespace-nowrap gap-1 rounded-md border border-danger/40 px-2.5 text-[13px] text-danger hover:bg-danger/10 disabled:opacity-40"
        @click="git.abortOperation()"
      ><X :size="15" />Abort {{ opName }}</button>
      <button
        v-if="operation && !isMerge"
        type="button" :disabled="!!ops.running || conflictCount > 0"
        :title="conflictCount ? 'Resolve and stage all conflicted files first' : `Continue the ${opName}`"
        class="flex h-8 shrink-0 items-center whitespace-nowrap gap-1 rounded-md bg-accent px-3 text-[13px] font-semibold text-on-accent hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
        @click="git.continueOperation()"
      ><Loader2 v-if="ops.running === 'Continue'" :size="15" class="animate-spin" /><Play v-else :size="15" />Continue</button>
      <button
        v-else
        type="button"
        :disabled="!canCommit"
        :title="commitTitle"
        class="flex h-8 shrink-0 items-center whitespace-nowrap gap-1 rounded-md bg-accent px-3 text-[13px] font-semibold text-on-accent hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
        @click="submit"
      >
        <Loader2 v-if="ops.running === 'Commit' || ops.running === 'Amend commit'" :size="15" class="animate-spin" />
        <Check v-else :size="15" />{{ draft.amend ? 'Amend' : 'Commit' }}
      </button>
    </div>
  </div>
</template>
