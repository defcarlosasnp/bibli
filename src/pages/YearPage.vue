<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useRouter } from 'vue-router'
import { liveQuery } from 'dexie'
import { db, type Book, type Highlight, type ReadingDay, type UnlockedAchievement } from '@/db'
import { bestStreakFrom, formatDuration } from '@/services/stats'
import { finishedDate, finishedInYear } from '@/services/goals'
import LumiOwl from '@/components/LumiOwl.vue'

/** Resumen del año: libros, horas, rachas, autor favorito, libros destacados y frases. */
const props = defineProps<{ year?: string }>()
const router = useRouter()

const days = ref<ReadingDay[]>([])
const books = ref<Book[]>([])
const highlights = ref<Highlight[]>([])
const unlocked = ref<UnlockedAchievement[]>([])
const subs = [
  liveQuery(() => db.days.toArray()).subscribe((v) => (days.value = v)),
  liveQuery(() => db.books.toArray()).subscribe((v) => (books.value = v)),
  liveQuery(() => db.highlights.toArray()).subscribe((v) => (highlights.value = v)),
  liveQuery(() => db.achievements.toArray()).subscribe((v) => (unlocked.value = v)),
]
onBeforeUnmount(() => subs.forEach((s) => s.unsubscribe()))

const year = computed(() => Number(props.year) || new Date().getFullYear())
const inYear = (ms: number | null | undefined) => ms != null && new Date(ms).getFullYear() === year.value

/** Años con algo que contar, para cambiar de uno a otro. */
const years = computed(() => {
  const set = new Set<number>([new Date().getFullYear()])
  for (const d of days.value) if (d.seconds > 0) set.add(Number(d.date.slice(0, 4)))
  for (const b of books.value) {
    const f = finishedDate(b)
    if (f) set.add(new Date(f).getFullYear())
  }
  return [...set].sort((a, b) => b - a)
})

const yearDays = computed(() => days.value.filter((d) => d.date.startsWith(`${year.value}-`)))
const finished = computed(() => finishedInYear(books.value, year.value))
const totals = computed(() => {
  const t = { seconds: 0, listen: 0, pages: 0, active: 0 }
  for (const d of yearDays.value) {
    t.seconds += d.seconds
    t.listen += d.listenSeconds
    t.pages += d.pages
    if (d.seconds >= 60) t.active++
  }
  return t
})
const bestStreak = computed(() => bestStreakFrom(yearDays.value.filter((d) => d.seconds > 0)))
const yearHighlights = computed(() => highlights.value.filter((h) => inYear(h.createdAt)))
const yearAchievements = computed(() => unlocked.value.filter((a) => inYear(a.unlockedAt)).length)

// Libros que tocaste este año (abiertos o terminados)
const touched = computed(() => books.value.filter((b) => inYear(b.lastOpenedAt) || inYear(finishedDate(b))))

const favoriteAuthor = computed(() => {
  const score = new Map<string, { books: number; seconds: number }>()
  for (const b of touched.value) {
    if (!b.author) continue
    const s = score.get(b.author) ?? { books: 0, seconds: 0 }
    if (finished.value.includes(b)) s.books++
    s.seconds += b.readingSeconds ?? 0
    score.set(b.author, s)
  }
  const best = [...score.entries()].sort((a, b) => b[1].books - a[1].books || b[1].seconds - a[1].seconds)[0]
  return best ? { name: best[0], ...best[1] } : null
})
const topRated = computed(
  () => [...finished.value].filter((b) => b.rating).sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))[0] ?? null,
)
const mostTime = computed(
  () =>
    [...touched.value].filter((b) => (b.readingSeconds ?? 0) >= 600).sort((a, b) => (b.readingSeconds ?? 0) - (a.readingSeconds ?? 0))[0] ??
    null,
)

// ---------- Horas por mes ----------
const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const MONTH_NAMES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const monthly = computed(() => {
  const out = Array(12).fill(0) as number[]
  for (const d of yearDays.value) out[Number(d.date.slice(5, 7)) - 1] += d.seconds
  return out
})
const monthMax = computed(() => Math.max(...monthly.value, 1))
const bestMonth = computed(() => {
  const i = monthly.value.indexOf(Math.max(...monthly.value))
  return monthly.value[i] > 0 ? MONTH_NAMES[i] : null
})

/** Tres frases del año: primero las que tienen nota, luego las de longitud media. */
const bestQuotes = computed(() =>
  [...yearHighlights.value]
    .filter((h) => h.text.length >= 25 && h.text.length <= 300)
    .sort((a, b) => Number(!!b.note) - Number(!!a.note) || Math.abs(a.text.length - 120) - Math.abs(b.text.length - 120))
    .slice(0, 3),
)
const titleOf = (id: number) => books.value.find((b) => b.id === id)?.title ?? ''
const hours = (s: number) => Math.round(s / 360) / 10

