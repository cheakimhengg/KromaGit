<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { AlertTriangle } from '@/lib/icons'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
const values = reactive<Record<string, string>>({})
const checks = reactive<Record<string, boolean>>({})
const touched = ref(false)
const firstInput = ref<HTMLInputElement | HTMLTextAreaElement | null>(null)
const confirmBtn = ref<HTMLButtonElement | null>(null)
const dialogEl = ref<HTMLElement | null>(null)

watch(
  () => ui.dialog,
  async (d) => {
    if (!d) return
    for (const k of Object.keys(values)) delete values[k]
    for (const k of Object.keys(checks)) delete checks[k]
    for (const f of d.fields ?? []) values[f.key] = f.initial ?? ''
    for (const c of d.checkboxes ?? []) checks[c.key] = c.initial ?? false
    touched.value = false
    await nextTick()
    if (firstInput.value) {
      firstInput.value.focus()
      firstInput.value.select()
    } else {
      confirmBtn.value?.focus()
    }
  },
)

const errors = computed(() => {
  const out: Record<string, string | null> = {}
  for (const f of ui.dialog?.fields ?? []) {
    const v = values[f.key] ?? ''
    out[f.key] = !f.optional && !v.trim() ? `${f.label} is required` : (f.validate?.(v) ?? null)
  }
  return out
})
const valid = computed(() => Object.values(errors.value).every((e) => !e))

function submit() {
  touched.value = true
  if (!valid.value) return
  ui.closeDialog({ values: { ...values }, checks: { ...checks } })
}

/** a key press is handled once — otherwise Enter that confirms one dialog would also confirm the next one it opens */
const handled = new WeakSet<KeyboardEvent>()

function onKey(e: KeyboardEvent) {
  if (handled.has(e)) return
  handled.add(e)
  if (e.key === 'Escape') ui.closeDialog(null)
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || !(e.target instanceof HTMLTextAreaElement))) {
    e.preventDefault()
    submit()
  }
}

function onWindowKey(e: KeyboardEvent) {
  if (!ui.dialog) return
  const inside = e.target instanceof Node && dialogEl.value?.contains(e.target)
  if (!inside) onKey(e)
}
onMounted(() => window.addEventListener('keydown', onWindowKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onWindowKey))

function setFirst(el: unknown, index: number) {
  if (index === 0) firstInput.value = el as HTMLInputElement | null
}
</script>

<template>
  <Transition enter-from-class="opacity-0" leave-to-class="opacity-0" enter-active-class="transition duration-150" leave-active-class="transition duration-100">
    <div v-if="ui.dialog" class="fixed inset-0 z-[60] flex items-start justify-center bg-black/55 pt-[10vh] backdrop-blur-[2px]" @mousedown.self="ui.closeDialog(null)" @keydown="onKey">
      <div ref="dialogEl" class="max-w-[92vw] rounded-xl border border-line-strong bg-surface-2 shadow-2xl shadow-black/60" :class="ui.dialog.wide ? 'w-[820px]' : 'w-[480px]'" role="dialog" aria-modal="true">
        <div class="flex items-start gap-3 px-5 pt-5">
          <AlertTriangle v-if="ui.dialog.danger" :size="20" class="mt-0.5 shrink-0 text-danger" />
          <div class="min-w-0 flex-1">
            <h2 class="text-[15px] font-semibold text-fg">{{ ui.dialog.title }}</h2>
            <p v-if="ui.dialog.message" class="mt-1.5 text-[13px] leading-relaxed whitespace-pre-line text-muted">{{ ui.dialog.message }}</p>
          </div>
        </div>

        <div v-if="ui.dialog.detail?.length" class="mx-5 mt-3 max-h-40 overflow-y-auto rounded-md border border-line bg-bg px-3 py-2 font-mono text-[12px] text-muted">
          <div v-for="d in ui.dialog.detail.slice(0, 200)" :key="d" class="truncate" :title="d">{{ d }}</div>
          <div v-if="ui.dialog.detail.length > 200" class="text-faint">…and {{ ui.dialog.detail.length - 200 }} more</div>
        </div>

        <pre
          v-if="ui.dialog.preview"
          class="mx-5 mt-3 max-h-[46vh] overflow-auto rounded-md border border-line bg-bg p-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-muted select-text"
        >{{ ui.dialog.preview }}</pre>

        <div v-if="ui.dialog.fields?.length" class="space-y-3 px-5 pt-4">
          <label v-for="(f, i) in ui.dialog.fields" :key="f.key" class="block">
            <span class="mb-1 block text-[12px] font-medium text-muted">{{ f.label }}<span v-if="f.optional" class="text-faint"> (optional)</span></span>
            <textarea
              v-if="f.multiline"
              :ref="(el) => setFirst(el, i)"
              v-model="values[f.key]"
              rows="3"
              class="gw-input h-auto resize-none py-1.5"
              :placeholder="f.placeholder"
              spellcheck="false"
            />
            <input
              v-else
              :ref="(el) => setFirst(el, i)"
              v-model="values[f.key]"
              class="gw-input h-9"
              :class="{ 'font-mono': f.mono }"
              :placeholder="f.placeholder"
              spellcheck="false"
              autocomplete="off"
            />
            <span v-if="(touched || values[f.key]) && errors[f.key]" class="mt-1 block text-[12px] text-danger">{{ errors[f.key] }}</span>
          </label>
        </div>

        <div v-if="ui.dialog.checkboxes?.length" class="space-y-1.5 px-5 pt-3">
          <label v-for="c in ui.dialog.checkboxes" :key="c.key" class="flex cursor-pointer items-center gap-2 text-[13px] text-muted select-none">
            <input v-model="checks[c.key]" type="checkbox" />{{ c.label }}
          </label>
        </div>

        <div class="mt-5 flex justify-end gap-2 border-t border-line px-5 py-3">
          <button type="button" class="h-9 rounded-md border border-line-strong px-3 text-[13px] text-fg hover:bg-hover" @click="ui.closeDialog(null)">Cancel</button>
          <button
            ref="confirmBtn"
            type="button"
            class="h-9 rounded-md px-3 text-[13px] font-semibold hover:brightness-110 disabled:opacity-40"
            :class="ui.dialog.danger ? 'bg-danger text-white' : 'bg-accent text-on-accent'"
            :disabled="touched && !valid"
            @click="submit"
          >{{ ui.dialog.confirmLabel ?? 'OK' }}</button>
        </div>
      </div>
    </div>
  </Transition>
</template>
