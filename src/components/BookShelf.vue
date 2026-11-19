<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type { Book } from '@/db'
import BookPeekMenu from './BookPeekMenu.vue'
import { FINISHED_THRESHOLD } from '@/services/stats'
import { fallbackColor, spineColor, type SpineColor } from '@/services/coverColor'
import { useSortableBooks } from '@/composables/useSortableBooks'

/**
 * Estantería de verdad: los libros de pie enseñando el lomo, sobre baldas de madera, y de vez en
 * cuando un montoncito de libros tumbados. Se pueden arrastrar (los de pie) para cambiar el orden.
 */
const props = defineProps<{ books: Book[] }>()
const emit = defineEmits<{
  open: [Book]
  edit: [Book]
  shelves: [Book]
  remove: [Book]
  reorder: [number[]]
}>()

/** Número estable a partir del libro, para que cada uno tenga siempre el mismo grosor y alto. */
function seed(b: Book) {
  let h = 7
  for (const ch of b.hash || b.title) h = (h * 33 + ch.charCodeAt(0)) >>> 0
  return h
}

interface Standing {
  type: 'standing'
  key: string
  book: Book
  w: number
  h: number
  /** El apellido solo se pone si cabe sin cortar el título. */
  showAuthor: boolean
}
interface Stack {
  type: 'stack'
  key: string
  books: { book: Book; len: number; thick: number; shift: number }[]
}

/** "Brandon Sanderson" → "Sanderson" */
const surname = (a: string) => a.trim().split(/\s+/).at(-1) ?? ''

/** Cálculo aproximado (a tamaño normal): letras de ~7,6 px el título y ~6,8 px el autor. */
function fitsAuthor(b: Book, h: number) {
  const name = surname(b.author)
  if (!name) return false
  const usable = h - 38
  return b.title.length * 7.6 + name.length * 6.8 + 14 <= usable
}

/** Cada 7 libros, los 2 últimos van tumbados uno encima del otro (con 4–6 libros, los 2 últimos). */
const items = computed<(Standing | Stack)[]>(() => {
  const list = props.books
  const out: (Standing | Stack)[] = []
  const stacked = (i: number) => {
    if (list.length >= 4 && list.length < 7) return i >= list.length - 2
    const group = Math.floor(i / 7)
    const full = (group + 1) * 7 <= list.length
    return full && i % 7 >= 5
  }
  for (let i = 0; i < list.length; i++) {
    const b = list[i]
    const s = seed(b)
    if (stacked(i)) {
      const last = out[out.length - 1]
      const entry = { book: b, len: 128 + (s % 34), thick: 22 + ((s >> 5) % 8), shift: ((s >> 9) % 14) - 7 }
      if (last?.type === 'stack') last.books.push(entry)
      else out.push({ type: 'stack', key: `stack-${b.id}`, books: [entry] })
    } else {
      // Los títulos largos, en libros algo más gruesos (como en la vida real)
      const w = 29 + (s % 13) + Math.min(10, Math.round(b.title.length / 4))
      const h = 172 + ((s >> 4) % 42)
      out.push({ type: 'standing', key: `b-${b.id}`, book: b, w, h, showAuthor: fitsAuthor(b, h) })
    }
  }
  return out
})

// ---------- Color de cada lomo (de su portada) ----------
const colors = reactive<Record<number, SpineColor>>({})
watch(
  () => props.books.map((b) => b.id),
  () => {
    for (const b of props.books) {
      if (colors[b.id]) continue
      colors[b.id] = fallbackColor(b.title)
      spineColor(b.cover, b.title).then((c) => (colors[b.id] = c))
    }
  },
  { immediate: true },
)

const reading = (b: Book) => b.progress > 0 && b.progress < FINISHED_THRESHOLD
const finished = (b: Book) => b.progress >= FINISHED_THRESHOLD

const caseEl = ref<HTMLElement>()
useSortableBooks(caseEl, '.slot--standing', (ids) => emit('reorder', ids))
</script>

