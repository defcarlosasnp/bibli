<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, type ComponentPublicInstance } from 'vue'
import { useRouter } from 'vue-router'
import { useQuasar } from 'quasar'
import { storeToRefs } from 'pinia'
import { liveQuery } from 'dexie'
import BookCard from '@/components/BookCard.vue'
import BookListItem from '@/components/BookListItem.vue'
import BookEditDialog from '@/components/BookEditDialog.vue'
import ReadingBuddy from '@/components/ReadingBuddy.vue'
import ContinueReading from '@/components/ContinueReading.vue'
import LumiOwl from '@/components/LumiOwl.vue'
import ShelvesDialog from '@/components/ShelvesDialog.vue'
import BookShelf from '@/components/BookShelf.vue'
import { useSortableBooks } from '@/composables/useSortableBooks'
import BackupDialog from '@/components/BackupDialog.vue'
import { bookStatus, useLibraryStore, type SortKey, type StatusFilter } from '@/stores/library'
import { FINISHED_THRESHOLD, celebrate, dailyGoalMinutes, dayKey, formatDuration, greeting, streakFrom } from '@/services/stats'
import { checkAchievements, setAchievementAnnouncer } from '@/services/achievements'
import { outfitFor } from '@/services/lumi'
import { db, type Book, type ReadingDay } from '@/db'

const $q = useQuasar()
const router = useRouter()
const library = useLibraryStore()
const { visibleBooks, books, loaded, search, sortKey, formatFilter, tagFilter, statusFilter, viewMode, allTags } =
  storeToRefs(library)

const fileInput = ref<HTMLInputElement>()
const buddy = ref<InstanceType<typeof ReadingBuddy>>()
const importing = ref(false)
const dragging = ref(false)
const days = ref<ReadingDay[]>([])
const daysSub = liveQuery(() => db.days.toArray()).subscribe((list) => (days.value = list))
const streak = computed(() => streakFrom(days.value))
const goalSeconds = dailyGoalMinutes() * 60
const todaySeconds = computed(() => days.value.find((d) => d.date === dayKey())?.seconds ?? 0)
const goalPercent = computed(() => Math.min(100, Math.round((todaySeconds.value / goalSeconds) * 100)))
const hello = greeting()

onMounted(() => {
  // Lumi anuncia los logros desde su bocadillo
  setAchievementAnnouncer((a) =>
    buddy.value?.say({ mood: 'excited', parts: [{ t: `${a.icon} ` }, { t: a.title, b: true }, { t: ` · ${a.lumi}` }] }),
  )
  checkAchievements()
})
onBeforeUnmount(() => {
  daysSub.unsubscribe()
  setAchievementAnnouncer(null)
})
const outfit = outfitFor()
const headerOwlMood = ref<'idle' | 'excited'>('idle')

function poke() {
  headerOwlMood.value = 'excited'
  setTimeout(() => (headerOwlMood.value = 'idle'), 1200)
}

const searching = computed(() => !!search.value?.trim())
const reading = computed(() =>
  books.value
    .filter((b) => b.progress > 0 && b.progress < FINISHED_THRESHOLD)
    .sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))
    .slice(0, 10),
)
const stats = computed(() => {
  const total = books.value.length
  const done = books.value.filter((b) => b.progress >= FINISHED_THRESHOLD).length
  return [
    { icon: '📚', value: total, label: total === 1 ? 'libro' : 'libros' },
    { icon: '📖', value: reading.value.length, label: 'leyendo' },
    { icon: '🏆', value: done, label: done === 1 ? 'terminado' : 'terminados' },
    { icon: '🔥', value: streak.value, label: streak.value === 1 ? 'día seguido' : 'días seguidos' },
  ]
})

// Arrastrar para ordenar en las vistas de portadas y de lista (la estantería lo hace por su cuenta)
const gridEl = ref<ComponentPublicInstance | null>(null)
const listEl = ref<ComponentPublicInstance | null>(null)
useSortableBooks(gridEl, '.book-card', (ids) => library.setVisibleOrder(ids))
useSortableBooks(listEl, '.q-item', (ids) => library.setVisibleOrder(ids))

