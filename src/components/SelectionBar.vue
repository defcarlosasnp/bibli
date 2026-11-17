<script setup lang="ts">
import { computed } from 'vue'
import type { HighlightColor } from '@/db'
import { HIGHLIGHT_COLORS } from '@/services/highlights'

const props = defineProps<{ text: string }>()
const emit = defineEmits<{
  highlight: [color: HighlightColor]
  note: []
  define: []
  copy: []
  close: []
}>()

/** El diccionario solo tiene sentido con una palabra (o dos, p. ej. "sin embargo"). */
const canDefine = computed(() => {
  const words = props.text.trim().split(/\s+/).filter(Boolean)
  return words.length >= 1 && words.length <= 2 && props.text.length <= 40
})
</script>

<template>
  <div class="selection-bar" @mousedown.prevent>
    <div class="row items-center no-wrap q-gutter-x-xs">
      <button
        v-for="(c, name) in HIGHLIGHT_COLORS"
        :key="name"
        class="dot"
        :style="{ background: c.solid }"
        :aria-label="`Subrayar en ${c.label}`"
        :title="`Subrayar (${c.label})`"
        @click="emit('highlight', name)"
      />
      <q-separator vertical class="q-mx-xs" />
      <q-btn flat dense round icon="edit_note" aria-label="Subrayar y añadir nota" @click="emit('note')">
        <q-tooltip>Nota</q-tooltip>
      </q-btn>
      <q-btn v-if="canDefine" flat dense no-caps icon="menu_book" label="Definir" @click="emit('define')" />
      <q-btn flat dense round icon="content_copy" aria-label="Copiar" @click="emit('copy')">
        <q-tooltip>Copiar</q-tooltip>
      </q-btn>
      <q-btn flat dense round icon="close" aria-label="Cerrar" @click="emit('close')" />
    </div>
  </div>
</template>

<style scoped>
.selection-bar {
  position: fixed;
  left: 50%;
  top: calc(64px + var(--q-safe-area-inset-top, 0px));
  transform: translateX(-50%);
  z-index: 3000;
  padding: 6px 8px;
  border-radius: 999px;
  background: var(--card);
  color: var(--ink);
  box-shadow: var(--shadow);
  animation: pop-in 0.22s cubic-bezier(0.3, 1.5, 0.5, 1);
}
.dot {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 2px solid rgba(0, 0, 0, 0.12);
  cursor: pointer;
  padding: 0;
  transition: transform 0.15s;
}
.dot:hover,
.dot:focus-visible {
  transform: scale(1.15);
}
@keyframes pop-in {
  from {
    opacity: 0;
    transform: translateX(-50%) translateY(-8px) scale(0.9);
  }
}
</style>
