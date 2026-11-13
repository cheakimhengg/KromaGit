<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ImageOff, Loader2 } from '@/lib/icons'
import { errorMessage, gitApi } from '@/api/git'
import { formatBytes } from '@/lib/format'
import type { DiffTarget, ImagePair } from '@/types/git'

type Side = 'before' | 'after'

const props = defineProps<{ repo: string; target: DiffTarget; refreshKey?: unknown }>()

const pair = ref<ImagePair | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const dims = reactive<Record<Side, string>>({ before: '', after: '' })

watch(
  () => [props.repo, props.target, props.refreshKey] as const,
  async ([repo, target], _old, onCleanup) => {
    let cancelled = false
    onCleanup(() => (cancelled = true))
    loading.value = true
    error.value = null
    try {
      const p = await gitApi.getFileImage(repo, target)
      if (!cancelled) {
        pair.value = p
        dims.before = ''
        dims.after = ''
      }
    } catch (e) {
      if (!cancelled) error.value = errorMessage(e)
    } finally {
      if (!cancelled) loading.value = false
    }
  },
  { immediate: true },
)

const sides = computed(() => {
  const p = pair.value
  if (!p) return []
  const out: { side: Side; label: string; src: string; bytes: number }[] = []
  if (p.before) out.push({ side: 'before', label: p.after ? 'Before' : 'Deleted', src: p.before.dataUrl, bytes: p.before.bytes })
  if (p.after) out.push({ side: 'after', label: p.before ? 'After' : 'Added', src: p.after.dataUrl, bytes: p.after.bytes })
  return out
})

const delta = computed(() => {
  const p = pair.value
  if (!p?.before || !p.after) return null
  const d = p.after.bytes - p.before.bytes
  if (d === 0) return 'Same file size'
  const pct = p.before.bytes ? Math.round((d / p.before.bytes) * 100) : 0
  return `${d > 0 ? '+' : '−'}${formatBytes(Math.abs(d))} (${d > 0 ? '+' : ''}${pct}%)`
})

function onLoad(side: Side, e: Event) {
  const img = e.target as HTMLImageElement
  dims[side] = `${img.naturalWidth} × ${img.naturalHeight}`
}
</script>

<template>
  <div class="min-h-0 flex-1 overflow-auto p-5">
    <div v-if="error" class="rounded-md border border-danger/30 bg-danger/10 p-3 text-[13px] text-danger select-text">{{ error }}</div>
    <div v-else-if="loading && !pair" class="flex items-center justify-center gap-2 p-12 text-[13px] text-muted">
      <Loader2 :size="18" class="animate-spin" />Loading image…
    </div>
    <div v-else-if="!sides.length" class="flex flex-col items-center gap-2 p-12 text-center text-[13px] text-muted">
      <ImageOff :size="26" class="text-faint" />
      {{ pair?.tooLarge ? 'This image is too large to preview (over 25 MB).' : 'No image content to preview.' }}
    </div>
    <template v-else>
      <div class="grid gap-5" :class="sides.length > 1 ? 'grid-cols-2' : 'mx-auto max-w-3xl grid-cols-1'">
        <figure v-for="s in sides" :key="s.side" class="flex min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-surface">
          <figcaption class="flex items-center gap-2 border-b border-line px-3 py-2 text-[12px]">
            <span
              class="rounded px-1.5 py-0.5 font-semibold"
              :class="s.side === 'before' ? 'bg-danger/15 text-danger' : 'bg-success/15 text-success'"
            >{{ s.label }}</span>
            <span class="font-mono text-faint">{{ dims[s.side] }}</span>
            <span class="ml-auto font-mono text-faint">{{ formatBytes(s.bytes) }}</span>
          </figcaption>
          <div class="checker flex min-h-[220px] flex-1 items-center justify-center p-4">
            <img :src="s.src" alt="" class="max-h-[60vh] max-w-full object-contain" draggable="false" @load="onLoad(s.side, $event)" />
          </div>
        </figure>
      </div>
      <p v-if="delta" class="mt-3 text-center font-mono text-[12px] text-faint">{{ delta }}</p>
    </template>
  </div>
</template>

<style scoped>
.checker {
  background-color: var(--gw-surface-2);
  background-image:
    linear-gradient(45deg, var(--gw-surface-3) 25%, transparent 25%),
    linear-gradient(-45deg, var(--gw-surface-3) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, var(--gw-surface-3) 75%),
    linear-gradient(-45deg, transparent 75%, var(--gw-surface-3) 75%);
  background-size: 16px 16px;
  background-position: 0 0, 0 8px, 8px -8px, -8px 0;
}
</style>
