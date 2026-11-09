import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'

/**
 * Lectura con la pantalla bloqueada (solo Android): plugin propio que arranca un servicio en
 * primer plano con controles en la notificación y la pantalla de bloqueo.
 * Ver android/app/src/main/java/com/bibli/app/ReadAloudService.java.
 */

export type MediaAction = 'play' | 'pause' | 'next' | 'previous' | 'stop'

interface BackgroundReadingPlugin {
  update(options: { title: string; author: string; cover?: string | null; playing: boolean }): Promise<void>
  startQueue(options: { sentences: string[]; voice: string | null; rate: number }): Promise<void>
  takeQueue(): Promise<{ active: boolean; index: number; playing: boolean; finished: boolean }>
  stop(): Promise<void>
  addListener(event: 'action', handler: (e: { action: MediaAction }) => void): Promise<PluginListenerHandle>
}

const BackgroundReading = registerPlugin<BackgroundReadingPlugin>('BackgroundReading')

export const backgroundReadingSupported = Capacitor.getPlatform() === 'android'

export interface NowPlaying {
  title: string
  author: string
  cover: string | null
}

let coverSent: string | null = null

/** Muestra u actualiza la notificación. La portada solo se envía cuando cambia. */
export function showNowPlaying(info: NowPlaying, playing: boolean) {
  if (!backgroundReadingSupported) return
  const cover = info.cover !== coverSent ? info.cover : undefined
  coverSent = info.cover
  BackgroundReading.update({ title: info.title, author: info.author, cover, playing }).catch((err) =>
    console.warn('Lectura en segundo plano:', err),
  )
}

export function hideNowPlaying() {
  if (!backgroundReadingSupported) return
  coverSent = null
  BackgroundReading.stop().catch(() => undefined)
}

/** El servicio nativo sigue leyendo estas frases mientras el WebView está congelado. */
export function startBackgroundQueue(sentences: string[], voice: string | null, rate: number) {
  return BackgroundReading.startQueue({ sentences, voice, rate })
}

/** Detiene la lectura nativa y dice por qué frase iba. */
export function takeBackgroundQueue() {
  return BackgroundReading.takeQueue()
}

export function onMediaAction(handler: (action: MediaAction) => void): () => void {
  if (!backgroundReadingSupported) return () => undefined
  const handle = BackgroundReading.addListener('action', (e) => handler(e.action))
  return () => {
    handle.then((h) => h.remove())
  }
}
