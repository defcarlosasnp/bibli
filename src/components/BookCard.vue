<script setup lang="ts">
import { computed } from 'vue'
import type { Book } from '@/db'
import { FINISHED_THRESHOLD } from '@/services/stats'

const props = defineProps<{ book: Book }>()
const emit = defineEmits<{ open: []; edit: []; remove: [] }>()

// Color estable por título para las portadas generadas.
const placeholderHue = computed(() => {
  let h = 0
  for (const ch of props.book.title) h = (h * 31 + ch.charCodeAt(0)) % 360
  return h
})
const finished = computed(() => props.book.progress >= FINISHED_THRESHOLD)
const isNew = computed(() => !props.book.lastOpenedAt && Date.now() - props.book.addedAt < 3 * 24 * 3600 * 1000)
</script>

<template>
  <div class="book-card" @click="emit('open')">
    <div class="stand">
      <div class="cover">
        <img v-if="book.cover" :src="book.cover" :alt="book.title" loading="lazy" />
        <div
          v-else
          class="placeholder font-display"
          :style="{
            background: `linear-gradient(160deg, hsl(${placeholderHue} 55% 42%), hsl(${(placeholderHue + 40) % 360} 50% 28%))`,
          }"
        >
          <q-icon name="auto_stories" size="26px" class="q-mb-sm" />
          <span>{{ book.title }}</span>
        </div>
        <div class="spine" />
        <div v-if="finished" class="ribbon">¡Leído!</div>
        <q-badge v-else-if="isNew" class="new-badge" color="accent" rounded>Nuevo</q-badge>
        <q-badge class="format" :color="book.format === 'pdf' ? 'red-6' : 'teal-6'" rounded>
          {{ book.format.toUpperCase() }}
        </q-badge>
        <q-btn class="menu" round dense flat size="sm" icon="more_vert" color="white" @click.stop>
          <q-menu auto-close>
            <q-list dense style="min-width: 140px">
              <q-item clickable @click="emit('edit')">
                <q-item-section avatar><q-icon name="edit" /></q-item-section>
                <q-item-section>Editar</q-item-section>
              </q-item>
              <q-item clickable @click="emit('remove')">
                <q-item-section avatar><q-icon name="delete" color="negative" /></q-item-section>
                <q-item-section>Eliminar</q-item-section>
              </q-item>
            </q-list>
          </q-menu>
        </q-btn>
        <div v-if="book.progress > 0 && !finished" class="progress">
          <div class="progress__bar" :style="{ width: `${book.progress * 100}%` }" />
        </div>
      </div>
    </div>
    <div class="plank" />
    <div class="title font-display ellipsis-2-lines">{{ book.title }}</div>
    <div class="author ellipsis">{{ book.author || 'Autor desconocido' }}</div>
  </div>
</template>

<style scoped>
.book-card {
  cursor: pointer;
  padding: 0 10px 18px;
  -webkit-tap-highlight-color: transparent;
}
.stand {
  perspective: 700px;
  padding-top: 10px;
}
.cover {
  position: relative;
  aspect-ratio: 2 / 3;
  border-radius: 3px 7px 7px 3px;
  overflow: hidden;
  transform-origin: bottom center;
  transition:
    transform 0.35s cubic-bezier(0.2, 0.8, 0.2, 1),
    box-shadow 0.35s;
  box-shadow:
    0 2px 0 rgba(0, 0, 0, 0.15),
    6px 6px 14px -6px rgba(0, 0, 0, 0.55);
}
.book-card:hover .cover {
  transform: translateY(-10px) rotateY(-14deg) rotateX(4deg);
  box-shadow:
    0 2px 0 rgba(0, 0, 0, 0.1),
    16px 18px 24px -10px rgba(0, 0, 0, 0.5);
}
.book-card:active .cover {
  transform: translateY(-4px) scale(0.97);
}
.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.spine {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    linear-gradient(90deg, rgba(0, 0, 0, 0.35) 0, rgba(255, 255, 255, 0.25) 3%, rgba(0, 0, 0, 0.12) 6%, transparent 10%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.12), transparent 40%);
}
.placeholder {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 12px 10px 12px 16px;
  text-align: center;
  color: #fff;
  font-size: 0.95rem;
  font-weight: 600;
  line-height: 1.2;
  overflow: hidden;
}
.ribbon {
  position: absolute;
  top: 12px;
  right: -30px;
  width: 110px;
  transform: rotate(45deg);
  text-align: center;
  background: var(--leaf);
  color: #fff;
  font-size: 0.68rem;
  font-weight: 800;
  padding: 3px 0;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
}
.new-badge {
  position: absolute;
  top: 6px;
  left: 8px;
  animation: pulse 1.8s ease-in-out infinite;
}
.format {
  position: absolute;
  bottom: 10px;
  left: 8px;
  font-size: 0.6rem;
}
.menu {
  position: absolute;
  top: 2px;
  right: 2px;
  background: rgba(0, 0, 0, 0.3);
  opacity: 0.85;
}
.progress {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 5px;
  background: rgba(0, 0, 0, 0.35);
}
.progress__bar {
  height: 100%;
  background: linear-gradient(90deg, var(--accent), #ffd166);
  border-radius: 0 3px 3px 0;
}
/* Tabla de la estantería: se extiende sobre el padding para unirse con la del libro vecino. */
.plank {
  height: 14px;
  margin: 0 -10px;
  background: linear-gradient(180deg, var(--wood-light) 0, var(--wood-light) 35%, var(--wood-dark) 100%);
  box-shadow: 0 8px 10px -6px rgba(60, 30, 10, 0.55);
}
.title {
  margin-top: 10px;
  font-weight: 600;
  font-size: 0.9rem;
  line-height: 1.15;
}
.author {
  font-size: 0.75rem;
  color: var(--ink-soft);
}
@keyframes pulse {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.12);
  }
}
</style>
