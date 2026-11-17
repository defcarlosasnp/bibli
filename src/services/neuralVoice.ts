/**
 * Voces neuronales de Bibli (Piper): suenan mucho más humanas que las del sistema y, una vez
 * descargadas, funcionan sin internet. El audio se genera en un Worker (src/workers/piper.worker.ts).
 */

export const NEURAL_PREFIX = 'piper:'

export interface NeuralVoiceInfo {
  /** Id de Piper, p. ej. "es_MX-claude-high". */
  key: string
  label: string
  detail: string
  lang: string
  sizeMB: number
}

export const NEURAL_VOICES: NeuralVoiceInfo[] = [
  { key: 'es_MX-claude-high', label: 'Mateo', detail: 'Español de México · voz masculina', lang: 'es-MX', sizeMB: 63 },
  { key: 'es_ES-davefx-medium', label: 'David', detail: 'Español de España · voz masculina', lang: 'es-ES', sizeMB: 63 },
  { key: 'es_MX-ald-medium', label: 'Álex', detail: 'Español de México · voz masculina', lang: 'es-MX', sizeMB: 63 },
  { key: 'en_US-hfc_female-medium', label: 'Hannah', detail: 'Inglés (EE. UU.) · voz femenina, para libros en inglés', lang: 'en-US', sizeMB: 63 },
]

export const neuralSupported =
  typeof Worker !== 'undefined' &&
  typeof WebAssembly === 'object' &&
  typeof navigator !== 'undefined' &&
  !!navigator.storage &&
  'getDirectory' in navigator.storage

export const isNeuralVoice = (id: string | null | undefined): id is string => !!id?.startsWith(NEURAL_PREFIX)
export const neuralKey = (id: string) => id.slice(NEURAL_PREFIX.length)

// ---------- Worker ----------

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void; progress?(f: number): void }>()

function call<T>(msg: Record<string, unknown>, progress?: (f: number) => void): Promise<T> {
  if (!worker) {
    worker = new Worker(new URL('../workers/piper.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent) => {
      const { id, result, error, progress: p } = e.data
      const req = pending.get(id)
      if (!req) return
      if (p != null) return req.progress?.(p)
      pending.delete(id)
      if (error) req.reject(new Error(error))
      else req.resolve(result)
    }
  }
  const id = nextId++
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, progress })
    worker!.postMessage({ id, ...msg })
  })
}

export async function storedNeuralVoices(): Promise<string[]> {
  if (!neuralSupported) return []
  return call<string[]>({ type: 'stored' }).catch(() => [])
}

export async function downloadNeuralVoice(key: string, onProgress: (fraction: number) => void) {
  // Que el navegador no borre la voz cuando necesite espacio
  navigator.storage.persist?.().catch(() => undefined)
  await call({ type: 'download', voice: key }, onProgress)
}

export async function removeNeuralVoice(key: string) {
  cache.clear()
  await call({ type: 'remove', voice: key })
}

// ---------- Síntesis y reproducción ----------

/** Últimas frases generadas (la actual y la siguiente, que se prepara mientras suena la actual). */
const cache = new Map<string, Promise<Blob>>()
const CACHE_SIZE = 4

function synthesize(text: string, key: string): Promise<Blob> {
  const k = `${key}\n${text}`
  let p = cache.get(k)
  if (!p) {
    p = call<ArrayBuffer>({ type: 'synth', voice: key, text }).then((buf) => new Blob([buf], { type: 'audio/wav' }))
    p.catch(() => cache.delete(k))
    cache.set(k, p)
    while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!)
  }
  return p
}

/** Genera de antemano la frase siguiente para que no haya pausa entre frases. */
export function prefetchNeural(text: string, voiceId: string) {
  synthesize(text, neuralKey(voiceId)).catch(() => undefined)
}

const audio = typeof Audio !== 'undefined' ? new Audio() : null
let token = 0
let finishCurrent: (() => void) | null = null
const SILENCE = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA='

/**
 * Safari (iPhone) solo deja reproducir audio si el primer play() ocurre dentro de un toque.
 * Se llama al pulsar "Escuchar"; después el mismo elemento puede sonar sin toques.
 */
export function unlockNeuralAudio() {
  if (!audio || audio.dataset.unlocked) return
  audio.dataset.unlocked = '1'
  audio.src = SILENCE
  audio.play().catch(() => delete audio.dataset.unlocked)
}

export async function speakNeural(text: string, voiceId: string, rate: number): Promise<void> {
  if (!audio) return
  const my = ++token
  const blob = await synthesize(text, neuralKey(voiceId))
  if (my !== token) return
  const url = URL.createObjectURL(blob)
  try {
    await new Promise<void>((resolve, reject) => {
      finishCurrent = resolve
      audio.onended = () => resolve()
      audio.onerror = () => reject(new Error('audio'))
      audio.src = url
      audio.playbackRate = rate
      audio.preservesPitch = true
      audio.play().catch(reject)
    })
  } finally {
    finishCurrent = null
    URL.revokeObjectURL(url)
  }
}

export function stopNeural() {
  token++
  if (audio && !audio.paused) audio.pause()
  finishCurrent?.()
  finishCurrent = null
}
