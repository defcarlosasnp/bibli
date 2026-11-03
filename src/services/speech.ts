import { Capacitor } from '@capacitor/core'
import { TextToSpeech } from '@capacitor-community/text-to-speech'

/**
 * Voz del sistema. En la web usa speechSynthesis; en la app nativa el plugin de Capacitor,
 * porque el WebView de Android no trae síntesis de voz.
 */

export interface Voice {
  /** En la web, el voiceURI; en nativo, el índice dentro de la lista del plugin. */
  id: string
  name: string
  lang: string
}

const native = Capacitor.isNativePlatform()
const web = typeof window !== 'undefined' && 'speechSynthesis' in window

export const speechSupported = native || web

let webVoices: SpeechSynthesisVoice[] = []

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

/** Voces en español (o todas, si el dispositivo no tiene ninguna en español). */
export async function listVoices(): Promise<Voice[]> {
  let all: Voice[] = []
  if (native) {
    const { voices } = await TextToSpeech.getSupportedVoices()
    all = voices.map((v, i) => ({ id: String(i), name: v.name, lang: v.lang.replace('_', '-') }))
  } else if (web) {
    webVoices = await loadWebVoices()
    all = webVoices.map((v) => ({ id: v.voiceURI, name: v.name, lang: v.lang }))
  }
  const spanish = all.filter((v) => v.lang.toLowerCase().startsWith('es'))
  return (spanish.length ? spanish : all).sort((a, b) => a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name))
}

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
