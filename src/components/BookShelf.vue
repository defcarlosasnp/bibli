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
  /** Diseño del lomo: filetes dorados, etiqueta, nervios de cuero o franja superior. */
  variant: number
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

/** Todos los libros de pie, cada uno con su grosor, alto y diseño de lomo. */
const items = computed<Standing[]>(() =>
  props.books.map((b) => {
    const s = seed(b)
    // Los títulos largos, en libros algo más gruesos (como en la vida real)
    const w = 29 + (s % 13) + Math.min(10, Math.round(b.title.length / 4))
    const h = 172 + ((s >> 4) % 42)
    return {
      type: 'standing' as const,
      key: `b-${b.id}`,
      book: b,
      w,
      h,
      showAuthor: fitsAuthor(b, h),
      variant: (s >> 11) % 4,
    }
  }),
)

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
  <!-- El mueble mide lo que ocupan los libros (más un hueco para el siguiente) y crece al añadir más -->
  <div class="bookcase">
    <div class="cornice" aria-hidden="true" />
    <div ref="caseEl" class="shelves">
      <template v-for="item in items" :key="item.key">
        <div class="slot slot--standing" :data-id="item.book.id">
          <button
            class="spine"
            :class="[`spine--v${item.variant}`, { 'spine--done': finished(item.book) }]"
            :style="{
              '--w': `${item.w}px`,
              '--h': `${item.h}px`,
              '--c': colors[item.book.id]?.bg,
              '--fg': colors[item.book.id]?.fg,
            }"
            :aria-label="item.book.title"
          >
            <span v-if="item.book.seriesIndex" class="spine__num">{{ item.book.seriesIndex }}</span>
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
      </template>
      <!-- Sujetalibros y una planta al final (no se pueden arrastrar) -->
      <div class="slot slot--deco" aria-hidden="true">
        <span class="bookend" />
        <span class="plant">🪴</span>
      </div>
    </div>
    <div class="plinth" aria-hidden="true"><span class="foot" /><span class="foot" /></div>
  </div>
</template>

