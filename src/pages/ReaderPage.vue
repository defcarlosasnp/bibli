<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, nextTick, toRaw } from 'vue'
import { useRouter } from 'vue-router'
import { useQuasar } from 'quasar'
import ePub, { EpubCFI, type Book as EpubBook, type Rendition, type NavItem } from 'epubjs'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import { db, type Book, type Bookmark } from '@/db'
import { openPdf } from '@/services/pdf'
import { FINISHED_THRESHOLD, celebrate, recordReadingDay } from '@/services/stats'
import ReaderBuddy from '@/components/ReaderBuddy.vue'

const props = defineProps<{ id: string }>()
const router = useRouter()
const $q = useQuasar()

const book = ref<Book>()
const loading = ref(true)
const viewport = ref<HTMLDivElement>()
const canvas = ref<HTMLCanvasElement>()
const drawer = ref(false)
const night = ref(localStorage.getItem('bibli.night') === null ? $q.dark.isActive : localStorage.getItem('bibli.night') === '1')

/** Página (PDF) o CFI (EPUB) que se está mostrando. */
const currentPosition = ref<string | null>(null)
/** Texto legible de la posición actual, usado como etiqueta del marcador. */
const currentLabel = ref('')

// PDF
const pdf = shallowRef<PDFDocumentProxy>()
const page = ref(1)
const pageCount = ref(0)
const zoom = ref(1)
let renderTask: RenderTask | null = null
let destroyPdf: (() => Promise<void>) | undefined

// EPUB
const epub = shallowRef<EpubBook>()
const rendition = shallowRef<Rendition>()
const fontSize = ref(100)
const epubPercent = ref<number | null>(null)
const toc = shallowRef<NavItem[]>([])

const bookId = Number(props.id)
let finished = false

// ---------- Lumi en el lector ----------

const buddy = ref<InstanceType<typeof ReaderBuddy>>()
const showBuddy = ref(localStorage.getItem('bibli.readerBuddy') !== '0')
const PAGE_CHEER_EVERY = 10
const BREAK_REMINDERS_MIN = [25, 50, 90]
const MILESTONES: [number, string][] = [
  [0.25, '¡Ya llevas un cuarto del libro! 🌱'],
  [0.5, '¡Mitad del libro! Desde aquí todo es cuesta abajo 🎢'],
  [0.75, '¡75%! La recta final se pone interesante 👀'],
  [0.9, '¡Solo queda un 10%! No me dejes con la intriga 😱'],
]
let pagesThisSession = 0
let lastProgress = 0
let sessionTimer: ReturnType<typeof setInterval> | undefined
let sessionMinutes = 0

function toggleBuddy(value: boolean) {
  showBuddy.value = value
  localStorage.setItem('bibli.readerBuddy', value ? '1' : '0')
}

function lumiSay(...args: Parameters<NonNullable<typeof buddy.value>['say']>) {
  if (showBuddy.value) buddy.value?.say(...args)
}

function greetReader(meta: Book) {
  setTimeout(() => {
    if (!meta.progress) lumiSay(`¡Empecemos «${meta.title}»! Ponte cómodo 🦉📖`, 'excited')
    else if (meta.progress >= FINISHED_THRESHOLD) lumiSay('¿Releyendo? ¡Los buenos libros lo merecen! ✨', 'happy')
    else lumiSay(`¡Bienvenido de vuelta! Ibas por el ${Math.round(meta.progress * 100)}% 🙌`, 'happy')
  }, 900)
  sessionTimer = setInterval(() => {
    sessionMinutes++
    if (BREAK_REMINDERS_MIN.includes(sessionMinutes)) {
      lumiSay(`Llevas ${sessionMinutes} minutos leyendo. ¿Descansas la vista un momento? 👀💧`, 'sleepy', 7000)
    }
  }, 60_000)
}

function onPageForward() {
  pagesThisSession++
  if (pagesThisSession % PAGE_CHEER_EVERY === 0) {
    const cheers = ['¡Vas genial! 🚀', '¡Qué ritmo! 🔥', '¡Imparable! 💪', '¡Así se lee! 🦉']
    lumiSay(`¡${pagesThisSession} páginas hoy! ${cheers[Math.floor(Math.random() * cheers.length)]}`, 'excited', 3500)
  }
}

