import { Notify } from 'quasar'
import { db, type Book, type ReadingDay } from '@/db'
import { FINISHED_THRESHOLD, celebrate, dailyGoalMinutes, dayKey, streakFrom } from './stats'

export interface AchievementDef {
  id: string
  icon: string
  title: string
  description: string
  /** Lo que dice Lumi al desbloquearlo. */
  lumi: string
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'primer-libro', icon: '📚', title: 'Primera estantería', description: 'Añade tu primer libro', lumi: '¡Tu biblioteca ya tiene su primer libro!' },
  { id: 'coleccionista', icon: '🗂️', title: 'Coleccionista', description: 'Ten 10 libros en la biblioteca', lumi: '¡10 libros! Esto ya es una biblioteca de verdad' },
  { id: 'primer-terminado', icon: '🏆', title: '¡Fin!', description: 'Termina un libro', lumi: '¡Tu primer libro terminado! Qué orgullo 🥹' },
  { id: 'devoralibros', icon: '🎓', title: 'Devoralibros', description: 'Termina 5 libros', lumi: '¡5 libros! Eres imparable' },
  { id: 'racha-3', icon: '🔥', title: 'En racha', description: 'Lee 3 días seguidos', lumi: '¡3 días seguidos! Que no se apague el fuego' },
  { id: 'racha-7', icon: '📅', title: 'Una semana leyendo', description: 'Lee 7 días seguidos', lumi: '¡Una semana entera leyendo!' },
  { id: 'racha-30', icon: '🌟', title: 'Lector de hierro', description: 'Lee 30 días seguidos', lumi: '¡30 días! Eres leyenda' },
  { id: 'maraton', icon: '⏱️', title: 'Maratón', description: 'Lee 1 hora en un día', lumi: '¡Una hora leyendo hoy! ¿Te traigo un té? 🍵' },
  { id: 'constancia', icon: '🎯', title: 'Constancia', description: 'Cumple tu meta diaria 7 días', lumi: '¡Siete metas cumplidas!' },
  { id: 'nocturno', icon: '🦉', title: 'Lector nocturno', description: 'Lee entre la medianoche y las 5', lumi: 'Otro búho nocturno, como yo 🦉🌙' },
  { id: 'madrugador', icon: '🌅', title: 'Madrugador', description: 'Lee entre las 5 y las 7 de la mañana', lumi: '¡Leyendo antes del desayuno!' },
  { id: 'oyente', icon: '🎧', title: 'Buen oyente', description: 'Escucha 30 minutos de lectura en voz alta', lumi: '¡Media hora escuchándome! Gracias 🥰' },
  { id: 'subrayador', icon: '🖍️', title: 'Subrayador', description: 'Subraya 10 frases', lumi: '¡10 frases subrayadas! Tienes buen ojo' },
  { id: 'pensador', icon: '📝', title: 'Pensador', description: 'Escribe tu primera nota', lumi: 'Tu primera nota. Me encanta que pienses mientras lees' },
  { id: 'curioso', icon: '🔎', title: 'Curioso', description: 'Busca 5 palabras en el diccionario', lumi: '¡Cada palabra nueva cuenta!' },
]

const DICT_KEY = 'bibli.dictLookups'

export function countDictionaryLookup() {
  localStorage.setItem(DICT_KEY, String(Number(localStorage.getItem(DICT_KEY) || 0) + 1))
}

interface Context {
  books: Book[]
  days: ReadingDay[]
  highlights: number
  notes: number
  hour: number
}

/** Logros que se ganan por el estado acumulado (los de hora del día se comprueban al leer). */
function earned(ctx: Context): string[] {
  const finished = ctx.books.filter((b) => b.progress >= FINISHED_THRESHOLD).length
  const streak = streakFrom(ctx.days)
  const goal = dailyGoalMinutes() * 60
  const today = ctx.days.find((d) => d.date === dayKey())
  const listened = ctx.days.reduce((s, d) => s + d.listenSeconds, 0)
  const ids: string[] = []
  if (ctx.books.length >= 1) ids.push('primer-libro')
  if (ctx.books.length >= 10) ids.push('coleccionista')
  if (finished >= 1) ids.push('primer-terminado')
  if (finished >= 5) ids.push('devoralibros')
  if (streak >= 3) ids.push('racha-3')
  if (streak >= 7) ids.push('racha-7')
  if (streak >= 30) ids.push('racha-30')
  if (ctx.days.some((d) => d.seconds >= 3600)) ids.push('maraton')
  if (ctx.days.filter((d) => d.seconds >= goal).length >= 7) ids.push('constancia')
  if (listened >= 1800) ids.push('oyente')
  if (ctx.highlights >= 10) ids.push('subrayador')
  if (ctx.notes >= 1) ids.push('pensador')
  if (Number(localStorage.getItem(DICT_KEY) || 0) >= 5) ids.push('curioso')
  // Solo cuenta si hoy ya se ha leído algo a esa hora
  if (today && today.seconds > 0 && ctx.hour < 5) ids.push('nocturno')
  if (today && today.seconds > 0 && ctx.hour >= 5 && ctx.hour < 7) ids.push('madrugador')
  return ids
}

type Announcer = (def: AchievementDef) => void
let lumiAnnouncer: Announcer | null = null

/** La pantalla visible registra cómo quiere que Lumi anuncie los logros. */
export function setAchievementAnnouncer(fn: Announcer | null) {
  lumiAnnouncer = fn
}

let checking = false

/** Comprueba logros nuevos, los guarda y los celebra. Se puede llamar a menudo. */
export async function checkAchievements(): Promise<AchievementDef[]> {
  if (checking) return []
  checking = true
  try {
    const [books, days, highlights, unlocked] = await Promise.all([
      db.books.toArray(),
      db.days.toArray(),
      db.highlights.toArray(),
      db.achievements.toArray(),
    ])
    const have = new Set(unlocked.map((a) => a.id))
    const ctx: Context = {
      books,
      days,
      highlights: highlights.length,
      notes: highlights.filter((h) => h.note.trim()).length,
      hour: new Date().getHours(),
    }
    const fresh = ACHIEVEMENTS.filter((a) => !have.has(a.id) && earned(ctx).includes(a.id))
    if (!fresh.length) return []
    await db.achievements.bulkPut(fresh.map((a) => ({ id: a.id, unlockedAt: Date.now() })))
    announce(fresh)
    return fresh
  } finally {
    checking = false
  }
}

function announce(list: AchievementDef[]) {
  celebrate()
  list.forEach((a, i) =>
    setTimeout(() => {
      Notify.create({
        message: `Logro desbloqueado: ${a.title}`,
        caption: a.description,
        icon: 'emoji_events',
        color: 'accent',
        timeout: 4500,
        position: 'top',
      })
      lumiAnnouncer?.(a)
    }, i * 1600),
  )
}
