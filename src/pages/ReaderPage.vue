<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, nextTick, toRaw, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useQuasar } from 'quasar'
import { liveQuery } from 'dexie'
import ePub, { EpubCFI, type Book as EpubBook, type Rendition, type NavItem } from 'epubjs'
import { TextLayer, Util, type PDFDocumentProxy, type PageViewport, type RenderTask } from 'pdfjs-dist'
import type { TextItem } from 'pdfjs-dist/types/src/display/api'
import { db, type Book, type Bookmark, type Highlight, type HighlightColor, type HighlightRect } from '@/db'
import { openPdf } from '@/services/pdf'
import { FINISHED_THRESHOLD, addReading, celebrate, recordReadingDay } from '@/services/stats'
import { HIGHLIGHT_COLORS, addHighlight, copyText, removeHighlight, updateHighlight } from '@/services/highlights'
import { checkAchievements, setAchievementAnnouncer } from '@/services/achievements'
import SelectionBar from '@/components/SelectionBar.vue'
import HighlightDialog from '@/components/HighlightDialog.vue'
import DictionaryDialog from '@/components/DictionaryDialog.vue'
import { cleanForSpeech, speechSupported, splitSentences } from '@/services/speech'
import { findMatches, foldQuery } from '@/services/bookSearch'
import {
  BACKGROUND_MAX_SECONDS,
  LOOKAHEAD_EPUB_CHAPTERS,
  LOOKAHEAD_PDF_PAGES,
  useReadAloud,
  type BackgroundPlan,
  type Sentence,
} from '@/composables/useReadAloud'
import {
  backgroundReadingSupported,
  hideNowPlaying,
  onMediaAction,
  showNowPlaying,
  startBackgroundQueue,
  takeBackgroundQueue,
} from '@/services/backgroundReading'
import ReaderBuddy from '@/components/ReaderBuddy.vue'
import ReadAloudBar from '@/components/ReadAloudBar.vue'

const props = defineProps<{ id: string }>()
const router = useRouter()
const route = useRoute()
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
/** Viewport de la página en píxeles CSS (sin devicePixelRatio), para colocar el resaltado. */
const pdfViewport = shallowRef<PageViewport>()
/** Capa de texto invisible encima del dibujo de la página: permite seleccionar y subrayar. */
const textLayerEl = ref<HTMLDivElement>()
let textLayer: TextLayer | null = null
let renderTask: RenderTask | null = null
let destroyPdf: (() => Promise<void>) | undefined

// EPUB
const epub = shallowRef<EpubBook>()
const rendition = shallowRef<Rendition>()
const fontSize = ref(100)
const epubPercent = ref<number | null>(null)
const epubLocationsReady = ref(false)
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
  markActivity()
  addReading({ pages: 1 })
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
    setTimeout(checkAchievements, 3000)
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
  window.addEventListener('pointerdown', markActivity)
  window.addEventListener('pointerdown', onTapStart, true)
  document.addEventListener('selectionchange', onDocumentSelectionChange)
  resizeObserver.observe(viewport.value!)
  setAchievementAnnouncer((a) => lumiSay(`${a.icon} ${a.lumi}`, 'excited', 6000))
  greetReader(meta)
  if (window.matchMedia('(pointer: coarse)').matches && !localStorage.getItem('bibli.tapHint')) {
    localStorage.setItem('bibli.tapHint', '1')
    $q.notify({
      message: 'Toca los bordes de la página para pasarla, y el centro para leer a pantalla completa',
      icon: 'touch_app',
      timeout: 5000,
    })
  }
  // Desde "Mis frases": abrir directamente en el subrayado
  if (typeof route.query.at === 'string') goTo(route.query.at)
})

onBeforeUnmount(() => {
  clearInterval(sessionTimer)
  clearInterval(statsTimer)
  highlightsSub.unsubscribe()
  setAchievementAnnouncer(null)
  window.removeEventListener('pointerdown', markActivity)
  window.removeEventListener('pointerdown', onTapStart, true)
  document.removeEventListener('selectionchange', onDocumentSelectionChange)
  window.removeEventListener('keydown', onKey)
  resizeObserver.disconnect()
  renderTask?.cancel()
  destroyPdf?.()
  epub.value?.destroy()
})

// ---------- PDF ----------

const PDF_MARGIN = 14

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
  // Margen alrededor de la hoja (el mismo que el padding de .pdf-viewport)
  const m = 2 * PDF_MARGIN
  const fit = Math.min((box.width - m) / base.width, (box.height - m) / base.height) * zoom.value
  const dpr = window.devicePixelRatio || 1
  const vp = p.getViewport({ scale: fit * dpr })
  canvas.value.width = Math.floor(vp.width)
  canvas.value.height = Math.floor(vp.height)
  canvas.value.style.width = `${Math.floor(vp.width / dpr)}px`
  canvas.value.style.height = `${Math.floor(vp.height / dpr)}px`
  renderTask = p.render({ canvas: canvas.value, viewport: vp })
  try {
    await renderTask.promise
    pdfViewport.value = p.getViewport({ scale: fit })
    if (dir) animateTurn(canvas.value?.parentElement ?? undefined, dir)
    await renderTextLayer(p, pdfViewport.value)
  } catch (err) {
    if ((err as Error)?.name !== 'RenderingCancelledException') throw err
  }
}

/** Texto transparente colocado sobre el dibujo de la página, para poder seleccionarlo. */
async function renderTextLayer(p: Awaited<ReturnType<PDFDocumentProxy['getPage']>>, vp: PageViewport) {
  const el = textLayerEl.value
  if (!el) return
  textLayer?.cancel()
  el.replaceChildren()
  el.style.setProperty('--total-scale-factor', String(vp.scale))
  el.style.setProperty('--scale-round-x', '1px')
  el.style.setProperty('--scale-round-y', '1px')
  textLayer = new TextLayer({ textContentSource: await p.getTextContent(), container: el, viewport: vp })
  await textLayer.render()
  // pdf.js fija el tamaño con round() de CSS, que los WebView antiguos no entienden: ocupa toda la página
  el.style.width = '100%'
  el.style.height = '100%'
}

function goToPdfPage(n: number, byReadAloud = false) {
  const target = Math.min(Math.max(1, n), pageCount.value)
  if (!target || target === page.value) return
  const dir = Math.sign(target - page.value)
  setPdfPage(target)
  saveProgress(String(target), target / pageCount.value)
  renderPdfPage(dir)
  if (!byReadAloud) readAloud.jump()
}

// ---------- Barra de progreso (deslizar para ir a otra parte del libro) ----------

/** Valor mientras se arrastra; null = sigue la página actual. EPUB: 0–1000 (décimas de %). */
const sliderDrag = ref<number | null>(null)
const sliderMax = computed(() => (book.value?.format === 'pdf' ? pageCount.value : 1000))
const sliderValue = computed(() => {
  if (sliderDrag.value != null) return sliderDrag.value
  return book.value?.format === 'pdf' ? page.value : Math.round((epubPercent.value ?? 0) * 1000)
})
const sliderDisabled = computed(() => (book.value?.format === 'pdf' ? pageCount.value < 2 : !epubLocationsReady.value))
const sliderLabel = computed(() =>
  book.value?.format === 'pdf' ? `Página ${sliderValue.value}` : `${Math.round(sliderValue.value / 10)}%`,
)

