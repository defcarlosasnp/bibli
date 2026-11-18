import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { Quasar, Notify, Dialog } from 'quasar'
import { Capacitor } from '@capacitor/core'
import { App as CapApp } from '@capacitor/app'
import { freeNeuralStorageOnMobile } from './services/neuralVoice'
import quasarLang from 'quasar/lang/es'
import '@quasar/extras/material-icons/material-icons.css'
import '@fontsource-variable/fraunces'
import '@fontsource-variable/nunito'
import 'quasar/src/css/index.sass'

import App from './App.vue'
import { router } from './router'
import './styles.css'

createApp(App)
  .use(Quasar, {
    plugins: { Notify, Dialog },
    lang: quasarLang,
    config: {
      dark: 'auto',
      brand: {
        primary: '#8a5534',
        secondary: '#4f9d7e',
        accent: '#f29e38',
        positive: '#4f9d7e',
        negative: '#d9534f',
        warning: '#f29e38',
      },
      notify: { position: 'top', timeout: 2200 },
    },
  })
  .use(createPinia())
  .use(router)
  .mount('#app')

// Botón Atrás de Android: cierra ventanas abiertas, vuelve a la pantalla anterior y, en la portada,
// manda la app al fondo (sin cerrarla, para no cortar un audiolibro).
if (Capacitor.getPlatform() === 'android') {
  CapApp.addListener('backButton', () => {
    if (document.querySelector('.q-dialog, .q-menu')) {
      // Quasar cierra diálogos y menús con Escape. key vacío: que el lector no lo tome como "salir".
      for (const type of ['keydown', 'keyup']) {
        const e = new KeyboardEvent(type, { bubbles: true })
        Object.defineProperty(e, 'keyCode', { value: 27 })
        document.dispatchEvent(e)
      }
      return
    }
    if (router.currentRoute.value.name === 'library') CapApp.minimizeApp()
    else if (window.history.state?.back) router.back()
    else router.replace({ name: 'library' })
  })
}

freeNeuralStorageOnMobile()

// Web instalada (PWA): funciona sin conexión. En la app nativa los archivos ya van dentro del APK.
if (import.meta.env.PROD && 'serviceWorker' in navigator && !Capacitor.isNativePlatform()) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('Service worker:', err))
  })
}
