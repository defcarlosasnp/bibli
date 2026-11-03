<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import LumiOwl, { type OwlMood } from './LumiOwl.vue'
import type { Book } from '@/db'
import { FINISHED_THRESHOLD } from '@/services/stats'
import { outfitFor } from '@/services/lumi'

interface Part {
  t: string
  b?: boolean
}
interface Message {
  mood: OwlMood
  parts: Part[]
  action?: { label: string; icon: string; book?: Book; kind: 'open' | 'import' }
}

const props = defineProps<{ books: Book[]; streak: number }>()
const emit = defineEmits<{ open: [book: Book]; import: [] }>()

const TIPS: Message[] = [
  { mood: 'happy', parts: [{ t: 'Truco: en el lector pulsa ' }, { t: '🔖', b: true }, { t: ' para guardar un marcador.' }] },
  { mood: 'idle', parts: [{ t: 'Organiza tus libros en ' }, { t: 'colecciones', b: true }, { t: ' desde ⋮ → Editar.' }] },
  { mood: 'sleepy', parts: [{ t: '¿Lees de noche? Prueba el ' }, { t: 'modo nocturno 🌙', b: true }, { t: ' en el lector.' }] },
  { mood: 'happy', parts: [{ t: 'Puedes añadir varios libros a la vez. ¡Cuantos más, mejor! 📚' }] },
]

const outfit = outfitFor()

function pct(b: Book) {
  return Math.round(b.progress * 100)
}

const messages = computed<Message[]>(() => {
  const books = props.books
  if (!books.length) {
    return [
      {
        mood: 'excited',
        parts: [{ t: '¡Hola! Soy ' }, { t: 'Lumi', b: true }, { t: ' 🦉. Tu estantería está vacía… ¿me traes un libro?' }],
        action: { label: 'Añadir libros', icon: 'add', kind: 'import' },
      },
    ]
  }

  const list: Message[] = []
  const reading = books
    .filter((b) => b.progress > 0 && b.progress < FINISHED_THRESHOLD)
    .sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))
  const unread = books.filter((b) => !b.progress)
  const finished = books.filter((b) => b.progress >= FINISHED_THRESHOLD)

  if (reading[0]) {
    const b = reading[0]
    list.push({
      mood: 'happy',
      parts: [{ t: 'Vas por el ' }, { t: `${pct(b)}%`, b: true }, { t: ' de ' }, { t: b.title, b: true }, { t: '. ¿Seguimos?' }],
      action: { label: 'Continuar', icon: 'auto_stories', book: b, kind: 'open' },
    })
    if (b.progress > 0.75) {
      list.push({
        mood: 'excited',
        parts: [{ t: '¡Ya casi terminas ' }, { t: b.title, b: true }, { t: '! Solo te queda un empujón 💪' }],
        action: { label: 'Terminarlo', icon: 'flag', book: b, kind: 'open' },
      })
    }
  }
  if (outfit.line) {
    list.splice(1, 0, { mood: outfit.hat === 'nightcap' ? 'sleepy' : 'happy', parts: [{ t: outfit.line }] })
  }
  if (props.streak >= 2) {
    list.push({ mood: 'excited', parts: [{ t: '¡Llevas ' }, { t: `${props.streak} días seguidos`, b: true }, { t: ' leyendo! 🔥 No rompas la racha.' }] })
  } else if (reading.length && props.streak === 0) {
    list.push({ mood: 'sleepy', parts: [{ t: 'Hoy no hemos leído nada… ¿unas páginas antes de dormir? 😴' }] })
  }
  if (unread.length) {
    const pick = unread[Math.floor(Math.random() * unread.length)]
    list.push({
      mood: 'idle',
      parts: [
        { t: `Tienes ${unread.length} libro${unread.length > 1 ? 's' : ''} sin empezar. ¿Qué tal ` },
        { t: pick.title, b: true },
        { t: '?' },
      ],
      action: { label: 'Empezar', icon: 'menu_book', book: pick, kind: 'open' },
    })
  }
  if (finished.length) {
    list.push({
      mood: 'happy',
      parts: [{ t: '¡Ya terminaste ' }, { t: `${finished.length} libro${finished.length > 1 ? 's' : ''}`, b: true }, { t: '! Estoy orgulloso 🦉✨' }],
    })
  }
  return [...list, ...TIPS]
})

