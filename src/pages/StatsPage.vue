<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useRouter } from 'vue-router'
import { liveQuery } from 'dexie'
import { db, type Book, type ReadingDay, type UnlockedAchievement } from '@/db'
import {
  FINISHED_THRESHOLD,
  GOAL_OPTIONS,
  bestStreakFrom,
  dailyGoalMinutes,
  dayKey,
  formatDuration,
  setDailyGoalMinutes,
  streakFrom,
} from '@/services/stats'
import { ACHIEVEMENTS } from '@/services/achievements'
import LumiOwl from '@/components/LumiOwl.vue'

const router = useRouter()

const days = ref<ReadingDay[]>([])
const books = ref<Book[]>([])
const unlocked = ref<UnlockedAchievement[]>([])
const subs = [
  liveQuery(() => db.days.toArray()).subscribe((v) => (days.value = v)),
  liveQuery(() => db.books.toArray()).subscribe((v) => (books.value = v)),
  liveQuery(() => db.achievements.toArray()).subscribe((v) => (unlocked.value = v)),
]
onBeforeUnmount(() => subs.forEach((s) => s.unsubscribe()))

const goal = ref(dailyGoalMinutes())
function changeGoal(minutes: number) {
  goal.value = minutes
  setDailyGoalMinutes(minutes)
}

const today = computed(() => days.value.find((d) => d.date === dayKey()))
const todayPercent = computed(() => Math.min(100, Math.round(((today.value?.seconds ?? 0) / (goal.value * 60)) * 100)))

/** Últimos 7 días, de más antiguo a hoy (incluye los días sin lectura). */
const week = computed(() => {
  const byDate = new Map(days.value.map((d) => [d.date, d]))
  const fmt = new Intl.DateTimeFormat('es', { weekday: 'short' })
  const out: { date: string; label: string; minutes: number; pages: number; isToday: boolean }[] = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const key = dayKey(d)
    const rec = byDate.get(key)
    out.push({
      date: key,
      label: i === 0 ? 'hoy' : fmt.format(d).replace('.', ''),
      minutes: Math.round((rec?.seconds ?? 0) / 60),
      pages: rec?.pages ?? 0,
      isToday: i === 0,
    })
  }
  return out
})
const weekMax = computed(() => Math.max(goal.value, ...week.value.map((d) => d.minutes), 1))
const weekMinutes = computed(() => week.value.reduce((s, d) => s + d.minutes, 0))
const weekPages = computed(() => week.value.reduce((s, d) => s + d.pages, 0))

const cards = computed(() => {
  const total = days.value.reduce((s, d) => s + d.seconds, 0)
  const listened = days.value.reduce((s, d) => s + d.listenSeconds, 0)
  const finished = books.value.filter((b) => b.progress >= FINISHED_THRESHOLD).length
  const streak = streakFrom(days.value)
  const best = bestStreakFrom(days.value)
  return [
    { icon: '🔥', value: String(streak), label: streak === 1 ? 'día seguido' : 'días seguidos' },
    { icon: '🏅', value: String(best), label: 'mejor racha' },
    { icon: '⏱️', value: formatDuration(total), label: 'leyendo en total' },
    { icon: '🎧', value: formatDuration(listened), label: 'escuchando a Lumi' },
    { icon: '📄', value: String(weekPages.value), label: 'páginas esta semana' },
    { icon: '🏆', value: String(finished), label: finished === 1 ? 'libro terminado' : 'libros terminados' },
  ]
})

const achievements = computed(() => {
  const when = new Map(unlocked.value.map((a) => [a.id, a.unlockedAt]))
  const fmt = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' })
  return ACHIEVEMENTS.map((a) => ({ ...a, unlockedAt: when.has(a.id) ? fmt.format(when.get(a.id)!) : null }))
})
const unlockedCount = computed(() => achievements.value.filter((a) => a.unlockedAt).length)
</script>