function onSliderChange(v: number | null) {
  sliderDrag.value = null
  if (v == null) return
  if (book.value?.format === 'pdf') goToPdfPage(v)
  else if (epub.value && epubLocationsReady.value) {
    rendition.value?.display(epub.value.locations.cfiFromPercentage(v / 1000)).then(() => readAloud.jump())
  }
}

/** Tocar "12 / 300" permite escribir la página exacta. */
function askPdfPage() {
  $q.dialog({
    title: 'Ir a la página',
    prompt: { model: String(page.value), type: 'number', isValid: (v: string) => +v >= 1 && +v <= pageCount.value },
    message: `Del 1 al ${pageCount.value}`,
    cancel: true,
  }).onOk((v: string) => goToPdfPage(Number(v)))
}

// ---------- EPUB ----------

const epubThemes = {
  day: { body: { color: '#2b2018 !important', background: '#fdf9f2 !important' } },
  night: {
    body: { color: '#ddd !important', background: '#121212 !important' },
    a: { color: '#ffb300 !important' },
  },
}

/**
 * Safari (iPhone, iPad, Mac) no entrega los toques ni la selección de texto de un iframe con sandbox sin
 * "allow-scripts", y entonces no se puede subrayar. Ahí se permite, pero antes se quita del libro
 * cualquier código (scripts y atributos on…), así que el EPUB sigue sin poder ejecutar nada.
 */
const appleWebKit =
  /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (/Macintosh/.test(navigator.userAgent) && /Safari/.test(navigator.userAgent) && !/Chrome|Chromium|Edg|Firefox/.test(navigator.userAgent))

function stripScripts(doc: Document) {
  doc.querySelectorAll('script, iframe, object, embed').forEach((el) => el.remove())
  doc.querySelectorAll('*').forEach((el) => {
    for (const attr of [...el.attributes]) {
      if (/^on/i.test(attr.name) || /^\s*javascript:/i.test(attr.value)) el.removeAttribute(attr.name)
    }
  })
}

async function initEpub(data: ArrayBuffer, meta: Book) {
  epub.value = ePub(data)
  if (appleWebKit) epub.value.spine.hooks.content.register((doc: Document) => stripScripts(doc))
  rendition.value = epub.value.renderTo(viewport.value!, {
    width: '100%',
    height: '100%',
    spread: 'auto',
    allowScriptedContent: appleWebKit,
  })
  rendition.value.themes.register('day', epubThemes.day)
  rendition.value.themes.register('night', epubThemes.night)
  rendition.value.themes.select(night.value ? 'night' : 'day')

  // Mientras epub.js genera las ubicaciones, percentageFromCfi devuelve 0 (no null): hasta que
  // terminen no hay porcentaje fiable, y guardarlo machacaría el progreso real del libro.
  let locationsReady = false
  const percentAt = (cfi: string) => (locationsReady ? epub.value!.locations.percentageFromCfi(cfi) : null)

  epubPercent.value = meta.progress || null
  watchEpubSelection(rendition.value)
  rendition.value.on('relocated', (loc: { start: { cfi: string; href: string } }) => {
    markActivity()
    const cfi = loc.start.cfi
    const pct = percentAt(cfi)
    if (pct != null) epubPercent.value = pct
    currentPosition.value = cfi
    currentLabel.value = epubLabel(loc.start.href, pct)
    saveProgress(cfi, pct)
  })
  rendition.value.on('keydown', onKey)

  epub.value.loaded.navigation.then((nav) => (toc.value = nav.toc))
  await rendition.value.display(meta.position || undefined)
  syncEpubHighlights()
  // Generar las ubicaciones permite calcular el % leído; puede tardar en libros grandes.
  await epub.value.ready
  await epub.value.locations.generate(1600)
  locationsReady = true
  epubLocationsReady.value = true
  const current = rendition.value.currentLocation() as unknown as { start?: { cfi: string; href: string } }
  if (current?.start) {
    const pct = percentAt(current.start.cfi)
    epubPercent.value = pct
    currentLabel.value = epubLabel(current.start.href, pct)
    saveProgress(current.start.cfi, pct)
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

// ---------- Lectura en voz alta ----------

// PDF: el texto viene en trozos (TextItem, normalmente una línea) con su posición. Se resalta la parte
// de cada trozo que ocupa la frase, repartiendo el ancho de forma proporcional a los caracteres.
interface PdfHighlightPart {
  item: TextItem
  /** Fracción del trozo donde empieza y acaba la frase (0–1). */
  from: number
  to: number
}
const pdfHighlight = shallowRef<PdfHighlightPart[]>([])
const pdfHighlightRects = computed(() => partRects(pdfHighlight.value))

function partRects(parts: PdfHighlightPart[]) {
  const vp = pdfViewport.value
  if (!vp) return []
  return parts.map(({ item, from, to }) => {
    const tx = Util.transform(vp.transform, item.transform)
    const h = Math.hypot(tx[2], tx[3])
    const w = item.width * vp.scale
    return {
      left: `${tx[4] + w * from - 2}px`,
      top: `${tx[5] - h}px`,
      width: `${w * (to - from) + 4}px`,
      height: `${h * 1.25}px`,
    }
  })
}

type PdfSpan = { start: number; end: number; item: TextItem }

/** Texto de una página PDF y qué trozo (TextItem) ocupa cada parte. */
async function pdfPageText(pageNumber: number): Promise<{ text: string; spans: PdfSpan[] }> {
  if (!pdf.value) return { text: '', spans: [] }
  const p = await pdf.value.getPage(pageNumber)
  const { items } = await p.getTextContent()
  let text = ''
  const spans: { start: number; end: number; item: TextItem }[] = []
  let prev: TextItem | null = null
  let pendingEOL = false
  for (const it of items) {
    if (!('str' in it)) continue
    if (it.str) {
      if (prev && pendingEOL) {
        // Un salto grande entre líneas es un párrafo nuevo; "pala-" + "bra" se une.
        const paragraph = Math.abs(prev.transform[5] - it.transform[5]) > Math.max(prev.height, it.height) * 1.8
        if (!paragraph && /\p{Ll}-$/u.test(text) && /^\p{Ll}/u.test(it.str)) text = text.slice(0, -1)
        else text += paragraph ? '\n' : ' '
      }
      const start = text.length
      text += it.str
      spans.push({ start, end: text.length, item: it })
      prev = it
      pendingEOL = false
    }
    if (it.hasEOL) pendingEOL = true
  }
  return { text, spans }
}

/** Partes de cada trozo que ocupa el texto entre `start` y `end`. */
function pdfParts(spans: PdfSpan[], start: number, end: number): PdfHighlightPart[] {
  return spans
    .filter((s) => s.end > start && s.start < end)
    .map((s) => {
      const len = s.end - s.start
      return { item: s.item, from: Math.max(0, start - s.start) / len, to: Math.min(len, end - s.start) / len }
    })
}

async function pdfSentences(pageNumber = page.value): Promise<Sentence[]> {
  const { text, spans } = await pdfPageText(pageNumber)
  return splitSentences(text).map(({ start, end }) => {
    const parts = pdfParts(spans, start, end)
    return { text: cleanForSpeech(text.slice(start, end)), show: () => (pdfHighlight.value = parts) }
  })
}

// EPUB: se recorre el HTML del capítulo y cada frase se resalta con una anotación de epub.js.
interface EpubContents {
  document: Document
  sectionIndex: number
  cfiFromRange(range: Range): string
}
interface EpubLocation {
  start: { cfi: string; index: number }
  end: { cfi: string }
}

const BLOCK_TAGS = 'p,div,li,h1,h2,h3,h4,h5,h6,blockquote,td,th,dt,dd,pre,figcaption,section,article,aside,header,footer'
const cfiTool = new EpubCFI()
let epubMark: string | null = null

function setEpubMark(cfi: string | null) {
  const r = rendition.value
  if (!r) return
  if (epubMark) r.annotations.remove(epubMark, 'underline')
  epubMark = cfi
  // Raya debajo (no relleno) para no confundirla con los subrayados de colores del lector
  if (cfi) {
    r.annotations.underline(cfi, {}, undefined, 'tts-ul', {
      stroke: '#e8891c',
      'stroke-opacity': '0.95',
      'stroke-width': '3',
      'mix-blend-mode': 'normal',
    })
  }
}

/** Texto de un capítulo EPUB y cómo convertir posiciones del texto en rangos del DOM. */
function documentText(doc: Document): { text: string; rangeOf(start: number, end: number): Range } {
  let text = ''
  const nodes: { node: Text; start: number }[] = []
  let lastBlock: Element | null = null
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === Node.ELEMENT_NODE) {
      if ((n as Element).localName === 'br') text += '\n'
      continue
    }
    const parent = n.parentElement
    if (!parent || parent.closest('script,style,noscript')) continue
    const block = parent.closest(BLOCK_TAGS)
    if (block !== lastBlock) {
      text += '\n'
      lastBlock = block
    }
    nodes.push({ node: n as Text, start: text.length })
    text += n.nodeValue ?? ''
  }

  /** Nodo de texto y desplazamiento de una posición del texto concatenado. */
  function pointAt(offset: number, isEnd: boolean): [Text, number] {
    let lo = 0
    let hi = nodes.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (isEnd ? nodes[mid].start < offset : nodes[mid].start <= offset) lo = mid
      else hi = mid - 1
    }
    const { node, start } = nodes[lo]
    return [node, Math.min(offset - start, node.length)]
  }

  return {
    text,
    rangeOf(start, end) {
      const range = doc.createRange()
      range.setStart(...pointAt(start, false))
      range.setEnd(...pointAt(end, true))
      return range
    },
  }
}

