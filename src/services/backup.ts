/**
 * Copia de seguridad: un .zip con la biblioteca (libros, progreso, marcadores, estanterías), los
 * subrayados y notas, las estadísticas y los logros. Al recuperarla en otro aparato se junta con lo
 * que ya haya: no se borra nada y los libros repetidos no se duplican (se reconocen por su huella).
 */
import JSZip from 'jszip'
import { Capacitor } from '@capacitor/core'
import { db, type Book, type BookNote, type Highlight, type ReadingDay, type UnlockedAchievement, type WishItem } from '@/db'

const MANIFEST = 'bibli.json'
const VERSION = 1

interface BackupBook extends Omit<Book, 'id'> {
  /** Id que tenía en el aparato de origen (para enlazar los subrayados). */
  oldId: number
  fileType?: string
}
interface BackupHighlight extends Omit<Highlight, 'id' | 'bookId'> {
  bookHash: string
}
interface BackupNote extends Omit<BookNote, 'id' | 'bookId'> {
  bookHash: string
}
interface Manifest {
  app: 'bibli'
  version: number
  createdAt: number
  withBooks: boolean
  books: BackupBook[]
  highlights: BackupHighlight[]
  days: ReadingDay[]
  achievements: UnlockedAchievement[]
  settings: Record<string, string>
  /** Desde la versión con cuaderno y "Quiero leer" (las copias antiguas no lo traen). */
  notes?: BackupNote[]
  wishlist?: Omit<WishItem, 'id'>[]
}

export interface RestoreResult {
  added: number
  updated: number
  /** Libros de la copia sin archivo (copia "solo datos") que no están en este aparato. */
  missing: number
  highlights: number
}

const bookPath = (hash: string) => `books/${hash}`

/** Ajustes propios de Bibli (tema, voz, meta diaria…). */
function readSettings() {
  const out: Record<string, string> = {}
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k?.startsWith('bibli.')) out[k] = localStorage.getItem(k) ?? ''
  }
  return out
}

/** Tamaño aproximado de la copia con libros, para avisar antes de hacerla. */
export async function libraryBytes() {
  const books = await db.books.toArray()
  return books.reduce((sum, b) => sum + (b.size || 0), 0)
}

export async function createBackup(withBooks: boolean, onProgress: (f: number) => void): Promise<Blob> {
  const [books, highlights, days, achievements, notes, wishlist] = await Promise.all([
    db.books.toArray(),
    db.highlights.toArray(),
    db.days.toArray(),
    db.achievements.toArray(),
    db.notes.toArray(),
    db.wishlist.toArray(),
  ])
  const hashById = new Map(books.map((b) => [b.id, b.hash]))
  const zip = new JSZip()
  const manifestBooks: BackupBook[] = []
  for (const { id, ...rest } of books) {
    const entry: BackupBook = { ...rest, oldId: id }
    if (withBooks) {
      const file = await db.files.get(id)
      if (file) {
        // Los PDF y EPUB ya van comprimidos: guardarlos tal cual es mucho más rápido
        zip.file(bookPath(rest.hash), file.data, { compression: 'STORE' })
        entry.fileType = file.data.type
      }
    }
    manifestBooks.push(entry)
  }
  const manifest: Manifest = {
    app: 'bibli',
    version: VERSION,
    createdAt: Date.now(),
    withBooks,
    books: manifestBooks,
    highlights: highlights
      .filter((h) => hashById.has(h.bookId))
      .map(({ id: _id, bookId, ...h }) => ({ ...h, bookHash: hashById.get(bookId)! })),
    days,
    achievements,
    settings: readSettings(),
    notes: notes
      .filter((n) => hashById.has(n.bookId))
      .map(({ id: _id, bookId, ...n }) => ({ ...n, bookHash: hashById.get(bookId)! })),
    wishlist: wishlist.map(({ id: _id, ...w }) => w),
  }
  zip.file(MANIFEST, JSON.stringify(manifest))
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', mimeType: 'application/zip' }, (m) =>
    onProgress(m.percent / 100),
  )
}

export function backupFileName(withBooks: boolean) {
  const d = new Date()
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return `bibli-copia${withBooks ? '' : '-datos'}-${date}.zip`
}

/**
 * Entrega el archivo al usuario. Debe llamarse dentro de un toque (Safari exige un gesto para compartir).
 * App Android: se escribe en la caché y se abre el menú Compartir (Drive, Archivos, correo…).
 * iPhone/iPad: menú Compartir → "Guardar en Archivos". Ordenador: descarga normal.
 */
