import Dexie, { type EntityTable } from 'dexie'

export type BookFormat = 'pdf' | 'epub'

export interface Bookmark {
  /** Página (PDF) o CFI (EPUB). */
  position: string
  label: string
  createdAt: number
}

export interface Book {
  id: number
  hash: string
  title: string
  author: string
  format: BookFormat
  fileName: string
  size: number
  /** Miniatura JPEG como data URL. */
  cover: string | null
  addedAt: number
  lastOpenedAt: number | null
  /** Página (PDF) o CFI (EPUB) donde se quedó el lector. */
  position: string | null
  /** 0..1 */
  progress: number
  /** Colecciones / etiquetas a las que pertenece. */
  tags: string[]
  bookmarks: Bookmark[]
  /** Posición en "Mi orden" (arrastrando los libros); sin valor, va por fecha de llegada. */
  order?: number
}

/** El binario va en su propia tabla para no cargarlo al listar la biblioteca. */
export interface BookFile {
  bookId: number
  data: Blob
}

export type HighlightColor = 'yellow' | 'green' | 'pink' | 'blue'

/** Rectángulo de un subrayado en un PDF, en fracciones del tamaño de la página (0..1). */
export interface HighlightRect {
  x: number
  y: number
  w: number
  h: number
}

export interface Highlight {
  id: number
  bookId: number
  /** Página (PDF) o rango CFI (EPUB). */
  position: string
  /** Solo PDF: dónde dibujarlo, independiente del zoom. */
  rects?: HighlightRect[]
  text: string
  note: string
  color: HighlightColor
  createdAt: number
}

/** Actividad de un día (fecha local AAAA-MM-DD). */
export interface ReadingDay {
  date: string
  /** Segundos leyendo con la app abierta (o escuchando). */
  seconds: number
  /** Páginas pasadas hacia delante. */
  pages: number
  /** Segundos escuchando a Lumi leer. */
  listenSeconds: number
}

export interface UnlockedAchievement {
  id: string
  unlockedAt: number
}

export const db = new Dexie('bibli') as Dexie & {
  books: EntityTable<Book, 'id'>
  files: EntityTable<BookFile, 'bookId'>
  highlights: EntityTable<Highlight, 'id'>
  days: EntityTable<ReadingDay, 'date'>
  achievements: EntityTable<UnlockedAchievement, 'id'>
}

db.version(1).stores({
  books: '++id, &hash, title, author, format, addedAt, lastOpenedAt',
  files: 'bookId',
})

db.version(2)
  .stores({
    books: '++id, &hash, title, author, format, addedAt, lastOpenedAt, *tags',
  })
  .upgrade((tx) =>
    tx
      .table('books')
      .toCollection()
      .modify((book: Book) => {
        book.tags ??= []
        book.bookmarks ??= []
      }),
  )

db.version(3)
  .stores({
    highlights: '++id, bookId, createdAt',
    days: 'date',
    achievements: 'id',
  })
  .upgrade(async (tx) => {
    // Antes solo se guardaban los días con lectura (para la racha) en localStorage
    let legacy: string[] = []
    try {
      legacy = JSON.parse(localStorage.getItem('bibli.readingDays') || '[]')
    } catch {
      legacy = []
    }
    await tx
      .table('days')
      .bulkPut(legacy.map((date) => ({ date, seconds: 0, pages: 0, listenSeconds: 0 })))
  })
