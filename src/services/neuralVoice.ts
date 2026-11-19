/**
 * Voces neuronales de Bibli (Piper): suenan mucho más humanas que las del sistema y, una vez
 * descargadas, funcionan sin internet. El audio se genera en un Worker (src/workers/piper.worker.ts).
 */

import { computed, ref } from 'vue'

export const NEURAL_PREFIX = 'piper:'

export interface NeuralVoiceInfo {
  /** Id de Piper, p. ej. "es_MX-claude-high". */
  key: string
  label: string
  detail: string
  lang: string
  sizeMB: number
  /** Se ofrece en el móvil (modelos pequeños o medianos; los grandes van demasiado lentos). */
  mobile?: boolean
}

export const NEURAL_VOICES: NeuralVoiceInfo[] = [
  {
    key: 'es_ES-carlfm-x_low',
    label: 'Carlos (ligera)',
    detail: 'Español de España · voz masculina, la más rápida (para el móvil)',
    lang: 'es-ES',
    sizeMB: 28,
    mobile: true,
  },
  {
    // Mismo modelo que un hombre y una mujer; "#1" es la mujer
    key: 'es_ES-sharvard-medium#1',
    label: 'Lucía',
    detail: 'Español de España · voz femenina',
    lang: 'es-ES',
    sizeMB: 77,
    mobile: true,
  },
  { key: 'es_MX-claude-high', label: 'Mateo', detail: 'Español de México · voz masculina', lang: 'es-MX', sizeMB: 63 },
  { key: 'es_ES-davefx-medium', label: 'David', detail: 'Español de España · voz masculina', lang: 'es-ES', sizeMB: 63 },
  { key: 'es_MX-ald-medium', label: 'Álex', detail: 'Español de México · voz masculina', lang: 'es-MX', sizeMB: 63 },
  { key: 'en_US-hfc_female-medium', label: 'Hannah', detail: 'Inglés (EE. UU.) · voz femenina, para libros en inglés', lang: 'en-US', sizeMB: 63 },
]

/**
 * En el móvil la voz se genera más despacio: en el emulador de Android, 26 s para 12 s de audio con la
 * voz buena y casi 1:1 con la ligera. Un teléfono real suele ir más rápido que el emulador, así que en
 * el móvil se puede activar como experimento, solo con la voz ligera.
 */
export const isMobile =
  typeof navigator !== 'undefined' &&
  (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
    (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1))

/** El navegador tiene lo necesario (Worker, WebAssembly y almacenamiento de archivos). */
export const neuralCapable =
  typeof Worker !== 'undefined' &&
  typeof WebAssembly === 'object' &&
  typeof navigator !== 'undefined' &&
  !!navigator.storage &&
  'getDirectory' in navigator.storage

const MOBILE_KEY = 'bibli.neuralMobile'
/** Experimento activado en este móvil. */
export const neuralOnMobile = ref(typeof localStorage !== 'undefined' && localStorage.getItem(MOBILE_KEY) === '1')
export const neuralSupported = computed(() => neuralCapable && (!isMobile || neuralOnMobile.value))
/** Voces que se ofrecen en este aparato. */
export const offeredNeuralVoices = computed(() => (isMobile ? NEURAL_VOICES.filter((n) => n.mobile) : NEURAL_VOICES))

export async function setNeuralOnMobile(on: boolean) {
  neuralOnMobile.value = on
  localStorage.setItem(MOBILE_KEY, on ? '1' : '0')
  if (!on) {
    cache.clear()
    worker?.terminate()
    worker = null
    await freeNeuralStorageOnMobile()
  }
}

/** En el móvil sin el experimento, borra las voces que se hubieran descargado antes. */
export async function freeNeuralStorageOnMobile() {
  if (!isMobile || neuralOnMobile.value || !navigator.storage?.getDirectory) return
  try {
    const root = await navigator.storage.getDirectory()
    for (const name of ['piper', 'piper-runtime']) await root.removeEntry(name, { recursive: true }).catch(() => undefined)
  } catch {
    // sin OPFS: no hay nada que borrar
  }
}

export const isNeuralVoice =(id: string | null | undefined): id is string => !!id?.startsWith(NEURAL_PREFIX)
export const neuralKey = (id: string) => id.slice(NEURAL_PREFIX.length)
/** Archivo de modelo de una voz ("es_ES-sharvard-medium#1" → "es_ES-sharvard-medium"). */
export const neuralModel = (key: string) => key.split('#')[0]

// ---------- Worker ----------

let worker: Worker | null = null
let nextId = 1
const pending = new Map<
  number,
  { resolve(v: unknown): void; reject(e: Error): void; progress?(f: number): void; log?(s: string): void }
