<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { clone } from '@/lib/clone'
import { AlertOctagon, ArrowDown, ArrowUp, GitCommitHorizontal, Loader2, RotateCw, Split, Trash2 } from '@/lib/icons'
import PanelShell from './PanelShell.vue'
import StatusBadge from '@/components/common/StatusBadge.vue'
import { useAiStore } from '@/stores/ai'
import { useOpsStore } from '@/stores/ops'
import { useUiStore } from '@/stores/ui'
import type { SplitGroup, SplitItem } from '@/ai/prompts'

const ai = useAiStore()
const ops = useOpsStore()
const ui = useUiStore()
const s = computed(() => ai.split)

/** Editable copy of the plan; nothing touches git until Apply. */
const groups = ref<SplitGroup[]>([])
watch(() => ai.split.groups, (g) => (groups.value = clone(g)), { immediate: true })

const statusOf = (path: string) => s.value.catalog?.files.find((f) => f.path === path)?.status ?? 'M'
const hunkHeader = (id: string) => s.value.catalog?.hunks.find((h) => h.id === id)?.header ?? id
const label = (it: SplitItem) => (it.hunkId ? `hunk ${it.hunkId.split('#')[1]}` : 'whole file')

function move(gi: number, ii: number, target: number) {
  const [item] = groups.value[gi].items.splice(ii, 1)
  groups.value[target].items.push(item)
  groups.value = groups.value.filter((g) => g.items.length)
}
function reorder(gi: number, dir: -1 | 1) {
  const j = gi + dir
  if (j < 0 || j >= groups.value.length) return
  const g = groups.value
  ;[g[gi], g[j]] = [g[j], g[gi]]
}
function remove(gi: number) {
  const [g] = groups.value.splice(gi, 1)
  if (groups.value.length) groups.value[groups.value.length - 1].items.push(...g.items)
}

const valid = computed(() => groups.value.length > 0 && groups.value.every((g) => g.summary.trim() && g.items.length))
</script>

<template>
  <PanelShell title="Split into commits" :icon="Split" subtitle="AI suggestion — edit freely, nothing changes until you apply">
    <template #actions>
      <button
        type="button" :disabled="s.status === 'running' || !!ops.running"
        class="flex h-7 shrink-0 items-center whitespace-nowrap gap-1 rounded-md border border-line-strong px-2 text-[12px] hover:bg-hover disabled:opacity-40"
        @click="ai.suggestSplit()"
      ><RotateCw :size="12" />Suggest again</button>
    </template>

    <div v-if="s.status === 'running'" class="flex flex-col items-center gap-2 p-12 text-[13px] text-muted">
      <Loader2 :size="22" class="animate-spin text-accent-2" />{{ ai.progress ?? 'Planning commits…' }}
    </div>

    <div v-else-if="s.status === 'error'" class="m-4 flex gap-2 rounded-md border border-danger/30 bg-danger/10 p-3 text-[13px] text-danger select-text">
      <AlertOctagon :size="17" class="shrink-0" />{{ s.error }}
    </div>

    <div v-else-if="groups.length" class="space-y-3 p-4">
      <div v-for="(g, gi) in groups" :key="g.id" class="overflow-hidden rounded-lg border border-line bg-surface">
        <div class="flex items-center gap-2 border-b border-line px-3 py-2">
          <span class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/15 font-mono text-[11px] text-accent">{{ gi + 1 }}</span>
          <input v-model="g.summary" class="gw-input h-8 flex-1 font-medium" placeholder="Commit summary" spellcheck="false" />
          <button type="button" class="rounded p-1 text-faint hover:bg-hover hover:text-fg disabled:opacity-30" :disabled="gi === 0" title="Move up" @click="reorder(gi, -1)"><ArrowUp :size="15" /></button>
          <button type="button" class="rounded p-1 text-faint hover:bg-hover hover:text-fg disabled:opacity-30" :disabled="gi === groups.length - 1" title="Move down" @click="reorder(gi, 1)"><ArrowDown :size="15" /></button>
          <button type="button" class="rounded p-1 text-faint hover:bg-danger/10 hover:text-danger disabled:opacity-30" :disabled="groups.length === 1" title="Remove group (its files move to the last group)" @click="remove(gi)"><Trash2 :size="15" /></button>
        </div>
        <textarea v-model="g.description" rows="2" class="gw-input mx-3 mt-2 h-auto w-[calc(100%-1.5rem)] resize-none py-1" placeholder="Description (optional)" spellcheck="false" />
        <div class="px-3 py-2">
          <div v-for="(it, ii) in g.items" :key="`${it.path}${it.hunkId ?? ''}`" class="flex h-7 shrink-0 items-center whitespace-nowrap gap-2 text-[13px]">
            <StatusBadge :status="statusOf(it.path)" />
            <span class="min-w-0 flex-1 truncate font-mono text-[12px] text-fg" :title="it.hunkId ? hunkHeader(it.hunkId) : it.path">{{ it.path }}</span>
            <span class="text-[11px] text-faint">{{ label(it) }}</span>
            <select
              v-if="groups.length > 1"
              class="h-5 rounded border border-line bg-surface-2 px-1 text-[11px] text-muted"
              :value="gi" title="Move to another commit"
              @change="move(gi, ii, Number(($event.target as HTMLSelectElement).value))"
            >
              <option v-for="(_, t) in groups" :key="t" :value="t">→ commit {{ t + 1 }}</option>
            </select>
          </div>
        </div>
      </div>

      <div class="flex items-center gap-2 pt-1">
        <span class="text-[12px] text-faint">{{ groups.length }} {{ groups.length === 1 ? 'commit' : 'commits' }} · applied top to bottom · one Undo reverts all</span>
        <div class="flex-1" />
        <button type="button" class="h-9 rounded-md border border-line-strong px-3 text-[13px] hover:bg-hover" @click="ai.split.groups = []; ai.split.status = 'idle'; ui.showPanel('graph')">Discard plan</button>
        <button
          type="button" :disabled="!valid || !!ops.running"
          class="flex h-9 items-center gap-1 rounded-md bg-accent px-3 text-[13px] font-semibold text-on-accent hover:brightness-110 disabled:opacity-40"
          @click="ai.applySplit(groups)"
        >
          <Loader2 v-if="ops.running" :size="15" class="animate-spin" /><GitCommitHorizontal v-else :size="15" />Create {{ groups.length }} {{ groups.length === 1 ? 'commit' : 'commits' }}
        </button>
      </div>
    </div>

    <div v-else class="p-12 text-center text-[13px] text-faint">No plan yet. Use “Split…” in the working copy panel.</div>
  </PanelShell>
</template>
