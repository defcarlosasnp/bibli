/* Service worker de Bibli: guarda la app para que abra sin conexión.
 * Es una plantilla: al compilar, el plugin `serviceWorker` de vite.config.ts rellena la versión
 * y la lista de archivos. Los libros no pasan por aquí: viven en IndexedDB. */
const CACHE = 'bibli-__VERSION__'
const PRECACHE = __PRECACHE__

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('bibli-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return

  // Páginas: primero la red (para recibir actualizaciones); sin conexión, la copia guardada.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(new URL('./', self.registration.scope).href)),
    )
    return
  }

  // Recursos (JS, CSS, fuentes, iconos): llevan hash en el nombre, así que la copia guardada vale.
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone()
            caches.open(CACHE).then((cache) => cache.put(request, copy))
          }
          return response
        }),
    ),
  )
})