const sortOptions: { value: SortKey; label: string; icon: string }[] = [
  { value: 'custom', label: 'Mi orden (arrastrando)', icon: 'drag_indicator' },
  { value: 'series', label: 'Por saga', icon: 'auto_stories' },
  { value: 'title', label: 'Título', icon: 'sort_by_alpha' },
  { value: 'author', label: 'Autor', icon: 'person' },
  { value: 'addedAt', label: 'Recién añadidos', icon: 'schedule' },
  { value: 'lastOpenedAt', label: 'Leídos recientemente', icon: 'auto_stories' },
]

function pickFiles() {
  fileInput.value?.click()
}

async function handleFiles(list: FileList | File[] | null | undefined) {
  if (!list || !list.length) return
  importing.value = true
  try {
    const r = await library.importFiles(Array.from(list))
    if (r.added) {
      celebrate()
      setTimeout(checkAchievements, 2500)
      buddy.value?.say({
        mood: 'excited',
        parts: [
          { t: '¡Genial! ' },
          { t: `${r.added} libro${r.added === 1 ? ' nuevo' : 's nuevos'}`, b: true },
          { t: ' en la estantería 🎉' },
        ],
      })
    }
    if (r.duplicates || r.unsupported) {
      const parts: string[] = []
      if (r.duplicates) parts.push(`${r.duplicates} ya estaba${r.duplicates === 1 ? '' : 'n'} en la biblioteca`)
      if (r.unsupported) parts.push(`${r.unsupported} no es PDF ni EPUB`)
      $q.notify({ type: 'warning', message: parts.join(' · ') })
    }
  } catch (err) {
    console.error(err)
    $q.notify({ type: 'negative', message: 'Error al importar los libros' })
  } finally {
    importing.value = false
    if (fileInput.value) fileInput.value.value = ''
  }
}

function onFileInput(e: Event) {
  handleFiles((e.target as HTMLInputElement).files)
}

function onDrop(e: DragEvent) {
  dragging.value = false
  handleFiles(e.dataTransfer?.files)
}

function openBook(book: Book) {
  router.push({ name: 'reader', params: { id: book.id } })
}

function editBook(book: Book) {
  $q.dialog({
    component: BookEditDialog,
    componentProps: { book, allTags: allTags.value, allSeries: allSeries.value },
  }).onOk((changes: Pick<Book, 'title' | 'author' | 'tags' | 'series' | 'seriesIndex'>) =>
    library.updateBook(book.id, changes),
  )
}

/** Sagas que ya hay, para sugerirlas al editar un libro. */
const allSeries = computed(() => [...new Set(books.value.map((b) => b.series).filter((x): x is string => !!x))].sort())

function openBackup() {
  $q.dialog({ component: BackupDialog })
}

function editShelves(book: Book) {
  $q.dialog({
    component: ShelvesDialog,
    componentProps: { book, allTags: allTags.value },
  }).onOk((tags: string[]) => library.updateBook(book.id, { tags }))
}

const statusShelves = computed(() => {
  const count = (s: StatusFilter) => books.value.filter((b) => bookStatus(b) === s).length
  return [
    { id: 'reading' as const, icon: '📖', label: 'Leyendo', count: count('reading') },
    { id: 'unread' as const, icon: '🕐', label: 'Por empezar', count: count('unread') },
    { id: 'finished' as const, icon: '🏆', label: 'Terminados', count: count('finished') },
  ]
})
const shelfCounts = computed(() => {
  const counts: Record<string, number> = {}
  for (const b of books.value) for (const t of b.tags) counts[t] = (counts[t] ?? 0) + 1
  return counts
})

function renameShelf(name: string) {
  $q.dialog({
    title: 'Renombrar estantería',
    prompt: { model: name, type: 'text', isValid: (v: string) => !!v.trim() },
    cancel: true,
  }).onOk((to: string) => library.renameShelf(name, to))
}

function deleteShelf(name: string) {
  $q.dialog({
    title: 'Quitar estantería',
    message: `¿Quitar la estantería «${name}»? Los libros siguen en tu biblioteca.`,
    cancel: { flat: true, label: 'Cancelar' },
    ok: { label: 'Quitar', color: 'negative', unelevated: true },
  }).onOk(() => library.deleteShelf(name))
}