>()
/** Quien está escuchando el diagnóstico (también recibe los errores sueltos del worker). */
let diagLog: ((s: string) => void) | null = null

function failAll(message: string) {
  for (const req of pending.values()) req.reject(new Error(message))
  pending.clear()
  worker?.terminate()
  worker = null
}

function call<T>(msg: Record<string, unknown>, progress?: (f: number) => void, log?: (s: string) => void): Promise<T> {
  if (!worker) {
    try {
      worker = new Worker(new URL('../workers/piper.worker.ts', import.meta.url), { type: 'module' })
    } catch (err) {
      return Promise.reject(err)
    }
    // Si el worker no puede arrancar (navegador antiguo), que nada se quede esperando para siempre
    worker.onerror = (e) => {
      diagLog?.(`Error del motor: ${e.message || 'el hilo de la voz se cerró'}`)
      failAll('worker')
    }
    worker.onmessageerror = () => failAll('worker')
    worker.onmessage = (e: MessageEvent) => {
      const { id, result, error, progress: p, log: line } = e.data
      if (line != null && id === -1) return diagLog?.(line)
      const req = pending.get(id)
      if (!req) return
      if (line != null) return req.log?.(line)
      if (p != null) return req.progress?.(p)
      pending.delete(id)
      if (error) req.reject(new Error(error))
      else req.resolve(result)
    }
  }
  const id = nextId++
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, progress, log })
    worker!.postMessage({ id, ...msg })
  })
}

export async function storedNeuralVoices(): Promise<string[]> {
  if (!neuralSupported.value) return []
  // Nunca debe retrasar el ▶: si tarda, se sigue sin voces neuronales
  const timeout = new Promise<string[]>((resolve) => setTimeout(() => resolve([]), 3000))
  return Promise.race([call<string[]>({ type: 'stored' }).catch(() => []), timeout])
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
/** 0,1 s de silencio en WAV (Safari ignora un archivo vacío y no se "desbloquea"). */
function silenceUrl() {
  const samples = 800
  const buf = new ArrayBuffer(44 + samples * 2)
  const v = new DataView(buf)
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  str(0, 'RIFF')
  v.setUint32(4, 36 + samples * 2, true)
  str(8, 'WAVEfmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true)
  v.setUint16(22, 1, true)
  v.setUint32(24, 8000, true)
  v.setUint32(28, 16000, true)
  v.setUint16(32, 2, true)
  v.setUint16(34, 16, true)
  str(36, 'data')
  v.setUint32(40, samples * 2, true)
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }))
}

/**
 * Safari (iPhone) solo deja reproducir audio si el primer play() ocurre dentro de un toque.
 * Se llama al pulsar "Escuchar"; después el mismo elemento puede sonar sin toques.
 */
export function unlockNeuralAudio() {
  if (!audio || audio.dataset.unlocked) return
  audio.dataset.unlocked = '1'
  audio.src = silenceUrl()
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

/** Cierra el hilo de la voz (p. ej. si una frase se quedó colgada) para que la siguiente empiece limpia. */
export function resetNeuralWorker() {
  cache.clear()
  failAll('reiniciado')
}

/**
 * Prueba completa (cargar, generar y reproducir una frase) contando cada paso.
 * Llamar a unlockNeuralAudio() antes, dentro del toque, para que el iPhone deje sonar el resultado.
 */
export async function diagnoseNeural(voiceId: string, log: (s: string) => void) {
  const text = 'Hola, soy la voz neuronal de Bibli. ¿Me oyes bien?'
  const key = neuralKey(voiceId)
  // Hilo nuevo: si el anterior se quedó colgado con una frase, la prueba esperaría detrás para siempre
  resetNeuralWorker()
  diagLog = log
  try {
    log('Arrancando el hilo de la voz…')
    const pong = await Promise.race([
      call<string>({ type: 'ping' }),
      new Promise<null>((r) => setTimeout(() => r(null), 8000)),
    ])
    if (!pong) throw new Error('El hilo de la voz no arranca en este navegador')
    log('Hilo arrancado')
    const buf = await call<ArrayBuffer>({ type: 'diagnose', voice: key, text }, undefined, log)
    cache.set(`${key}\n${text}`, Promise.resolve(new Blob([buf], { type: 'audio/wav' })))
    log('Reproduciendo…')
    const t = performance.now()
    await speakNeural(text, voiceId, 1)
    log(`✅ Sonó entera (${((performance.now() - t) / 1000).toFixed(1)} s)`)
  } catch (err) {
    log(`❌ ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    diagLog = null
  }
}

export function stopNeural() {
  token++
  if (audio && !audio.paused) audio.pause()
  finishCurrent?.()
  finishCurrent = null
}
