<script setup lang="ts">
import type { Book } from '@/db'

defineProps<{ books: Book[] }>()
const emit = defineEmits<{ open: [book: Book] }>()

const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' })

function lastRead(ts: number | null): string {
  if (!ts) return ''
  const minutes = Math.round((ts - Date.now()) / 60000)
  if (minutes > -60) return rtf.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (hours > -24) return rtf.format(hours, 'hour')
  return rtf.format(Math.round(hours / 24), 'day')
}
</script>

<template>
  <div class="carousel">
    <div
      v-for="(book, i) in books"
      :key="book.id"
      class="item"
      :style="{ '--i': i }"
      @click="emit('open', book)"
    >
      <div class="cover">
        <img v-if="book.cover" :src="book.cover" :alt="book.title" />
        <div v-else class="cover__placeholder font-display">{{ book.title }}</div>
        <div class="cover__shine" />
      </div>
      <div class="info">
        <div class="title font-display ellipsis-2-lines">{{ book.title }}</div>
        <div class="author ellipsis">{{ book.author || 'Autor desconocido' }}</div>
        <div class="row items-center no-wrap q-mt-sm">
          <q-circular-progress
            :value="book.progress * 100"
            size="38px"
            :thickness="0.22"
            color="accent"
            track-color="grey-3"
            show-value
            class="text-weight-bold"
            font-size="10px"
          >
            {{ Math.round(book.progress * 100) }}%
          </q-circular-progress>
          <div class="q-ml-sm when">{{ lastRead(book.lastOpenedAt) }}</div>
        </div>
        <q-btn
          unelevated
          rounded
          dense
          no-caps
          color="primary"
          icon-right="play_arrow"
          label="Seguir"
          class="q-mt-sm q-px-sm"
          @click.stop="emit('open', book)"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.carousel {
  display: flex;
  gap: 14px;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  padding: 4px 4px 14px;
  margin: 0 -4px;
  scrollbar-width: none;
}
.item {
  scroll-snap-align: start;
  flex: 0 0 auto;
  width: 260px;
  display: flex;
  gap: 12px;
  padding: 12px;
  border-radius: 18px;
  background: var(--card);
  box-shadow: var(--shadow);
  cursor: pointer;
  transition: transform 0.2s;
  animation: slide-in 0.5s cubic-bezier(0.2, 0.8, 0.2, 1) backwards;
  animation-delay: calc(var(--i) * 80ms);
}
.item:hover {
  transform: translateY(-3px);
}
.item:active {
  transform: scale(0.98);
}
.cover {
  position: relative;
  flex: 0 0 86px;
  aspect-ratio: 2 / 3;
  border-radius: 4px 8px 8px 4px;
  overflow: hidden;
  box-shadow:
    inset 4px 0 6px -3px rgba(0, 0, 0, 0.4),
    0 6px 14px -6px rgba(0, 0, 0, 0.5);
}
.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cover__placeholder {
  height: 100%;
  padding: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  color: white;
  background: linear-gradient(135deg, #8a5534, #e2654a);
  font-size: 0.8rem;
}
.cover__shine {
  position: absolute;
  inset: 0;
  background: linear-gradient(105deg, transparent 40%, rgba(255, 255, 255, 0.35) 50%, transparent 60%);
  transform: translateX(-100%);
  animation: shine 4s ease-in-out infinite;
  animation-delay: calc(var(--i) * 0.7s + 1s);
}
.info {
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.title {
  font-weight: 600;
  line-height: 1.15;
}
.author,
.when {
  font-size: 0.78rem;
  color: var(--ink-soft);
}
@keyframes slide-in {
  from {
    opacity: 0;
    transform: translateX(30px);
  }
}
@keyframes shine {
  0%,
  70% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(100%);
  }
}
</style>