function removeBook(book: Book) {
  $q.dialog({
    title: 'Eliminar libro',
    message: `¿Quitar «${book.title}» de la biblioteca?`,
    cancel: { flat: true, label: 'Cancelar' },
    ok: { label: 'Eliminar', color: 'negative', unelevated: true },
  }).onOk(() => library.removeBook(book.id))
}
</script>

<template>
  <q-layout view="hHh lpR fFf">
    <q-header class="app-header">
      <q-toolbar class="q-py-sm">
        <LumiOwl :size="34" :mood="headerOwlMood" :outfit="outfit" class="q-mr-xs header-owl" @click="poke" />
        <q-toolbar-title class="font-display brand gt-xs">Bibli</q-toolbar-title>
        <q-input
          v-model="search"
          dense
          rounded
          standout="search--focus"
          clearable
          placeholder="Buscar título o autor"
          class="search q-mx-sm col"
        >
          <template #prepend><q-icon name="search" /></template>
        </q-input>
        <q-btn flat round icon="sort">
          <q-tooltip>Ordenar</q-tooltip>
          <q-menu auto-close>
            <q-list style="min-width: 210px">
              <q-item
                v-for="opt in sortOptions"
                :key="opt.value"
                clickable
                :active="sortKey === opt.value"
                active-class="text-accent"
                @click="library.setSort(opt.value)"
              >
                <q-item-section avatar><q-icon :name="opt.icon" /></q-item-section>
                <q-item-section>{{ opt.label }}</q-item-section>
              </q-item>
            </q-list>
          </q-menu>
        </q-btn>
        <q-btn flat round icon="cloud_sync" aria-label="Copia de seguridad" @click="openBackup">
          <q-tooltip>Copia de seguridad</q-tooltip>
        </q-btn>
        <q-btn
          v-if="$q.screen.gt.xs"
          unelevated
          rounded
          no-caps
          color="accent"
          icon="add"
          label="Añadir libros"
          class="q-ml-sm"
          :loading="importing"
          @click="pickFiles"
        />
        <input
          ref="fileInput"
          type="file"
          multiple
          accept=".pdf,.epub,application/pdf,application/epub+zip"
          hidden
          @change="onFileInput"
        />
      </q-toolbar>
    </q-header>

    <q-page-container>
      <q-page
        class="page"
        @dragover.prevent="dragging = true"
        @dragleave.self="dragging = false"
        @drop.prevent="onDrop"
      >
        <!-- Portada: saludo, estadísticas y Lumi -->
        <transition name="fade">
          <section v-if="!searching" class="hero">
            <div class="hero__deco" aria-hidden="true">
              <span v-for="n in 7" :key="n" :class="`deco deco--${n}`">{{ ['📕', '✨', '📗', '⭐', '📘', '✨', '📙'][n - 1] }}</span>
            </div>
            <div class="hero__content">
              <div class="hero__greeting">
                <div class="overline">{{ hello.icon }} {{ hello.text }}</div>
                <h1 class="font-display">¿Qué leemos hoy?</h1>
                <div v-if="books.length" class="stats">
                  <div v-for="(s, i) in stats" :key="s.label" class="stat" :style="{ '--i': i }">
                    <span class="stat__icon">{{ s.icon }}</span>
                    <span class="stat__value font-display">{{ s.value }}</span>
                    <span class="stat__label">{{ s.label }}</span>
                  </div>
                </div>
                <div v-if="books.length" class="today">
                  <button class="today__goal" @click="router.push({ name: 'stats' })">
                    <q-circular-progress
                      :value="goalPercent"
                      size="46px"
                      :thickness="0.22"
                      color="accent"
                      track-color="white"
                      show-value
                      class="text-weight-bold"
                    >
                      {{ goalPercent >= 100 ? '✓' : `${goalPercent}%` }}
                    </q-circular-progress>
                    <span class="today__text">
                      <b>Hoy {{ formatDuration(todaySeconds) }}</b>
                      <span>de tu meta de {{ dailyGoalMinutes() }} min</span>
                    </span>
                  </button>
                  <q-btn
                    rounded
                    unelevated
                    no-caps
                    color="white"
                    text-color="primary"
                    icon="insights"
                    label="Estadísticas y logros"
                    @click="router.push({ name: 'stats' })"
                  />
                  <q-btn
                    rounded
                    unelevated
                    no-caps
                    color="white"
                    text-color="primary"
                    icon="format_quote"
                    label="Mis frases"
                    @click="router.push({ name: 'quotes' })"
                  />
                </div>
              </div>
              <ReadingBuddy
                v-if="loaded"
                ref="buddy"
                :books="books"
                :streak="streak"
                class="hero__buddy"
                @open="openBook"
                @import="pickFiles"
              />
            </div>
          </section>
        </transition>

        <!-- Continuar leyendo -->
        <section v-if="!searching && reading.length" class="section">
          <h2 class="section__title font-display">
            <q-icon name="auto_stories" color="accent" /> Continuar leyendo
          </h2>
          <ContinueReading :books="reading" @open="openBook" />
        </section>

        <!-- Estantería -->
        <section class="section">
          <div class="row items-center q-mb-sm shelf-head">
            <h2 class="section__title font-display q-my-none">
              <q-icon name="local_library" color="primary" />
              {{ searching ? 'Resultados' : 'Tu estantería' }}
            </h2>
            <q-space />
            <!-- Cómo ver los libros: lomos en la estantería, portadas o lista -->
            <q-btn-toggle
              v-if="books.length"
              :model-value="viewMode"
              rounded
              unelevated
              dense
              toggle-color="primary"
              color="transparent"
              text-color="primary"
              class="format-toggle view-toggle"
              :options="[
                { value: 'spines', slot: 'spines' },
                { value: 'grid', slot: 'grid' },
                { value: 'list', slot: 'list' },
              ]"
              @update:model-value="library.setViewMode"
            >
              <template #spines>
                <q-icon name="view_week" /><q-tooltip>Estantería (lomos)</q-tooltip>
              </template>
              <template #grid>
                <q-icon name="grid_view" /><q-tooltip>Portadas</q-tooltip>
              </template>
              <template #list>
                <q-icon name="view_list" /><q-tooltip>Lista</q-tooltip>
              </template>
            </q-btn-toggle>
            <q-btn-toggle
              v-if="books.length"
              v-model="formatFilter"
              rounded
              unelevated
              dense
              no-caps
              toggle-color="primary"
              color="transparent"
              text-color="primary"
              class="format-toggle"
              :options="[
                { label: 'Todos', value: 'all' },
                { label: 'PDF', value: 'pdf' },
                { label: 'EPUB', value: 'epub' },
              ]"
            />
          </div>

          <!-- Estanterías: las automáticas (según lo leído) y las del usuario -->
          <div v-if="books.length" class="tag-bar q-mb-md">
            <q-chip
              v-for="s in statusShelves"
              :key="s.id"
              clickable
              :outline="statusFilter !== s.id"
              :color="statusFilter === s.id ? 'accent' : 'primary'"
              :text-color="statusFilter === s.id ? 'white' : 'primary'"
              @click="statusFilter = statusFilter === s.id ? null : s.id"
            >
              {{ s.icon }}&nbsp;{{ s.label }}
              <span class="shelf-count">{{ s.count }}</span>
            </q-chip>
            <q-separator v-if="allTags.length" vertical inset class="q-mx-xs" />
            <q-chip
              v-for="tag in allTags"
              :key="tag"
              clickable
              :outline="tagFilter !== tag"
              :color="tagFilter === tag ? 'accent' : 'primary'"
              :text-color="tagFilter === tag ? 'white' : 'primary'"
              icon="collections_bookmark"
              @click="tagFilter = tagFilter === tag ? null : tag"
            >
              {{ tag }}
              <span class="shelf-count">{{ shelfCounts[tag] }}</span>
              <q-menu context-menu touch-position auto-close>
                <q-list dense style="min-width: 170px">
                  <q-item clickable @click="renameShelf(tag)">
                    <q-item-section avatar><q-icon name="edit" /></q-item-section>
                    <q-item-section>Renombrar</q-item-section>
                  </q-item>
                  <q-item clickable @click="deleteShelf(tag)">
                    <q-item-section avatar><q-icon name="delete" color="negative" /></q-item-section>
                    <q-item-section>Quitar estantería</q-item-section>
                  </q-item>
                </q-list>
              </q-menu>
            </q-chip>
            <q-chip v-if="!allTags.length" outline color="grey-7" icon="info" class="shelf-hint">
              Crea tus estanterías desde el menú ⋮ de cada libro
            </q-chip>
          </div>

          <!-- Estantería vacía -->
          <div v-if="loaded && !books.length" class="empty">
            <div v-for="n in 2" :key="n" class="empty__shelf">
              <div v-for="m in 4" :key="m" class="ghost-book" :style="{ '--i': n * 4 + m }" />
            </div>
            <q-btn
              unelevated
              rounded
              no-caps
              size="lg"
              color="accent"
              icon="add"
              label="Añadir mi primer libro"
              class="q-mt-lg"
              @click="pickFiles"
            />
            <div class="q-mt-sm hint">o arrastra archivos PDF / EPUB aquí</div>
          </div>

          <div v-else-if="loaded && !visibleBooks.length" class="no-results">
            <LumiOwl mood="sleepy" :size="90" />
            <div class="q-mt-sm">Lumi buscó por todas partes y no encontró nada…</div>
          </div>

          <template v-else>
            <div v-if="sortKey !== 'custom'" class="drag-hint">
              <q-icon name="pan_tool_alt" size="16px" />
              {{ $q.platform.has.touch ? 'Mantén pulsado un libro y arrástralo' : 'Arrastra un libro' }} para ordenarlos a tu gusto
            </div>
          </template>

          <BookShelf
            v-if="loaded && visibleBooks.length && viewMode === 'spines'"
            :books="visibleBooks"
            @open="openBook"
            @edit="editBook"
            @shelves="editShelves"
            @remove="removeBook"
            @reorder="library.setVisibleOrder"
          />

          <TransitionGroup
            v-else-if="loaded && visibleBooks.length && viewMode === 'grid'"
            ref="gridEl"
            tag="div"
            name="shelf"
            class="shelf"
          >
            <BookCard
              v-for="(book, i) in visibleBooks"
              :key="book.id"
              :data-id="book.id"
              :book="book"
              :style="{ '--i': Math.min(i, 24) }"
              class="shelf__item"
              @open="openBook(book)"
              @edit="editBook(book)"
              @shelves="editShelves(book)"
              @remove="removeBook(book)"
            />
          </TransitionGroup>

          <q-list v-else-if="loaded && visibleBooks.length" ref="listEl" class="book-list">
            <BookListItem
              v-for="book in visibleBooks"
              :key="book.id"
              :data-id="book.id"
              :book="book"
              @open="openBook(book)"
              @edit="editBook(book)"
              @shelves="editShelves(book)"
              @remove="removeBook(book)"
            />
          </q-list>
        </section>

        <q-page-sticky v-if="$q.screen.xs" position="bottom-right" :offset="[18, 18]">
          <q-btn fab color="accent" icon="add" class="fab" :loading="importing" @click="pickFiles" />
        </q-page-sticky>

        <transition name="fade">
          <div v-if="dragging" class="drop-overlay flex flex-center column">
            <LumiOwl mood="excited" :size="130" />
            <div class="text-h5 font-display text-white q-mt-md">¡Suéltalos aquí!</div>
          </div>
        </transition>
      </q-page>
    </q-page-container>
  </q-layout>