const index = ref(0)
const override = ref<Message | null>(null)
const mood = ref<OwlMood>('idle')
const current = computed(() => override.value ?? messages.value[index.value % messages.value.length])

// Efecto máquina de escribir
const shown = ref(0)
const totalChars = computed(() => current.value.parts.reduce((n, p) => n + p.t.length, 0))
const visibleParts = computed(() => {
  let left = shown.value
  return current.value.parts.map((p) => {
    const t = p.t.slice(0, Math.max(0, left))
    left -= p.t.length
    return { ...p, t }
  })
})
let typer: ReturnType<typeof setInterval> | undefined
let rotator: ReturnType<typeof setInterval> | undefined
let moodTimer: ReturnType<typeof setTimeout> | undefined

function typeOut() {
  clearInterval(typer)
  shown.value = 0
  mood.value = current.value.mood
  typer = setInterval(() => {
    shown.value += 2
    if (shown.value >= totalChars.value) clearInterval(typer)
  }, 22)
}

function next() {
  override.value = null
  index.value = (index.value + 1) % messages.value.length
  restartRotation()
}

function onOwlTap() {
  next()
  mood.value = 'excited'
  clearTimeout(moodTimer)
  moodTimer = setTimeout(() => (mood.value = current.value.mood), 1400)
}

function restartRotation() {
  clearInterval(rotator)
  rotator = setInterval(() => {
    if (!override.value) index.value = (index.value + 1) % messages.value.length
  }, 14000)
}

/** Permite al padre hacer que Lumi reaccione a eventos (p. ej. un libro nuevo). */
function say(msg: Message, ms = 6000) {
  override.value = msg
  clearTimeout(moodTimer)
  moodTimer = setTimeout(() => {
    override.value = null
  }, ms)
}

function runAction() {
  const a = current.value.action
  if (!a) return
  if (a.kind === 'import') emit('import')
  else if (a.book) emit('open', a.book)
}

watch(current, typeOut)
onMounted(() => {
  typeOut()
  restartRotation()
})
onBeforeUnmount(() => {
  clearInterval(typer)
  clearInterval(rotator)
  clearTimeout(moodTimer)
})

defineExpose({ say })
</script>

<template>
  <div class="buddy">
    <LumiOwl
      :mood="mood"
      :outfit="outfit"
      :size="$q.screen.lt.sm ? 84 : 110"
      class="buddy__owl"
      @click="onOwlTap"
    />
    <transition name="bubble" mode="out-in">
      <div :key="current.parts.map((p) => p.t).join('')" class="bubble">
        <p class="bubble__text">
          <template v-for="(p, i) in visibleParts" :key="i">
            <strong v-if="p.b">{{ p.t }}</strong>
            <template v-else>{{ p.t }}</template>
          </template>
          <span v-if="shown < totalChars" class="caret">▍</span>
        </p>
        <div class="row items-center q-gutter-sm">
          <q-btn
            v-if="current.action"
            unelevated
            rounded
            dense
            no-caps
            color="accent"
            class="q-px-md"
            :icon="current.action.icon"
            :label="current.action.label"
            @click="runAction"
          />
          <q-space />
          <q-btn flat round dense size="sm" icon="navigate_next" color="grey-7" @click="next">
            <q-tooltip>Otro mensaje</q-tooltip>
          </q-btn>
        </div>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.buddy {
  display: flex;
  align-items: flex-end;
  gap: 10px;
}
.buddy__owl {
  flex-shrink: 0;
}
.bubble {
  position: relative;
  flex: 1;
  background: var(--card);
  color: var(--ink);
  border-radius: 18px;
  padding: 12px 14px 8px;
  box-shadow: var(--shadow);
  margin-bottom: 28px;
  min-height: 84px;
}
.bubble::before {
  content: '';
  position: absolute;
  left: -9px;
  bottom: 18px;
  border-width: 9px 10px 9px 0;
  border-style: solid;
  border-color: transparent var(--card) transparent transparent;
}
.bubble__text {
  margin: 0 0 6px;
  font-size: 0.95rem;
  line-height: 1.35;
}
.caret {
  animation: caret 0.8s steps(1) infinite;
  color: var(--accent);
}
.bubble-enter-active,
.bubble-leave-active {
  transition:
    opacity 0.2s,
    transform 0.2s;
}
.bubble-enter-from {
  opacity: 0;
  transform: translateY(8px) scale(0.97);
}
.bubble-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
@keyframes caret {
  50% {
    opacity: 0;
  }
}
</style>
