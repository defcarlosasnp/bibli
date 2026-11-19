import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { liveQuery } from 'dexie'
import { db, type Book } from '@/db'
import { detectFormat, extractMetadata, sha256 } from '@/services/metadata'
import { epubToUtf8 } from '@/services/epubEncoding'
import { FINISHED_THRESHOLD } from '@/services/stats'

export type SortKey = 'title' | 'author' | 'addedAt' | 'lastOpenedAt'
export type ViewMode = 'grid' | 'list'
export type StatusFilter = 'reading' | 'unread' | 'finished'

export function bookStatus(b: Book): StatusFilter {
  if (b.progress >= FINISHED_THRESHOLD) return 'finished'
  return b.progress > 0 ? 'reading' : 'unread'
}

export interface ImportResult {
  added: number
  duplicates: number
  unsupported: number
}

const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true })

export const useLibraryStore = defineStore('library', () => {
  const books = ref<Book[]>([])
  const loaded = ref(false)
  const search = ref('')
  const sortKey = ref<SortKey>((localStorage.getItem('bibli.sort') as SortKey) || 'title')
  const formatFilter = ref<'all' | 'pdf' | 'epub'>('all')
  const tagFilter = ref<string | null>(null)
  /** Estanterías automáticas según lo leído. */
  const statusFilter = ref<StatusFilter | null>(null)
  const viewMode = ref<ViewMode>((localStorage.getItem('bibli.view') as ViewMode) || 'grid')

  const allTags = computed(() =>
    [...new Set(books.value.flatMap((b) => b.tags))].sort((a, b) => collator.compare(a, b)),
  )

  liveQuery(() => db.books.toArray()).subscribe({
    next: (rows) => {
      books.value = rows
      loaded.value = true
    },
    error: (err) => console.error(err),
  })

  const visibleBooks = computed(() => {
    const q = search.value.trim().toLocaleLowerCase('es')
    const filtered = books.value.filter(
      (b) =>
        (formatFilter.value === 'all' || b.format === formatFilter.value) &&
        (!tagFilter.value || b.tags.includes(tagFilter.value)) &&
        (!statusFilter.value || bookStatus(b) === statusFilter.value) &&
        (!q || b.title.toLocaleLowerCase('es').includes(q) || b.author.toLocaleLowerCase('es').includes(q)),
    )
    const key = sortKey.value
    return filtered.sort((a, b) => {
      switch (key) {
        case 'title':
          return collator.compare(a.title, b.title)
        case 'author':
          return collator.compare(a.author || '￿', b.author || '￿') || collator.compare(a.title, b.title)
        case 'addedAt':
          return b.addedAt - a.addedAt
        case 'lastOpenedAt':
          return (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0)
      }
    })
  })

  function setSort(key: SortKey) {
    sortKey.value = key
    localStorage.setItem('bibli.sort', key)
  }

  function setViewMode(mode: ViewMode) {
    viewMode.value = mode
    localStorage.setItem('bibli.view', mode)
  }

  async function importFiles(files: Iterable<File>): Promise<ImportResult> {
    const result: ImportResult = { added: 0, duplicates: 0, unsupported: 0 }
    for (const file of files) {
      const format = detectFormat(file)
      if (!format) {
        result.unsupported++
        continue
      }
      const original = await file.arrayBuffer()
      // El hash es del archivo original, para detectar duplicados aunque se convierta
      const hash = await sha256(original)
      if (await db.books.where('hash').equals(hash).count()) {
        result.duplicates++
        continue
      }
      const data = format === 'epub' ? await epubToUtf8(original).catch(() => original) : original
      const meta = await extractMetadata(format, data, file.name)
      await db.transaction('rw', db.books, db.files, async () => {
        const id = await db.books.add({
          hash,
          format,
          fileName: file.name,
          size: file.size,
          title: meta.title,
          author: meta.author,
          cover: meta.cover,
          addedAt: Date.now(),
          lastOpenedAt: null,
          position: null,
          progress: 0,
          tags: tagFilter.value ? [tagFilter.value] : [],
          bookmarks: [],
        })
        await db.files.add({ bookId: id, data: new Blob([data], { type: file.type }) })
      })
      result.added++
    }
    return result
  }

  async function updateBook(id: number, changes: Partial<Pick<Book, 'title' | 'author' | 'tags'>>) {
    await db.books.update(id, changes)
    if (tagFilter.value && !allTags.value.includes(tagFilter.value)) tagFilter.value = null
  }

  /** Cambia el nombre de una estantería en todos sus libros (si ya existe otra igual, se juntan). */
  async function renameShelf(from: string, to: string) {
    to = to.trim()
    if (!to || to === from) return
    await db.books
      .where('tags')
      .equals(from)
      .modify((b: Book) => {
        b.tags = [...new Set(b.tags.map((t) => (t === from ? to : t)))]
      })
    if (tagFilter.value === from) tagFilter.value = to
  }

  /** Quita la estantería; los libros siguen en la biblioteca. */
  async function deleteShelf(name: string) {
    await db.books
      .where('tags')
      .equals(name)
      .modify((b: Book) => {
        b.tags = b.tags.filter((t) => t !== name)
      })
    if (tagFilter.value === name) tagFilter.value = null
  }

  async function removeBook(id: number) {
    await db.transaction('rw', db.books, db.files, db.highlights, async () => {
      await db.books.delete(id)
      await db.files.delete(id)
      await db.highlights.where('bookId').equals(id).delete()
    })
  }

  return {
    books,
    loaded,
    search,
    sortKey,
    formatFilter,
    tagFilter,
    statusFilter,
    viewMode,
    allTags,
    visibleBooks,
    setSort,
    setViewMode,
    importFiles,
    updateBook,
    renameShelf,
    deleteShelf,
    removeBook,
  }
})
