import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import { quasar, transformAssetUrls } from '@quasar/vite-plugin'
import { fileURLToPath, URL } from 'node:url'
import { readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'

const publicDir = fileURLToPath(new URL('./public', import.meta.url))

/** Genera dist/sw.js a partir de src/sw.js con la lista de archivos del build para usarlos sin conexión. */
function serviceWorker(): Plugin {
  return {
    name: 'bibli-service-worker',
    apply: 'build',
    enforce: 'post',
    generateBundle(_, bundle) {
      const files = [...Object.keys(bundle), ...readdirSync(publicDir)]
        .filter((f) => f !== 'index.html' && !f.endsWith('.map'))
        // Las fuentes de iconos traen también .woff/.ttf y los navegadores actuales solo usan .woff2
        .filter((f) => !/\.(woff|ttf|eot)$/.test(f))
        // Fraunces y Nunito traen subconjuntos para otros alfabetos que nunca se descargan
        .filter((f) => !/-(cyrillic|greek|vietnamese)(-ext)?-/.test(f))
      const precache = ['./', ...files.map((f) => `./${f}`)]
      const version = createHash('sha256').update(precache.join('\n')).digest('hex').slice(0, 10)
      const source = readFileSync(fileURLToPath(new URL('./src/sw.js', import.meta.url)), 'utf8')
        .replace('__VERSION__', version)
        .replace('__PRECACHE__', JSON.stringify(precache, null, 2))
      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
    },
  }
}

/**
 * Dos arreglos a la librería de voz neuronal (piper-tts-web 1.0.5) al compilar:
 * - Elegir el hablante en modelos con varios (p. ej. la voz femenina de "sharvard"); trae fijo el 0.
 * - Un aviso del motor de pronunciación lanzaba un error que nadie recogía y la frase se quedaba
 *   esperando para siempre (pasaba en el iPhone): ahora solo se anota.
 */
function piperPatch(): Plugin {
  return {
    name: 'bibli-piper-patch',
    transform(code, id) {
      if (!id.includes('piper-tts-web') || !code.includes('const speakerId = 0;')) return
      const patched = code
        .replace('const speakerId = 0;', 'const speakerId = globalThis.__bibliPiperSpeaker ?? 0;')
        .replace(/printErr: \(message\) => \{\s*throw new Error\(message\);\s*\}/, 'printErr: (message) => { console.warn("piper:", message); }')
      if (!patched.includes('__bibliPiperSpeaker') || patched.includes('throw new Error(message)')) {
        this.error('piper-tts-web cambió: revisa piperPatch en vite.config.ts')
      }
      return { code: patched, map: null }
    },
  }
}

export default defineConfig({
  // Rutas relativas: funciona igual en Capacitor, en GitHub Pages (/bibli/) y en cualquier hosting.
  base: './',
  plugins: [
    vue({ template: { transformAssetUrls } }),
    quasar(),
    serviceWorker(),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // El worker de la voz neuronal carga partes del motor bajo demanda (import dinámico)
  worker: { format: 'es', plugins: () => [piperPatch()] },
  // Sin pre-empaquetar, para que el parche también se aplique con `npm run dev`
  optimizeDeps: { exclude: ['@mintplex-labs/piper-tts-web'] },
})