/** Frases del documento con su rango en el DOM. Los bloques (párrafos, títulos…) cortan frase. */
function documentSentences(doc: Document): { text: string; range: Range }[] {
  const { text, rangeOf } = documentText(doc)
  if (!text.trim()) return []
  return splitSentences(text).map(({ start, end }) => ({
    text: cleanForSpeech(text.slice(start, end)),
    range: rangeOf(start, end),
  }))
}

async function epubSentences(): Promise<Sentence[]> {
  const r = rendition.value
  if (!r) return []
  const loc = r.currentLocation() as unknown as EpubLocation
  const all = r.getContents() as unknown as EpubContents[]
  const contents = all.find((c) => c.sectionIndex === loc?.start?.index) ?? all[0]
  if (!loc?.start || !contents) return []
  const sentences = documentSentences(contents.document)

  // Empieza por la primera frase que se ve en la página actual
  let from = 0
  try {
    const pageStart = new EpubCFI(loc.start.cfi).toRange(contents.document)
    from = sentences.findIndex((s) => pageStart.comparePoint(s.range.endContainer, s.range.endOffset) >= 0)
    if (from < 0) from = sentences.length
  } catch {
    from = 0
  }

  return sentences.slice(from).map(({ text, range }) => ({
    text,
    show: () => {
      const cfi = contents.cfiFromRange(range)
      setEpubMark(cfi)
      // la voz llegó al final de la página: pasar a la siguiente
      const now = r.currentLocation() as unknown as EpubLocation
      if (now?.end && cfiTool.compare(cfi, now.end.cfi) > 0) {
        r.display(cfi).then(() => animateTurn(viewport.value, 1))
        onPageForward()
      }
    },
  }))
}

async function epubNextSection(): Promise<boolean> {
  const r = rendition.value
  const loc = r?.currentLocation() as unknown as EpubLocation | undefined
  const next = loc?.start ? epub.value?.spine.get(loc.start.index)?.next() : undefined
  if (!r || !next) return false
  await r.display(next.href)
  return true
}

function epubSectionIndex(): number | undefined {
  return (rendition.value?.currentLocation() as unknown as EpubLocation | undefined)?.start?.index
}

/** Texto de los capítulos siguientes sin mostrarlos (para leer con la pantalla bloqueada). */
async function epubUpcoming(count: number) {
  const book = epub.value
  const current = epubSectionIndex()
  if (!book || current == null) return []
  const out: { key: number; texts: string[] }[] = []
  for (let i = current + 1; out.length < count; i++) {
    const section = book.spine.get(i)
    if (!section) break
    await section.load(book.load.bind(book))
    const doc = (section as unknown as { document?: Document }).document
    if (doc?.body) out.push({ key: i, texts: documentSentences(doc).map((s) => s.text) })
    section.unload()
  }
  return out
}

async function pdfUpcoming(count: number) {
  const out: { key: number; texts: string[] }[] = []
  for (let p = page.value + 1; p <= pageCount.value && out.length < count; p++) {
    out.push({ key: p, texts: (await pdfSentences(p)).map((s) => s.text) })
  }
  return out
}

