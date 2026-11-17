import { computed, onBeforeUnmount, ref } from 'vue'
import { VOICE_SAMPLE, listVoices, prefetchSpeech, speak, speakWithin, stopSpeaking, unlockSpeech, type Voice } from '@/services/speech'

export interface Sentence {
  text: string
  /** Resalta la frase en pantalla (y pasa de pÃ¡gina si hace falta). */
  show?: () => void
}

/** Lo que cada formato (PDF, EPUB) tiene que saber hacer para que la app lo lea en voz alta. */
export interface ReadAloudSource {
  /** Frases desde la posiciÃ³n actual hasta el final de la pÃ¡gina (PDF) o del capÃ­tulo (EPUB). */
  load(): Promise<Sentence[]>
  /** Pasa a la pÃ¡gina o capÃ­tulo siguiente. Devuelve false si el libro se acabÃ³. */
  advance(): Promise<boolean>
  /** Quita el resaltado. */
  clear(): void

  // Para leer con la pantalla bloqueada (Android): el servicio nativo lee las frases siguientes
  /** Identificador de la pÃ¡gina (PDF) o capÃ­tulo (EPUB) actual. */
  currentKey?(): unknown
  /** Frases de las prÃ³ximas pÃ¡ginas o capÃ­tulos, sin moverse de donde estÃ¡. */
  upcoming?(count: number): Promise<{ key: unknown; texts: string[] }[]>
  /** Ir al principio de una pÃ¡gina o capÃ­tulo (al volver a la app). */
  goToChunk?(key: unknown): Promise<void>
}

/** Frases entregadas al servicio nativo y de quÃ© pÃ¡gina/capÃ­tulo sale cada una. */
export interface BackgroundPlan {
  sentences: string[]
  map: { key: unknown; index: number }[]
}

/** Lo que devuelve el servicio al volver: por quÃ© frase de la cola iba. */
export interface BackgroundState {
  active: boolean
  index: number
  playing: boolean
  finished: boolean
}

/** PÃ¡ginas o capÃ­tulos que se preparan por adelantado al bloquear la pantalla, y audio mÃ¡ximo. */
export const LOOKAHEAD_PDF_PAGES = 40
export const LOOKAHEAD_EPUB_CHAPTERS = 4
export const BACKGROUND_MAX_SECONDS = 90 * 60

export interface ReadAloudHooks {
  onStart?: () => void
  onChunkEnd?: () => void
  onFinish?: () => void
  onSleep?: () => void
  /** Varias pÃ¡ginas seguidas sin texto: probablemente un PDF escaneado. */
  onNoText?: () => void
  /** La voz de internet no respondiÃ³ y se cambiÃ³ a la del dispositivo. */
  onVoiceFallback?: () => void
}

/** 'chunk' = al acabar la pÃ¡gina o el capÃ­tulo actual. */
export type SleepMode = number | 'chunk' | null

export const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2]
const EMPTY_CHUNKS_BEFORE_GIVING_UP = 5

