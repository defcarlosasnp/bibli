export type LumiHat = 'nightcap' | 'santa' | 'party' | 'witch'
export type LumiGlasses = 'sun' | 'reading'

export interface Outfit {
  hat?: LumiHat
  glasses?: LumiGlasses
}

export interface OutfitInfo extends Outfit {
  /** Comentario de Lumi sobre lo que lleva puesto. */
  line?: string
}

/** Lo que se pone Lumi según la fecha y la hora. Las fiestas mandan sobre la hora del día. */
export function outfitFor(date = new Date()): OutfitInfo {
  const month = date.getMonth() + 1
  const day = date.getDate()
  const hour = date.getHours()

  if ((month === 12 && day === 31) || (month === 1 && day === 1)) {
    return { hat: 'party', line: '¡Feliz año nuevo! 🎉 ¿Cuántos libros leeremos este año?' }
  }
  if (month === 12 && day >= 15) {
    return { hat: 'santa', line: '¡Jo, jo, jo! 🎄 Un buen libro es el mejor regalo.' }
  }
  if (month === 10 && day >= 25) {
    return { hat: 'witch', line: '¿Algo de terror para esta noche? 🎃 Yo me pongo el sombrero.' }
  }
  if (hour >= 21 || hour < 6) {
    return { hat: 'nightcap', line: 'Ya me puse el gorro de dormir… pero un capítulo más no hace daño 😴' }
  }
  if (hour >= 11 && hour < 17) {
    return { glasses: 'sun', line: '¡Qué buen día para leer! 😎 Yo ya tengo mis gafas de sol.' }
  }
  return {}
}
