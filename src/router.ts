import { createRouter, createWebHashHistory } from 'vue-router'

export const router = createRouter({
  // Hash history funciona igual en web estática y dentro de Capacitor.
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'library', component: () => import('./pages/LibraryPage.vue') },
    { path: '/read/:id', name: 'reader', component: () => import('./pages/ReaderPage.vue'), props: true },
  ],
})
