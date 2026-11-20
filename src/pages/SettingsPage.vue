<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useQuasar } from 'quasar'
import BackupDialog from '@/components/BackupDialog.vue'
import LumiOwl from '@/components/LumiOwl.vue'
import { GOAL_OPTIONS, dailyGoalMinutes, setDailyGoalMinutes } from '@/services/stats'
import { GOAL_CHOICES, setYearGoal, yearGoal } from '@/services/goals'
import { reminderSettings, remindersSupported, setReminder } from '@/services/reminder'
import { onlineInfoEnabled, recheckLibraryInfo, setOnlineInfo } from '@/services/bookInfo'
import { READER_THEMES, type PdfFit, type ReaderTheme } from '@/services/readerPrefs'

/** Todos los ajustes en un sitio (antes estaban repartidos por la app). */
const router = useRouter()
const $q = useQuasar()
const thisYear = new Date().getFullYear()

// ---------- Lectura ----------
const goal = ref(dailyGoalMinutes())
function changeGoal(m: number) {
  goal.value = m
  setDailyGoalMinutes(m)
}

const yGoal = ref<number | null>(yearGoal())
function changeYearGoal(n: number | null) {
  yGoal.value = n
  setYearGoal(n)
}

const theme = ref<ReaderTheme>((localStorage.getItem('bibli.readerTheme') as ReaderTheme | null) ?? 'day')
function changeTheme(t: ReaderTheme) {
  theme.value = t
  localStorage.setItem('bibli.readerTheme', t)
}

const pdfFit = ref<PdfFit>(
  (localStorage.getItem('bibli.pdfFit') as PdfFit | null) ?? (window.innerWidth < 700 ? 'width' : 'page'),
)
function changeFit(f: PdfFit) {
  pdfFit.value = f
  localStorage.setItem('bibli.pdfFit', f)
}

const buddy = ref(localStorage.getItem('bibli.readerBuddy') !== '0')
function changeBuddy(on: boolean) {
  buddy.value = on
  localStorage.setItem('bibli.readerBuddy', on ? '1' : '0')
}

// ---------- Avisos ----------
const reminder = ref(reminderSettings())
async function saveReminder(changes: Partial<typeof reminder.value>) {
  const next = { ...reminder.value, ...changes }
  const ok = await setReminder(next)
  if (!ok && next.on) {
    $q.notify({ type: 'warning', message: 'Sin permiso para avisos. Actívalo en los ajustes de Android → Apps → Bibli.' })
    return
  }
  reminder.value = next
  if (changes.on) $q.notify({ message: `Te avisaré a las ${next.time} los días que no hayas leído 🦉`, timeout: 2500 })
}
const onReminderToggle = (on: boolean) => saveReminder({ on })
const onReminderTime = (e: Event) => saveReminder({ time: (e.target as HTMLInputElement).value || reminder.value.time })

// ---------- Datos ----------
const online = ref(onlineInfoEnabled())
function changeOnline(on: boolean) {
  online.value = on
  setOnlineInfo(on)
}
const rechecking = ref(false)
async function recheck() {
  rechecking.value = true
  try {
    await recheckLibraryInfo()
    $q.notify({ message: 'Revisión terminada: se completó lo que faltaba', icon: 'auto_fix_high', timeout: 2500 })
  } finally {
    rechecking.value = false
  }
}
function openBackup() {
  $q.dialog({ component: BackupDialog })
}
</script>

