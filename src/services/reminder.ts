/**
 * Recordatorio diario suave para mantener la racha. Desactivado por defecto y solo en la app de
 * Android (la web no puede programar avisos sin un servidor).
 *
 * Se programan los próximos 7 días, uno a uno, y se rehace al abrir la app y al salir de un libro:
 * así, si hoy ya leíste, hoy no avisa, y el mensaje habla del libro que estás leyendo.
 */
import { Capacitor } from '@capacitor/core'
import { db } from '@/db'
import { FINISHED_THRESHOLD, dayKey } from './stats'

export const remindersSupported = Capacitor.isNativePlatform()

const KEY = 'bibli.reminder'
const FIRST_ID = 7001
const DAYS_AHEAD = 7

export interface ReminderSettings {
  on: boolean
  /** "HH:MM" */
  time: string
}

export function reminderSettings(): ReminderSettings {
  try {
    return { on: false, time: '21:30', ...JSON.parse(localStorage.getItem(KEY) || '{}') }
  } catch {
    return { on: false, time: '21:30' }
  }
}

async function plugin() {
  return (await import('@capacitor/local-notifications')).LocalNotifications
}

/** Activa, cambia la hora o desactiva. Devuelve false si el usuario no dio permiso. */
export async function setReminder(settings: ReminderSettings): Promise<boolean> {
  if (!remindersSupported) return false
  if (settings.on) {
    const ln = await plugin()
    let perm = await ln.checkPermissions()
    if (perm.display !== 'granted') perm = await ln.requestPermissions()
    if (perm.display !== 'granted') return false
  }
  localStorage.setItem(KEY, JSON.stringify(settings))
  await refreshReminder()
  return true
}

/** Vuelve a programar los avisos de los próximos días con lo último que se sabe. */
export async function refreshReminder() {
  if (!remindersSupported) return
  try {
    const ln = await plugin()
    await ln.cancel({ notifications: Array.from({ length: DAYS_AHEAD + 1 }, (_, i) => ({ id: FIRST_ID + i })) })
    const s = reminderSettings()
    if (!s.on) return
    const [h, m] = s.time.split(':').map(Number)
    const readToday = ((await db.days.get(dayKey()))?.seconds ?? 0) >= 60
    const current = (await db.books.toArray())
      .filter((b) => b.progress > 0 && b.progress < FINISHED_THRESHOLD)
      .sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))[0]
    const body = current
      ? `¿Seguimos con «${current.title}»? Vas por el ${Math.round(current.progress * 100)}% 📖`
      : 'Un ratito de lectura antes de dormir sienta genial 📖'
    const now = new Date()
    const notifications = []
    for (let d = 0; d <= DAYS_AHEAD; d++) {
      const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d, h, m)
      if (at <= now || (d === 0 && readToday)) continue
      notifications.push({
        id: FIRST_ID + d,
        title: 'Lumi te espera 🦉',
        body,
        schedule: { at, allowWhileIdle: true },
      })
    }
    if (notifications.length) await ln.schedule({ notifications })
  } catch (err) {
    console.warn('Recordatorio:', err)
  }
}
