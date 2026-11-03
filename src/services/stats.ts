import confetti from 'canvas-confetti'

const DAYS_KEY = 'bibli.readingDays'

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function readDays(): string[] {
  try {
    return JSON.parse(localStorage.getItem(DAYS_KEY) || '[]')
  } catch {
    return []
  }
}

/** Marca hoy como día de lectura (se guardan los últimos 120 días). */
export function recordReadingDay() {
  const days = new Set(readDays())
  days.add(dayKey(new Date()))
  localStorage.setItem(DAYS_KEY, JSON.stringify([...days].sort().slice(-120)))
}

/** Días consecutivos leyendo, contando hasta hoy (o hasta ayer si hoy aún no se ha leído). */
export function readingStreak(): number {
  const days = new Set(readDays())
  const cursor = new Date()
  if (!days.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1)
  let streak = 0
  while (days.has(dayKey(cursor))) {
    streak++
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
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
