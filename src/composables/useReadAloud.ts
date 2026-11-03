import { computed, onBeforeUnmount, ref } from 'vue'
import { listVoices, speak, stopSpeaking, type Voice } from '@/services/speech'

export interface Sentence {
  text: string
  /** Resalta la frase en pantalla (y pasa de página si hace falta). */
  show?: () => void
}

/** Lo que cada formato (PDF, EPUB) tiene que saber hacer para que la app lo lea en voz alta. */
export interface ReadAloudSource {
  /** Frases desde la posición actual hasta el final de la página (PDF) o del capítulo (EPUB). */
  load(): Promise<Sentence[]>
  /** Pasa a la página o capítulo siguiente. Devuelve false si el libro se acabó. */
  advance(): Promise<boolean>
  /** Quita el resaltado. */
  clear(): void
}

export interface ReadAloudHooks {
  onStart?: () => void
  onChunkEnd?: () => void
  onFinish?: () => void
  onSleep?: () => void
  /** Varias páginas seguidas sin texto: probablemente un PDF escaneado. */
  onNoText?: () => void
}

/** 'chunk' = al acabar la página o el capítulo actual. */
export type SleepMode = number | 'chunk' | null

export const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2]
const EMPTY_CHUNKS_BEFORE_GIVING_UP = 5

export function useReadAloud(source: ReadAloudSource, hooks: ReadAloudHooks = {}) {
  /** Barra de reproducción visible. */
  const active = ref(false)
  const playing = ref(false)
  const sentence = ref('')
  const rate = ref(Number(localStorage.getItem('bibli.tts.rate')) || 1)
  const voiceId = ref<string | null>(localStorage.getItem('bibli.tts.voice'))
  const voices = ref<Voice[]>([])

  let chunk: Sentence[] | null = null
  let index = 0
  /** Cada reproducción tiene su número; al pausar o saltar se invalida la anterior. */
  let runId = 0
  let spokeAny = false
  let emptyStreak = 0

  // ---------- Temporizador para dormir ----------
  const sleepMode = ref<SleepMode>(null)
  const sleepEndsAt = ref<number | null>(null)
  const now = ref(Date.now())
  let stopAfterSentence = false
  let ticker: ReturnType<typeof setInterval> | undefined

  const sleepLeft = computed(() => {
    if (sleepEndsAt.value == null) return null
    const s = Math.max(0, Math.ceil((sleepEndsAt.value - now.value) / 1000))
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  })

  function setSleep(mode: SleepMode) {
    sleepMode.value = mode
    stopAfterSentence = false
    clearInterval(ticker)
    sleepEndsAt.value = typeof mode === 'number' ? Date.now() + mode * 60_000 : null
    if (sleepEndsAt.value != null) {
      now.value = Date.now()
      ticker = setInterval(() => {
        now.value = Date.now()
        // termina la frase en curso antes de parar
        if (sleepEndsAt.value != null && now.value >= sleepEndsAt.value) {
          clearInterval(ticker)
          stopAfterSentence = true
        }
      }, 1000)
    }
  }

  function fallAsleep() {
    setSleep(null)
    pause()
    hooks.onSleep?.()
  }

  // ---------- Pantalla encendida mientras se escucha ----------
  let wakeLock: WakeLockSentinel | null = null
  async function keepAwake(on: boolean) {
    try {
      if (on && !wakeLock && 'wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen')
      else if (!on && wakeLock) {
        await wakeLock.release()
        wakeLock = null
      }
    } catch {
      wakeLock = null
    }
  }

  // ---------- Reproducción ----------

  async function run(id: number) {
    while (id === runId) {
      if (!chunk) {
        chunk = await source.load()
        index = 0
        if (id !== runId) return
        emptyStreak = chunk.length ? 0 : emptyStreak + 1
        if (emptyStreak >= EMPTY_CHUNKS_BEFORE_GIVING_UP && !spokeAny) {
          close()
          hooks.onNoText?.()
          return
        }
      }
      while (index < chunk.length) {
        const s = chunk[index]
        sentence.value = s.text
        s.show?.()
        await speak(s.text, { rate: rate.value, voiceId: voiceId.value })
        if (id !== runId) return
        spokeAny = true
        index++
        if (stopAfterSentence) return fallAsleep()
      }
      chunk = null
      const more = await source.advance()
      if (id !== runId) return
      if (!more) {
        close()
        hooks.onFinish?.()
        return
      }
      if (sleepMode.value === 'chunk') return fallAsleep()
      hooks.onChunkEnd?.()
    }
  }

  async function play() {
    if (playing.value) return
    if (!active.value) {
      active.value = true
      spokeAny = false
      emptyStreak = 0
      if (!voices.value.length) voices.value = await listVoices().catch(() => [])
      hooks.onStart?.()
    }
    playing.value = true
    keepAwake(true)
    run(++runId)
  }

  /** Para la voz pero recuerda la frase: al reanudar se repite desde su inicio. */
  function pause() {
    runId++
    stopSpeaking()
    playing.value = false
    keepAwake(false)
  }

  function toggle() {
    if (playing.value) pause()
    else play()
  }

  function close() {
    pause()
    setSleep(null)
    active.value = false
    chunk = null
    sentence.value = ''
    source.clear()
  }

  /** Vuelve a empezar la frase actual (tras cambiar velocidad, voz o de frase). */
  function restartSentence() {
    if (!playing.value) return
    runId++
    stopSpeaking()
    run(runId)
  }

  /** El usuario cambió de página: se sigue leyendo desde ahí. */
  function jump() {
    if (!active.value) return
    chunk = null
    source.clear()
    restartSentence()
  }

  function skip(delta: number) {
    if (!chunk) return
    index = Math.min(Math.max(0, index + delta), chunk.length)
    if (playing.value) restartSentence()
    else if (chunk[index]) {
      sentence.value = chunk[index].text
      chunk[index].show?.()
    }
  }

  function setRate(r: number) {
    rate.value = r
    localStorage.setItem('bibli.tts.rate', String(r))
    restartSentence()
  }

  function setVoice(id: string | null) {
    voiceId.value = id
    if (id == null) localStorage.removeItem('bibli.tts.voice')
    else localStorage.setItem('bibli.tts.voice', id)
    restartSentence()
  }

  onBeforeUnmount(() => {
    runId++
    stopSpeaking()
    clearInterval(ticker)
    keepAwake(false)
  })

  return {
    active,
    playing,
    sentence,
    rate,
    voiceId,
    voices,
    sleepMode,
    sleepLeft,
    play,
    pause,
    toggle,
    close,
    jump,
    skip,
    setRate,
    setVoice,
    setSleep,
  }
}

export type ReadAloud = ReturnType<typeof useReadAloud>
