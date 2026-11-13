<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { AlertOctagon, Brush, Loader2, RotateCw, Trash2 } from 'lucide-vue-next'
import PanelShell from './PanelShell.vue'
import { useAiStore } from '@/stores/ai'
import { useOpsStore } from '@/stores/ops'
import { useReposStore } from '@/stores/repos'
import { useSettingsStore } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'
import { fullDate, relativeTime } from '@/lib/format'

const ai = useAiStore()
const ops = useOpsStore()
const repos = useReposStore()
const settings = useSettingsStore()
const ui = useUiStore()

const c = computed(() => ai.cleanup)
const selected = ref(new Set<string>())
const deleteLocal = ref(true)
const deleteRemote = ref(false)

watch(() => ai.cleanup.candidates, () => (selected.value = new Set()))
watch(() => repos.activeTabId, () => void ai.loadCleanup())
onMounted(async () => {
  if (!settings.loaded) await settings.load()
  void ai.loadCleanup()
})

const allChecked = computed(() => c.value.candidates.length > 0 && selected.value.size === c.value.candidates.length)
function toggle(name: string) {
  const next = new Set(selected.value)
  if (next.has(name)) next.delete(name)
  else next.add(name)
  selected.value = next
}
function toggleAll() {
  selected.value = allChecked.value ? new Set() : new Set(c.value.candidates.map((x) => x.name))
}
const chosen = computed(() => c.value.candidates.filter((x) => selected.value.has(x.name)))
const remoteCount = computed(() => chosen.value.filter((x) => x.remoteBranch).length)
</script>

<template>
  <PanelShell title="Branch cleanup" :icon="Brush" :subtitle="repos.activeTab?.name">
    <template #actions>
      <button type="button" class="flex h-7 shrink-0 items-center whitespace-nowrap gap-1 rounded-md border border-line-strong px-2 text-[12px] hover:bg-hover" @click="ai.loadCleanup()">
        <RotateCw :size="12" />Rescan
      </button>
    </template>

    <div class="space-y-3 p-4">
      <p class="text-[13px] text-muted">
        Local branches merged into <span class="font-mono text-fg">{{ settings.settings.cleanup.baseBranches.join(', ') }}</span>, whose remote was deleted (<span class="font-mono">[gone]</span>), or with no commits in {{ settings.settings.cleanup.staleDays }} days.
        <button type="button" class="text-accent hover:underline" @click="ui.openSettings('workflow')">Change</button>
      </p>

      <div v-if="c.status === 'running'" class="flex justify-center p-10"><Loader2 :size="20" class="animate-spin text-faint" /></div>
      <div v-else-if="c.status === 'error'" class="flex gap-2 rounded-md border border-danger/30 bg-danger/10 p-3 text-[13px] text-danger"><AlertOctagon :size="17" />{{ c.error }}</div>
      <div v-else-if="!c.candidates.length" class="p-10 text-center text-[13px] text-success">Nothing to clean up. 🎉</div>

      <template v-else>
        <div class="overflow-hidden rounded-lg border border-line">
          <label class="flex cursor-pointer items-center gap-2 border-b border-line bg-surface px-3 py-1.5 text-[13px] font-semibold text-fg">
            <input type="checkbox" :checked="allChecked" class="h-3 w-3 accent-[var(--gw-accent)]" @change="toggleAll" />
            {{ c.candidates.length }} candidates
          </label>
          <label v-for="b in c.candidates" :key="b.name" class="flex cursor-pointer items-center gap-2 border-b border-line px-3 py-1.5 text-[13px] last:border-b-0 hover:bg-surface-2">
            <input type="checkbox" :checked="selected.has(b.name)" class="h-3 w-3 accent-[var(--gw-accent)]" @change="toggle(b.name)" />
            <span class="min-w-0 flex-1 truncate font-mono text-fg">{{ b.name }}</span>
            <span v-for="m in b.mergedInto" :key="m" class="rounded bg-success/15 px-1.5 text-[11px] text-success">merged → {{ m }}</span>
            <span v-if="b.upstreamGone" class="rounded bg-danger/15 px-1.5 text-[11px] text-danger">remote gone</span>
            <span v-if="b.staleDays" class="rounded bg-warning/15 px-1.5 text-[11px] text-warning">{{ b.staleDays }}d stale</span>
            <span v-if="b.remoteBranch" class="font-mono text-[11px] text-faint" :title="`Remote branch ${b.remoteBranch} still exists`">{{ b.remoteBranch }}</span>
            <span class="w-20 shrink-0 text-right text-[12px] text-faint" :title="fullDate(b.lastCommit)">{{ relativeTime(b.lastCommit) }}</span>
          </label>
        </div>

        <div class="flex flex-wrap items-center gap-4">
          <label class="flex items-center gap-1.5 text-[13px] text-muted"><input v-model="deleteLocal" type="checkbox" class="h-3 w-3 accent-[var(--gw-accent)]" />Delete local branch</label>
          <label class="flex items-center gap-1.5 text-[13px] text-muted"><input v-model="deleteRemote" type="checkbox" class="h-3 w-3 accent-[var(--gw-accent)]" />Also delete on remote ({{ remoteCount }})</label>
          <div class="flex-1" />
          <button
            type="button" :disabled="!chosen.length || (!deleteLocal && !(deleteRemote && remoteCount)) || !!ops.running"
            class="flex h-9 items-center gap-1 rounded-md bg-danger px-3 text-[13px] font-semibold text-white hover:brightness-110 disabled:opacity-40"
            @click="ai.deleteBranches(chosen, deleteLocal, deleteRemote)"
          ><Trash2 :size="15" />Delete {{ chosen.length || '' }} selected…</button>
        </div>
      </template>
    </div>
  </PanelShell>
</template>
