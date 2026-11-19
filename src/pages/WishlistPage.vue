<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useQuasar } from 'quasar'
import { liveQuery } from 'dexie'
import { db, type Book, type WishItem } from '@/db'
import LumiOwl from '@/components/LumiOwl.vue'

/** Libros que quieres leer y aún no tienes. Se buscan en Open Library o se apuntan a mano. */
const router = useRouter()
const $q = useQuasar()

const wishes = ref<WishItem[]>([])
const books = ref<Book[]>([])
const subs = [
  liveQuery(() => db.wishlist.orderBy('addedAt').reverse().toArray()).subscribe((v) => (wishes.value = v)),
  liveQuery(() => db.books.toArray()).subscribe((v) => (books.value = v)),
]
onBeforeUnmount(() => subs.forEach((s) => s.unsubscribe()))

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/** Si ya está en la biblioteca (mismo título), para avisar y poder abrirlo. */
const ownedBook = (w: WishItem) => {
  const t = fold(w.title)
  return books.value.find((b) => fold(b.title) === t || fold(b.title).startsWith(t + ' '))
}

// ---------- Buscar en Open Library ----------
interface Result {
  key: string
  title: string
  author: string
  cover: string | null
  year?: number
}
const query = ref('')
const results = ref<Result[]>([])
const searching = ref(false)
const searchError = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined
let lastSearch = 0

watch(query, (q) => {
  clearTimeout(timer)
  if (!q || q.trim().length < 3) {
    results.value = []
    return
  }
  timer = setTimeout(() => search(q.trim()), 500)
})

async function search(q: string) {
  const id = ++lastSearch
  searching.value = true
  searchError.value = false
  try {
    const params = new URLSearchParams({ q, limit: '12', fields: 'key,title,author_name,cover_i,first_publish_year' })
    const res = await fetch(`https://openlibrary.org/search.json?${params}`)
    const data = (await res.json()) as {
      docs: { key: string; title: string; author_name?: string[]; cover_i?: number; first_publish_year?: number }[]
    }
    if (id !== lastSearch) return
    results.value = data.docs.map((d) => ({
      key: d.key,
      title: d.title,
      author: d.author_name?.slice(0, 2).join(', ') ?? '',
      cover: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : null,
      year: d.first_publish_year,
    }))
  } catch {
    if (id === lastSearch) searchError.value = true
  } finally {
    if (id === lastSearch) searching.value = false
  }
}

const already = (title: string) => wishes.value.some((w) => fold(w.title) === fold(title))

async function add(r: Pick<Result, 'title' | 'author' | 'cover' | 'year'>) {
  if (already(r.title)) return
  await db.wishlist.add({ title: r.title, author: r.author, cover: r.cover, year: r.year, addedAt: Date.now() } as WishItem)
  $q.notify({ message: `«${r.title}» apuntado`, icon: 'bookmark_add', timeout: 1500 })
}

function addManual() {
  const title = query.value.trim()
  if (title) add({ title, author: '', cover: null })
  query.value = ''
}

function remove(w: WishItem) {
  db.wishlist.delete(w.id)
  $q.notify({
    message: `Quitado «${w.title}»`,
    timeout: 3000,
    actions: [{ label: 'Deshacer', color: 'accent', handler: () => db.wishlist.add(w) }],
  })
}

const owned = computed(() => wishes.value.filter((w) => ownedBook(w)))
</script>