<template>
  <q-layout view="hHh lpR fFf">
    <q-header class="app-header">
      <q-toolbar>
        <q-btn flat round icon="arrow_back" aria-label="Volver" @click="router.push({ name: 'library' })" />
        <q-toolbar-title class="font-display text-weight-bold">Estadísticas y logros</q-toolbar-title>
      </q-toolbar>
    </q-header>

    <q-page-container>
      <q-page class="page">
        <!-- Meta de hoy -->
        <section class="card today">
          <q-circular-progress
            :value="todayPercent"
            size="110px"
            :thickness="0.16"
            color="accent"
            track-color="grey-3"
            show-value
            class="ring"
          >
            <div class="ring__inner">
              <b class="font-display">{{ Math.round((today?.seconds ?? 0) / 60) }}</b>
              <span>de {{ goal }} min</span>
            </div>
          </q-circular-progress>
          <div class="today__body">
            <h2 class="font-display">
              {{ todayPercent >= 100 ? '¡Meta de hoy cumplida! 🎉' : 'Tu meta de hoy' }}
            </h2>
            <p>
              {{
                todayPercent >= 100
                  ? 'Lumi está encantado. Todo lo que leas ahora es extra.'
                  : `Te faltan ${goal - Math.floor((today?.seconds ?? 0) / 60)} min. ¡Tú puedes!`
              }}
            </p>
            <q-btn-dropdown flat dense no-caps color="primary" icon="flag" :label="`Meta diaria: ${goal} min`">
              <q-list>
                <q-item v-for="m in GOAL_OPTIONS" :key="m" v-close-popup clickable :active="m === goal" @click="changeGoal(m)">
                  <q-item-section>{{ m }} minutos al día</q-item-section>
                </q-item>
              </q-list>
            </q-btn-dropdown>
          </div>
          <LumiOwl :mood="todayPercent >= 100 ? 'excited' : 'happy'" :size="70" class="today__owl gt-xs" />
        </section>

        <!-- Resumen -->
        <section class="grid">
          <div v-for="c in cards" :key="c.label" class="card stat">
            <span class="stat__icon">{{ c.icon }}</span>
            <b class="stat__value font-display">{{ c.value }}</b>
            <span class="stat__label">{{ c.label }}</span>
          </div>
        </section>

        <!-- Últimos 7 días -->
        <section class="card">
          <div class="row items-baseline">
            <h2 class="font-display q-my-none">Últimos 7 días</h2>
            <q-space />
            <span class="muted">{{ weekMinutes }} min · {{ weekPages }} páginas</span>
          </div>
          <div class="chart" role="img" :aria-label="`Minutos leídos cada día de la última semana. Meta: ${goal} minutos.`">
            <div class="chart__goal" :style="{ bottom: `${(goal / weekMax) * 100}%` }">
              <span>meta {{ goal }} min</span>
            </div>
            <div v-for="d in week" :key="d.date" class="chart__col">
              <span class="chart__value" :class="{ 'chart__value--strong': d.isToday }">{{ d.minutes || '' }}</span>
              <div
                class="chart__bar"
                :class="{ 'chart__bar--empty': !d.minutes }"
                :style="{ height: `${(d.minutes / weekMax) * 100}%` }"
              >
                <q-tooltip>{{ d.label }}: {{ d.minutes }} min · {{ d.pages }} páginas</q-tooltip>
              </div>
            </div>
          </div>
          <div class="chart__labels">
            <span v-for="d in week" :key="d.date" :class="{ strong: d.isToday }">{{ d.label }}</span>
          </div>
        </section>

        <!-- Logros -->
        <section class="card">
          <div class="row items-baseline q-mb-md">
            <h2 class="font-display q-my-none">Logros</h2>
            <q-space />
            <span class="muted">{{ unlockedCount }} de {{ achievements.length }}</span>
          </div>
          <div class="badges">
            <div
              v-for="a in achievements"
              :key="a.id"
              class="badge"
              :class="{ 'badge--locked': !a.unlockedAt }"
            >
              <span class="badge__icon">{{ a.unlockedAt ? a.icon : '🔒' }}</span>
              <b class="badge__title">{{ a.title }}</b>
              <span class="badge__desc">{{ a.unlockedAt ? `Conseguido el ${a.unlockedAt}` : a.description }}</span>
            </div>
          </div>
        </section>
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
  --bar: #c06a1c;
  max-width: 900px;
  margin: 0 auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.body--dark .page {
  --bar: #d27d2a;
}
.card {
  background: var(--card);
  border-radius: 20px;
  box-shadow: var(--shadow);
  padding: 18px;
}
h2 {
  font-size: 1.25rem;
  margin: 0 0 6px;
}
.muted {
  color: var(--ink-soft);
  font-size: 0.85rem;
}
.today {
  display: flex;
  align-items: center;
  gap: 18px;
  background: linear-gradient(135deg, #ffe2b8, #ffc7a8);
  color: #3b2a20;
}
.body--dark .today {
  background: linear-gradient(135deg, #4a3322, #5a3428);
  color: var(--ink);
}
.today__body {
  flex: 1;
}
.today__body p {
  margin: 0 0 4px;
  opacity: 0.85;
}
.today__owl {
  align-self: flex-end;
}
.ring__inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  line-height: 1.05;
}
.ring__inner b {
  font-size: 1.9rem;
}
.ring__inner span {
  font-size: 0.7rem;
  opacity: 0.8;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 12px;
}
.stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 14px;
}
.stat__icon {
  font-size: 1.4rem;
}
.stat__value {
  font-size: 1.5rem;
}
.stat__label {
  font-size: 0.8rem;
  color: var(--ink-soft);
}
/* Gráfico: una sola serie (minutos por día), sin leyenda: el título la nombra */
.chart {
  position: relative;
  height: 160px;
  margin-top: 22px;
  display: flex;
  align-items: flex-end;
  gap: 2px;
  border-bottom: 1px solid color-mix(in srgb, var(--ink) 18%, transparent);
}
.chart__col {
  flex: 1;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: center;
}
.chart__bar {
  width: min(34px, 70%);
  min-height: 0;
  background: var(--bar);
  border-radius: 4px 4px 0 0;
  transition: height 0.5s cubic-bezier(0.3, 1.2, 0.5, 1);
}
.chart__bar--empty {
  height: 3px !important;
  background: color-mix(in srgb, var(--ink) 12%, transparent);
}
.chart__value {
  font-size: 0.75rem;
  color: var(--ink-soft);
  margin-bottom: 2px;
  min-height: 1em;
}
.chart__value--strong {
  color: var(--ink);
  font-weight: 700;
}
.chart__goal {
  position: absolute;
  left: 0;
  right: 0;
  border-top: 1px dashed color-mix(in srgb, var(--ink) 35%, transparent);
  pointer-events: none;
}
.chart__goal span {
  position: absolute;
  right: 0;
  top: -16px;
  font-size: 0.7rem;
  color: var(--ink-soft);
}
.chart__labels {
  display: flex;
  margin-top: 6px;
}
.chart__labels span {
  flex: 1;
  text-align: center;
  font-size: 0.75rem;
  color: var(--ink-soft);
  text-transform: capitalize;
}
.chart__labels .strong {
  color: var(--ink);
  font-weight: 700;
}
.badges {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 10px;
}
.badge {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 2px;
  padding: 12px 8px;
  border-radius: 16px;
  background: color-mix(in srgb, var(--accent) 12%, var(--card));
}
.badge__icon {
  font-size: 2rem;
}
.badge__title {
  font-size: 0.9rem;
}
.badge__desc {
  font-size: 0.75rem;
  color: var(--ink-soft);
}
.badge--locked {
  background: color-mix(in srgb, var(--ink) 5%, var(--card));
}
.badge--locked .badge__icon {
  filter: grayscale(1);
  opacity: 0.6;
}
@media (max-width: 599px) {
  .today {
    flex-direction: column;
    text-align: center;
  }
}
</style>