<style scoped>
.bookcase {
  /* Alto de cada balda y grosor de la tabla; --s escala los libros en pantallas pequeñas */
  --row: 252px;
  --plank: 18px;
  --side: 16px;
  --s: 1;
  --wood-hi: #c99263;
  --wood: #9c663a;
  --wood-lo: #6a3f21;
  --back: #3b2517;
  /* Veta de la madera: rayas finas irregulares */
  --grain: repeating-linear-gradient(
    92deg,
    rgba(0, 0, 0, 0.06) 0 2px,
    transparent 2px 7px,
    rgba(255, 255, 255, 0.04) 7px 8px,
    transparent 8px 15px,
    rgba(0, 0, 0, 0.04) 15px 18px,
    transparent 18px 29px
  );
  /* Tan ancho como los libros (hasta llenar la pantalla y pasar a otra balda), con un mínimo */
  width: fit-content;
  max-width: 100%;
  min-width: min(100%, 320px);
  margin: 6px 0 0;
  filter: drop-shadow(0 22px 22px rgba(30, 14, 4, 0.45));
}
.cornice {
  position: relative;
  height: 24px;
  margin: 0 -10px;
  border-radius: 6px 6px 2px 2px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.22), transparent 30%, transparent 62%, rgba(0, 0, 0, 0.35) 62%, rgba(0, 0, 0, 0.15) 70%, transparent 71%),
    var(--grain),
    linear-gradient(180deg, var(--wood-hi), var(--wood) 55%, var(--wood-lo));
  box-shadow: 0 4px 6px -2px rgba(0, 0, 0, 0.5);
  z-index: 1;
}
.shelves {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  /* Hueco al final para que quepa el siguiente libro */
  padding: 0 calc(var(--side) + 14px) 0 calc(var(--side) + 12px);
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
    linear-gradient(to bottom, rgba(0, 0, 0, 0.5), transparent 26px) 0 0 / 100% var(--row) repeat-y,
    /* Laterales del mueble */
    linear-gradient(90deg, var(--wood-lo), var(--wood) 30%, var(--wood-hi) 70%, var(--wood-lo)) left / var(--side) 100% no-repeat,
    linear-gradient(90deg, var(--wood-lo), var(--wood-hi) 30%, var(--wood) 70%, var(--wood-lo)) right / var(--side) 100% no-repeat,
    /* Fondo: tablas verticales con algo de veta */
    repeating-linear-gradient(90deg, rgba(0, 0, 0, 0.28) 0 1px, transparent 1px 64px),
    var(--grain),
    linear-gradient(180deg, color-mix(in srgb, var(--back) 80%, #000), var(--back) 40%, color-mix(in srgb, var(--back) 88%, #000));
}
/* Profundidad: sombra dentro del mueble junto a los laterales y luz cálida desde arriba */
.shelves::before {
  content: '';
  position: absolute;
  inset: 0 var(--side);
  pointer-events: none;
  background:
    radial-gradient(ellipse 60% 120px at 50% 0, rgba(255, 196, 120, 0.16), transparent 70%),
    linear-gradient(90deg, rgba(0, 0, 0, 0.45), transparent 22px, transparent calc(100% - 22px), rgba(0, 0, 0, 0.45));
}
.plinth {
  position: relative;
  height: 26px;
  margin: 0 -6px;
  border-radius: 2px 2px 4px 4px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.18), transparent 25%, transparent 75%, rgba(0, 0, 0, 0.3)),
    var(--grain),
    linear-gradient(180deg, var(--wood), var(--wood-lo));
}
.foot {
  position: absolute;
  bottom: -9px;
  width: 26px;
  height: 10px;
  border-radius: 0 0 5px 5px;
  background: linear-gradient(180deg, var(--wood-lo), #3e2412);
}
.foot:first-child {
  left: 14px;
}
.foot:last-child {
  right: 14px;
}
/* Pantallas grandes: libros más grandes y un mueble que no se pierda en tanto espacio */
@media (min-width: 1024px) {
  .bookcase {
    --row: 296px;
    --plank: 20px;
    --side: 18px;
    --s: 1.2;
    min-width: min(100%, 720px);
  }
}
@media (max-width: 599px) {
  .bookcase {
    --row: 214px;
    --plank: 15px;
    --side: 10px;
    --s: 0.82;
  }
  .shelves {
    padding: 0 calc(var(--side) + 6px);
  }
}

.slot {
  position: relative;
  height: var(--row);
  padding-bottom: var(--plank);
  display: flex;
  align-items: flex-end;
}
.slot--standing {
  margin-right: 2px;
}

/* ---------- Decoración ---------- */
.slot--deco {
  gap: 10px;
  margin-left: 2px;
  pointer-events: none;
  /* Solo ocupa el hueco que sobre en la última balda: nunca abre una balda nueva para ella sola */
  flex: 1 0 0;
  min-width: 0;
  overflow: hidden;
  padding-left: 2px;
}
.bookend {
  flex-shrink: 0;
  width: calc(14px * var(--s));
  height: calc(86px * var(--s));
  border-radius: 3px 3px 0 0;
  background: linear-gradient(90deg, #2b2b2e, #6d6d73 40%, #3a3a3e);
  box-shadow: 2px 0 4px rgba(0, 0, 0, 0.5);
  position: relative;
}
.bookend::after {
  content: '';
  position: absolute;
  bottom: 0;
  right: calc(-22px * var(--s));
  width: calc(24px * var(--s));
  height: 4px;
  background: #4a4a4f;
}
.plant {
  flex-shrink: 0;
  /* Al otro extremo de la balda: rellena el hueco cuando hay pocos libros */
  margin-left: auto;
  margin-right: 6px;
  font-size: calc(54px * var(--s));
  line-height: 1;
  margin-bottom: -4px;
  filter: drop-shadow(0 3px 3px rgba(0, 0, 0, 0.5));
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
  background:
    repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.035) 0 1px, transparent 1px 3px),
    linear-gradient(
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
/* ---------- Diseños de lomo ---------- */
/* 1: el título en una etiqueta oscura con borde dorado */
.spine--v1::after {
  display: none;
}
.spine--v1 .spine__title {
  padding: 8px 3px;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(232, 190, 110, 0.55);
  border-radius: 2px;
}
/* 2: nervios de cuero (relieves horizontales arriba y abajo) */
.spine--v2::after {
  border: 0;
  top: 0;
  bottom: 0;
  left: 0;
  right: 0;
  background: linear-gradient(
    to bottom,
    transparent 7%,
    rgba(0, 0, 0, 0.4) 7% 8.2%,
    rgba(255, 255, 255, 0.2) 8.2% 9.4%,
    transparent 9.4% 12%,
    rgba(0, 0, 0, 0.4) 12% 13.2%,
    rgba(255, 255, 255, 0.2) 13.2% 14.4%,
    transparent 14.4% 85.6%,
    rgba(0, 0, 0, 0.4) 85.6% 86.8%,
    rgba(255, 255, 255, 0.2) 86.8% 88%,
    transparent 88% 90.6%,
    rgba(0, 0, 0, 0.4) 90.6% 91.8%,
    rgba(255, 255, 255, 0.2) 91.8% 93%,
    transparent 93%
  );
}
.spine--v2 {
  padding-top: calc(30px * var(--s));
  padding-bottom: calc(24px * var(--s));
}
/* 3: franja oscura arriba con un filete dorado, como las colecciones de bolsillo */
.spine--v3::after {
  border: 0;
  top: 0;
  bottom: auto;
  left: 0;
  right: 0;
  height: 17%;
  background: rgba(0, 0, 0, 0.32);
  border-bottom: 2px solid rgba(232, 190, 110, 0.6);
  border-radius: 3px 3px 0 0;
}
.spine--v3 {
  padding-top: calc(42px * var(--s));
}
/* Número dentro de la saga, arriba del lomo */
.spine__num {
  position: relative;
  flex: 0 0 auto;
  min-width: calc(17px * var(--s));
  height: calc(17px * var(--s));
  margin-top: calc(-6px * var(--s));
  padding: 0 3px;
  border-radius: 999px;
  border: 1px solid rgba(232, 190, 110, 0.7);
  font-size: calc(10px * var(--s));
  font-weight: 700;
  line-height: calc(15px * var(--s));
  text-align: center;
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

/* Mientras se arrastra */
.drag-ghost .spine {
  opacity: 0.35;
}
.drag-chosen .spine {
  transform: translateY(-14px) rotate(-3deg);
  box-shadow: 6px 10px 18px rgba(0, 0, 0, 0.5);
}
</style>
