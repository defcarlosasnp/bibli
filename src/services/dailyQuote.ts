/** Frase del día: una de tus frases subrayadas, la misma durante todo el día. */
import type { Book, Highlight } from '@/db'
import { dayKey } from './stats'

export interface DailyQuote {
  text: string
  book: Book
  position: string
}

export function pickDailyQuote(highlights: Highlight[], books: Book[]): DailyQuote | null {
  const byId = new Map(books.map((b) => [b.id, b]))
  // Solo frases con sentido (ni una palabra suelta ni un párrafo entero) de libros que siguen ahí
  const pool = highlights.filter((h) => byId.has(h.bookId) && h.text.length >= 25 && h.text.length <= 400)
  if (!pool.length) return null
  let seed = 0
  for (const ch of dayKey()) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0
  const h = pool[seed % pool.length]
  return { text: h.text.replace(/\s+/g, ' ').trim(), book: byId.get(h.bookId)!, position: h.position }
}