export async function saveBackup(blob: Blob, name: string) {
  if (Capacitor.isNativePlatform()) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem')
    const { Share } = await import('@capacitor/share')
    // Por trozos: pasar cientos de MB de una vez al lado nativo agota la memoria
    const CHUNK = 3 * 1024 * 1024
    let start = 0
    do {
      const data = await blobToBase64(blob.slice(start, start + CHUNK))
      const opts = { path: name, data, directory: Directory.Cache }
      if (start === 0) await Filesystem.writeFile(opts)
      else await Filesystem.appendFile(opts)
      start += CHUNK
    } while (start < blob.size)
    const { uri } = await Filesystem.getUri({ path: name, directory: Directory.Cache })
    await Share.share({ title: 'Copia de seguridad de Bibli', files: [uri] })
    return
  }
  const file = new File([blob], name, { type: 'application/zip' })
  const touch = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || navigator.maxTouchPoints > 1
  if (touch && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Copia de seguridad de Bibli' })
      return
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      // Si compartir falla, se descarga
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

/** Junta la copia con lo que ya hay en este aparato. */
export async function restoreBackup(file: Blob, onProgress: (f: number) => void): Promise<RestoreResult> {
  const zip = await JSZip.loadAsync(file)
  const raw = await zip.file(MANIFEST)?.async('string')
  if (!raw) throw new Error('not-backup')
  const data = JSON.parse(raw) as Manifest
  if (data.app !== 'bibli') throw new Error('not-backup')

  const result: RestoreResult = { added: 0, updated: 0, missing: 0, highlights: 0 }
  const idByHash = new Map<string, number>()
  let done = 0

  for (const { oldId: _old, fileType, ...b } of data.books) {
    const existing = await db.books.where('hash').equals(b.hash).first()
    if (existing) {
      // Se queda con el progreso más reciente y suma marcadores y estanterías
      const newer = (b.lastOpenedAt ?? 0) > (existing.lastOpenedAt ?? 0)
      const marks = new Map([...existing.bookmarks, ...b.bookmarks].map((m) => [m.position, m]))
      await db.books.update(existing.id, {
        tags: [...new Set([...existing.tags, ...b.tags])],
        bookmarks: [...marks.values()],
        ...(newer ? { position: b.position, progress: b.progress, lastOpenedAt: b.lastOpenedAt } : {}),
      })
      idByHash.set(b.hash, existing.id)
      result.updated++
    } else {
      const entry = zip.file(bookPath(b.hash))
      if (!entry) {
        result.missing++
      } else {
        const blob = await entry.async('blob')
        await db.transaction('rw', db.books, db.files, async () => {
          const id = await db.books.add(b as Book)
          await db.files.add({ bookId: id, data: new Blob([blob], { type: fileType || '' }) })
          idByHash.set(b.hash, id)
        })
        result.added++
      }
    }
    onProgress(++done / Math.max(1, data.books.length))
  }

  // Subrayados y notas, sin repetir los que ya estén
  for (const { bookHash, ...h } of data.highlights) {
    const bookId = idByHash.get(bookHash)
    if (!bookId) continue
    const dup = await db.highlights
      .where('bookId')
      .equals(bookId)
      .filter((x) => x.position === h.position && x.text === h.text)
      .count()
    if (dup) continue
    await db.highlights.add({ ...h, bookId } as Highlight)
    result.highlights++
  }

  // Cuaderno: sin repetir notas iguales
  for (const { bookHash, ...n } of data.notes ?? []) {
    const bookId = idByHash.get(bookHash)
    if (!bookId) continue
    const dup = await db.notes
      .where('bookId')
      .equals(bookId)
      .filter((x) => x.title === n.title && x.text === n.text)
      .count()
    if (!dup) await db.notes.add({ ...n, bookId } as BookNote)
  }
  // Quiero leer: sin repetir títulos
  const wished = new Set((await db.wishlist.toArray()).map((w) => w.title.toLowerCase()))
  for (const w of data.wishlist ?? []) {
    if (!wished.has(w.title.toLowerCase())) await db.wishlist.add(w as WishItem)
  }

  // Estadísticas: por cada día, el valor mayor (el mismo día pudo leerse en los dos aparatos)
  for (const d of data.days) {
    const cur = await db.days.get(d.date)
    await db.days.put(
      cur
        ? {
            date: d.date,
            seconds: Math.max(cur.seconds, d.seconds),
            pages: Math.max(cur.pages, d.pages),
            listenSeconds: Math.max(cur.listenSeconds, d.listenSeconds),
          }
        : d,
    )
  }
  for (const a of data.achievements) {
    const cur = await db.achievements.get(a.id)
    if (!cur || a.unlockedAt < cur.unlockedAt) await db.achievements.put(a)
  }
  // Ajustes: solo los que este aparato aún no tiene
  for (const [k, v] of Object.entries(data.settings ?? {})) {
    if (localStorage.getItem(k) === null) localStorage.setItem(k, v)
  }
  return result
}
