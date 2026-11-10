<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{ side: 'left' | 'right'; width: number; min: number; max: number }>()
const emit = defineEmits<{ 'update:width': [number]; reset: [] }>()

const dragging = ref(false)

function start(e: PointerEvent) {
  e.preventDefault()
  const startX = e.clientX
  const startW = props.width
  dragging.value = true
  const move = (ev: PointerEvent) => {
    const dx = ev.clientX - startX
    const w = startW + (props.side === 'left' ? dx : -dx)
    emit('update:width', Math.round(Math.min(props.max, Math.max(props.min, w))))
  }
  const up = () => {
    dragging.value = false
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}
</script>

<template>
  <div
    class="group relative z-10 w-0 shrink-0 cursor-col-resize"
    title="Drag to resize · double-click to reset"
    @pointerdown="start"
    @dblclick="emit('reset')"
  >
    <div class="absolute inset-y-0 -left-[3px] w-[6px]" />
    <div class="absolute inset-y-0 -left-px w-[2px] transition-colors" :class="dragging ? 'bg-accent' : 'group-hover:bg-accent/50'" />
  </div>
</template>
