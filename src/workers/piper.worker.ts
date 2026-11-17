/// <reference lib="webworker" />
/**
 * Voz neuronal (Piper) en un hilo aparte, para no trabar la pantalla mientras genera el audio.
 *
 * Todo lo que necesita se descarga una vez y se guarda en el almacenamiento privado del navegador
 * (OPFS): el modelo de la voz (~63 MB) y el motor (~30 MB, compartido por todas las voces). Después
 * funciona sin internet.
 */
import { TtsSession } from '@mintplex-labs/piper-tts-web'

declare const self: DedicatedWorkerGlobalScope

const HF_BASE = 'https://huggingface.co/diffusionstudio/piper-voices/resolve/main'
/** Mismos archivos y versiones que espera la librería. */
const RUNTIME = {
  ort: 'https://cdnjs.cloudflare.com/ajax/libs/onnxruntime-web/1.18.0/ort-wasm-simd.wasm',
  piperWasm: 'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.wasm',
  piperData: 'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize.data',
}

/** "es_MX-claude-high" → "es/es_MX/claude/high/es_MX-claude-high.onnx" */
function modelPath(voice: string) {
  const [locale, name, quality] = voice.split('-')
  return `${locale.split('_')[0]}/${locale}/${name}/${quality}/${voice}.onnx`
}

async function dir(name: string) {
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle(name, { create: true })
}

async function exists(d: FileSystemDirectoryHandle, file: string) {
  try {
    return (await (await d.getFileHandle(file)).getFile()).size > 0
  } catch {
    return false
  }
}

/** Descarga a un archivo de OPFS escribiendo por trozos (sin cargar 60 MB en memoria). */
async function downloadTo(d: FileSystemDirectoryHandle, file: string, url: string, onBytes?: (n: number, total: number) => void) {
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
  const total = Number(res.headers.get('Content-Length') ?? 0)
  const handle = await (await d.getFileHandle(file, { create: true })).createSyncAccessHandle()
  try {
    handle.truncate(0)
    let at = 0
    const reader = res.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      handle.write(value, { at })
      at += value.length
      onBytes?.(at, total)
    }
    handle.flush()
  } catch (err) {
    handle.close()
    await d.removeEntry(file).catch(() => undefined)
    throw err
  }
  handle.close()
}

async function ensureRuntime(onBytes?: (n: number) => void) {
  const d = await dir('piper-runtime')
  let done = 0
  for (const url of Object.values(RUNTIME)) {
    const file = url.split('/').at(-1)!
    if (!(await exists(d, file))) {
      const base = done
      await downloadTo(d, file, url, (n) => onBytes?.(base + n))
    }
    done += (await (await d.getFileHandle(file)).getFile()).size
  }
}

async function runtimeUrls() {
  const d = await dir('piper-runtime')
  const url = async (u: string) => URL.createObjectURL(await (await d.getFileHandle(u.split('/').at(-1)!)).getFile())
  return {
    // onnxruntime acepta un mapa archivo → URL además de una carpeta
    onnxWasm: { 'ort-wasm-simd.wasm': await url(RUNTIME.ort) } as unknown as string,
    piperWasm: await url(RUNTIME.piperWasm),
    piperData: await url(RUNTIME.piperData),
  }
}

/** La voz está completa si existe su configuración, que se escribe la última. */
async function stored(): Promise<string[]> {
  const d = await dir('piper')
  const out: string[] = []
  for await (const name of (d as unknown as { keys(): AsyncIterable<string> }).keys()) {
    if (name.endsWith('.onnx.json') && (await exists(d, name.replace(/\.json$/, '')))) out.push(name.replace(/\.onnx\.json$/, ''))
  }
  return out
}

async function download(voice: string, progress: (loaded: number, total: number) => void) {
  const path = modelPath(voice)
  const d = await dir('piper')
  // Tamaños aproximados para una barra de progreso estable: motor ~30 MB + voz ~63 MB
  const RUNTIME_BYTES = 30e6
  let modelTotal = 63e6
  await ensureRuntime((n) => progress(Math.min(n, RUNTIME_BYTES), RUNTIME_BYTES + modelTotal))
  await d.removeEntry(`${voice}.onnx.json`).catch(() => undefined)
  await downloadTo(d, `${voice}.onnx`, `${HF_BASE}/${path}`, (n, total) => {
    if (total) modelTotal = total
    progress(RUNTIME_BYTES + n, RUNTIME_BYTES + modelTotal)
  })
  await downloadTo(d, `${voice}.onnx.json`, `${HF_BASE}/${path}.json`)
}

async function remove(voice: string) {
  const d = await dir('piper')
  await d.removeEntry(`${voice}.onnx.json`).catch(() => undefined)
  await d.removeEntry(`${voice}.onnx`).catch(() => undefined)
  if (session && currentVoice === voice) {
    session = null
    TtsSession._instance = null
  }
}

let session: TtsSession | null = null
let currentVoice = ''

async function synth(voice: string, text: string): Promise<ArrayBuffer> {
  if (!session || currentVoice !== voice) {
    // La librería reutiliza una única sesión: hay que soltarla para cargar otro modelo
    TtsSession._instance = null
    session = null
    await ensureRuntime()
    session = await TtsSession.create({ voiceId: voice, wasmPaths: await runtimeUrls() })
    currentVoice = voice
  }
  const blob = await session.predict(text)
  return blob.arrayBuffer()
}

// Las peticiones se atienden de una en una (el modelo no admite dos a la vez)
let queue: Promise<unknown> = Promise.resolve()

self.onmessage = (e: MessageEvent) => {
  const { id, type, voice, text } = e.data as { id: number; type: string; voice: string; text: string }
  const reply = (data: object, transfer: Transferable[] = []) => self.postMessage({ id, ...data }, transfer)
  const task = async () => {
    try {
      if (type === 'stored') reply({ result: await stored() })
      else if (type === 'remove') reply({ result: await remove(voice) })
      else if (type === 'download') {
        let last = 0
        await download(voice, (loaded, total) => {
          const now = Date.now()
          if (now - last > 250) {
            last = now
            reply({ progress: total ? loaded / total : 0 })
          }
        })
        reply({ result: true })
      } else if (type === 'synth') {
        const wav = await synth(voice, text)
        reply({ result: wav }, [wav])
      }
    } catch (err) {
      reply({ error: err instanceof Error ? err.message : String(err) })
    }
  }
  // Las descargas no esperan a la cola de síntesis
  if (type === 'synth') queue = queue.then(task)
  else task()
}
