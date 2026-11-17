import { db, type Highlight, type HighlightColor } from '@/db'

export const HIGHLIGHT_COLORS: Record<HighlightColor, { label: string; solid: string; fill: string }> = {
  yellow: { label: 'amarillo', solid: '#ffd84d', fill: 'rgba(255, 216, 77, 0.45)' },
  green: { label: 'verde', solid: '#7fd18b', fill: 'rgba(127, 209, 139, 0.45)' },
  pink: { label: 'rosa', solid: '#f59bb8', fill: 'rgba(245, 155, 184, 0.45)' },
  blue: { label: 'azul', solid: '#8ec5ff', fill: 'rgba(142, 197, 255, 0.45)' },
}

export function addHighlight(h: Omit<Highlight, 'id' | 'createdAt'>) {
  return db.highlights.add({ ...h, createdAt: Date.now() } as Highlight)
}

export function updateHighlight(id: number, changes: Partial<Pick<Highlight, 'note' | 'color'>>) {
  return db.highlights.update(id, changes)
}

export function removeHighlight(id: number) {
  return db.highlights.delete(id)
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