/** Guarda la posición, avisa de los hitos y celebra la primera vez que se llega al final. */
function saveProgress(position: string, progress: number | null) {
  db.books.update(bookId, progress != null ? { position, progress } : { position })
  if (progress == null) return
  if (progress >= FINISHED_THRESHOLD && !finished) {
    finished = true
    celebrate()
    lumiSay('¡¡Lo terminaste!! 🎉 Estoy orgullosísimo de ti', 'excited', 6000)
    $q.notify({
      message: `¡Terminaste «${book.value?.title}»! 🎉`,
      color: 'secondary',
      icon: 'emoji_events',
      timeout: 4000,
    })
  } else {
    const hit = MILESTONES.find(([m]) => lastProgress < m && progress >= m)
    if (hit) lumiSay(hit[1], 'excited', 5000)
  }
  lastProgress = progress
}

/** Pequeño desplazamiento al cambiar de página para que se note el paso. */
function animateTurn(el: HTMLElement | undefined, dir: number) {
  el?.animate(
    [
      { opacity: 0.25, transform: `translateX(${dir * 40}px) rotateY(${dir * -8}deg)` },
      { opacity: 1, transform: 'none' },
    ],
    { duration: 280, easing: 'cubic-bezier(.2,.8,.2,1)' },
  )
}

onMounted(async () => {
  const [meta, file] = await Promise.all([db.books.get(bookId), db.files.get(bookId)])
  if (!meta || !file) {
    $q.notify({ type: 'negative', message: 'No se encontró el libro' })
    router.replace({ name: 'library' })
    return
  }
  book.value = meta
  finished = meta.progress >= FINISHED_THRESHOLD
  lastProgress = meta.progress
  recordReadingDay()
  db.books.update(bookId, { lastOpenedAt: Date.now() })
  const data = await file.data.arrayBuffer()
  loading.value = false
  await nextTick()
  if (meta.format === 'pdf') await initPdf(data, meta)
  else await initEpub(data, meta)
  window.addEventListener('keydown', onKey)
  window.addEventListener('resize', onResize)
  greetReader(meta)
})

onBeforeUnmount(() => {
  clearInterval(sessionTimer)
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('resize', onResize)
  renderTask?.cancel()
  destroyPdf?.()
  epub.value?.destroy()
})

// ---------- PDF ----------

async function initPdf(data: ArrayBuffer, meta: Book) {
  const opened = await openPdf(data)
  pdf.value = opened.doc
  destroyPdf = opened.destroy
  pageCount.value = pdf.value.numPages
  const saved = Number(meta.position)
  setPdfPage(saved >= 1 && saved <= pageCount.value ? saved : 1)
  await renderPdfPage()
}

function setPdfPage(n: number) {
  page.value = n
  currentPosition.value = String(n)
  currentLabel.value = `Página ${n}`
}

async function renderPdfPage(dir = 0) {
  if (!pdf.value || !canvas.value || !viewport.value) return
  renderTask?.cancel()
  const p = await pdf.value.getPage(page.value)
  const base = p.getViewport({ scale: 1 })
  const box = viewport.value.getBoundingClientRect()
  const fit = Math.min(box.width / base.width, box.height / base.height) * zoom.value
  const dpr = window.devicePixelRatio || 1
  const vp = p.getViewport({ scale: fit * dpr })
  canvas.value.width = Math.floor(vp.width)
  canvas.value.height = Math.floor(vp.height)
  canvas.value.style.width = `${Math.floor(vp.width / dpr)}px`
  canvas.value.style.height = `${Math.floor(vp.height / dpr)}px`
  renderTask = p.render({ canvas: canvas.value, viewport: vp })
  try {
    await renderTask.promise
    if (dir) animateTurn(canvas.value, dir)
  } catch (err) {
    if ((err as Error)?.name !== 'RenderingCancelledException') throw err
  }
}

function goToPdfPage(n: number) {
  const target = Math.min(Math.max(1, n), pageCount.value)
  if (!target || target === page.value) return
  const dir = Math.sign(target - page.value)
  setPdfPage(target)
  saveProgress(String(target), target / pageCount.value)
  renderPdfPage(dir)
}

