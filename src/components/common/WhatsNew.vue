<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { Loader2, Sparkles, X } from '@/lib/icons'
import { useUpdatesStore } from '@/stores/updates'

const updates = useUpdatesStore()

function close() {
  updates.whatsNewOpen = false
}
function onKey(e: KeyboardEvent) {
  if (updates.whatsNewOpen && e.key === 'Escape') {
    e.stopPropagation()
    close()
  }
}
onMounted(() => window.addEventListener('keydown', onKey, true))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true))
</script>

<template>
  <Transition enter-from-class="opacity-0" leave-to-class="opacity-0" enter-active-class="transition duration-150" leave-active-class="transition duration-100">
    <div v-if="updates.whatsNewOpen" class="fixed inset-0 z-[60] flex items-start justify-center bg-black/55 pt-[12vh] backdrop-blur-[2px]" @mousedown.self="close">
      <div class="w-[460px] max-w-[92vw] overflow-hidden rounded-xl border border-line-strong bg-surface-2 shadow-2xl shadow-black/60" role="dialog" aria-modal="true" aria-labelledby="whats-new-title">
        <div class="flex items-start gap-3 px-5 pt-5">
          <img src="/favicon.png" alt="" class="h-10 w-10 shrink-0 rounded-lg" />
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5 text-[12px] font-medium text-accent-2"><Sparkles :size="13" />What's new</div>
            <h2 id="whats-new-title" class="text-[16px] font-semibold text-fg">KromaGit {{ updates.whatsNewVersion }}</h2>
          </div>
          <button type="button" class="rounded p-1 text-faint hover:bg-hover hover:text-fg" aria-label="Close" @click="close"><X :size="16" /></button>
        </div>

        <div class="px-5 pt-4 pb-2 text-[13.5px]">
          <div v-if="updates.whatsNewStatus === 'loading'" class="flex items-center gap-2 py-3 text-muted"><Loader2 :size="15" class="animate-spin" />Loading release notes…</div>
          <ul v-else-if="updates.whatsNewItems.length" class="space-y-2.5">
            <li v-for="(item, i) in updates.whatsNewItems" :key="i" class="flex gap-2.5 leading-relaxed text-fg">
              <span class="mt-[0.55em] h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
              <span>{{ item }}</span>
            </li>
          </ul>
          <p v-else-if="updates.whatsNewStatus === 'error'" class="py-2 leading-relaxed text-muted">Couldn't load the release notes. Check your internet connection and try again.</p>
          <p v-else class="py-2 leading-relaxed text-muted">Bug fixes and improvements.</p>
        </div>

        <div class="flex justify-end px-5 pt-3 pb-5">
          <button type="button" class="h-9 rounded-lg bg-accent px-4 text-[13px] font-medium text-on-accent hover:opacity-90" @click="close">Got it</button>
        </div>
      </div>
    </div>
  </Transition>
</template>
