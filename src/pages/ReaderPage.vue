<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, nextTick, toRaw, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useQuasar } from 'quasar'
import ePub, { EpubCFI, type Book as EpubBook, type Rendition, type NavItem } from 'epubjs'
import { Util, type PDFDocumentProxy, type PageViewport, type RenderTask } from 'pdfjs-dist'
import type { TextItem } from 'pdfjs-dist/types/src/display/api'
import { db, type Book, type Bookmark } from '@/db'
import { openPdf } from '@/services/pdf'
import { FINISHED_THRESHOLD, celebrate, recordReadingDay } from '@/services/stats'
import { cleanForSpeech, speechSupported, splitSentences } from '@/services/speech'
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
  resizeObserver.observe(viewport.value!)
  greetReader(meta)
})

onBeforeUnmount(() => {
  clearInterval(sessionTimer)
  window.removeEventListener('keydown', onKey)
  resizeObserver.disconnect()
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
    pdfViewport.value = p.getViewport({ scale: fit })
    if (dir) animateTurn(canvas.value?.parentElement ?? undefined, dir)
  } catch (err) {
    if ((err as Error)?.name !== 'RenderingCancelledException') throw err
  }
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

  // Mientras epub.js genera las ubicaciones, percentageFromCfi devuelve 0 (no null): hasta que
  // terminen no hay porcentaje fiable, y guardarlo machacaría el progreso real del libro.
  let locationsReady = false
  const percentAt = (cfi: string) => (locationsReady ? epub.value!.locations.percentageFromCfi(cfi) : null)

  epubPercent.value = meta.progress || null
  rendition.value.on('relocated', (loc: { start: { cfi: string; href: string } }) => {
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
  // Generar las ubicaciones permite calcular el % leído; puede tardar en libros grandes.
  await epub.value.ready
  await epub.value.locations.generate(1600)
  locationsReady = true
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
const pdfHighlightRects = computed(() => {
  const vp = pdfViewport.value
  if (!vp) return []
  return pdfHighlight.value.map(({ item, from, to }) => {
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
})

async function pdfSentences(pageNumber = page.value): Promise<Sentence[]> {
  if (!pdf.value) return []
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
  return splitSentences(text).map(({ start, end }) => {
    const parts = spans
      .filter((s) => s.end > start && s.start < end)
      .map((s) => {
        const len = s.end - s.start
        return { item: s.item, from: Math.max(0, start - s.start) / len, to: Math.min(len, end - s.start) / len }
      })
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
  if (epubMark) r.annotations.remove(epubMark, 'highlight')
  epubMark = cfi
  if (cfi) {
    r.annotations.highlight(cfi, {}, undefined, 'tts-hl', {
      fill: '#f29e38',
      'fill-opacity': '0.35',
      'mix-blend-mode': 'normal',
    })
  }
}

/** Frases del documento con su rango en el DOM. Los bloques (párrafos, títulos…) cortan frase. */
function documentSentences(doc: Document): { text: string; range: Range }[] {
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

  return splitSentences(text).map(({ start, end }) => {
    const range = doc.createRange()
    range.setStart(...pointAt(start, false))
    range.setEnd(...pointAt(end, true))
    return { text: cleanForSpeech(text.slice(start, end)), range }
  })
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
      onVoiceFallback: () => lumiSay('Me quedé sin internet 📶 Sigo con la voz del teléfono', 'happy', 5000),
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
async function onVisibilityChange() {
  if (!backgroundReadingSupported) return
  if (document.visibilityState === 'hidden') {
    if (!readAloud.playing || backgroundPlan) return
    const chunksAhead = book.value?.format === 'pdf' ? LOOKAHEAD_PDF_PAGES : LOOKAHEAD_EPUB_CHAPTERS
    const plan = await readAloud.exportForBackground(BACKGROUND_MAX_SECONDS, chunksAhead)
    if (!plan?.sentences.length) return
    try {
      await startBackgroundQueue(plan.sentences, readAloud.speakingVoiceId, readAloud.rate)
      backgroundPlan = plan
    } catch (err) {
      console.warn('No se pudo seguir leyendo en segundo plano:', err)
      readAloud.play()
    }
  } else if (backgroundPlan) {
    const plan = backgroundPlan
    backgroundPlan = null
    const state = await takeBackgroundQueue()
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
      <q-page class="reader-page" :class="{ night }" :style-fn="pageStyle">
        <q-inner-loading :showing="loading" />
        <div
          v-if="!loading"
          ref="viewport"
          v-touch-swipe.mouse.horizontal="onSwipe"
          class="viewport"
          :class="{ 'pdf-viewport': book?.format === 'pdf' }"
        >
          <div v-if="book?.format === 'pdf'" class="pdf-page">
            <canvas ref="canvas" class="shadow-4" />
            <div v-for="(r, i) in pdfHighlightRects" :key="i" class="tts-hl" :style="r" />
          </div>
        </div>
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
  background: #5d5d5d;
}
.night .pdf-viewport {
  background: #000;
}
.pdf-page {
  position: relative;
  margin: auto;
}
.pdf-viewport canvas {
  display: block;
  background: white;
}
/* Frase que se está leyendo en voz alta */
.tts-hl {
  position: absolute;
  border-radius: 3px;
  background: rgba(242, 158, 56, 0.35);
  pointer-events: none;
  transition:
    left 0.2s,
    top 0.2s,
    width 0.2s;
}
.night .tts-hl {
  background: rgba(242, 158, 56, 0.45);
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
