# Bibli

Biblioteca local de libros PDF y EPUB para web y móvil.

**Stack:** Vue 3 + Vite + TypeScript · Quasar (UI) · Pinia · Dexie (IndexedDB) · pdf.js · epub.js · Capacitor (Android/iOS)

## Desarrollo web

```bash
npm install
npm run dev
```

## Web instalable (PWA)

La web publicada en https://defcarlosasnp.github.io/bibli/ se puede instalar y funciona sin conexión:

- **iPhone / iPad:** ábrela en Safari → Compartir → *Añadir a pantalla de inicio*.
- **Android / escritorio (Chrome, Edge):** menú → *Instalar app*.

`npm run build` genera `dist/sw.js` a partir de `src/sw.js` con la lista de archivos del build (plugin en `vite.config.ts`). El service worker solo se registra en producción y fuera de la app nativa.

## Android

Requiere Android Studio.

```bash
npx cap add android   # solo la primera vez
npm run android       # compila, sincroniza y abre Android Studio
```

Para iOS (requiere macOS + Xcode): `npm i -D @capacitor/ios && npx cap add ios && npx cap open ios`.

## Estructura

```
src/
  db.ts                  Esquema Dexie: tabla `books` (metadatos) y `files` (binarios)
  services/metadata.ts   Extrae título, autor y portada de PDF/EPUB
  services/pdf.ts        Configuración de pdf.js
  sw.js                  Service worker (plantilla) para usar la web sin conexión
  stores/library.ts      Estado: importar, ordenar, filtrar, editar, eliminar
  pages/LibraryPage.vue  Estantería con búsqueda, orden y arrastrar/soltar
  pages/ReaderPage.vue   Lector PDF/EPUB que recuerda la posición
  components/BookCard.vue
```

## Cómo se guardan los libros

Al importar, el archivo se copia a IndexedDB (dentro de la app). Se detectan duplicados
por hash SHA-256. En web el navegador no puede leer tu carpeta de Descargas directamente,
por eso los libros se importan con el botón o arrastrándolos.
