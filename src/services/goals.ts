/** Reto de lectura del año ("20 libros en 2026") y libros terminados en un año. */
import type { Book } from '@/db'
import { FINISHED_THRESHOLD } from './stats'

const KEY = 'bibli.yearGoal'

function load(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}')
  } catch {
    return {}
  }
}

export function yearGoal(year = new Date().getFullYear()): number | null {
  return load()[year] ?? null
}

export function setYearGoal(goal: number | null, year = new Date().getFullYear()) {
  const all = load()
  if (goal && goal > 0) all[year] = goal
  else delete all[year]
  localStorage.setItem(KEY, JSON.stringify(all))
}

/**
 * Cuándo se terminó un libro. Los terminados antes de guardarse la fecha usan la última vez que
 * se abrieron (es la mejor pista que hay).
 */
export function finishedDate(b: Book): number | null {
  if (b.progress < FINISHED_THRESHOLD) return null
  return b.finishedAt ?? b.lastOpenedAt ?? null
}

export function finishedInYear(books: Book[], year = new Date().getFullYear()): Book[] {
  return books
    .filter((b) => {
      const d = finishedDate(b)
      return d != null && new Date(d).getFullYear() === year
    })
    .sort((a, b) => (finishedDate(a) ?? 0) - (finishedDate(b) ?? 0))
}

export const GOAL_CHOICES = [5, 10, 12, 15, 20, 25, 30, 40, 52]
