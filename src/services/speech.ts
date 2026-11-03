import { Capacitor, registerPlugin } from '@capacitor/core'
import { TextToSpeech } from '@capacitor-community/text-to-speech'

/**
 * Voz del sistema. En la web usa speechSynthesis; en la app nativa el plugin de Capacitor,
 * porque el WebView de Android no trae síntesis de voz.
 */

/** Calidad estimada por el nombre de la voz: los sistemas no la exponen de otra forma. */
export type VoiceQuality = 'natural' | 'good' | 'standard' | 'robotic'

export interface Voice {
  /** En la web, el voiceURI; en nativo, el índice dentro de la lista del plugin. */
  id: string
  /** Nombre legible ("Elvira", "Mónica"…). */
  label: string
  /** Idioma y región, y si necesita internet. */
  detail: string
  lang: string
  quality: VoiceQuality
  online: boolean
}

export const QUALITY_LABEL: Record<VoiceQuality, string> = {
  natural: 'Natural ✨',
  good: 'Buena',
  standard: 'Estándar',
  robotic: 'Robótica',
}
const QUALITY_RANK: Record<VoiceQuality, number> = { natural: 0, good: 1, standard: 2, robotic: 3 }

const native = Capacitor.isNativePlatform()
const web = typeof window !== 'undefined' && 'speechSynthesis' in window

export const speechSupported = native || web

let webVoices: SpeechSynthesisVoice[] = []

interface RawVoice {
  name: string
  voiceURI: string
  lang: string
  localService: boolean
}

function classify(v: RawVoice): VoiceQuality {
  const id = `${v.name} ${v.voiceURI}`.toLowerCase()
  // Edge: "Microsoft Elvira Online (Natural)"; Apple: com.apple.voice.premium.*; voces neuronales en general
  if (/natural|neural|premium/.test(id)) return 'natural'
  // Apple "mejorada", voces de Google en la nube (Chrome y Android "-network")
  if (/enhanced|mejorad|network/.test(id) || (!v.localService && /google/.test(id))) return 'good'
  // Voces antiguas de Apple (Eloquence: Eddy, Flo, Grandpa…) y "compact"
  if (/eloquence|compact|espeak/.test(id)) return 'robotic'
  return 'standard'
}

const languageNames = new Intl.DisplayNames(['es'], { type: 'language' })

/** Android (Google): voiceURI "es-es-x-eea-network" → "eea". La misma voz existe en local y en red. */
function androidVoiceCode(v: RawVoice): string | null {
  return /^[a-z]{2,3}-[a-z]{2,3}-x-([a-z]+)-(?:local|network)$/i.exec(v.voiceURI)?.[1] ?? null
}

function prettyName(v: RawVoice): string {
  // Edge: "Microsoft Elvira Online (Natural) - Spanish (Spain)" → "Elvira"
  const microsoft = /^Microsoft\s+(\S+)/.exec(v.name)
  if (microsoft) return microsoft[1]
  return v.name.replace(/\s*\(.*?\)\s*/g, ' ').trim() || v.name
}

function toVoice(v: RawVoice, id: string): Voice {
  const lang = v.lang.replace('_', '-')
  const online = !v.localService || /network|online/i.test(`${v.name} ${v.voiceURI}`)
  let langName = lang
  try {
    langName = languageNames.of(lang) ?? lang
  } catch {
    // etiqueta de idioma no válida: se muestra tal cual
  }
  return {
    id,
    label: prettyName(v),
    detail: langName.charAt(0).toUpperCase() + langName.slice(1) + (online ? ' · necesita internet' : ''),
    lang,
    quality: classify(v),
    online,
  }
}

/** Orden: calidad, luego el idioma del dispositivo y el acento más cercano (latino o de España). */
function compareVoices(a: Voice, b: Voice): number {
  const device = navigator.language.toLowerCase()
  const latino = device.startsWith('es-') && device !== 'es-es'
  const preferred = [device, ...(latino ? ['es-mx', 'es-us', 'es-419', 'es-es'] : ['es-es', 'es-mx', 'es-us'])]
  const langRank = (v: Voice) => {
    const i = preferred.indexOf(v.lang.toLowerCase())
    return i < 0 ? preferred.length : i
  }
  return (
    QUALITY_RANK[a.quality] - QUALITY_RANK[b.quality] ||
    langRank(a) - langRank(b) ||
    a.label.localeCompare(b.label, 'es')
  )
}

function loadWebVoices(): Promise<SpeechSynthesisVoice[]> {
  const list = speechSynthesis.getVoices()
  if (list.length) return Promise.resolve(list)
  // Chrome carga las voces de forma asíncrona
  return new Promise((resolve) => {
    const done = () => resolve(speechSynthesis.getVoices())
    speechSynthesis.addEventListener('voiceschanged', done, { once: true })
    setTimeout(done, 1500)
  })
}

/** Voces en español (o todas, si el dispositivo no tiene ninguna en español), las mejores primero. */
export async function listVoices(): Promise<Voice[]> {
  let all: Voice[] = []
  if (native) {
    const { voices } = await TextToSpeech.getSupportedVoices()
    // Android solo da nombres genéricos ("Spanish Spain"): se numeran por país, y la versión
    // local y la de red de una misma voz comparten número. "es-ES-language" repite otra voz.
    const numbers = new Map<string, number>()
    const perLang = new Map<string, number>()
    all = voices.flatMap((v, i) => {
      if (/-language$/.test(v.voiceURI) && voices.some((o) => o.lang === v.lang && androidVoiceCode(o))) return []
      const voice = toVoice(v, String(i))
      const code = androidVoiceCode(v)
      if (code) {
        const key = `${voice.lang}:${code}`
        if (!numbers.has(key)) {
          const n = (perLang.get(voice.lang) ?? 0) + 1
          perLang.set(voice.lang, n)
          numbers.set(key, n)
        }
        voice.label = `Voz ${numbers.get(key)}`
      }
      return [voice]
    })
  } else if (web) {
    webVoices = await loadWebVoices()
    all = webVoices.map((v) => toVoice(v, v.voiceURI))
  }
  const spanish = all.filter((v) => v.lang.toLowerCase().startsWith('es'))
  return (spanish.length ? spanish : all).sort(compareVoices)
}