const readAloud = reactive(
  useReadAloud(
    {
      load: () => (book.value?.format === 'pdf' ? pdfSentences() : epubSentences()),
      async advance() {
        if (book.value?.format === 'epub') return epubNextSection()
        if (page.value >= pageCount.value) return false
        goToPdfPage(page.value + 1, true)
        onPageForward()
        return true
      },
      clear() {
        pdfHighlight.value = []
        setEpubMark(null)
      },
      currentKey: () => (book.value?.format === 'pdf' ? page.value : epubSectionIndex()),
      upcoming: (count) => (book.value?.format === 'pdf' ? pdfUpcoming(count) : epubUpcoming(count)),
      async goToChunk(key) {
        if (book.value?.format === 'pdf') goToPdfPage(key as number, true)
        else {
          const section = epub.value?.spine.get(key as number)
          if (section) await rendition.value?.display(section.href)
        }
      },
    },
    {
      onStart: () => {
        const onlyBasic = !readAloud.voices.some((v) => v.quality === 'natural' || v.quality === 'good')
        if (onlyBasic && !localStorage.getItem('bibli.tts.voiceTip')) {
          localStorage.setItem('bibli.tts.voiceTip', '1')
          lumiSay('¿Mi voz suena robótica? 🤖 Toca 🗣️ y te explico cómo conseguir una más natural, gratis', 'happy', 9000)
        } else {
          lumiSay('¡Ponte cómodo, yo te leo! 🎧', 'happy', 3500)
        }
      },
      onChunkEnd: () => {
        if (book.value?.format === 'epub') lumiSay('¡Fin del capítulo! Seguimos con el siguiente 🎶', 'excited', 3500)
      },
      onVoiceFallback: () =>
        lumiSay(
          readAloud.currentVoice?.neural
            ? 'La voz neuronal no pudo arrancar 😕 Sigo con la voz del teléfono'
            : 'Me quedé sin internet 📶 Sigo con la voz del teléfono',
          'happy',
          5000,
        ),
      onSleep: () => lumiSay('Buenas noches 🌙 Te guardé el sitio, mañana seguimos 😴', 'sleepy', 8000),
      onFinish: () => lumiSay('Y… ¡fin! 📕 Gracias por escuchar conmigo 🦉', 'excited', 6000),
      onNoText: () => {
        $q.notify({
          type: 'warning',
          message: 'No encuentro texto en estas páginas: parece un PDF escaneado (fotos de las páginas).',
          timeout: 5000,
        })
        lumiSay('Este PDF son fotos de páginas y no las puedo leer en voz alta 😢', 'sleepy', 6000)
      },
    },
  ),
)

function toggleListening() {
  if (readAloud.active) readAloud.close()
  else readAloud.play()
}

// Android: notificación con controles y lectura con la pantalla bloqueada
watch(
  () => [readAloud.active, readAloud.playing] as const,
  ([active, playing]) => {
    if (!active || !book.value) return hideNowPlaying()
    showNowPlaying({ title: book.value.title, author: book.value.author, cover: book.value.cover }, playing)
  },
)
const stopMediaActions = onMediaAction((action) => {
  if (action === 'play') readAloud.play()
  else if (action === 'pause') readAloud.pause()
  else if (action === 'next') readAloud.skip(1)
  else if (action === 'previous') readAloud.skip(-1)
  else if (action === 'stop') readAloud.close()
})
/**
 * Pantalla bloqueada: Chromium congela el WebView al minuto, así que se entregan las próximas frases
 * al servicio nativo, que sigue leyendo. Al volver, se retoma desde donde llegó.
 */
let backgroundPlan: BackgroundPlan | null = null
let backgroundSince = 0
async function onVisibilityChange() {
  if (!backgroundReadingSupported) return
  if (document.visibilityState === 'hidden') {
    if (!readAloud.playing || backgroundPlan) return
    const chunksAhead = book.value?.format === 'pdf' ? LOOKAHEAD_PDF_PAGES : LOOKAHEAD_EPUB_CHAPTERS
    const plan = await readAloud.exportForBackground(BACKGROUND_MAX_SECONDS, chunksAhead)
    if (!plan?.sentences.length) return
    try {
      await startBackgroundQueue(plan.sentences, readAloud.backgroundVoiceId, readAloud.rate)
      backgroundPlan = plan
      backgroundSince = Date.now()
    } catch (err) {
      console.warn('No se pudo seguir leyendo en segundo plano:', err)
      readAloud.play()
    }
  } else if (backgroundPlan) {
    const plan = backgroundPlan
    backgroundPlan = null
    const state = await takeBackgroundQueue()
    // Lo escuchado con la pantalla bloqueada también cuenta (como mucho, lo que daba la cola)
    const listened = Math.min((Date.now() - backgroundSince) / 1000, BACKGROUND_MAX_SECONDS)
    if (state.active && listened > 0) addReading({ seconds: Math.round(listened), listenSeconds: Math.round(listened) })
    if (state.active) await readAloud.resumeFromBackground(plan, state)
  }
}
document.addEventListener('visibilitychange', onVisibilityChange)

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisibilityChange)
  stopMediaActions()
  hideNowPlaying()
})

/** Alto real de la barra inferior (crece con el reproductor), para que Lumi se coloque encima. */
const footerHeight = ref(0)

// ---------- Subrayados, notas y diccionario ----------

const highlights = ref<Highlight[]>([])
const highlightsSub = liveQuery(() => db.highlights.where('bookId').equals(bookId).sortBy('createdAt')).subscribe(
  (list) => (highlights.value = list),
)

/** Texto seleccionado ahora mismo y dónde está (página o rango CFI). */
interface PendingSelection {
  text: string
  position: string
  rects?: HighlightRect[]
}
const selection = ref<PendingSelection | null>(null)
let epubSelectionWindow: Window | null = null

function clearSelection() {
  selection.value = null
  window.getSelection()?.removeAllRanges()
  epubSelectionWindow?.getSelection()?.removeAllRanges()
  epubSelectionWindow = null
}

// PDF: se selecciona sobre la capa de texto. Se espera un poco a que se suelten los tiradores.
let selectionTimer: ReturnType<typeof setTimeout> | undefined
function onDocumentSelectionChange() {
  if (book.value?.format !== 'pdf') return
  clearTimeout(selectionTimer)
  selectionTimer = setTimeout(readPdfSelection, 350)
}

function readPdfSelection() {
  const sel = window.getSelection()
  const el = textLayerEl.value
  if (!sel || sel.isCollapsed || !el || !sel.anchorNode || !el.contains(sel.anchorNode)) {
    if (book.value?.format === 'pdf') selection.value = null
    return
  }
  const text = cleanForSpeech(sel.toString())
  if (!text) return
  const box = el.getBoundingClientRect()
  const rects = [...sel.getRangeAt(0).getClientRects()]
    .filter((r) => r.width > 1 && r.height > 1)
    .map((r) => ({
      x: (r.left - box.left) / box.width,
      y: (r.top - box.top) / box.height,
      w: r.width / box.width,
      h: r.height / box.height,
    }))
  selection.value = { text, position: String(page.value), rects: mergeRects(rects) }
}

/** Une los trozos de una misma línea para que el subrayado se vea continuo. */
function mergeRects(rects: HighlightRect[]): HighlightRect[] {
  const out: HighlightRect[] = []
  for (const r of [...rects].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const last = out[out.length - 1]
    if (last && Math.abs(last.y - r.y) < last.h * 0.5 && r.x <= last.x + last.w + 0.02) {
      const right = Math.max(last.x + last.w, r.x + r.w)
      last.x = Math.min(last.x, r.x)
      last.w = right - last.x
      last.h = Math.max(last.h, r.h)
    } else {
      out.push({ ...r })
    }
  }
  return out
}

/** Subrayados de la página PDF visible, listos para dibujar sobre ella. */
const pdfPageHighlights = computed(() =>
  book.value?.format === 'pdf' ? highlights.value.filter((h) => h.position === String(page.value) && h.rects) : [],
)

// ---------- Toques: bordes para pasar página, centro para leer sin barras ----------

/** Barras de arriba y abajo visibles (tocar el centro las oculta para leer a pantalla completa). */
const barsVisible = ref(true)
/** Cómo empezó el último toque: con ratón no se pasa página al hacer clic en el texto. */
let tapStart = { mouse: true, hadSelection: false }
let annotationTapAt = 0

