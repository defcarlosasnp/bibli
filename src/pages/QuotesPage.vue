<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useQuasar } from 'quasar'
import { liveQuery } from 'dexie'
import { db, type Book, type Highlight, type HighlightColor } from '@/db'
import { HIGHLIGHT_COLORS, copyText, removeHighlight, updateHighlight } from '@/services/highlights'
import HighlightDialog from '@/components/HighlightDialog.vue'
import LumiOwl from '@/components/LumiOwl.vue'

const router = useRouter()
const $q = useQuasar()

const highlights = ref<Highlight[]>([])
const books = ref<Book[]>([])
const subs = [
  liveQuery(() => db.highlights.orderBy('createdAt').reverse().toArray()).subscribe((v) => (highlights.value = v)),
  liveQuery(() => db.books.toArray()).subscribe((v) => (books.value = v)),
]
onBeforeUnmount(() => subs.forEach((s) => s.unsubscribe()))

const search = ref('')
const colorFilter = ref<HighlightColor | null>(null)
const onlyNotes = ref(false)

const bookById = computed(() => new Map(books.value.map((b) => [b.id, b])))

/** Agrupados por libro, el más reciente primero. */
const groups = computed(() => {
  const q = search.value.trim().toLowerCase()
  const filtered = highlights.value.filter(
    (h) =>
      (!colorFilter.value || h.color === colorFilter.value) &&
      (!onlyNotes.value || h.note.trim()) &&
      (!q || h.text.toLowerCase().includes(q) || h.note.toLowerCase().includes(q)),
  )
  const map = new Map<number, Highlight[]>()
  for (const h of filtered) map.set(h.bookId, [...(map.get(h.bookId) ?? []), h])
  return [...map.entries()].map(([bookId, items]) => ({ book: bookById.value.get(bookId), items }))
})

const fmt = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', year: 'numeric' })

function open(h: Highlight) {
  router.push({ name: 'reader', params: { id: h.bookId }, query: { at: h.position } })
}

async function copy(h: Highlight) {
  const title = bookById.value.get(h.bookId)?.title
  const ok = await copyText(title ? `«${h.text}» — ${title}` : h.text)
  $q.notify({ message: ok ? 'Frase copiada' : 'No se pudo copiar', icon: 'content_copy', timeout: 1200 })
}

function edit(h: Highlight) {
  $q.dialog({
    component: HighlightDialog,
    componentProps: { text: h.text, note: h.note, color: h.color, existing: true },
  }).onOk((r: { remove?: boolean; note?: string; color?: HighlightColor }) => {
    if (r.remove) removeHighlight(h.id)
    else updateHighlight(h.id, { note: r.note ?? '', color: r.color ?? h.color })
  })
}
</script>

<template>
  <q-layout view="hHh lpR fFf">
    <q-header class="app-header">
      <q-toolbar>
        <q-btn flat round icon="arrow_back" aria-label="Volver" @click="router.push({ name: 'library' })" />
        <q-toolbar-title class="font-display text-weight-bold">Mis frases</q-toolbar-title>
      </q-toolbar>
      <q-toolbar v-if="highlights.length" class="filters">
        <q-input v-model="search" dense rounded standout clearable placeholder="Buscar en frases y notas" class="col">
          <template #prepend><q-icon name="search" /></template>
        </q-input>
      </q-toolbar>
      <div v-if="highlights.length" class="chips">
        <q-chip
          v-for="(c, name) in HIGHLIGHT_COLORS"
          :key="name"
          clickable
          :outline="colorFilter !== name"
          :style="colorFilter === name ? { background: c.solid } : {}"
          @click="colorFilter = colorFilter === name ? null : name"
        >
          <span class="dot" :style="{ background: c.solid }" /> {{ c.label }}
        </q-chip>
        <q-chip clickable :outline="!onlyNotes" icon="edit_note" :color="onlyNotes ? 'accent' : undefined" :text-color="onlyNotes ? 'white' : undefined" @click="onlyNotes = !onlyNotes">
          Con nota
        </q-chip>
      </div>
    </q-header>

    <q-page-container>
      <q-page class="page">
        <div v-if="!highlights.length" class="empty">
          <LumiOwl mood="happy" :size="110" />
          <h2 class="font-display">Aún no tienes frases guardadas</h2>
          <p>
            En el lector, mantén pulsado el texto (o selecciónalo) y elige un color para subrayarlo.
            Todas tus frases favoritas aparecerán aquí.
          </p>
        </div>

        <div v-else-if="!groups.length" class="empty">
          <LumiOwl mood="sleepy" :size="90" />
          <p>No hay frases con esos filtros.</p>
        </div>

        <section v-for="g in groups" :key="g.book?.id ?? 0" class="group">
          <h2 class="group__title font-display">
            <img v-if="g.book?.cover" :src="g.book.cover" alt="" class="group__cover" />
            {{ g.book?.title ?? 'Libro eliminado' }}
            <span class="muted">· {{ g.items.length }}</span>
          </h2>
          <article
            v-for="h in g.items"
            :key="h.id"
            class="quote"
            :style="{ '--hl': HIGHLIGHT_COLORS[h.color].solid }"
          >
            <blockquote class="font-display">{{ h.text }}</blockquote>
            <p v-if="h.note" class="note">📝 {{ h.note }}</p>
            <div class="row items-center">
              <span class="muted">{{ fmt.format(h.createdAt) }}</span>
              <q-space />
              <q-btn v-if="g.book" flat dense round icon="menu_book" aria-label="Abrir en el libro" @click="open(h)">
                <q-tooltip>Abrir en el libro</q-tooltip>
              </q-btn>
              <q-btn flat dense round icon="content_copy" aria-label="Copiar" @click="copy(h)">
                <q-tooltip>Copiar</q-tooltip>
              </q-btn>
              <q-btn flat dense round icon="edit" aria-label="Editar" @click="edit(h)">
                <q-tooltip>Editar o borrar</q-tooltip>
              </q-btn>
            </div>
          </article>
        </section>
      </q-page>
    </q-page-container>
  </q-layout>
</template>

<style scoped>
.app-header {
  background: color-mix(in srgb, var(--paper) 88%, transparent);
  backdrop-filter: blur(12px);
  color: var(--ink);
  border-bottom: 1px solid color-mix(in srgb, var(--ink) 8%, transparent);
}
.filters {
  min-height: 0;
  padding-bottom: 4px;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  padding: 0 12px 8px;
}
.dot {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  margin-right: 6px;
}
.page {
  max-width: 760px;
  margin: 0 auto;
  padding: 16px;
}
.muted {
  color: var(--ink-soft);
  font-size: 0.8rem;
  font-family: var(--font-body);
  font-weight: 400;
}
.empty {
  text-align: center;
  padding: 40px 16px;
  color: var(--ink-soft);
}
.empty h2 {
  color: var(--ink);
  font-size: 1.3rem;
}
.group + .group {
  margin-top: 24px;
}
.group__title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 1.15rem;
  margin: 0 0 10px;
}
.group__cover {
  width: 32px;
  height: 46px;
  object-fit: cover;
  border-radius: 3px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
}
.quote {
  background: var(--card);
  border-radius: 16px;
  box-shadow: var(--shadow);
  padding: 14px 14px 6px 18px;
  margin-bottom: 12px;
  border-left: 6px solid var(--hl);
}
blockquote {
  margin: 0;
  font-size: 1.05rem;
  line-height: 1.45;
  font-style: italic;
}
.note {
  margin: 8px 0 0;
  padding: 8px 10px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--hl) 22%, transparent);
  font-size: 0.9rem;
}
</style>
