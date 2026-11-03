import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export { pdfjs }

/** Abre un PDF. Llama a `destroy()` al terminar para liberar el worker. */
export async function openPdf(data: ArrayBuffer) {
  const task = pdfjs.getDocument({ data: new Uint8Array(data) })
  const doc = await task.promise
  return { doc, destroy: () => task.destroy() }
}