function onPageInput(e: Event) {
  goToPdfPage(Number((e.target as HTMLInputElement).value))
}

// ---------- EPUB ----------

const epubThemes = {
  day: { body: { color: '#222 !important', background: '#fff !important' } },
  night: {
    body: { color: '#ddd !important', background: '#121212 !important' },
    a: { color: '#ffb300 !important' },
  },
}

async function initEpub(data: ArrayBuffer, meta: Book) {
  epub.value = ePub(data)
  rendition.value = epub.value.renderTo(viewport.value!, {
    width: '100%',
    height: '100%',
    spread: 'auto',
    allowScriptedContent: false,
  })
  rendition.value.themes.register('day', epubThemes.day)
  rendition.value.themes.register('night', epubThemes.night)
  rendition.value.themes.select(night.value ? 'night' : 'day')

  rendition.value.on('relocated', (loc: { start: { cfi: string; href: string } }) => {
    const cfi = loc.start.cfi
    const locations = epub.value?.locations
    const pct = locations?.length() ? locations.percentageFromCfi(cfi) : null
    epubPercent.value = pct
    currentPosition.value = cfi
    currentLabel.value = epubLabel(loc.start.href, pct)
    saveProgress(cfi, pct)
  })
  rendition.value.on('keydown', onKey)

  epub.value.loaded.navigation.then((nav) => (toc.value = nav.toc))
  await rendition.value.display(meta.position || undefined)
  // Generar las ubicaciones permite calcular el % leído; puede tardar en libros grandes.
  await epub.value.ready
  await epub.value.locations.generate(1600)
  const current = rendition.value.currentLocation() as unknown as { start?: { cfi: string; href: string } }
  if (current?.start) {
    epubPercent.value = epub.value.locations.percentageFromCfi(current.start.cfi)
    currentLabel.value = epubLabel(current.start.href, epubPercent.value)
  }
}

function findTocLabel(items: NavItem[], href: string): string | null {
  for (const item of items) {
    if (item.href.split('#')[0].endsWith(href) || href.endsWith(item.href.split('#')[0])) return item.label.trim()
    const sub = item.subitems?.length ? findTocLabel(item.subitems, href) : null
    if (sub) return sub
  }
  return null
}

function epubLabel(href: string, pct: number | null): string {
  const chapter = findTocLabel(toc.value, href)
  const percent = pct != null ? `${Math.round(pct * 100)}%` : ''
  return [chapter, percent].filter(Boolean).join(' · ') || 'Marcador'
}

function setFontSize(delta: number) {
  fontSize.value = Math.min(200, Math.max(60, fontSize.value + delta))
  rendition.value?.themes.fontSize(`${fontSize.value}%`)
}

// ---------- Marcadores ----------

const bookmarks = computed(() => {
  const list = [...(book.value?.bookmarks ?? [])]
  if (book.value?.format === 'pdf') return list.sort((a, b) => Number(a.position) - Number(b.position))
  const cfi = new EpubCFI()
  return list.sort((a, b) => cfi.compare(a.position, b.position))
})

const isBookmarked = computed(
  () => !!currentPosition.value && bookmarks.value.some((b) => b.position === currentPosition.value),
)

async function saveBookmarks(list: Bookmark[]) {
  if (!book.value) return
  book.value.bookmarks = list
  await db.books.update(bookId, { bookmarks: toRaw(list).map((b) => ({ ...b })) })
}

function toggleBookmark() {
  if (!book.value || !currentPosition.value) return
  const pos = currentPosition.value
  if (isBookmarked.value) {
    saveBookmarks(book.value.bookmarks.filter((b) => b.position !== pos))
    $q.notify({ message: 'Marcador eliminado', timeout: 1200 })
  } else {
    saveBookmarks([...book.value.bookmarks, { position: pos, label: currentLabel.value, createdAt: Date.now() }])
    $q.notify({ message: 'Marcador añadido', icon: 'bookmark', timeout: 1200 })
  }
}

function removeBookmark(bm: Bookmark) {
  if (!book.value) return
  saveBookmarks(book.value.bookmarks.filter((b) => b.position !== bm.position))
}