<template>
  <div ref="caseEl" class="bookcase">
    <template v-for="item in items" :key="item.key">
      <div v-if="item.type === 'standing'" class="slot slot--standing" :data-id="item.book.id">
        <button
          class="spine"
          :class="{ 'spine--done': finished(item.book) }"
          :style="{
            '--w': `${item.w}px`,
            '--h': `${item.h}px`,
            '--c': colors[item.book.id]?.bg,
            '--fg': colors[item.book.id]?.fg,
          }"
          :aria-label="item.book.title"
        >
          <span class="spine__title font-display">{{ item.book.title }}</span>
          <span v-if="item.showAuthor" class="spine__author">{{ surname(item.book.author) }}</span>
          <span v-if="reading(item.book)" class="spine__ribbon" />
          <BookPeekMenu
            :book="item.book"
            @open="emit('open', item.book)"
            @edit="emit('edit', item.book)"
            @shelves="emit('shelves', item.book)"
            @remove="emit('remove', item.book)"
          />
        </button>
      </div>
      <div v-else class="slot slot--stack">
        <button
          v-for="entry in item.books"
          :key="entry.book.id"
          class="lying"
          :data-id="entry.book.id"
          :style="{
            '--len': `${entry.len}px`,
            '--thick': `${entry.thick}px`,
            '--shift': `${entry.shift}px`,
            '--c': colors[entry.book.id]?.bg,
            '--fg': colors[entry.book.id]?.fg,
          }"
          :aria-label="entry.book.title"
        >
          <span class="lying__title font-display">{{ entry.book.title }}</span>
          <BookPeekMenu
            :book="entry.book"
            @open="emit('open', entry.book)"
            @edit="emit('edit', entry.book)"
            @shelves="emit('shelves', entry.book)"
            @remove="emit('remove', entry.book)"
          />
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.bookcase {
  /* Alto de cada balda y grosor de la tabla; --s escala los libros en pantallas pequeñas */
  --row: 252px;
  --plank: 18px;
  --s: 1;
  --wood-hi: #c48a5a;
  --wood: #9a6438;
  --wood-lo: #6b4123;
  --back: #3a2416;
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  padding: 0 16px;
  border: 12px solid var(--wood);
  border-top-width: 14px;
  border-bottom: 0;
  border-radius: 10px 10px 4px 4px;
  background:
    /* Tabla de cada balda: borde claro arriba, canto oscuro abajo */
    linear-gradient(
        to bottom,
        transparent calc(var(--row) - var(--plank)),
        var(--wood-hi) calc(var(--row) - var(--plank)),
        var(--wood) calc(var(--row) - var(--plank) + 4px),
        var(--wood) calc(var(--row) - 6px),
        var(--wood-lo) calc(var(--row) - 6px),
        var(--wood-lo) var(--row)
      )
      0 0 / 100% var(--row) repeat-y,
    /* Sombra que cada balda proyecta sobre el fondo de la de abajo */
    linear-gradient(to bottom, rgba(0, 0, 0, 0.45), transparent 22px) 0 0 / 100% var(--row) repeat-y,
    /* Fondo del mueble, con algo de veta */
    repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.025) 0 2px, transparent 2px 23px),
    linear-gradient(180deg, color-mix(in srgb, var(--back) 85%, #000), var(--back));
  box-shadow:
    inset 0 10px 18px -8px rgba(0, 0, 0, 0.6),
    0 18px 30px -18px rgba(40, 20, 5, 0.7);
  /* El borde de madera con algo de brillo */
  border-image: linear-gradient(180deg, var(--wood-hi), var(--wood) 30%, var(--wood-lo)) 14;
}
.body--light .bookcase {
  --back: #5a3a24;
}
@media (max-width: 599px) {
  .bookcase {
    --row: 214px;
    --plank: 15px;
    --s: 0.82;
    padding: 0 8px;
    border-width: 8px;
    border-top-width: 10px;
  }
}

.slot {
  height: var(--row);
  padding-bottom: var(--plank);
  display: flex;
  align-items: flex-end;
}
.slot--standing {
  margin-right: 2px;
}
.slot--stack {
  flex-direction: column;
  justify-content: flex-end;
  align-items: center;
  margin: 0 6px 0 4px;
}

/* ---------- Libro de pie ---------- */
.spine {
  position: relative;
  width: calc(var(--w) * var(--s));
  height: calc(var(--h) * var(--s));
  padding: calc(16px * var(--s)) 0 calc(12px * var(--s));
  border: 0;
  border-radius: 3px 3px 1px 1px;
  background: var(--c, #6b4123);
  color: var(--fg, #f6ead8);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  cursor: pointer;
  box-shadow:
    inset 0 0 0 1px rgba(0, 0, 0, 0.25),
    2px 0 3px rgba(0, 0, 0, 0.35);
  transition:
    transform 0.25s cubic-bezier(0.3, 1.4, 0.5, 1),
    box-shadow 0.25s,
    background-color 0.6s;
}
/* Curvatura del lomo */
.spine::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: linear-gradient(
    90deg,
    rgba(0, 0, 0, 0.35),
    rgba(255, 255, 255, 0.16) 22%,
    rgba(255, 255, 255, 0) 48%,
    rgba(0, 0, 0, 0.12) 78%,
    rgba(0, 0, 0, 0.38)
  );
  pointer-events: none;
}
/* Filetes dorados arriba y abajo */
.spine::after {
  content: '';
  position: absolute;
  left: 3px;
  right: 3px;
  top: calc(8px * var(--s));
  bottom: calc(6px * var(--s));
  border-top: 2px solid rgba(232, 190, 110, 0.55);
  border-bottom: 2px solid rgba(232, 190, 110, 0.55);
  pointer-events: none;
}
.spine:hover,
.spine:focus-visible {
  transform: translateY(-10px);
  box-shadow:
    inset 0 0 0 1px rgba(0, 0, 0, 0.25),
    4px 6px 10px rgba(0, 0, 0, 0.45);
  outline: none;
}
.spine__title,
.spine__author {
  position: relative;
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1;
}
.spine__title {
  flex: 1 1 auto;
  min-height: 0;
  font-weight: 700;
  font-size: calc(12.5px * var(--s));
  letter-spacing: 0.02em;
}
.spine__author {
  flex: 0 1 auto;
  max-height: 34%;
  font-size: calc(9.5px * var(--s));
  text-transform: uppercase;
  letter-spacing: 0.08em;
  opacity: 0.8;
}
/* Cinta de punto de lectura asomando por abajo: el libro que vas leyendo */
.spine__ribbon {
  position: absolute;
  right: 22%;
  bottom: -12px;
  width: 7px;
  height: 20px;
  background: var(--accent, #f29e38);
  clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 78%, 0 100%);
  filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.4));
}
.spine--done .spine__title::before {
  content: '★ ';
  color: #f2c45a;
}

