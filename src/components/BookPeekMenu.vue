<script setup lang="ts">
import type { Book } from '@/db'
import { computed } from 'vue'
import { FINISHED_THRESHOLD, formatDuration } from '@/services/stats'
import { askRating, openNotebook, shortDate } from '@/services/bookActions'

/** Al tocar un lomo en la estantería: la portada y lo que se puede hacer con el libro. */
const props = defineProps<{ book: Book }>()
const emit = defineEmits<{ open: []; edit: []; shelves: []; remove: [] }>()

/** Empezado el 3 nov · Terminado el 18 nov · 12 h 30 min leídas */
const history = computed(() => {
  const b = props.book
  const parts: string[] = []
  if (b.startedAt) parts.push(`Empezado el ${shortDate(b.startedAt)}`)
  if (b.finishedAt) parts.push(`Terminado el ${shortDate(b.finishedAt)}`)
  if (b.readingSeconds && b.readingSeconds >= 60) parts.push(`${formatDuration(b.readingSeconds)} de lectura`)
  return parts
})
</script>

<template>
  <q-menu anchor="top middle" self="bottom middle" :offset="[0, 10]" transition-show="jump-up" transition-hide="fade">
    <div class="peek">
      <div class="peek__cover">
        <img v-if="book.cover" :src="book.cover" :alt="book.title" />
        <q-icon v-else name="auto_stories" size="32px" />
      </div>
      <div class="peek__info">
        <div class="peek__title font-display">{{ book.title }}</div>
        <div class="peek__author">{{ book.author || 'Autor desconocido' }}</div>
        <div v-if="book.series" class="peek__series">
          {{ book.series }}<template v-if="book.seriesIndex"> · nº {{ book.seriesIndex }}</template>
        </div>
        <div class="peek__meta">
          <q-badge :color="book.format === 'pdf' ? 'red-6' : 'teal-6'" rounded>{{ book.format.toUpperCase() }}</q-badge>
          <span v-if="book.progress >= FINISHED_THRESHOLD">🏆 Leído</span>
          <span v-else-if="book.progress > 0">{{ Math.round(book.progress * 100) }}% leído</span>
          <span v-else>Sin empezar</span>
        </div>
        <div v-if="book.rating" class="peek__stars" :title="book.review">
          {{ '★'.repeat(book.rating) }}<span class="peek__stars-off">{{ '★'.repeat(5 - book.rating) }}</span>
        </div>
        <div v-if="book.review" class="peek__review">«{{ book.review }}»</div>
        <div v-if="history.length" class="peek__history">
          <div v-for="line in history" :key="line">{{ line }}</div>
        </div>
        <q-linear-progress
          v-if="book.progress > 0 && book.progress < FINISHED_THRESHOLD"
          :value="book.progress"
          color="accent"
          rounded
          class="q-mt-xs"
        />
        <q-btn
          v-close-popup
          unelevated
          rounded
          no-caps
          color="accent"
          icon="menu_book"
          :label="book.progress > 0 ? 'Seguir leyendo' : 'Empezar'"
          class="q-mt-sm full-width"
          @click="emit('open')"
        />
        <div class="row justify-between q-mt-xs">
          <q-btn v-close-popup flat round dense icon="edit" aria-label="Editar" @click="emit('edit')">
            <q-tooltip>Editar</q-tooltip>
          </q-btn>
          <q-btn v-close-popup flat round dense icon="menu_book" aria-label="Cuaderno" @click="openNotebook(book)">
            <q-tooltip>Cuaderno del libro</q-tooltip>
          </q-btn>
          <q-btn v-close-popup flat round dense :icon="book.rating ? 'star' : 'star_border'" aria-label="Valorar" @click="askRating(book)">
            <q-tooltip>Valorar</q-tooltip>
          </q-btn>
          <q-btn v-close-popup flat round dense icon="collections_bookmark" aria-label="Estanterías" @click="emit('shelves')">
            <q-tooltip>Estanterías</q-tooltip>
          </q-btn>
          <q-btn v-close-popup flat round dense icon="delete_outline" color="negative" aria-label="Eliminar" @click="emit('remove')">
            <q-tooltip>Eliminar</q-tooltip>
          </q-btn>
        </div>
      </div>
    </div>
  </q-menu>
</template>

<style scoped>
.peek {
  display: flex;
  gap: 12px;
  padding: 12px;
  width: 300px;
  max-width: 88vw;
}
.peek__cover {
  flex: 0 0 86px;
  aspect-ratio: 2 / 3;
  border-radius: 3px 6px 6px 3px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(128, 128, 128, 0.2);
  box-shadow: 0 6px 14px -4px rgba(0, 0, 0, 0.45);
}
.peek__cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.peek__info {
  flex: 1;
  min-width: 0;
}
.peek__title {
  font-weight: 700;
  line-height: 1.2;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.peek__author {
  font-size: 0.8rem;
  opacity: 0.7;
  margin-top: 2px;
}
.peek__series {
  font-size: 0.75rem;
  color: var(--accent);
  font-weight: 600;
  margin-top: 2px;
}
.peek__stars {
  color: #f2b13c;
  letter-spacing: 1px;
  margin-top: 4px;
}
.peek__stars-off {
  opacity: 0.25;
}
.peek__review {
  font-size: 0.75rem;
  font-style: italic;
  opacity: 0.8;
  margin-top: 2px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.peek__history {
  font-size: 0.7rem;
  opacity: 0.65;
  margin-top: 4px;
  line-height: 1.35;
}
.peek__meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.75rem;
  margin-top: 6px;
  opacity: 0.85;
}
</style>