function goTo(position: string) {
  if (book.value?.format === 'pdf') goToPdfPage(Number(position))
  else rendition.value?.display(position)
  if (!$q.screen.gt.sm) drawer.value = false
}

// ---------- Común ----------

function toggleNight() {
  night.value = !night.value
  localStorage.setItem('bibli.night', night.value ? '1' : '0')
  rendition.value?.themes.select(night.value ? 'night' : 'day')
}

function next() {
  if (book.value?.format === 'pdf') {
    if (page.value >= pageCount.value) return
    goToPdfPage(page.value + 1)
  } else {
    rendition.value?.next().then(() => animateTurn(viewport.value, 1))
  }
  onPageForward()
}

function prev() {
  if (book.value?.format === 'pdf') goToPdfPage(page.value - 1)
  else rendition.value?.prev().then(() => animateTurn(viewport.value, -1))
}

function onKey(e: KeyboardEvent) {
  if ((e.target as HTMLElement)?.tagName === 'INPUT') return
  if (e.key === 'ArrowRight' || e.key === 'PageDown') next()
  else if (e.key === 'ArrowLeft' || e.key === 'PageUp') prev()
  else if (e.key === 'b') toggleBookmark()
  else if (e.key === 'Escape') router.push({ name: 'library' })
}

let resizeTimer: ReturnType<typeof setTimeout> | undefined
function onResize() {
  clearTimeout(resizeTimer)
  resizeTimer = setTimeout(() => {
    if (book.value?.format === 'pdf') renderPdfPage()
  }, 150)
}

function setZoom(delta: number) {
  zoom.value = Math.min(4, Math.max(0.5, +(zoom.value + delta).toFixed(2)))
  renderPdfPage()
}

function onSwipe({ direction }: { direction?: string }) {
  if (book.value?.format !== 'pdf') return
  if (direction === 'left') next()
  else if (direction === 'right') prev()
}
</script>