export function useReadAloud(source: ReadAloudSource, hooks: ReadAloudHooks = {}) {
  /** Barra de reproducciÃ³n visible. */
  const active = ref(false)
  const playing = ref(false)
  const sentence = ref('')
  const rate = ref(Number(localStorage.getItem('bibli.tts.rate')) || 1)
  /** Voz elegida; null = automÃ¡tica (la mejor disponible). */
  const voiceId = ref<string | null>(localStorage.getItem('bibli.tts.voice'))
  const voices = ref<Voice[]>([])
  /** La lista ya viene ordenada: la primera es la mejor. */
  const effectiveVoiceId = computed(() =>
    voiceId.value != null && voices.value.some((v) => v.id === voiceId.value) ? voiceId.value : (voices.value[0]?.id ?? null),
  )
  const currentVoice = computed(() => voices.value.find((v) => v.id === effectiveVoiceId.value) ?? null)

  /**
   * Las voces de internet se cuelgan sin conexiÃ³n (tambiÃ©n cuando Android la corta con la pantalla
   * bloqueada). Entonces se sigue con la mejor voz del dispositivo hasta la prÃ³xima vez que se pulse â–¶.
   * Lo mismo si la voz neuronal falla (p. ej. un mÃ³vil sin memoria suficiente).
   */
  const offline = ref(false)
  /** Mejor voz del sistema que no necesita internet, del mismo idioma si la hay. */
  const localVoiceId = computed(() => {
    const local = voices.value.filter((v) => !v.online && !v.neural)
    const lang = currentVoice.value?.lang ?? ''
    return (
      local.find((v) => v.lang === lang) ??
      local.find((v) => v.lang.slice(0, 2) === lang.slice(0, 2)) ??
      local[0]
    )?.id ?? null
  })
  const canFallBack = computed(() => !!(currentVoice.value?.online || currentVoice.value?.neural))
  const speakingVoiceId = computed(() =>
    offline.value && canFallBack.value ? localVoiceId.value : effectiveVoiceId.value,
  )
  /** Con la pantalla bloqueada lee el servicio nativo de Android, que solo sabe usar voces del sistema. */
  const backgroundVoiceId = computed(() => (currentVoice.value?.neural ? localVoiceId.value : speakingVoiceId.value))

  let chunk: Sentence[] | null = null
  let index = 0
  /** Cada reproducciÃ³n tiene su nÃºmero; al pausar o saltar se invalida la anterior. */
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

  // ---------- ReproducciÃ³n ----------

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
        const usedOnline = canFallBack.value && !offline.value
        const voice = speakingVoiceId.value
        const speaking = speakWithin(s.text, { rate: rate.value, voiceId: voice })
        const following = chunk[index + 1]
        if (following) prefetchSpeech(following.text, voice)
        const finished = await speaking
        if (id !== runId) return
        if (!finished && usedOnline && localVoiceId.value) {
          // Sin conexiÃ³n: se repite la misma frase con la voz del dispositivo
          offline.value = true
          hooks.onVoiceFallback?.()
          continue
        }
        spokeAny = true
        index++
        // Con la pantalla bloqueada los temporizadores pueden retrasarse: se comprueba la hora tambiÃ©n aquÃ­
        if (stopAfterSentence || (sleepEndsAt.value != null && Date.now() >= sleepEndsAt.value)) return fallAsleep()
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
    unlockSpeech()
    if (!active.value) {
      active.value = true
      spokeAny = false
      emptyStreak = 0
      if (!voices.value.length) await refreshVoices()
      hooks.onStart?.()
    }
    playing.value = true
    offline.value = false // quizÃ¡ ya vuelve a haber conexiÃ³n
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

  /** El usuario cambiÃ³ de pÃ¡gina: se sigue leyendo desde ahÃ­. */
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
    offline.value = false
    if (id == null) localStorage.removeItem('bibli.tts.voice')
    else localStorage.setItem('bibli.tts.voice', id)
    restartSentence()
  }

  // ---------- Pantalla bloqueada (Android) ----------

  /**
   * Para el bucle de JavaScript (el WebView se congelarÃ¡) y prepara las frases que leerÃ¡ el servicio
   * nativo: lo que queda de la pÃ¡gina o capÃ­tulo y los siguientes, hasta `maxSeconds` de audio
   * aproximado, o menos si el temporizador para dormir acaba antes.
   */
  async function exportForBackground(maxSeconds: number, chunksAhead: number): Promise<BackgroundPlan | null> {
    if (!playing.value) return null
    runId++
    stopSpeaking()
    if (!chunk) {
      chunk = await source.load()
      index = 0
    }
    let budget = maxSeconds
    if (sleepEndsAt.value != null) budget = Math.min(budget, Math.max(0, (sleepEndsAt.value - Date.now()) / 1000))
    const plan: BackgroundPlan = { sentences: [], map: [] }
    let seconds = 0
    const add = (text: string, key: unknown, i: number) => {
      plan.sentences.push(text)
      plan.map.push({ key, index: i })
      seconds += text.length / (15 * rate.value)
    }
    const key = source.currentKey?.()
    for (let i = index; i < chunk.length && seconds < budget; i++) add(chunk[i].text, key, i)
    if (sleepMode.value !== 'chunk' && source.upcoming && seconds < budget) {
      for (const next of await source.upcoming(chunksAhead)) {
        for (let i = 0; i < next.texts.length && seconds < budget; i++) add(next.texts[i], next.key, i)
        if (seconds >= budget) break
      }
    }
    return plan
  }

  /** Al volver a la app: sigue desde la frase por la que iba el servicio. */
  async function resumeFromBackground(plan: BackgroundPlan, state: BackgroundState) {
    const sleepDone = state.finished && (sleepMode.value != null)
    const at = Math.min(state.index, plan.map.length - 1)
    const target = plan.map[at]
    if (target) {
      if (target.key !== source.currentKey?.() && source.goToChunk) {
        await source.goToChunk(target.key)
        chunk = await source.load()
      }
      index = Math.min(target.index + (state.finished && state.index >= plan.map.length ? 1 : 0), chunk?.length ?? 0)
    }
    if (sleepDone) return fallAsleep()
    if (state.playing && !state.finished) {
      playing.value = true
      run(++runId)
    } else {
      pause()
      const s = chunk?.[index]
      if (s) {
        sentence.value = s.text
        s.show?.()
      }
    }
  }

  /** Vuelve a pedir las voces (p. ej. despuÃ©s de descargar una nueva en los ajustes). */
  async function refreshVoices() {
    voices.value = await listVoices().catch(() => [])
  }

  /** Muestra de una voz. Pausa la lectura para no mezclar las dos. */
  function preview(id: string) {
    unlockSpeech()
    if (playing.value) pause()
    stopSpeaking()
    speak(VOICE_SAMPLE, { rate: rate.value, voiceId: id })
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
    currentVoice,
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
    refreshVoices,
    preview,
    setSleep,
    speakingVoiceId,
    backgroundVoiceId,
    exportForBackground,
    resumeFromBackground,
  }
}

export type ReadAloud = ReturnType<typeof useReadAloud>
