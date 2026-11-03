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
}

/** El binario va en su propia tabla para no cargarlo al listar la biblioteca. */
export interface BookFile {
  bookId: number
  data: Blob
}

export const db = new Dexie('bibli') as Dexie & {
  books: EntityTable<Book, 'id'>
  files: EntityTable<BookFile, 'bookId'>
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
