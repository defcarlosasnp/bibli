/**
 * Ritmo de lectura del usuario, para decir cuánto le queda ("8 min de capítulo, 5 h de libro").
 * Se aprende de cuánto tarda en pasar página (solo cuando pasa él, no la voz) y se guarda en el
 * aparato. Las pausas largas (fue a por un café) no cuentan.
 */
import { ref } from 'vue'

/** pdfPage: una página de PDF · epubScreen: una pantalla de EPUB · epubLoc: ~1600 letras de EPUB */
export type PaceUnit = 'pdfPage' | 'epubScreen' | 'epubLoc'

interface Sample {
  /** Segundos por unidad (media móvil). */
  v: number
  /** Cuántas veces se ha medido. */
  n: number
}

const KEY = 'bibli.pace'
/** Mientras no hay medidas: lector medio (~250 palabras por minuto). */
const DEFAULTS: Record<PaceUnit, number> = { pdfPage: 80, epubScreen: 45, epubLoc: 75 }
/** Más de esto en una sola página es una pausa, no lectura. */
const MAX_PER_UNIT = 8 * 60

function load(): Partial<Record<PaceUnit, Sample>> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}')
  } catch {
    return {}
  }
}

/** Cambia cada vez que se aprende algo, para que lo que depende del ritmo se recalcule. */
export const paceVersion = ref(0)

export function secondsPer(unit: PaceUnit): number {
  return load()[unit]?.v ?? DEFAULTS[unit]
}

export function recordPace(unit: PaceUnit, seconds: number, units = 1) {
  if (units <= 0) return
  const per = seconds / units
  if (per < 2 || per > MAX_PER_UNIT) return
  const all = load()
  const cur = all[unit]
  // Al principio aprende rápido; luego cambia poco a poco
  const alpha = !cur ? 1 : cur.n < 6 ? 0.35 : 0.12
  all[unit] = { v: cur ? cur.v + (per - cur.v) * alpha : per, n: (cur?.n ?? 0) + 1 }
  try {
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    // sin almacenamiento: se seguirá usando el ritmo por defecto
  }
  paceVersion.value++
}

/** 45 → "1 min", 4000 → "1 h 7 min", 30000 → "8 h" */
export function formatRemaining(seconds: number): string {
  const min = Math.max(1, Math.round(seconds / 60))
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return h >= 5 || !m ? `${h} h` : `${h} h ${m} min`
}
