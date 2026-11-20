/**
 * Completa los datos de los libros sin molestar: la saga (de los datos internos del EPUB o del
 * título) y, si faltan, el autor o la portada (de Open Library). Nunca cambia lo que ya hay ni lo
 * que el usuario escribió; cada libro se revisa una sola vez, en segundo plano.
 */
import JSZip from 'jszip'
import { db, type Book } from '@/db'

export interface SeriesInfo {
  series: string
  index?: number
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim()
const num = (s: string | undefined) => {
  const n = Number(String(s ?? '').replace(',', '.'))
  return Number.isFinite(n) && n > 0 && n < 1000 ? n : undefined
}

/** Números romanos de los títulos ("El archivo de las tormentas III"). */
function roman(s: string): number | undefined {
  const map: Record<string, number> = { I: 1, V: 5, X: 10, L: 50 }
  if (!/^[IVXL]+$/.test(s)) return undefined
  let total = 0
  for (let i = 0; i < s.length; i++) {
    const v = map[s[i]]
    total += v < (map[s[i + 1]] ?? 0) ? -v : v
  }
  return total > 0 && total < 60 ? total : undefined
}

/**
 * Saga escrita en el propio título:
 * - "Juramentada (El archivo de las tormentas 3)" o "(El archivo de las tormentas, #3)"
 * - "Mistborn 1: El imperio final" o "Mistborn #1 - El imperio final"
 * - "Saga de los Longevos II"
 */
export function seriesFromTitle(title: string): SeriesInfo | null {
  const t = clean(title)
  let m =
    /\(([^()]*?\p{L}[^()]*?)(?:[\s,.:\-–]+(?:#|n[ºo°.]|libro|vol\.?|tomo|parte)?\s*|\s*#\s*)(\d{1,3}(?:[.,]\d)?|[IVXL]{1,6})\)\s*$/iu.exec(t)
  if (m) {
    const index = num(m[2]) ?? roman(m[2].toUpperCase())
    const series = clean(m[1].replace(/[\s,:\-–]*(?:#|n[ºo°.]|libro|vol\.?|tomo|parte)?[\s,:\-–]*$/iu, ''))
    // "(Tomo II)" solo dice el número, no la saga
    if (index && series && !/^(libro|tomo|vol\.?|parte|volumen)$/iu.test(series)) return { series, index }
  }
  m = /^(\p{L}[^:\-–#]*?)\s*(?:#|n[ºo°.]\s*|libro\s+)?(\d{1,3})\s*[:\-–]\s+\S/iu.exec(t)
  if (m && !/^\d+$/.test(m[1])) return { series: clean(m[1]), index: num(m[2]) }
  return null
}

/** "Tormentas &amp; Luz" → "Tormentas & Luz" (lo justo para textos del OPF). */
function decodeEntities(s: string) {
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (all, code: string) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1))
      return Number.isFinite(n) ? String.fromCodePoint(n) : all
    }
    return named[code.toLowerCase()] ?? all
  })
}

/**
 * Saga en los datos internos del EPUB: la que pone Calibre ("calibre:series") o la de EPUB 3
 * ("belongs-to-collection" con "group-position").
 */
export async function seriesFromEpub(data: Blob): Promise<SeriesInfo | null> {
  try {
    const zip = await JSZip.loadAsync(data)
    const container = await zip.file('META-INF/container.xml')?.async('string')
    const opfPath = container && /full-path="([^"]+)"/.exec(container)?.[1]
    const opf = opfPath && (await zip.file(opfPath)?.async('string'))
    if (!opf) return null
    const attr = (tag: string, name: string) => new RegExp(`${name}\\s*=\\s*"([^"]*)"`).exec(tag)?.[1]
    const metas = opf.match(/<meta\b[^>]*\/?>(?:[^<]*<\/meta>)?/g) ?? []
    let series: string | undefined
    let index: number | undefined
    for (const tag of metas) {
      const name = attr(tag, 'name')
      if (name === 'calibre:series') series = attr(tag, 'content')
      if (name === 'calibre:series_index') index = num(attr(tag, 'content'))
    }
    if (!series) {
      const coll = /(<meta\b[^>]*property="belongs-to-collection"[^>]*>)([^<]+)<\/meta>/.exec(opf)
      if (coll) {
        series = coll[2]
        const id = attr(coll[1], 'id')
        if (id) {
          const pos = new RegExp(`<meta\\b[^>]*refines="#${id}"[^>]*property="group-position"[^>]*>([^<]+)<`).exec(opf)
          index = num(pos?.[1])
        }
      }
    }
    if (!series) return null
    return { series: clean(decodeEntities(series)), index }
  } catch {
    return null
  }
}

/** Sin tildes ni signos, para comparar títulos ("Juramentada" = "juramentada."). */
const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/** Título sin la saga entre paréntesis ni subtítulos, para buscarlo. */
const searchTitle = (t: string) => clean(t.replace(/\([^()]*\)\s*$/, '').split(/[:\-–]\s/)[0])

interface OpenLibraryDoc {
  title: string
  author_name?: string[]
  cover_i?: number
}

/** Busca el libro en Open Library; solo vale si el título coincide de verdad. */
async function openLibraryMatch(book: Book): Promise<OpenLibraryDoc | null> {
  const title = searchTitle(book.title)
  if (fold(title).length < 3) return null
  const params = new URLSearchParams({ title, limit: '5', fields: 'title,author_name,cover_i' })
  if (book.author) params.set('author', book.author)
  const res = await fetch(`https://openlibrary.org/search.json?${params}`)
  if (!res.ok) return null
  const { docs } = (await res.json()) as { docs: OpenLibraryDoc[] }
  const want = fold(title)
  return docs.find((d) => fold(d.title) === want) ?? null
}

async function coverFromOpenLibrary(id: number): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      // Open Library devuelve una imagen de 1×1 cuando no tiene portada
      if (img.naturalWidth < 20) return resolve(null)
      const canvas = document.createElement('canvas')
      canvas.width = 300
      canvas.height = Math.round((img.naturalHeight / img.naturalWidth) * 300)
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
      try {
        resolve(canvas.toDataURL('image/jpeg', 0.8))
      } catch {
        resolve(null)
      }
    }
    img.onerror = () => resolve(null)
    img.src = `https://covers.openlibrary.org/b/id/${id}-M.jpg`
  })
}