/** Dónde conseguir voces mejores en este dispositivo. */
export function voiceHelp(): { title: string; steps: string[]; canOpenInstaller: boolean } {
  const ua = navigator.userAgent
  const platform = Capacitor.getPlatform()
  if (platform === 'ios' || /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) {
    return {
      title: 'En iPhone / iPad',
      steps: [
        'Ajustes → Accesibilidad → Contenido leído → Voces',
        'Español → elige una voz (Mónica, Paulina, Jorge…)',
        'Descarga la versión «Mejorada» o «Premium»',
        'Vuelve aquí y elígela en esta lista',
      ],
      canOpenInstaller: false,
    }
  }
  if (platform === 'android' || /Android/.test(ua)) {
    return {
      title: 'En Android',
      steps: [
        'Ajustes → Accesibilidad (o Sistema) → Texto a voz',
        'Motor de Google → ⚙️ → Instalar datos de voz → Español',
        'Descarga las voces que quieras (de alta calidad si aparece)',
        'Vuelve aquí y elígela en esta lista',
      ],
      canOpenInstaller: native,
    }
  }
  if (/Edg\//.test(ua)) {
    return {
      title: 'En Microsoft Edge',
      steps: ['Elige una voz marcada como «Natural ✨» (Elvira, Álvaro, Dalia…). Necesitan internet.'],
      canOpenInstaller: false,
    }
  }
  return {
    title: 'En el ordenador',
    steps: [
      'Microsoft Edge trae voces «Natural» gratuitas que suenan casi humanas: abre Bibli en Edge',
      'En Chrome, elige «Google español» (necesita internet)',
    ],
    canOpenInstaller: false,
  }
}

/** Plugin propio (android/app/.../VoiceSettingsPlugin.java). */
const VoiceSettings = registerPlugin<{ open(): Promise<void> }>('VoiceSettings')

/** Android: abre los ajustes de Texto a voz, donde se descargan voces. */
export function openVoiceInstaller() {
  if (native) VoiceSettings.open().catch(() => undefined)
}

export const VOICE_SAMPLE = 'Hola, soy Lumi. Así sonaría tu libro con esta voz.'

export interface SpeakOptions {
  rate: number
  voiceId: string | null
}

// Safari descarta la locución si nadie guarda una referencia a ella
let utterance: SpeechSynthesisUtterance | null = null

/** Lee el texto y se resuelve al terminar o al interrumpirse con stopSpeaking(). */
export function speak(text: string, { rate, voiceId }: SpeakOptions): Promise<void> {
  if (native) {
    return TextToSpeech.speak({
      text,
      lang: 'es-ES',
      rate,
      voice: voiceId != null ? Number(voiceId) : undefined,
      category: 'playback',
    }).catch(() => undefined)
  }
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text)
    const voice = webVoices.find((v) => v.voiceURI === voiceId)
    u.lang = voice?.lang ?? 'es-ES'
    if (voice) u.voice = voice
    u.rate = rate
    u.onend = u.onerror = () => {
      if (utterance === u) utterance = null
      resolve()
    }
    utterance = u
    speechSynthesis.speak(u)
  })
}

export function stopSpeaking() {
  if (native) TextToSpeech.stop().catch(() => undefined)
  else if (web) speechSynthesis.cancel()
}

// ---------- Texto → frases ----------

export interface TextSpan {
  start: number
  end: number
}

const MAX_SENTENCE = 280
const segmenter = 'Segmenter' in Intl ? new Intl.Segmenter('es', { granularity: 'sentence' }) : null

/**
 * Divide el texto en frases (posiciones dentro de `text`). Las frases muy largas se cortan
 * por comas o puntos y coma para que la voz no se trabe y el resaltado avance.
 */
export function splitSentences(text: string): TextSpan[] {
  const raw: TextSpan[] = []
  if (segmenter) {
    for (const s of segmenter.segment(text)) raw.push({ start: s.index, end: s.index + s.segment.length })
  } else {
    for (const m of text.matchAll(/[^.!?…\n]+(?:[.!?…]+["»”')\]]*|\n|$)/g)) raw.push({ start: m.index!, end: m.index! + m[0].length })
  }

  const out: TextSpan[] = []
  for (let { start, end } of raw) {
    // sin espacios en los bordes
    while (start < end && /\s/.test(text[start])) start++
    while (end > start && /\s/.test(text[end - 1])) end--
    while (end - start > MAX_SENTENCE) {
      const slice = text.slice(start, start + MAX_SENTENCE)
      const cut = Math.max(slice.lastIndexOf(', '), slice.lastIndexOf('; '), slice.lastIndexOf(': '))
      const at = cut > MAX_SENTENCE / 3 ? start + cut + 1 : start + (slice.lastIndexOf(' ') > 0 ? slice.lastIndexOf(' ') : MAX_SENTENCE)
      out.push({ start, end: at })
      start = at
      while (start < end && /\s/.test(text[start])) start++
    }
    // descarta trozos sin letras ni números (guiones, viñetas…)
    if (/[\p{L}\p{N}]/u.test(text.slice(start, end))) out.push({ start, end })
  }
  return out
}

/** Texto tal como se envía a la voz. */
export function cleanForSpeech(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}
