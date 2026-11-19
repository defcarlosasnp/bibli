/** Color del lomo de un libro, sacado de su portada (o del título si no tiene). */
export interface SpineColor {
  bg: string
  fg: string
}

const cache = new Map<string, Promise<SpineColor>>()

function hashHue(text: string) {
  let h = 0
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) % 360
  return h
}

export function fallbackColor(title: string): SpineColor {
  return { bg: `hsl(${hashHue(title)} 45% 32%)`, fg: '#f6ead8' }
}

/**
 * Color dominante de la portada: se reduce a pocos píxeles y se toma la media de los que tienen
 * más color (si no, las portadas con mucho blanco darían lomos grises). Se oscurece un poco para
 * que el título se lea encima.
 */
export function spineColor(cover: string | null, title: string): Promise<SpineColor> {
  if (!cover) return Promise.resolve(fallbackColor(title))
  const key = cover.length > 200 ? cover.slice(-200) + cover.length : cover
  let p = cache.get(key)
  if (!p) {
    p = new Promise<SpineColor>((resolve) => {
      const img = new Image()
      img.onload = () => {
        try {
          const size = 12
          const c = document.createElement('canvas')
          c.width = c.height = size
          const ctx = c.getContext('2d', { willReadFrequently: true })!
          ctx.drawImage(img, 0, 0, size, size)
          const px = ctx.getImageData(0, 0, size, size).data
          const samples: [number, number, number, number][] = []
          for (let i = 0; i < px.length; i += 4) {
            const [r, g, b] = [px[i], px[i + 1], px[i + 2]]
            const sat = Math.max(r, g, b) - Math.min(r, g, b)
            samples.push([r, g, b, sat])
          }
          // La mitad con más color
          samples.sort((a, b) => b[3] - a[3])
          const top = samples.slice(0, Math.ceil(samples.length / 2))
          let [r, g, b] = top.reduce((acc, s) => [acc[0] + s[0], acc[1] + s[1], acc[2] + s[2]], [0, 0, 0])
          r /= top.length
          g /= top.length
          b /= top.length
          // Luminancia: si es muy claro, se oscurece para que parezca tela o cartón
          const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
          const k = lum > 0.55 ? 0.62 : lum > 0.35 ? 0.8 : 1
          r *= k
          g *= k
          b *= k
          const finalLum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
          resolve({
            bg: `rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(b)})`,
            fg: finalLum > 0.5 ? '#1e140d' : '#f6ead8',
          })
        } catch {
          resolve(fallbackColor(title))
        }
      }
      img.onerror = () => resolve(fallbackColor(title))
      img.src = cover
    })
    cache.set(key, p)
  }
  return p
}