/** Buscar en internet (Open Library) el autor o la portada que falten. Se puede apagar en Ajustes. */
export function onlineInfoEnabled() {
  return localStorage.getItem('bibli.onlineInfo') !== '0'
}
export function setOnlineInfo(on: boolean) {
  localStorage.setItem('bibli.onlineInfo', on ? '1' : '0')
}

/** Revisa un libro y guarda lo que encuentre. */
async function completeBook(book: Book) {
  const changes: Partial<Book> = { infoChecked: true }
  if (!book.series) {
    let found: SeriesInfo | null = null
    if (book.format === 'epub') {
      const file = await db.files.get(book.id)
      if (file) found = await seriesFromEpub(file.data)
    }
    found ??= seriesFromTitle(book.title)
    if (found) {
      changes.series = found.series
      if (found.index != null && book.seriesIndex == null) changes.seriesIndex = found.index
    }
  }
  if ((!book.author || !book.cover) && onlineInfoEnabled()) {
    try {
      if (!navigator.onLine) throw new Error('offline')
      const doc = await openLibraryMatch(book)
      if (doc) {
        if (!book.author && doc.author_name?.length) changes.author = doc.author_name.slice(0, 2).join(', ')
        if (!book.cover && doc.cover_i) {
          const cover = await coverFromOpenLibrary(doc.cover_i)
          if (cover) changes.cover = cover
        }
      }
    } catch {
      // Sin conexión o Open Library no responde: se guarda la saga y se reintentará la próxima vez
      changes.infoChecked = false
    }
  }
  await db.books.update(book.id, changes)
}

/** Vuelve a revisar todos los libros (solo rellena lo que falte; nunca cambia lo que ya hay). */
export async function recheckLibraryInfo() {
  await db.books.toCollection().modify((b: Book) => {
    b.infoChecked = false
  })
  await completeLibraryInfo()
}

let running = false
/** Revisa en segundo plano, de uno en uno, los libros que aún no se revisaron. */
export async function completeLibraryInfo() {
  if (running) return
  running = true
  try {
    const pending = await db.books.filter((b) => !b.infoChecked).toArray()
    for (const book of pending) {
      await completeBook(book).catch(() => undefined)
      // Sin prisa: que no compita con abrir un libro ni sature Open Library
      await new Promise((r) => setTimeout(r, 1200))
    }
  } finally {
    running = false
  }
}