function onTapStart(e: PointerEvent) {
  tapStart = { mouse: e.pointerType === 'mouse', hadSelection: !!selection.value }
}

/** x en coordenadas de la ventana. halves: con ratón fuera de la hoja basta con el lado. */
function handleReaderTap(x: number, halves = false) {
  if (tapStart.hadSelection || !viewport.value) return
  const box = viewport.value.getBoundingClientRect()
  const f = (x - box.left) / box.width
  const edge = halves ? 0.5 : 0.28
  if (f < edge) prev()
  else if (f > 1 - edge) next()
  else if (!tapStart.mouse) barsVisible.value = !barsVisible.value
}

/** PDF: tocar un subrayado abre su nota; tocar los bordes pasa página. */
function onViewportClick(e: MouseEvent) {
  if (book.value?.format !== 'pdf' || window.getSelection()?.toString()) return
  const pageEl = (e.target as HTMLElement).closest('.pdf-page')
  if (pageEl) {
    const box = pageEl.getBoundingClientRect()
    const x = (e.clientX - box.left) / box.width
    const y = (e.clientY - box.top) / box.height
    const hit = pdfPageHighlights.value.find((h) =>
      h.rects!.some((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h),
    )
    if (hit) {
      openHighlight(hit.id)
      return
    }
    // Con ratón, hacer clic en el texto sirve para seleccionar, no para pasar página
    if (tapStart.mouse) return
  }
  handleReaderTap(e.clientX, tapStart.mouse)
}

/** EPUB: el toque llega desde dentro del iframe del capítulo. */
function onEpubClick(e: MouseEvent) {
  if (tapStart.mouse) return
  const target = e.target as Element | null
  if (target?.closest?.('a')) return
  const win = e.view as Window | null
  if (win?.getSelection()?.toString()) return
  const x = (win?.frameElement?.getBoundingClientRect().left ?? 0) + e.clientX
  // Si el toque era sobre un subrayado, se abre su nota y no se pasa página
  setTimeout(() => {
    if (Date.now() - annotationTapAt > 400) handleReaderTap(x)
  }, 30)
}

// EPUB: epub.js avisa de la selección dentro del capítulo y dibuja los subrayados como anotaciones
const epubDrawn = new Map<number, { cfi: string; color: HighlightColor }>()

function syncEpubHighlights() {
  const r = rendition.value
  if (!r) return
  const current = new Map(highlights.value.map((h) => [h.id, h]))
  for (const [id, drawn] of epubDrawn) {
    if (current.get(id)?.color !== drawn.color) {
      r.annotations.remove(drawn.cfi, 'highlight')
      epubDrawn.delete(id)
    }
  }
  for (const h of highlights.value) {
    if (epubDrawn.has(h.id)) continue
    r.annotations.highlight(h.position, { id: h.id }, () => {
      annotationTapAt = Date.now()
      openHighlight(h.id)
    }, 'hl-user', {
      fill: HIGHLIGHT_COLORS[h.color].solid,
      'fill-opacity': '0.4',
      'mix-blend-mode': 'normal',
    })
    epubDrawn.set(h.id, { cfi: h.position, color: h.color })
  }
}
watch(highlights, syncEpubHighlights)

function watchEpubSelection(r: Rendition) {
  r.on('selected', (cfiRange: string, contents: { window: Window }) => {
    const text = cleanForSpeech(contents.window.getSelection()?.toString() ?? '')
    if (!text) return
    epubSelectionWindow = contents.window
    selection.value = { text, position: cfiRange }
  })
  r.on('click', onEpubClick)
  r.hooks.content.register((contents: { document: Document }) => {
    contents.document.addEventListener('pointerdown', onTapStart, true)
    contents.document.addEventListener('selectionchange', () => {
      if (book.value?.format === 'epub' && contents.document.getSelection()?.isCollapsed) selection.value = null
    })
  })
}

async function saveSelection(color: HighlightColor, note = '') {
  const s = selection.value
  if (!s) return
  // IndexedDB no puede guardar los Proxy reactivos de Vue: se guarda una copia simple
  const rects = s.rects?.map((r) => ({ x: r.x, y: r.y, w: r.w, h: r.h }))
  await addHighlight({ bookId, position: s.position, rects, text: s.text, note, color })
  clearSelection()
  lumiSay(note ? '¡Nota guardada! 📝' : '¡Guardada en tus frases favoritas! 🖍️', 'happy', 2500)
  checkAchievements()
}

function onSelectionNote() {
  const s = selection.value
  if (!s) return
  $q.dialog({ component: HighlightDialog, componentProps: { text: s.text } }).onOk(
    ({ note, color }: { note: string; color: HighlightColor }) => saveSelection(color, note),
  )
}

function onSelectionDefine() {
  const s = selection.value
  if (!s) return
  $q.dialog({ component: DictionaryDialog, componentProps: { text: s.text } })
  clearSelection()
}

async function onSelectionCopy() {
  const s = selection.value
  if (!s) return
  const ok = await copyText(s.text)
  $q.notify({ message: ok ? 'Copiado' : 'No se pudo copiar', icon: 'content_copy', timeout: 1200 })
  clearSelection()
}

function openHighlight(id: number) {
  const h = highlights.value.find((x) => x.id === id)
  if (!h) return
  $q.dialog({
    component: HighlightDialog,
    componentProps: { text: h.text, note: h.note, color: h.color, existing: true },
  }).onOk(async (r: { remove?: boolean; note?: string; color?: HighlightColor }) => {
    if (r.remove) await removeHighlight(id)
    else {
      await updateHighlight(id, { note: r.note ?? '', color: r.color ?? h.color })
      checkAchievements()
    }
  })
}

// ---------- Buscar en el libro ----------

const SEARCH_MAX_RESULTS = 300
interface SearchResult {
  key: string
  position: string
  label: string
  before: string
  match: string
  after: string
  /** PDF: dónde está la coincidencia en el texto de la página. */
  start?: number
  end?: number
}
const searchOpen = ref(false)
const searchQuery = ref('')
const searchResults = shallowRef<SearchResult[]>([])
const searching = ref(false)
const searchProgress = ref(0)
const searchDone = ref(false)
const searchActive = ref<string | null>(null)
let searchRun = 0
let searchTimer: ReturnType<typeof setTimeout> | undefined

/** Coincidencia marcada en la página PDF actual. */
const pdfSearchHit = shallowRef<{ page: number; parts: PdfHighlightPart[] } | null>(null)
const pdfSearchRects = computed(() =>
  pdfSearchHit.value && pdfSearchHit.value.page === page.value ? partRects(pdfSearchHit.value.parts) : [],
)
let epubSearchMark: string | null = null

const pdfTextCache = new Map<number, string>()
async function pdfSearchText(p: number): Promise<string> {
  let text = pdfTextCache.get(p)
  if (text == null) {
    text = (await pdfPageText(p)).text
    pdfTextCache.set(p, text)
  }
  return text
}

function openSearch() {
  searchOpen.value = true
}

function onSearchInput() {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(runSearch, 450)
}

async function runSearch() {
  clearTimeout(searchTimer)
  const run = ++searchRun
  const query = foldQuery(searchQuery.value ?? '')
  searchResults.value = []
  searchDone.value = false
  if (query.length < 2) {
    searching.value = false
    return
  }
  searching.value = true
  searchProgress.value = 0
  const results: SearchResult[] = []
  const push = (items: SearchResult[]) => {
    results.push(...items.slice(0, SEARCH_MAX_RESULTS - results.length))
    searchResults.value = [...results]
  }
  try {
    if (book.value?.format === 'pdf') {
      // Varias páginas a la vez; el texto se guarda para que la siguiente búsqueda sea instantánea.
      const BATCH = 8
      for (let first = 1; first <= pageCount.value && results.length < SEARCH_MAX_RESULTS; first += BATCH) {
        const pages = Array.from({ length: Math.min(BATCH, pageCount.value - first + 1) }, (_, k) => first + k)
        const texts = await Promise.all(pages.map(pdfSearchText))
        if (run !== searchRun) return
        pages.forEach((p, k) =>
          push(
            findMatches(texts[k], query, SEARCH_MAX_RESULTS).map((m, i) => ({
              ...m,
              key: `${p}-${i}`,
              position: String(p),
              label: `Página ${p}`,
            })),
          ),
        )
        searchProgress.value = (first + pages.length - 1) / pageCount.value
      }
    } else if (epub.value) {
      const b = epub.value
      const total = (b.spine as unknown as { length: number }).length || 1
      for (let i = 0; results.length < SEARCH_MAX_RESULTS; i++) {
        const section = b.spine.get(i)
        if (!section) break
        await section.load(b.load.bind(b))
        if (run !== searchRun) return
        const doc = (section as unknown as { document?: Document }).document
        if (doc?.body) {
          const { text, rangeOf } = documentText(doc)
          const label = findTocLabel(toc.value, section.href) ?? `Sección ${i + 1}`
          push(
            findMatches(text, query, SEARCH_MAX_RESULTS - results.length).map((m, j) => ({
              ...m,
              key: `${i}-${j}`,
              position: section.cfiFromRange(rangeOf(m.start, m.end)),
              label,
              start: undefined,
              end: undefined,
            })),
          )
        }
        section.unload()
        searchProgress.value = (i + 1) / total
      }
    }
  } finally {
    if (run === searchRun) {
      searching.value = false
      searchDone.value = true
    }
  }
}

async function openSearchResult(r: SearchResult) {
  searchOpen.value = false
  searchActive.value = r.key
  if (book.value?.format === 'pdf') {
    const p = Number(r.position)
    const { spans } = await pdfPageText(p)
    pdfSearchHit.value = { page: p, parts: pdfParts(spans, r.start!, r.end!) }
    goTo(r.position)
  } else {
    const rd = rendition.value
    if (!rd) return
    if (epubSearchMark) rd.annotations.remove(epubSearchMark, 'highlight')
    epubSearchMark = r.position
    rd.annotations.highlight(r.position, {}, undefined, 'search-hl', {
      fill: '#2f8fd8',
      'fill-opacity': '0.4',
      'mix-blend-mode': 'normal',
    })
    goTo(r.position)
  }
}

/** Ir a la coincidencia anterior o siguiente sin abrir el buscador. */
function stepSearch(dir: number) {
  const list = searchResults.value
  const i = list.findIndex((r) => r.key === searchActive.value)
  const target = list[i + dir]
  if (target) openSearchResult(target)
}

const searchIndex = computed(() => searchResults.value.findIndex((r) => r.key === searchActive.value))

function closeSearchHits() {
  searchActive.value = null
  pdfSearchHit.value = null
  if (epubSearchMark) rendition.value?.annotations.remove(epubSearchMark, 'highlight')
  epubSearchMark = null
}

// ---------- Estadísticas: tiempo, páginas y escucha ----------

const READING_TICK_S = 15
/** Sin tocar nada durante este tiempo (y sin escuchar), no cuenta como lectura. */
const IDLE_AFTER_MS = 3 * 60_000
let lastActivity = Date.now()
let statsTicks = 0

function markActivity() {
  lastActivity = Date.now()
}

const statsTimer = setInterval(() => {
  if (document.visibilityState !== 'visible' || loading.value) return
  const listening = readAloud.playing
  if (!listening && Date.now() - lastActivity > IDLE_AFTER_MS) return
  addReading({ seconds: READING_TICK_S, listenSeconds: listening ? READING_TICK_S : 0 })
  if (++statsTicks % 4 === 0) checkAchievements()
}, READING_TICK_S * 1000)

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
  else rendition.value?.display(position).then(() => readAloud.jump())
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
    rendition.value?.next().then(() => {
      animateTurn(viewport.value, 1)
      readAloud.jump()
    })
  }
  onPageForward()
}