<template>
  <q-layout view="hHh lpR fFf">
    <q-header class="app-header">
      <q-toolbar>
        <q-btn flat round icon="arrow_back" aria-label="Volver" @click="router.push({ name: 'library' })" />
        <q-toolbar-title class="font-display text-weight-bold">Ajustes</q-toolbar-title>
      </q-toolbar>
    </q-header>

    <q-page-container>
      <q-page class="page">
        <!-- Lectura -->
        <section class="card">
          <h2 class="font-display">📖 Lectura</h2>

          <div class="setting">
            <div class="setting__text">
              <b>Meta diaria</b>
              <span>Minutos de lectura al día</span>
            </div>
            <q-select
              :model-value="goal"
              :options="GOAL_OPTIONS.map((m) => ({ label: `${m} min`, value: m }))"
              emit-value
              map-options
              dense
              outlined
              class="setting__control"
              @update:model-value="changeGoal"
            />
          </div>

          <div class="setting">
            <div class="setting__text">
              <b>Reto {{ thisYear }}</b>
              <span>Libros que quieres terminar este año</span>
            </div>
            <q-select
              :model-value="yGoal"
              :options="[{ label: 'Sin reto', value: null }, ...GOAL_CHOICES.map((n) => ({ label: `${n} libros`, value: n }))]"
              emit-value
              map-options
              dense
              outlined
              class="setting__control"
              @update:model-value="changeYearGoal"
            />
          </div>

          <div class="setting setting--column">
            <div class="setting__text">
              <b>Tema de lectura</b>
              <span>Color del papel al abrir un libro (también se cambia en el botón Aa)</span>
            </div>
            <div class="themes">
              <button
                v-for="t in READER_THEMES"
                :key="t.id"
                class="theme"
                :class="{ 'theme--on': theme === t.id }"
                :style="{ background: t.bg, color: t.ink }"
                @click="changeTheme(t.id)"
              >
                <span class="theme__aa font-display">Aa</span>
                <span class="theme__label">{{ t.label }}</span>
              </button>
            </div>
          </div>

          <div class="setting">
            <div class="setting__text">
              <b>PDF</b>
              <span>Hoja entera, o a lo ancho y bajar con el dedo (mejor en el móvil)</span>
            </div>
            <q-btn-toggle
              :model-value="pdfFit"
              no-caps
              rounded
              unelevated
              dense
              toggle-color="accent"
              class="toggle-border"
              :options="[
                { label: 'Página', value: 'page' },
                { label: 'Ancho', value: 'width' },
              ]"
              @update:model-value="changeFit"
            />
          </div>

          <div class="setting">
            <div class="setting__text">
              <b>Lumi me acompaña</b>
              <span>Ánimos, hitos y recordatorios de descanso mientras lees</span>
            </div>
            <q-toggle :model-value="buddy" color="accent" @update:model-value="changeBuddy" />
          </div>
        </section>

        <!-- Avisos -->
        <section class="card">
          <h2 class="font-display">🔔 Recordatorio diario</h2>
          <div class="setting">
            <div class="setting__text">
              <b>Avisarme si no he leído</b>
              <span v-if="remindersSupported">Un aviso suave a la hora que elijas. Si ese día ya leíste, no molesta.</span>
              <span v-else>Disponible en la app de Android. En el navegador no se pueden programar avisos.</span>
            </div>
            <q-toggle
              :model-value="reminder.on"
              :disable="!remindersSupported"
              color="accent"
              @update:model-value="onReminderToggle"
            />
          </div>
          <div v-if="remindersSupported && reminder.on" class="setting">
            <div class="setting__text"><b>Hora</b></div>
            <q-input
              :model-value="reminder.time"
              type="time"
              dense
              outlined
              class="setting__control"
              @change="onReminderTime"
            />
          </div>
        </section>

        <!-- Datos -->
        <section class="card">
          <h2 class="font-display">💾 Tus datos</h2>
          <div class="setting">
            <div class="setting__text">
              <b>Copia de seguridad</b>
              <span>Guarda o recupera tus libros, progreso, subrayados, notas y estadísticas</span>
            </div>
            <q-btn unelevated rounded no-caps color="accent" icon="cloud_sync" label="Abrir" @click="openBackup" />
          </div>
          <div class="setting">
            <div class="setting__text">
              <b>Completar datos por internet</b>
              <span>Si a un libro le falta el autor o la portada, buscarlos en Open Library (se envía el título)</span>
            </div>
            <q-toggle :model-value="online" color="accent" @update:model-value="changeOnline" />
          </div>
          <div class="setting">
            <div class="setting__text">
              <b>Revisar de nuevo mis libros</b>
              <span>Vuelve a buscar sagas, autores y portadas que falten. Nunca cambia lo que ya tienes.</span>
            </div>
            <q-btn outline rounded no-caps color="primary" label="Revisar" :loading="rechecking" @click="recheck" />
          </div>
        </section>

        <!-- Acerca de -->
        <section class="card about">
          <LumiOwl mood="happy" :size="64" />
          <div>
            <b class="font-display">Bibli</b>
            <div class="muted">Tu biblioteca personal. Todo se guarda en este aparato.</div>
            <a href="https://github.com/defcarlosasnp/bibli" target="_blank" rel="noopener" class="about__link">
              Código en GitHub
            </a>
          </div>
        </section>
      </q-page>
    </q-page-container>
  </q-layout>
</template>

<style scoped>
.app-header {
  background: color-mix(in srgb, var(--paper) 85%, transparent);
  backdrop-filter: blur(12px);
  color: var(--ink);
  border-bottom: 1px solid color-mix(in srgb, var(--ink) 8%, transparent);
}
.page {
  max-width: 760px;
  margin: 0 auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.card {
  background: var(--card);
  border-radius: 20px;
  box-shadow: var(--shadow);
  padding: 18px;
}
h2 {
  font-size: 1.2rem;
  margin: 0 0 6px;
}
.muted {
  color: var(--ink-soft);
  font-size: 0.85rem;
}
.setting {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 0;
  border-top: 1px solid color-mix(in srgb, var(--ink) 8%, transparent);
}
.setting:first-of-type {
  border-top: 0;
}
.setting--column {
  flex-direction: column;
  align-items: stretch;
}
.setting__text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.setting__text span {
  color: var(--ink-soft);
  font-size: 0.82rem;
  line-height: 1.3;
}
.setting__control {
  width: 140px;
  flex-shrink: 0;
}
.toggle-border {
  border: 1px solid color-mix(in srgb, var(--ink) 15%, transparent);
}
.themes {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.theme {
  width: 70px;
  height: 64px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  border-radius: 14px;
  border: 2px solid rgba(0, 0, 0, 0.15);
  cursor: pointer;
  font-family: var(--font-body);
}
.theme--on {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 35%, transparent);
}
.theme__aa {
  font-size: 1.25rem;
  font-weight: 700;
  line-height: 1;
}
.theme__label {
  font-size: 0.72rem;
}
.about {
  display: flex;
  align-items: center;
  gap: 14px;
}
.about__link {
  color: var(--accent);
  font-size: 0.85rem;
}
</style>
