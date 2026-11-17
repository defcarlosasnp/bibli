import confetti from 'canvas-confetti'
import { db, type ReadingDay } from '@/db'

export function dayKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Suma actividad al día de hoy (crea el registro si no existe). */
export async function addReading(delta: Partial<Omit<ReadingDay, 'date'>> = {}) {
  const date = dayKey()
  await db.transaction('rw', db.days, async () => {
    const day = (await db.days.get(date)) ?? { date, seconds: 0, pages: 0, listenSeconds: 0 }
    day.seconds += delta.seconds ?? 0
    day.pages += delta.pages ?? 0
    day.listenSeconds += delta.listenSeconds ?? 0
    await db.days.put(day)
  })
}

/** Marca hoy como día de lectura (cuenta para la racha). */
export function recordReadingDay() {
  return addReading()
}

/** Días consecutivos leyendo, contando hasta hoy (o hasta ayer si hoy aún no se ha leído). */
export function streakFrom(days: Pick<ReadingDay, 'date'>[]): number {
  const set = new Set(days.map((d) => d.date))
  const cursor = new Date()
  if (!set.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1)
  let streak = 0
  while (set.has(dayKey(cursor))) {
    streak++
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}

/** Racha más larga de la historia. */
export function bestStreakFrom(days: Pick<ReadingDay, 'date'>[]): number {
  const sorted = [...new Set(days.map((d) => d.date))].sort()
  let best = 0
  let run = 0
  let prev: Date | null = null
  for (const date of sorted) {
    const d = new Date(`${date}T12:00:00`)
    run = prev && Math.round((d.getTime() - prev.getTime()) / 86_400_000) === 1 ? run + 1 : 1
    best = Math.max(best, run)
    prev = d
  }
  return best
}

// ---------- Meta diaria ----------

const GOAL_KEY = 'bibli.goalMinutes'
export const GOAL_OPTIONS = [5, 10, 15, 20, 30, 45, 60]

export function dailyGoalMinutes(): number {
  return Number(localStorage.getItem(GOAL_KEY)) || 15
}

export function setDailyGoalMinutes(minutes: number) {
  localStorage.setItem(GOAL_KEY, String(minutes))
}

/** Tiempo legible: "45 s", "12 min", "2 h 5 min". */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `${h} h ${m} min` : `${h} h`
}

export function greeting(date = new Date()): { text: string; icon: string } {
  const h = date.getHours()
  if (h < 6) return { text: 'Lectura de madrugada', icon: '🌙' }
  if (h < 12) return { text: 'Buenos días', icon: '☀️' }
  if (h < 20) return { text: 'Buenas tardes', icon: '🌤️' }
  return { text: 'Buenas noches', icon: '🌙' }
}

export const FINISHED_THRESHOLD = 0.98

export function celebrate() {
  const colors = ['#f29e38', '#e2654a', '#4f9d7e', '#8a5534', '#ffd166']
  confetti({ particleCount: 90, spread: 75, origin: { y: 0.35 }, colors, disableForReducedMotion: true })
  setTimeout(
    () => confetti({ particleCount: 50, spread: 110, origin: { y: 0.3 }, colors, disableForReducedMotion: true }),
    220,
  )
}