function prev() {
  if (book.value?.format === 'pdf') goToPdfPage(page.value - 1)
  else
    rendition.value?.prev().then(() => {
      animateTurn(viewport.value, -1)
      readAloud.jump()
    })
}

function onKey(e: KeyboardEvent) {
  if ((e.target as HTMLElement)?.tagName === 'INPUT') return
  if (e.key === ' ' && readAloud.active) {
    e.preventDefault()
    readAloud.toggle()
  } else if (e.key === 'ArrowRight' || e.key === 'PageDown') next()
  else if (e.key === 'ArrowLeft' || e.key === 'PageUp') prev()
  else if (e.key === 'b') toggleBookmark()
  else if (e.key === 'f' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault()
    openSearch()
  }
  else if (e.key === 'Escape') router.push({ name: 'library' })
}

/** Ajusta la página cuando cambia el espacio disponible (ventana, giro o reproductor abierto). */
let resizeTimer: ReturnType<typeof setTimeout> | undefined
let lastSize = ''
const resizeObserver = new ResizeObserver(([entry]) => {
  const { width, height } = entry.contentRect
  const size = `${Math.round(width)}x${Math.round(height)}`
  if (size === lastSize) return
  const first = !lastSize
  lastSize = size
  if (first) return
  clearTimeout(resizeTimer)
  resizeTimer = setTimeout(() => {
    if (book.value?.format === 'pdf') renderPdfPage()
    else rendition.value?.resize(Math.round(width), Math.round(height))
  }, 150)
})

/** El alto de la página es el de la pantalla menos la cabecera y la barra inferior. */
function pageStyle(offset: number, height: number) {
  return { height: `${height - offset}px` }
}

function setZoom(delta: number) {
  zoom.value = Math.min(4, Math.max(0.5, +(zoom.value + delta).toFixed(2)))
  renderPdfPage()
}

function onSwipe({ direction }: { direction?: string }) {
  if (book.value?.format !== 'pdf') return
  // Arrastrar para seleccionar texto no debe pasar de página
  if (window.getSelection()?.toString()) return
  if (direction === 'left') next()
  else if (direction === 'right') prev()
}
</script>

