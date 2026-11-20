/** Preferencias de lectura que se usan en el lector y en Ajustes. */

/** Temas de lectura: color del papel y de la letra. */
export type ReaderTheme = 'day' | 'sepia' | 'dusk' | 'night'
export const READER_THEMES: { id: ReaderTheme; label: string; bg: string; ink: string; dark: boolean }[] = [
  { id: 'day', label: 'Papel', bg: '#fdf9f2', ink: '#2b2018', dark: false },
  { id: 'sepia', label: 'Sepia', bg: '#f1e3c6', ink: '#4a3524', dark: false },
  { id: 'dusk', label: 'Gris', bg: '#2d2c30', ink: '#dcd6cc', dark: true },
  { id: 'night', label: 'Noche', bg: '#0f0e0d', ink: '#cfc5b8', dark: true },
]

/** Cómo cabe una hoja de PDF: entera o a lo ancho. */
export type PdfFit = 'page' | 'width'