<template>
  <q-layout view="hHh lpR fFf">
    <q-header class="app-header">
      <q-toolbar>
        <q-btn flat round icon="arrow_back" aria-label="Volver" @click="router.push({ name: 'library' })" />
        <q-toolbar-title class="font-display text-weight-bold">Quiero leer</q-toolbar-title>
        <span v-if="wishes.length" class="q-mr-sm text-caption">{{ wishes.length }} apuntados</span>
      </q-toolbar>
    </q-header>

    <q-page-container>
      <q-page class="page q-pa-md">
        <div class="wrap">
          <q-input
            v-model="query"
            rounded
            outlined
            clearable
            :loading="searching"
            placeholder="Busca un libro por título o autor"
            @keyup.enter="results.length ? undefined : addManual()"
          >
            <template #prepend><q-icon name="search" /></template>
          </q-input>

          <!-- Resultados -->
          <div v-if="query && query.trim().length >= 3" class="results q-mt-sm">
            <div v-if="searchError" class="hint q-pa-sm">No se pudo buscar (¿sin internet?). Puedes apuntarlo a mano.</div>
            <q-list v-if="results.length" separator class="results__list">
              <q-item v-for="r in results" :key="r.key">
                <q-item-section avatar>
                  <img v-if="r.cover" :src="r.cover" class="mini-cover" :alt="r.title" loading="lazy" />
                  <div v-else class="mini-cover mini-cover--empty"><q-icon name="auto_stories" /></div>
                </q-item-section>
                <q-item-section>
                  <q-item-label class="text-weight-medium">{{ r.title }}</q-item-label>
                  <q-item-label caption>{{ r.author || 'Autor desconocido' }}<template v-if="r.year"> · {{ r.year }}</template></q-item-label>
                </q-item-section>
                <q-item-section side>
                  <q-btn
                    v-if="!already(r.title)"
                    unelevated
                    round
                    dense
                    color="accent"
                    icon="add"
                    :aria-label="`Apuntar ${r.title}`"
                    @click="add(r)"
                  />
                  <q-icon v-else name="check_circle" color="positive" size="24px" />
                </q-item-section>
              </q-item>
            </q-list>
            <q-btn
              flat
              no-caps
              color="primary"
              icon="edit_note"
              class="q-mt-xs"
              :label="`Apuntar «${query.trim()}» a mano`"
              @click="addManual"
            />
          </div>

          <!-- Ya los tienes -->
          <div v-if="owned.length" class="owned q-mt-lg">
            <div class="text-subtitle2">🎉 ¡Ya tienes {{ owned.length === 1 ? 'uno' : owned.length }} en tu biblioteca!</div>
            <div v-for="w in owned" :key="w.id" class="row items-center q-mt-xs no-wrap">
              <span class="col ellipsis">{{ w.title }}</span>
              <q-btn
                flat
                dense
                no-caps
                color="accent"
                label="Abrir"
                @click="router.push({ name: 'reader', params: { id: ownedBook(w)!.id } })"
              />
              <q-btn flat dense no-caps label="Quitar de la lista" @click="remove(w)" />
            </div>
          </div>

          <!-- Lista -->
          <div v-if="!wishes.length && !query" class="empty">
            <LumiOwl mood="happy" :size="96" />
            <p>Apunta aquí los libros que quieres leer.<br />Búscalos arriba o escribe el título y pulsa Enter.</p>
          </div>
          <div v-else class="wish-grid q-mt-lg">
            <div v-for="w in wishes" :key="w.id" class="wish">
              <div class="wish__cover">
                <img v-if="w.cover" :src="w.cover" :alt="w.title" loading="lazy" />
                <div v-else class="wish__placeholder font-display">{{ w.title }}</div>
                <q-badge v-if="ownedBook(w)" class="wish__owned" color="positive" rounded>¡Lo tienes!</q-badge>
                <q-btn
                  class="wish__remove"
                  round
                  dense
                  size="sm"
                  icon="close"
                  color="dark"
                  :aria-label="`Quitar ${w.title}`"
                  @click="remove(w)"
                />
              </div>
              <div class="wish__title font-display">{{ w.title }}</div>
              <div class="wish__author">{{ w.author }}</div>
            </div>
          </div>
        </div>
      </q-page>
    </q-page-container>
  </q-layout>
</template>

<style scoped>
.app-header {
  background: color-mix(in srgb, var(--paper) 85%, transparent);
  backdrop-filter: blur(12px);
  color: var(--ink);
  border-bottom: 1px solid color-mix(in srgb, var(--ink) 8%, transparent);
}
.page {
  background: var(--paper);
}
.wrap {
  max-width: 900px;
  margin: 0 auto;
}
.results__list {
  background: var(--card);
  border-radius: 16px;
  box-shadow: var(--shadow);
  max-height: 55vh;
  overflow-y: auto;
}
.mini-cover {
  width: 40px;
  aspect-ratio: 2 / 3;
  object-fit: cover;
  border-radius: 2px 4px 4px 2px;
  background: rgba(128, 128, 128, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
}
.hint {
  color: var(--ink-soft);
  font-size: 0.85rem;
}
.owned {
  padding: 12px 14px;
  border-radius: 14px;
  background: color-mix(in srgb, var(--leaf) 14%, transparent);
}
.empty {
  text-align: center;
  color: var(--ink-soft);
  padding: 40px 0;
}
.wish-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 18px 14px;
}
.wish__cover {
  position: relative;
  aspect-ratio: 2 / 3;
  border-radius: 3px 8px 8px 3px;
  overflow: hidden;
  box-shadow: 0 8px 18px -8px rgba(0, 0, 0, 0.5);
  background: linear-gradient(160deg, var(--wood-light), var(--wood-dark));
}
.wish__cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.wish__placeholder {
  color: #fff;
  padding: 12px;
  font-weight: 700;
  font-size: 0.9rem;
}
.wish__owned {
  position: absolute;
  left: 6px;
  bottom: 6px;
}
.wish__remove {
  position: absolute;
  top: 4px;
  right: 4px;
  opacity: 0.75;
}
.wish__title {
  margin-top: 6px;
  font-weight: 700;
  font-size: 0.85rem;
  line-height: 1.2;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.wish__author {
  font-size: 0.75rem;
  color: var(--ink-soft);
}
</style>