<template>
  <q-layout view="hHh lpR fFf">
    <q-header :model-value="barsVisible" elevated class="reader-bar">
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
        <q-btn flat round icon="search" aria-label="Buscar en el libro" @click="openSearch">
          <q-tooltip>Buscar en el libro (Ctrl+F)</q-tooltip>
        </q-btn>
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

          <q-separator class="q-my-sm" />
          <q-item-label header>Subrayados y notas</q-item-label>
          <q-item v-if="!highlights.length">
            <q-item-section class="text-grey">
              Mantén pulsado el texto (o selecciónalo) para subrayarlo o buscar una palabra.
            </q-item-section>
          </q-item>
          <q-item v-for="h in highlights" :key="h.id" clickable @click="goTo(h.position)">
            <q-item-section avatar>
              <span class="hl-swatch" :style="{ background: HIGHLIGHT_COLORS[h.color].solid }" />
            </q-item-section>
            <q-item-section>
              <q-item-label lines="3" class="hl-text">{{ h.text }}</q-item-label>
              <q-item-label v-if="h.note" caption lines="2" class="hl-note">📝 {{ h.note }}</q-item-label>
            </q-item-section>
            <q-item-section side>
              <q-btn flat round dense icon="edit" size="sm" aria-label="Editar" @click.stop="openHighlight(h.id)" />
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

    <q-footer :model-value="barsVisible || readAloud.active" class="reader-bar reader-bar--bottom">
      <q-resize-observer @resize="(s) => (footerHeight = s.height)" />
      <transition name="tts">
        <ReadAloudBar
          v-if="readAloud.active"
          :ra="readAloud"
          :chunk-name="book?.format === 'pdf' ? 'esta página' : 'este capítulo'"
        />
      </transition>
      <q-toolbar>
        <q-btn flat round icon="chevron_left" @click="prev" />
        <q-btn
          v-if="speechSupported && !loading"
          flat
          round
          :icon="readAloud.active ? 'headset_off' : 'headphones'"
          :class="{ 'listen-btn--on': readAloud.active }"
          @click="toggleListening"
        >
          <q-tooltip>{{ readAloud.active ? 'Dejar de escuchar' : 'Escuchar (Lumi te lee)' }}</q-tooltip>
        </q-btn>
        <q-slider
          v-if="book && sliderMax"
          class="reader-slider"
          :model-value="sliderValue"
          :min="book.format === 'pdf' ? 1 : 0"
          :max="sliderMax"
          :step="1"
          :disable="sliderDisabled"
          label
          :label-value="sliderLabel"
          color="accent"
          track-color="white"
          dark
          aria-label="Avance en el libro"
          @update:model-value="(v) => (sliderDrag = v)"
          @change="onSliderChange"
        />
        <q-space v-else />
        <button
          v-if="book?.format === 'pdf' && pageCount"
          class="reader-progress reader-progress--btn"
          aria-label="Ir a una página"
          @click="askPdfPage"
        >
          {{ page }}<span class="reader-progress__total"> / {{ pageCount }}</span>
        </button>
        <span v-else-if="epubPercent != null" class="reader-progress">{{ Math.round(epubPercent * 100) }}%</span>
        <q-btn flat round icon="chevron_right" @click="next" />
      </q-toolbar>
    </q-footer>

    <q-page-container>
      <q-page class="reader-page" :class="{ night }" :style-fn="pageStyle">
        <q-inner-loading :showing="loading" />
        <div
          v-if="!loading"
          ref="viewport"
          v-touch-swipe.horizontal="onSwipe"
          class="viewport"
          :class="{ 'pdf-viewport': book?.format === 'pdf' }"
          @click="onViewportClick"
        >
          <div v-if="book?.format === 'pdf'" class="pdf-page">
            <canvas ref="canvas" />
            <template v-for="h in pdfPageHighlights" :key="h.id">
              <div
                v-for="(r, i) in h.rects"
                :key="i"
                class="user-hl"
                :style="{
                  left: `${r.x * 100}%`,
                  top: `${r.y * 100}%`,
                  width: `${r.w * 100}%`,
                  height: `${r.h * 100}%`,
                  background: HIGHLIGHT_COLORS[h.color].fill,
                }"
              />
            </template>
            <div v-for="(r, i) in pdfHighlightRects" :key="`tts-${i}`" class="tts-hl" :style="r" />
            <div v-for="(r, i) in pdfSearchRects" :key="`search-${i}`" class="search-hl" :style="r" />
            <div ref="textLayerEl" class="textLayer" />
          </div>
        </div>
        <template v-if="!loading">
          <button class="side-nav side-nav--prev" aria-label="Página anterior" @click="prev">
            <q-icon name="chevron_left" size="32px" />
          </button>
          <button class="side-nav side-nav--next" aria-label="Página siguiente" @click="next">
            <q-icon name="chevron_right" size="32px" />
          </button>
        </template>
        <div v-if="searchActive && searchIndex >= 0 && !selection" class="search-nav shadow-4">
          <q-btn flat dense round icon="search" size="sm" aria-label="Ver resultados" @click="openSearch" />
          <span class="search-nav__count">{{ searchIndex + 1 }} / {{ searchResults.length }}</span>
          <q-btn flat dense round icon="keyboard_arrow_up" size="sm" :disable="searchIndex <= 0" aria-label="Anterior" @click="stepSearch(-1)" />
          <q-btn flat dense round icon="keyboard_arrow_down" size="sm" :disable="searchIndex >= searchResults.length - 1" aria-label="Siguiente" @click="stepSearch(1)" />
          <q-btn flat dense round icon="close" size="sm" aria-label="Cerrar búsqueda" @click="closeSearchHits" />
        </div>
        <q-dialog v-model="searchOpen" position="top">
          <q-card class="search-card">
            <q-card-section class="q-pb-sm">
              <q-input
                v-model="searchQuery"
                autofocus
                dense
                outlined
                clearable
                placeholder="Buscar una palabra o frase"
                @update:model-value="onSearchInput"
                @keyup.enter="runSearch"
              >
                <template #prepend><q-icon name="search" /></template>
              </q-input>
              <div class="search-status">
                <template v-if="searching">
                  Buscando… {{ Math.round(searchProgress * 100) }}%
                  <q-linear-progress :value="searchProgress" color="accent" class="q-mt-xs" />
                </template>
                <template v-else-if="searchDone && !searchResults.length">No aparece en este libro.</template>
                <template v-else-if="searchDone">
                  {{ searchResults.length >= SEARCH_MAX_RESULTS ? `Más de ${SEARCH_MAX_RESULTS}` : searchResults.length }}
                  {{ searchResults.length === 1 ? 'resultado' : 'resultados' }}
                </template>
                <template v-else>No importan las mayúsculas ni las tildes.</template>
              </div>
            </q-card-section>
            <q-list v-if="searchResults.length" separator class="search-results">
              <q-item
                v-for="r in searchResults"
                :key="r.key"
                clickable
                :active="r.key === searchActive"
                active-class="search-results__active"
                @click="openSearchResult(r)"
              >
                <q-item-section>
                  <q-item-label caption>{{ r.label }}</q-item-label>
                  <q-item-label class="search-snippet">
                    {{ r.before }}<mark>{{ r.match }}</mark>{{ r.after }}
                  </q-item-label>
                </q-item-section>
              </q-item>
            </q-list>
          </q-card>
        </q-dialog>
        <SelectionBar
          v-if="selection"
          :text="selection.text"
          @highlight="saveSelection"
          @note="onSelectionNote"
          @define="onSelectionDefine"
          @copy="onSelectionCopy"
          @close="clearSelection"
        />
        <transition name="buddy">
          <ReaderBuddy
            v-if="showBuddy && !loading"
            ref="buddy"
            :listening="readAloud.playing"
            :bottom="footerHeight"
          />
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
  position: relative;
  background: #fdf9f2;
}
.reader-slider {
  flex: 1;
  margin: 0 12px;
  min-width: 80px;
}
.reader-progress {
  font-variant-numeric: tabular-nums;
  font-size: 0.9rem;
  white-space: nowrap;
  padding: 4px 8px;
  min-width: 48px;
  text-align: center;
}
.reader-progress--btn {
  background: rgba(255, 255, 255, 0.12);
  border: 0;
  border-radius: 999px;
  color: inherit;
  font-family: inherit;
  cursor: pointer;
}
.reader-progress__total {
  opacity: 0.7;
}
/* Flechas a los lados: solo con ratón, aparecen al pasar por encima */
.side-nav {
  position: absolute;
  top: 50%;
  translate: 0 -50%;
  z-index: 3;
  width: 44px;
  height: 96px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 0;
  color: #fff;
  background: rgba(59, 42, 32, 0.45);
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.2s;
}
.side-nav--prev {
  left: 0;
  border-radius: 0 12px 12px 0;
}
.side-nav--next {
  right: 0;
  border-radius: 12px 0 0 12px;
}
@media (hover: hover) and (pointer: fine) {
  .reader-page:hover .side-nav {
    opacity: 0.55;
  }
  .reader-page .side-nav:hover {
    opacity: 1;
  }
}
@media not ((hover: hover) and (pointer: fine)) {
  .side-nav {
    display: none;
  }
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
  min-width: 0;
  height: 100%;
  overflow: hidden;
}
.pdf-viewport {
  overflow: auto;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding: 14px; /* = PDF_MARGIN */
  /* Mesa de madera clara alrededor de la hoja, a juego con la app */
  background: radial-gradient(ellipse at center, #efe5d6 0%, #e2d3bf 100%);
}
.night .pdf-viewport {
  background: #0d0b0a;
}
.pdf-page {
  position: relative;
  margin: auto;
}
/* Subrayados del usuario: debajo de la capa de texto, para no estorbar al seleccionar */
.user-hl {
  position: absolute;
  border-radius: 2px;
  pointer-events: none;
  mix-blend-mode: multiply;
}
.night .user-hl {
  mix-blend-mode: normal;
  opacity: 0.6;
}
.hl-swatch {
  display: inline-block;
  width: 6px;
  height: 36px;
  border-radius: 3px;
}
.hl-text {
  font-family: var(--font-display);
  font-style: italic;
}
.hl-note {
  margin-top: 2px;
}
/* Capa de texto de pdf.js (sus reglas, sin anidar, para que funcionen en WebViews antiguos) */
.textLayer {
  position: absolute;
  inset: 0;
  overflow: clip;
  line-height: 1;
  text-align: initial;
  -webkit-text-size-adjust: none;
  text-size-adjust: none;
  forced-color-adjust: none;
  transform-origin: 0 0;
  z-index: 2;
  --min-font-size: 1;
  --text-scale-factor: calc(var(--total-scale-factor) * var(--min-font-size));
  --min-font-size-inv: calc(1 / var(--min-font-size));
}
.textLayer :deep(span),
.textLayer :deep(br) {
  color: transparent;
  position: absolute;
  white-space: pre;
  cursor: text;
  transform-origin: 0% 0%;
  user-select: text;
  -webkit-user-select: text;
}
.textLayer > :deep(:not(.markedContent)),
.textLayer :deep(.markedContent span:not(.markedContent)) {
  z-index: 1;
  --font-height: 0;
  font-size: calc(var(--text-scale-factor) * var(--font-height));
  --scale-x: 1;
  --rotate: 0deg;
  transform: rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv));
}
.textLayer :deep(.markedContent) {
  display: contents;
}
.textLayer :deep(::selection) {
  background: rgba(242, 158, 56, 0.35);
  color: transparent;
}
.textLayer :deep(br::selection) {
  background: transparent;
}
.textLayer :deep(.endOfContent) {
  display: block;
  position: absolute;
  inset: 100% 0 0;
  z-index: 0;
  cursor: default;
  user-select: none;
}
.pdf-viewport canvas {
  display: block;
  background: white;
  border-radius: 3px;
  box-shadow:
    0 1px 3px rgba(60, 40, 20, 0.18),
    0 14px 34px -10px rgba(60, 40, 20, 0.35);
}
.night .pdf-viewport canvas {
  box-shadow: 0 10px 30px -8px rgba(0, 0, 0, 0.9);
}
/* Frase que se está leyendo en voz alta */
/* Frase que se está leyendo: raya naranja debajo, distinta del relleno de los subrayados */
.tts-hl {
  position: absolute;
  border-bottom: 3px solid rgba(232, 137, 28, 0.95);
  pointer-events: none;
  transition:
    left 0.2s,
    top 0.2s,
    width 0.2s;
}
.night .tts-hl {
  border-bottom-color: #ffb04d;
}
.search-hl {
  position: absolute;
  border-radius: 3px;
  background: rgba(47, 143, 216, 0.35);
  outline: 2px solid rgba(47, 143, 216, 0.8);
  pointer-events: none;
}
.search-nav {
  position: fixed;
  top: calc(64px + var(--q-safe-area-inset-top, 0px));
  left: 50%;
  transform: translateX(-50%);
  z-index: 2000;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px 6px;
  border-radius: 999px;
  background: var(--card);
  color: var(--ink);
}
.search-nav__count {
  font-size: 0.85rem;
  padding: 0 4px;
  min-width: 52px;
  text-align: center;
}
.search-card {
  width: 600px;
  max-width: 94vw;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
}
.search-status {
  font-size: 0.8rem;
  color: var(--ink-soft);
  margin-top: 6px;
}
.search-results {
  overflow-y: auto;
}
.search-results__active {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
}
.search-snippet {
  line-height: 1.4;
}
.search-snippet mark {
  background: rgba(47, 143, 216, 0.3);
  color: inherit;
  border-radius: 3px;
  padding: 0 1px;
  font-weight: 600;
}
.listen-btn--on {
  color: var(--accent);
}
.tts-enter-active,
.tts-leave-active {
  transition:
    opacity 0.25s,
    transform 0.3s cubic-bezier(0.3, 1.3, 0.5, 1);
}
.tts-enter-from,
.tts-leave-to {
  opacity: 0;
  transform: translateY(20px);
}
/* Invierte la página y rota el tono para que las imágenes conserven colores aproximados. */
.night .pdf-viewport canvas {
  filter: invert(0.9) hue-rotate(180deg);
}
</style>
