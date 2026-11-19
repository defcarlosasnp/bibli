import { createRouter, createWebHashHistory } from 'vue-router'

export const router = createRouter({
  // Hash history funciona igual en web estática y dentro de Capacitor.
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'library', component: () => import('./pages/LibraryPage.vue') },
    { path: '/read/:id', name: 'reader', component: () => import('./pages/ReaderPage.vue'), props: true },
    { path: '/estadisticas', name: 'stats', component: () => import('./pages/StatsPage.vue') },
    { path: '/frases', name: 'quotes', component: () => import('./pages/QuotesPage.vue') },
    { path: '/quiero-leer', name: 'wishlist', component: () => import('./pages/WishlistPage.vue') },
    { path: '/mi-ano/:year?', name: 'year', component: () => import('./pages/YearPage.vue'), props: true },
  ],
})
