/**
 * Diccionario con Wiktionary (gratis y sin clave; necesita internet).
 * Primero el Wikcionario en español; si la palabra no es española (libros en inglés), el inglés.
 */

export interface DictionaryEntry {
  /** Categoría gramatical ("sustantivo masculino", "verb"…). */
  kind: string
  definitions: string[]
}

export interface DictionaryResult {
  word: string
  /** Palabra base si se buscó una forma ("faros" → "faro"). */
  lemma: string
  language: 'es' | 'en'
  entries: DictionaryEntry[]
  url: string
}

const MAX_DEFINITIONS = 4

/** Quita signos y espacios: «¡Faros!» → faros. */
export function cleanWord(text: string): string {
  return text
    .trim()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    .toLowerCase()
}

/** Wikitexto → texto: enlaces, plantillas sencillas, cursivas y etiquetas. */
function wikiToText(s: string): string {
  return s
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>|<ref[^>]*\/>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\{\{plm\|([^}|]+)[^}]*\}\}/g, (_, w: string) => w.charAt(0).toUpperCase() + w.slice(1))
    .replace(/\{\{l\+?\|[a-z]+\|([^}|]+)[^}]*\}\}/g, '$1')
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/'{2,}/g, '')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

interface SpanishParse {
  entries: DictionaryEntry[]
  /** Si solo hay formas flexivas, la palabra base a la que remiten. */
  lemma: string | null
}

function parseSpanish(wikitext: string): SpanishParse | null {
  const start = wikitext.indexOf('{{lengua|es}}')
  if (start < 0) return null
  const rest = wikitext.slice(start)
  const end = rest.search(/\n==\s*[^=]/)
  const section = end > 0 ? rest.slice(0, end) : rest

  const entries: DictionaryEntry[] = []
  let lemma: string | null = null
  let current: DictionaryEntry | null = null
  for (const line of section.split('\n')) {
    const heading = /^={3,4}\s*(.+?)\s*={3,4}\s*$/.exec(line)
    if (heading) {
      const template = /\{\{([^|}]+)/.exec(heading[1])
      const kind = (template ? template[1] : heading[1]).trim()
      current = /etimolog|información|véase|traduc|referenc|pronunc|locuc|refran|conjug/i.test(kind)
        ? null
        : { kind, definitions: [] }
      if (current) entries.push(current)
      continue
    }
    const def = /^;\d+[^:]*:\s*(.+)$/.exec(line)
    if (!def) continue
    const form = /\{\{(?:forma [^|}]+|f\.[^|}]+)\|([^|}]+)/.exec(def[1])
    if (form) {
      lemma ??= form[1].trim()
      continue
    }
    const text = wikiToText(def[1])
    if (current && text && current.definitions.length < MAX_DEFINITIONS) current.definitions.push(text)
  }
  return { entries: entries.filter((e) => e.definitions.length), lemma }
}

async function lookupSpanish(word: string, depth = 0): Promise<DictionaryResult | null> {
  const url = `https://es.wiktionary.org/w/api.php?action=parse&format=json&origin=*&redirects=1&prop=wikitext&page=${encodeURIComponent(word)}`
  const data = (await getJson(url)) as { parse?: { wikitext?: { '*': string } } }
  const wikitext = data.parse?.wikitext?.['*']
  if (!wikitext) return null
  const parsed = parseSpanish(wikitext)
  if (!parsed) return null
  if (!parsed.entries.length && parsed.lemma && depth === 0 && parsed.lemma !== word) {
    const base = await lookupSpanish(parsed.lemma, 1)
    return base ? { ...base, word } : null
  }
  if (!parsed.entries.length) return null
  return {
    word,
    lemma: word,
    language: 'es',
    entries: parsed.entries,
    url: `https://es.wiktionary.org/wiki/${encodeURIComponent(word)}`,
  }
}

async function lookupEnglish(word: string): Promise<DictionaryResult | null> {
  let data: Record<string, { partOfSpeech: string; definitions: { definition: string }[] }[]>
  try {
    data = (await getJson(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`)) as typeof data
  } catch {
    return null
  }
  const groups = data.en ?? data.es ?? Object.values(data)[0]
  if (!groups?.length) return null
  const strip = (html: string) => html.replace(/<[^>]+>/g, '').replace(/\s{2,}/g, ' ').trim()
  const entries = groups
    .map((g) => ({
      kind: g.partOfSpeech,
      definitions: g.definitions.map((d) => strip(d.definition)).filter(Boolean).slice(0, MAX_DEFINITIONS),
    }))
    .filter((e) => e.definitions.length)
  if (!entries.length) return null
  return {
    word,
    lemma: word,
    language: 'en',
    entries,
    url: `https://en.wiktionary.org/wiki/${encodeURIComponent(word)}`,
  }
}

/** Busca la palabra. Devuelve null si no hay definición; lanza error si no hay conexión. */
export async function define(text: string): Promise<DictionaryResult | null> {
  const word = cleanWord(text)
  if (!word) return null
  return (await lookupSpanish(word)) ?? (await lookupEnglish(word))
}