const nothing = computed(() => !totals.value.seconds && !finished.value.length)
</script>

<template>
  <q-layout view="hHh lpR fFf">
    <q-header class="app-header">
      <q-toolbar>
        <q-btn flat round icon="arrow_back" aria-label="Volver" @click="router.back()" />
        <q-toolbar-title class="font-display text-weight-bold">Tu año en libros</q-toolbar-title>
        <q-btn-dropdown v-if="years.length > 1" flat no-caps :label="String(year)">
          <q-list>
            <q-item v-for="y in years" :key="y" v-close-popup clickable @click="router.replace({ name: 'year', params: { year: y } })">
              <q-item-section>{{ y }}</q-item-section>
            </q-item>
          </q-list>
        </q-btn-dropdown>
      </q-toolbar>
    </q-header>

    <q-page-container>
      <q-page class="page">
        <!-- Portada -->
        <section class="hero">
          <div class="hero__text">
            <div class="hero__year font-display">{{ year }}</div>
            <div class="hero__lead">
              <template v-if="nothing">Aún no hay lecturas este año. ¡Empieza hoy y llénalo de historias!</template>
              <template v-else>
                Leíste <b>{{ formatDuration(totals.seconds) }}</b>
                <template v-if="finished.length"> y terminaste <b>{{ finished.length }} libro{{ finished.length === 1 ? '' : 's' }}</b></template>.
                <template v-if="bestMonth"> Tu mejor mes fue <b>{{ bestMonth }}</b>.</template>
              </template>
            </div>
          </div>
          <LumiOwl mood="excited" :size="96" class="hero__owl" />
        </section>

        <template v-if="!nothing">
          <!-- Cifras -->
          <section class="tiles">
            <div class="tile"><span>📚</span><b class="font-display">{{ finished.length }}</b><small>libros terminados</small></div>
            <div class="tile"><span>⏱️</span><b class="font-display">{{ hours(totals.seconds) }}</b><small>horas leyendo</small></div>
            <div class="tile"><span>📄</span><b class="font-display">{{ totals.pages }}</b><small>páginas pasadas</small></div>
            <div class="tile"><span>📅</span><b class="font-display">{{ totals.active }}</b><small>días con lectura</small></div>
            <div class="tile"><span>🔥</span><b class="font-display">{{ bestStreak }}</b><small>días de racha máxima</small></div>
            <div v-if="totals.listen" class="tile"><span>🎧</span><b class="font-display">{{ hours(totals.listen) }}</b><small>horas escuchando</small></div>
            <div v-if="yearHighlights.length" class="tile"><span>🖍️</span><b class="font-display">{{ yearHighlights.length }}</b><small>frases subrayadas</small></div>
            <div v-if="yearAchievements" class="tile"><span>🏅</span><b class="font-display">{{ yearAchievements }}</b><small>logros</small></div>
          </section>

          <!-- Horas por mes -->
          <section class="card">
            <h2 class="font-display">Horas de lectura por mes</h2>
            <div class="months" role="img" :aria-label="`Horas leídas cada mes de ${year}`">
              <div v-for="(sec, i) in monthly" :key="i" class="month">
                <div class="month__track">
                  <div class="month__bar" :style="{ height: `${(sec / monthMax) * 100}%` }">
                    <q-tooltip>{{ MONTH_NAMES[i] }}: {{ formatDuration(sec) }}</q-tooltip>
                  </div>
                </div>
                <span class="month__label">{{ MONTHS[i] }}</span>
              </div>
            </div>
          </section>

          <!-- Libros terminados -->
          <section v-if="finished.length" class="card">
            <h2 class="font-display">Los que terminaste</h2>
            <div class="covers">
              <button
                v-for="b in finished"
                :key="b.id"
                class="cover"
                :title="b.title"
                @click="router.push({ name: 'reader', params: { id: b.id } })"
              >
                <img v-if="b.cover" :src="b.cover" :alt="b.title" loading="lazy" />
                <span v-else class="cover__ph font-display">{{ b.title }}</span>
                <span v-if="b.rating" class="cover__stars">{{ '★'.repeat(b.rating) }}</span>
              </button>
            </div>
          </section>

          <!-- Destacados -->
          <section class="highlights-grid">
            <div v-if="favoriteAuthor" class="card pick">
              <span class="pick__icon">✍️</span>
              <small>Tu autor del año</small>
              <b class="font-display">{{ favoriteAuthor.name }}</b>
              <span class="muted">
                <template v-if="favoriteAuthor.books">{{ favoriteAuthor.books }} libro{{ favoriteAuthor.books === 1 ? '' : 's' }} · </template>
                {{ formatDuration(favoriteAuthor.seconds) }}
              </span>
            </div>
            <div v-if="topRated" class="card pick">
              <span class="pick__icon">⭐</span>
              <small>Tu favorito</small>
              <b class="font-display">{{ topRated.title }}</b>
              <span class="stars">{{ '★'.repeat(topRated.rating ?? 0) }}</span>
              <span v-if="topRated.review" class="muted pick__review">«{{ topRated.review }}»</span>
            </div>
            <div v-if="mostTime" class="card pick">
              <span class="pick__icon">⌛</span>
              <small>Al que más tiempo dedicaste</small>
              <b class="font-display">{{ mostTime.title }}</b>
              <span class="muted">{{ formatDuration(mostTime.readingSeconds ?? 0) }}</span>
            </div>
          </section>

          <!-- Frases -->
          <section v-if="bestQuotes.length" class="card">
            <h2 class="font-display">Frases que te marcaron</h2>
            <blockquote v-for="h in bestQuotes" :key="h.id" class="quote">
              <p class="font-display">«{{ h.text }}»</p>
              <footer>— {{ titleOf(h.bookId) }}<template v-if="h.note"> · 📝 {{ h.note }}</template></footer>
            </blockquote>
          </section>
        </template>
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
  max-width: 900px;
  margin: 0 auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.card {
  background: var(--card);
  border-radius: 20px;
  box-shadow: var(--shadow);
  padding: 18px;
}
h2 {
  font-size: 1.2rem;
  margin: 0 0 12px;
}
.muted {
  color: var(--ink-soft);
  font-size: 0.85rem;
}
.hero {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  padding: 22px;
  border-radius: 24px;
  color: #fff;
  background:
    radial-gradient(circle at 85% 15%, rgba(255, 209, 102, 0.55), transparent 45%),
    radial-gradient(circle at 0% 100%, rgba(226, 101, 74, 0.45), transparent 50%),
    linear-gradient(135deg, #6e4529, #b85a2a 60%, #e2954a);
  box-shadow: var(--shadow);
}
.hero__text {
  flex: 1;
}
.hero__year {
  font-size: clamp(3rem, 12vw, 5rem);
  font-weight: 800;
  line-height: 1;
}
.hero__lead {
  font-size: 1.05rem;
  margin-top: 6px;
  max-width: 520px;
}
.tiles {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 12px;
}
.tile {
  background: var(--card);
  border-radius: 18px;
  box-shadow: var(--shadow);
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.tile span {
  font-size: 1.3rem;
}
.tile b {
  font-size: 1.8rem;
  line-height: 1.1;
}
.tile small {
  color: var(--ink-soft);
}
.months {
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  gap: 6px;
  height: 160px;
  align-items: end;
}
.month {
  display: flex;
  flex-direction: column;
  align-items: center;
  height: 100%;
  gap: 4px;
}
.month__track {
  flex: 1;
  width: 100%;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  border-bottom: 1px solid color-mix(in srgb, var(--ink) 15%, transparent);
}
.month__bar {
  width: min(22px, 70%);
  min-height: 2px;
  border-radius: 4px 4px 0 0;
  background: var(--accent);
  transition: height 0.5s;
}
.month__label {
  font-size: 0.7rem;
  color: var(--ink-soft);
}
.covers {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
  gap: 12px;
}
.cover {
  position: relative;
  aspect-ratio: 2 / 3;
  border: 0;
  padding: 0;
  border-radius: 3px 7px 7px 3px;
  overflow: hidden;
  cursor: pointer;
  background: linear-gradient(160deg, var(--wood-light), var(--wood-dark));
  box-shadow: 0 8px 16px -8px rgba(0, 0, 0, 0.55);
}
.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cover__ph {
  color: #fff;
  font-size: 0.75rem;
  padding: 8px;
  display: block;
}
.cover__stars {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 2px 0;
  font-size: 0.75rem;
  color: #f2c45a;
  background: rgba(0, 0, 0, 0.55);
}
.highlights-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}
.pick {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.pick__icon {
  font-size: 1.6rem;
}
.pick small {
  color: var(--ink-soft);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-size: 0.7rem;
}
.pick b {
  font-size: 1.15rem;
  line-height: 1.2;
}
.pick__review {
  font-style: italic;
}
.stars {
  color: #f2b13c;
}
.quote {
  margin: 0 0 14px;
  padding: 4px 0 4px 14px;
  border-left: 3px solid var(--accent);
}
.quote p {
  margin: 0;
  font-size: 1.05rem;
  font-style: italic;
  line-height: 1.4;
}
.quote footer {
  margin-top: 4px;
  font-size: 0.8rem;
  color: var(--ink-soft);
}
</style>
