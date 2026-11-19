import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { liveQuery } from 'dexie'
import { db, type Book } from '@/db'
import { detectFormat, extractMetadata, sha256 } from '@/services/metadata'
import { epubToUtf8 } from '@/services/epubEncoding'
import { FINISHED_THRESHOLD } from '@/services/stats'
import { completeLibraryInfo } from '@/services/bookInfo'

export type SortKey = 'custom' | 'series' | 'title' | 'author' | 'addedAt' | 'lastOpenedAt'
/** spines: lomos en una estantería de madera · grid: portadas · list: lista */
export type ViewMode = 'spines' | 'grid' | 'list'
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
  const viewMode = ref<ViewMode>((localStorage.getItem('bibli.view') as ViewMode) || 'spines')

  const allTags = computed(() =>
    [...new Set(books.value.flatMap((b) => b.tags))].sort((a, b) => collator.compare(a, b)),
  )

  liveQuery(() => db.books.toArray()).subscribe({
    next: (rows) => {
      books.value = rows
      // La primera vez: completar en segundo plano los datos que falten (saga, autor, portada)
      if (!loaded.value) setTimeout(() => completeLibraryInfo(), 4000)
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
    return filtered.sort(compareBy(sortKey.value))
  })

  function compareBy(key: SortKey) {
    return (a: Book, b: Book) => {
      switch (key) {
        case 'custom':
          // Los que nunca se movieron, después y por fecha de llegada
          return (a.order ?? 1e9 + a.addedAt / 1e6) - (b.order ?? 1e9 + b.addedAt / 1e6)
        case 'series': {
          // Cada saga junta y en orden; los libros sueltos, por su título, entre medias
          const ka = a.series || a.title
          const kb = b.series || b.title
          return (
            collator.compare(ka, kb) ||
            (a.seriesIndex ?? 999) - (b.seriesIndex ?? 999) ||
            collator.compare(a.title, b.title)
          )
        }
        case 'title':
          return collator.compare(a.title, b.title)
        case 'author':
          return collator.compare(a.author || '￿', b.author || '￿') || collator.compare(a.title, b.title)
        case 'addedAt':
          return b.addedAt - a.addedAt
        case 'lastOpenedAt':
          return (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0)
      }
    }
  }

  /**
   * Nuevo orden de los libros visibles (ids tal como quedan tras arrastrar). Pasa a "Mi orden": los
   * visibles se recolocan en los huecos que ocupaban en el orden completo, así un filtro no desordena el resto.
   */
  async function setVisibleOrder(ids: number[]) {
    const byId = new Map(books.value.map((b) => [b.id, b]))
    const visible = ids.map((id) => byId.get(id)).filter((b): b is Book => !!b)
    const all = [...books.value].sort(compareBy(sortKey.value))
    const slots = visible.map((b) => all.indexOf(b)).sort((x, y) => x - y)
    slots.forEach((slot, i) => (all[slot] = visible[i]))
    // Se cambia ya en memoria (para que no salte) y luego se guarda
    all.forEach((b, i) => (b.order = i))
    setSort('custom')
    await db.transaction('rw', db.books, () => Promise.all(all.map((b, i) => db.books.update(b.id, { order: i }))))
  }


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
    if (result.added) setTimeout(() => completeLibraryInfo(), 1500)
    return result
  }

  async function updateBook(
    id: number,
    changes: Partial<Pick<Book, 'title' | 'author' | 'tags' | 'series' | 'seriesIndex'>>,
  ) {
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
    setVisibleOrder,
  }
})
