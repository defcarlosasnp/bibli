import JSZip from 'jszip'

/**
 * epub.js lee todos los archivos del EPUB como UTF-8 e ignora la codificación que declaran.
 * Los EPUB antiguos (muchos en español) vienen en ISO-8859-1 / Windows-1252 y las tildes
 * saldrían como "�". Al importar, se pasan a UTF-8 los archivos que lo necesiten.
 */

const TEXT_FILE = /\.(x?html?|opf|ncx|xml)$/i

function detectEncoding(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8'
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le'
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be'

  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024))
  const declared =
    /<\?xml[^>]*encoding\s*=\s*["']([\w.:-]+)/i.exec(head)?.[1] ??
    /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i.exec(head)?.[1]
  if (declared && !/^utf-?8$/i.test(declared)) {
    try {
      return new TextDecoder(declared).encoding
    } catch {
      // codificación desconocida: se decide por el contenido
    }
  }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return 'utf-8'
  } catch {
    return 'windows-1252'
  }
}

/** Devuelve el mismo EPUB si ya está en UTF-8; si no, una copia convertida. */
export async function epubToUtf8(data: ArrayBuffer): Promise<ArrayBuffer> {
  const zip = await JSZip.loadAsync(data)
  let changed = false
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || !TEXT_FILE.test(entry.name)) continue
    const bytes = await entry.async('uint8array')
    const encoding = detectEncoding(bytes)
    if (encoding === 'utf-8') continue
    const text = new TextDecoder(encoding)
      .decode(bytes)
      .replace(/(<\?xml[^>]*encoding\s*=\s*["'])[\w.:-]+/i, '$1utf-8')
      .replace(/(<meta[^>]+charset\s*=\s*["']?)[\w.:-]+/i, '$1utf-8')
    zip.file(entry.name, text) // JSZip guarda las cadenas en UTF-8
    changed = true
  }
  if (!changed) return data
  return zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' })
}
