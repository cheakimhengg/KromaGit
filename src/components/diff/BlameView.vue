<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Loader2 } from '@/lib/icons'
import Avatar from '@/components/common/Avatar.vue'
import { errorMessage, gitApi } from '@/api/git'
import { avatarHue, fullDate, languageFromPath, relativeTime } from '@/lib/format'
import { highlightLine } from '@/lib/highlight'
import type { BlameLine } from '@/types/git'

const props = defineProps<{ repo: string; path: string; rev?: string }>()
const emit = defineEmits<{ select: [hash: string] }>()

const lines = ref<BlameLine[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const hovered = ref<string | null>(null)

watch(
  () => [props.repo, props.path, props.rev] as const,
  async ([repo, path, rev], _o, onCleanup) => {
    let cancelled = false
    onCleanup(() => (cancelled = true))
    loading.value = true
    error.value = null
    try {
      const r = await gitApi.blame(repo, path, rev)
      if (!cancelled) lines.value = r
    } catch (e) {
      if (!cancelled) error.value = errorMessage(e)
    } finally {
      if (!cancelled) loading.value = false
    }
  },
  { immediate: true },
)

const language = computed(() => languageFromPath(props.path))
const NOT_COMMITTED = '0'.repeat(40)
const rows = computed(() =>
  lines.value.map((l, i) => ({
    ...l,
    first: i === 0 || lines.value[i - 1].hash !== l.hash,
    html: highlightLine(l.content, language.value),
    uncommitted: l.hash === NOT_COMMITTED,
    hue: avatarHue(l.hash),
  })),
)
const newest = computed(() => Math.max(0, ...lines.value.map((l) => l.time)))
const oldest = computed(() => Math.min(...lines.value.map((l) => l.time || Infinity)))
/** newer lines get a stronger age bar */
function age(t: number) {
  const span = newest.value - oldest.value || 1
  return 0.15 + 0.85 * ((t - oldest.value) / span)
}
</script>

<template>
  <div class="min-h-0 flex-1 overflow-auto font-mono text-[13px] leading-[22px]">
    <div v-if="error" class="m-4 rounded-md border border-danger/30 bg-danger/10 p-3 font-sans text-[13px] text-danger select-text">{{ error }}</div>
    <div v-else-if="loading && !lines.length" class="flex items-center justify-center gap-2 p-10 font-sans text-[13px] text-muted"><Loader2 :size="16" class="animate-spin" />Reading blame…</div>
    <table v-else class="w-full border-collapse">
      <tbody>
        <tr
          v-for="r in rows" :key="r.line"
          :class="[r.first ? 'border-t border-line/70' : '', hovered === r.hash ? 'bg-hover/60' : '']"
          @mouseenter="hovered = r.hash" @mouseleave="hovered = null"
        >
          <td
            class="w-[260px] max-w-[260px] cursor-pointer border-r border-line px-3 align-top font-sans text-[12px] select-none"
            :title="r.uncommitted ? 'Not committed yet' : `${r.summary}\n${r.author} <${r.email}>\n${fullDate(r.time)}\n${r.hash}`"
            @click="!r.uncommitted && emit('select', r.hash)"
          >
            <div v-if="r.first" class="flex h-[22px] items-center gap-2 overflow-hidden">
              <template v-if="r.uncommitted"><span class="text-warning">Not committed yet</span></template>
              <template v-else>
                <Avatar :name="r.author" :email="r.email" :size="18" />
                <span class="min-w-0 flex-1 truncate text-fg/90">{{ r.author }}</span>
                <span class="shrink-0 text-faint">{{ relativeTime(r.time) }}</span>
                <span class="shrink-0 font-mono text-[11px] text-faint" :style="{ opacity: 0.5 + age(r.time) / 2 }">{{ r.hash.slice(0, 7) }}</span>
              </template>
            </div>
            <div v-else-if="!r.uncommitted && hovered === r.hash" class="truncate pl-[26px] text-faint">{{ r.summary }}</div>
          </td>
          <td class="w-12 pr-3 text-right align-top text-faint select-none">{{ r.line }}</td>
          <td class="pr-4 align-top whitespace-pre text-fg"><span v-html="r.html || '&nbsp;'" /></td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
