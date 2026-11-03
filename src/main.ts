import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { Quasar, Notify, Dialog } from 'quasar'
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
