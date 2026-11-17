/** Búsqueda de palabras o frases dentro de un libro, sin distinguir mayúsculas ni tildes. */

export interface SearchMatch {
  /** Posición dentro del texto original. */
  start: number
  end: number
  before: string
  match: string
  after: string
}

const SNIPPET = 50

/** Un carácter "plegado": sin tilde, en minúsculas y con cualquier espacio como ' '. Conserva la longitud. */
function foldChar(c: string): string {
  if (/\s/.test(c)) return ' '
  const f = c.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  return f.length === 1 ? f : c.toLowerCase().length === 1 ? c.toLowerCase() : c
}

/** Pliega el texto carácter a carácter para que las posiciones coincidan con el original. */
export function foldText(text: string): string {
  let out = ''
  for (let i = 0; i < text.length; i++) out += foldChar(text[i])
  return out
}

export function foldQuery(query: string): string {
  return foldText(query.trim().replace(/\s+/g, ' '))
}

/**
 * Busca `query` (ya plegada) en `text`. Los espacios de la búsqueda aceptan varios espacios o saltos de
 * línea seguidos en el texto.
 */
export function findMatches(text: string, query: string, max = Infinity): SearchMatch[] {
  if (!query) return []
  const folded = foldText(text)
  const escaped = query
    .split(' ')
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join(' +')
  const re = new RegExp(escaped, 'g')
  const out: SearchMatch[] = []
  for (let m = re.exec(folded); m && out.length < max; m = re.exec(folded)) {
    const start = m.index
    const end = start + m[0].length
    const clean = (s: string) => s.replace(/\s+/g, ' ')
    let before = clean(text.slice(Math.max(0, start - SNIPPET), start))
    let after = clean(text.slice(end, end + SNIPPET))
    if (start > SNIPPET) before = '…' + before.replace(/^\S*\s/, '')
    if (end + SNIPPET < text.length) after = after.replace(/\s\S*$/, '') + '…'
    out.push({ start, end, before, match: clean(text.slice(start, end)), after })
  }
  return out
}