</template>

<style scoped>
.app-header {
  background: color-mix(in srgb, var(--paper) 82%, transparent);
  backdrop-filter: blur(12px);
  color: var(--ink);
  border-bottom: 1px solid color-mix(in srgb, var(--ink) 8%, transparent);
}
.brand {
  font-weight: 700;
  font-size: 1.5rem;
  flex: 0 0 auto;
  color: var(--ink);
}
.search {
  max-width: 460px;
}
.search :deep(.q-field__control) {
  background: var(--paper-2);
}
.page {
  background:
    radial-gradient(circle at 10% 0%, color-mix(in srgb, var(--accent) 12%, transparent), transparent 40%),
    var(--paper);
  padding-bottom: 90px;
}

/* ---------- Hero ---------- */
.hero {
  position: relative;
  margin: 16px;
  border-radius: 28px;
  overflow: hidden;
  background:
    radial-gradient(circle at 85% 20%, rgba(255, 209, 102, 0.55), transparent 45%),
    radial-gradient(circle at 0% 100%, rgba(226, 101, 74, 0.35), transparent 50%),
    linear-gradient(135deg, #fde3c3, #f8c99a);
  color: #3b2a20;
  box-shadow: var(--shadow);
}
.body--dark .hero {
  background:
    radial-gradient(circle at 85% 20%, rgba(242, 158, 56, 0.35), transparent 45%),
    radial-gradient(circle at 0% 100%, rgba(226, 101, 74, 0.25), transparent 50%),
    linear-gradient(135deg, #4a3020, #2e1e15);
  color: #f4e9dc;
}
.hero__content {
  position: relative;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  align-items: end;
  padding: 24px 24px 8px;
}
.hero__greeting {
  padding-bottom: 20px;
}
.overline {
  font-weight: 700;
  letter-spacing: 0.04em;
  opacity: 0.8;
}
.hero h1 {
  font-size: clamp(1.8rem, 5vw, 2.8rem);
  line-height: 1.05;
  font-weight: 700;
  margin: 4px 0 16px;
}
.stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.stat {
  display: flex;
  align-items: baseline;
  gap: 5px;
  padding: 6px 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.55);
  backdrop-filter: blur(4px);
  animation: pop 0.5s cubic-bezier(0.3, 1.6, 0.5, 1) backwards;
  animation-delay: calc(var(--i) * 90ms + 200ms);
}
.body--dark .stat {
  background: rgba(255, 255, 255, 0.1);
}
.stat__value {
  font-weight: 700;
  font-size: 1.1rem;
}
.stat__label {
  font-size: 0.78rem;
  opacity: 0.8;
}
.today {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
}
.today__goal {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 14px 4px 4px;
  border: 0;
  border-radius: 999px;
  background: color-mix(in srgb, var(--card) 70%, transparent);
  color: var(--ink);
  font: inherit;
  cursor: pointer;
  text-align: left;
}
.today__text {
  display: flex;
  flex-direction: column;
  line-height: 1.15;
  font-size: 0.85rem;
}
.today__text span {
  font-size: 0.75rem;
  opacity: 0.75;
}
.hero__deco {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.deco {
  position: absolute;
  font-size: 1.4rem;
  opacity: 0.55;
  animation: drift 7s ease-in-out infinite;
}
.deco--1 { top: 12%; left: 52%; animation-delay: 0s; }
.deco--2 { top: 8%; left: 70%; font-size: 1rem; animation-delay: 1s; }
.deco--3 { top: 62%; left: 46%; animation-delay: 2s; }
.deco--4 { top: 18%; left: 92%; font-size: 1rem; animation-delay: 0.5s; }
.deco--5 { top: 78%; left: 4%; animation-delay: 3s; }
.deco--6 { top: 6%; left: 30%; font-size: 0.9rem; animation-delay: 1.5s; }
.deco--7 { top: 40%; left: 96%; animation-delay: 2.5s; }

@media (max-width: 599px) {
  .hero {
    margin: 10px;
    border-radius: 22px;
  }
  .hero__content {
    grid-template-columns: 1fr;
    padding: 18px 14px 4px;
    gap: 0;
  }
  .hero__greeting {
    padding-bottom: 8px;
  }
  .hero h1 {
    margin-bottom: 12px;
  }
  .stats {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }
  .stat {
    padding: 5px 10px;
  }
  .stat__value {
    font-size: 1rem;
  }
  .stat__label {
    font-size: 0.72rem;
  }
  /* En pantallas estrechas solo se dejan los adornos de los bordes. */
  .deco--1,
  .deco--3,
  .deco--6 {
    display: none;
  }
}

/* ---------- Secciones ---------- */
.section {
  padding: 0 16px 4px;
}
.section__title {
  font-size: 1.35rem;
  font-weight: 700;
  margin: 12px 0 10px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.shelf-head {
  flex-wrap: wrap;
  gap: 8px;
}
.view-toggle :deep(.q-btn) {
  padding: 4px 10px;
}
.drag-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.78rem;
  color: var(--ink-soft);
  margin: -4px 0 10px;
}
/* Mientras se arrastra en portadas o lista */
.shelf :deep(.drag-ghost),
.book-list :deep(.drag-ghost) {
  opacity: 0.35;
}
.format-toggle {
  border: 1px solid color-mix(in srgb, var(--ink) 15%, transparent);
}
.tag-bar {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  overflow-x: auto;
  scrollbar-width: none;
}
.tag-bar .q-chip {
  flex-shrink: 0;
}
.shelf-count {
  margin-left: 6px;
  font-size: 0.75em;
  opacity: 0.7;
  font-variant-numeric: tabular-nums;
}
.shelf-hint {
  font-size: 0.8rem;
}

/* ---------- Estantería ---------- */
.shelf {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  column-gap: 0;
  row-gap: 6px;
  padding: 0 6px;
}
@media (max-width: 599px) {
  .shelf {
    grid-template-columns: repeat(3, 1fr);
    padding: 0;
  }
  .shelf :deep(.book-card) {
    padding: 0 6px 14px;
  }
  .shelf :deep(.plank) {
    margin: 0 -6px;
  }
}
.shelf__item {
  animation: rise 0.55s cubic-bezier(0.2, 0.9, 0.3, 1.2) backwards;
  animation-delay: calc(var(--i) * 45ms);
}
.shelf-move {
  transition: transform 0.45s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.shelf-leave-active {
  position: absolute;
  transition:
    opacity 0.3s,
    transform 0.3s;
}
.shelf-leave-to {
  opacity: 0;
  transform: scale(0.6) rotate(-6deg);
}
.book-list {
  max-width: 900px;
  margin: 0 auto;
  background: var(--card);
  border-radius: 18px;
  box-shadow: var(--shadow);
  overflow: hidden;
}

/* ---------- Estados vacíos ---------- */
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 10px 0 30px;
}
.empty__shelf {
  width: min(520px, 100%);
  display: flex;
  justify-content: space-evenly;
  align-items: flex-end;
  padding: 0 10px;
  border-bottom: 14px solid var(--wood-light);
  border-radius: 0 0 4px 4px;
  box-shadow: 0 10px 10px -8px rgba(60, 30, 10, 0.5);
  margin-top: 26px;
  height: 120px;
}
.ghost-book {
  width: 56px;
  height: 84px;
  border: 2px dashed color-mix(in srgb, var(--ink) 25%, transparent);
  border-radius: 3px 6px 6px 3px;
  animation: bob 2.6s ease-in-out infinite;
  animation-delay: calc(var(--i) * 0.2s);
}
.hint,
.no-results {
  color: var(--ink-soft);
}
.no-results {
  text-align: center;
  padding: 40px 0;
}

.fab {
  animation: pop 0.5s cubic-bezier(0.3, 1.6, 0.5, 1) 0.6s backwards;
  /* que no quede encima de la barra de inicio del iPhone */
  margin-bottom: var(--q-safe-area-inset-bottom, 0px);
}
.drop-overlay {
  position: fixed;
  inset: 0;
  background: rgba(59, 42, 32, 0.8);
  border: 4px dashed var(--accent);
  pointer-events: none;
  z-index: 3000;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

@keyframes rise {
  from {
    opacity: 0;
    transform: translateY(30px) scale(0.92);
  }
}
@keyframes pop {
  from {
    opacity: 0;
    transform: scale(0.5);
  }
}
@keyframes drift {
  0%,
  100% {
    transform: translateY(0) rotate(0deg);
  }
  50% {
    transform: translateY(-12px) rotate(8deg);
  }
}
@keyframes bob {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-6px);
  }
}
</style>
