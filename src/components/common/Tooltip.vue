<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

const DELAY = 400
const text = ref('')
const pos = ref({ x: 0, y: 0 })
const visible = ref(false)
const el = ref<HTMLElement | null>(null)
let target: HTMLElement | null = null
let timer: ReturnType<typeof setTimeout> | undefined

function tipOf(node: HTMLElement): string {
  const t = node.getAttribute('title')
  if (t) {
    node.dataset.tip = t
    node.removeAttribute('title')
  }
  return node.dataset.tip ?? ''
}

function hide() {
  clearTimeout(timer)
  visible.value = false
  target = null
}

async function show() {
  if (!target || !target.isConnected || !target.matches(':hover')) return hide()
  text.value = tipOf(target)
  if (!text.value) return
  const r = target.getBoundingClientRect()
  pos.value = { x: r.left + r.width / 2, y: r.bottom + 6 }
  visible.value = true
  await nextTick()
  const box = el.value?.getBoundingClientRect()
  if (!box) return
  const x = Math.min(Math.max(pos.value.x - box.width / 2, 6), window.innerWidth - box.width - 6)
  const y = pos.value.y + box.height > window.innerHeight - 6 ? r.top - box.height - 6 : pos.value.y
  pos.value = { x, y }
}

function onOver(e: PointerEvent) {
  const node = (e.target as Element | null)?.closest<HTMLElement>('[title], [data-tip]')
  if (node === target) return
  hide()
  if (!node || !tipOf(node)) return
  target = node
  timer = setTimeout(show, DELAY)
}

function onOut(e: PointerEvent) {
  if (!target) return
  const to = e.relatedTarget as Node | null
  if (to && target.contains(to)) return
  hide()
}

onMounted(() => {
  document.addEventListener('pointerover', onOver, true)
  document.addEventListener('pointerout', onOut, true)
  window.addEventListener('pointerdown', hide, true)
  window.addEventListener('dblclick', hide, true)
  window.addEventListener('keydown', hide, true)
  window.addEventListener('scroll', hide, true)
  window.addEventListener('blur', hide)
})
onBeforeUnmount(() => {
  clearTimeout(timer)
  document.removeEventListener('pointerover', onOver, true)
  document.removeEventListener('pointerout', onOut, true)
  window.removeEventListener('pointerdown', hide, true)
  window.removeEventListener('dblclick', hide, true)
  window.removeEventListener('keydown', hide, true)
  window.removeEventListener('scroll', hide, true)
  window.removeEventListener('blur', hide)
})
</script>

<template>
  <div
    v-if="visible"
    ref="el"
    role="tooltip"
    class="pointer-events-none fixed z-[60] w-max max-w-[320px] rounded-md border border-line-strong bg-surface-2 px-2 py-1 text-[12px] whitespace-pre-line text-fg shadow-lg shadow-black/40"
    :style="{ left: `${pos.x}px`, top: `${pos.y}px` }"
  >{{ text }}</div>
</template>
