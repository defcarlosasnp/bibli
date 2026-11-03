import ePub from 'epubjs'
import type { BookFormat } from '@/db'
import { openPdf } from './pdf'

export interface ExtractedMetadata {
  title: string
  author: string
  cover: string | null
}

const COVER_WIDTH = 300

export function detectFormat(file: File): BookFormat | null {
  const name = file.name.toLowerCase()
  if (name.endsWith('.pdf') || file.type === 'application/pdf') return 'pdf'
  if (name.endsWith('.epub') || file.type === 'application/epub+zip') return 'epub'
  return null
}

export async function sha256(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function titleFromFileName(fileName: string): string {
  return fileName.replace(/\.(pdf|epub)$/i, '').replace(/[_]+/g, ' ').trim()
}

export async function extractMetadata(
  format: BookFormat,
  data: ArrayBuffer,
  fileName: string,
): Promise<ExtractedMetadata> {
  const fallback = { title: titleFromFileName(fileName), author: '', cover: null }
  try {
    const meta = format === 'pdf' ? await extractPdf(data) : await extractEpub(data)
    return {
      title: meta.title?.trim() || fallback.title,
      author: meta.author?.trim() || '',
      cover: meta.cover,
    }
  } catch (err) {
    console.warn('No se pudieron leer los metadatos de', fileName, err)
    return fallback
  }
}

async function extractPdf(data: ArrayBuffer): Promise<Partial<ExtractedMetadata> & { cover: string | null }> {
  // pdf.js transfiere el buffer al worker, así que trabajamos sobre una copia.
  const { doc: pdf, destroy } = await openPdf(data.slice(0))
  try {
    const { info } = (await pdf.getMetadata()) as { info: Record<string, string | undefined> }
    const page = await pdf.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: COVER_WIDTH / base.width })
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(viewport.width)
    canvas.height = Math.round(viewport.height)
    await page.render({ canvas, viewport }).promise
    return {
      title: info.Title,
      author: info.Author,
      cover: canvas.toDataURL('image/jpeg', 0.8),
    }
  } finally {
    await destroy()
  }
}

async function extractEpub(data: ArrayBuffer): Promise<Partial<ExtractedMetadata> & { cover: string | null }> {
  const book = ePub(data.slice(0))
  try {
    const metadata = await book.loaded.metadata
    let cover: string | null = null
    const coverUrl = await book.coverUrl()
    if (coverUrl) cover = await thumbnailFromUrl(coverUrl)
    return { title: metadata.title, author: metadata.creator, cover }
  } finally {
    book.destroy()
  }
}

function thumbnailFromUrl(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = COVER_WIDTH
      canvas.height = Math.round((img.naturalHeight / img.naturalWidth) * COVER_WIDTH)
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/jpeg', 0.8))
    }
    img.onerror = () => resolve(null)
    img.src = url
  })
}