<template>
  <q-layout view="hHh lpR fFf">
    <q-header elevated class="reader-bar">
      <q-toolbar>
        <q-btn flat round icon="arrow_back" @click="router.push({ name: 'library' })" />
        <q-toolbar-title class="text-subtitle1 font-display text-weight-bold">
          {{ book?.title }}
          <div v-if="book?.author" class="text-caption ellipsis reader-author">{{ book.author }}</div>
        </q-toolbar-title>
        <template v-if="book?.format === 'pdf'">
          <q-btn flat round icon="zoom_out" @click="setZoom(-0.25)" />
          <q-btn flat round icon="zoom_in" @click="setZoom(0.25)" />
        </template>
        <template v-else-if="book?.format === 'epub'">
          <q-btn flat round icon="text_decrease" @click="setFontSize(-10)" />
          <q-btn flat round icon="text_increase" @click="setFontSize(10)" />
        </template>
        <q-btn flat round :icon="night ? 'light_mode' : 'dark_mode'" @click="toggleNight">
          <q-tooltip>{{ night ? 'Modo día' : 'Modo nocturno' }}</q-tooltip>
        </q-btn>
        <q-btn flat round :icon="isBookmarked ? 'bookmark' : 'bookmark_border'" @click="toggleBookmark">
          <q-tooltip>{{ isBookmarked ? 'Quitar marcador' : 'Añadir marcador' }} (B)</q-tooltip>
        </q-btn>
        <q-btn flat round icon="list" @click="drawer = !drawer">
          <q-tooltip>Marcadores e índice</q-tooltip>
        </q-btn>
      </q-toolbar>
    </q-header>

    <q-drawer v-model="drawer" side="right" bordered :width="300" overlay>
      <q-scroll-area class="fit">
        <q-list>
          <q-item-label header>Marcadores</q-item-label>
          <q-item v-if="!bookmarks.length">
            <q-item-section class="text-grey">
              Aún no hay marcadores. Pulsa <q-icon name="bookmark_border" /> para añadir uno.
            </q-item-section>
          </q-item>
          <q-item
            v-for="bm in bookmarks"
            :key="bm.position"
            clickable
            :active="bm.position === currentPosition"
            @click="goTo(bm.position)"
          >
            <q-item-section avatar><q-icon name="bookmark" color="accent" /></q-item-section>
            <q-item-section>
              <q-item-label>{{ bm.label }}</q-item-label>
              <q-item-label caption>{{ new Date(bm.createdAt).toLocaleDateString('es') }}</q-item-label>
            </q-item-section>
            <q-item-section side>
              <q-btn flat round dense icon="close" size="sm" @click.stop="removeBookmark(bm)" />
            </q-item-section>
          </q-item>

          <q-separator class="q-my-sm" />
          <q-item tag="label">
            <q-item-section avatar><q-icon name="pets" color="accent" /></q-item-section>
            <q-item-section>
              <q-item-label>Lumi me acompaña</q-item-label>
              <q-item-label caption>Ánimos, hitos y recordatorios de descanso</q-item-label>
            </q-item-section>
            <q-item-section side>
              <q-toggle :model-value="showBuddy" color="accent" @update:model-value="toggleBuddy" />
            </q-item-section>
          </q-item>

          <template v-if="toc.length">
            <q-separator class="q-my-sm" />
            <q-item-label header>Índice</q-item-label>
            <template v-for="item in toc" :key="item.id">
              <q-item clickable dense @click="goTo(item.href)">
                <q-item-section>{{ item.label.trim() }}</q-item-section>
              </q-item>
              <q-item
                v-for="sub in item.subitems ?? []"
                :key="sub.id"
                clickable
                dense
                :inset-level="0.5"
                @click="goTo(sub.href)"
              >
                <q-item-section class="text-grey-7">{{ sub.label.trim() }}</q-item-section>
              </q-item>
            </template>
          </template>
        </q-list>
      </q-scroll-area>
    </q-drawer>

    <q-footer class="reader-bar reader-bar--bottom">
      <q-toolbar>
        <q-btn flat round icon="chevron_left" @click="prev" />
        <q-space />
        <template v-if="book?.format === 'pdf' && pageCount">
          <q-input
            :model-value="page"
            type="number"
            dense
            dark
            borderless
            input-class="text-center text-white"
            style="width: 60px"
            @change="onPageInput"
          />
          <span>/ {{ pageCount }}</span>
        </template>
        <span v-else-if="epubPercent != null">{{ Math.round(epubPercent * 100) }}%</span>
        <q-space />
        <q-btn flat round icon="chevron_right" @click="next" />
      </q-toolbar>
    </q-footer>

    <q-page-container>
      <q-page class="reader-page" :class="{ night }">
        <q-inner-loading :showing="loading" />
        <div
          v-if="!loading"
          ref="viewport"
          v-touch-swipe.mouse.horizontal="onSwipe"
          class="viewport"
          :class="{ 'pdf-viewport': book?.format === 'pdf' }"
        >
          <canvas v-if="book?.format === 'pdf'" ref="canvas" class="shadow-4" />
        </div>
        <transition name="buddy">
          <ReaderBuddy v-if="showBuddy && !loading" ref="buddy" />
        </transition>
      </q-page>
    </q-page-container>
  </q-layout>
</template>

<style scoped>
.reader-bar {
  background: linear-gradient(135deg, #6e4529, #8a5534);
  color: #fff;
}
.reader-bar--bottom {
  background: linear-gradient(135deg, #8a5534, #6e4529);
}
.reader-author {
  opacity: 0.75;
  font-family: var(--font-body);
  font-weight: 400;
}
.reader-page {
  display: flex;
}
.pdf-viewport {
  perspective: 900px;
}
.buddy-enter-active,
.buddy-leave-active {
  transition:
    opacity 0.3s,
    translate 0.4s cubic-bezier(0.3, 1.5, 0.5, 1);
}
.buddy-enter-from,
.buddy-leave-to {
  opacity: 0;
  translate: 0 120px;
}
.reader-page.night {
  background: #121212;
}
.viewport {
  flex: 1;
  height: calc(100vh - 100px);
  overflow: hidden;
}
.pdf-viewport {
  overflow: auto;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  background: #5d5d5d;
}
.night .pdf-viewport {
  background: #000;
}
.pdf-viewport canvas {
  margin: auto;
  background: white;
}
/* Invierte la página y rota el tono para que las imágenes conserven colores aproximados. */
.night .pdf-viewport canvas {
  filter: invert(0.9) hue-rotate(180deg);
}
</style>
