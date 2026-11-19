/** Acciones sobre un libro que se abren desde varios sitios (lector, estantería, ficha). */
import { Dialog } from 'quasar'
import { db, type Book } from '@/db'
import RatingDialog from '@/components/RatingDialog.vue'
import NotebookDialog from '@/components/NotebookDialog.vue'

export function askRating(book: Book) {
  Dialog.create({ component: RatingDialog, componentProps: { book } }).onOk(
    ({ rating, review }: { rating?: number; review?: string }) => db.books.update(book.id, { rating, review }),
  )
}

export function openNotebook(book: Pick<Book, 'id' | 'title'>) {
  Dialog.create({ component: NotebookDialog, componentProps: { bookId: book.id, title: book.title } })
}

/** "3 nov 2026" */
export function shortDate(ms: number) {
  return new Date(ms).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' })
}