/* ---------- Libros tumbados ---------- */
.lying {
  position: relative;
  width: calc(var(--len) * var(--s));
  height: calc(var(--thick) * var(--s));
  transform: translateX(var(--shift));
  border: 0;
  border-radius: 2px 4px 4px 2px;
  background: var(--c, #6b4123);
  color: var(--fg, #f6ead8);
  padding: 0 10px;
  display: flex;
  align-items: center;
  cursor: pointer;
  box-shadow:
    inset 0 0 0 1px rgba(0, 0, 0, 0.25),
    0 2px 3px rgba(0, 0, 0, 0.35);
  transition: transform 0.25s cubic-bezier(0.3, 1.4, 0.5, 1);
}
.lying::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.16), transparent 45%, rgba(0, 0, 0, 0.3));
  pointer-events: none;
}
.lying:hover,
.lying:focus-visible {
  transform: translateX(calc(var(--shift) + 10px));
  outline: none;
}
.lying__title {
  position: relative;
  font-size: calc(11px * var(--s));
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Mientras se arrastra */
.drag-ghost .spine {
  opacity: 0.35;
}
.drag-chosen .spine {
  transform: translateY(-14px) rotate(-3deg);
  box-shadow: 6px 10px 18px rgba(0, 0, 0, 0.5);
}
</style>
