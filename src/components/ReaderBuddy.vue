<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import LumiOwl, { type OwlMood } from './LumiOwl.vue'
import { outfitFor } from '@/services/lumi'

const props = withDefaults(
  defineProps<{
    /** La app está leyendo en voz alta: Lumi se pone los auriculares. */
    listening?: boolean
    /** Alto de la barra inferior, para colocarse justo encima. */
    bottom?: number
  }>(),
  { listening: false, bottom: 0 },
)

// En el lector Lumi se pone sus gafas de leer (y conserva el gorro si toca).
const baseOutfit = { ...outfitFor(), glasses: 'reading' as const }
const outfit = computed(() => ({ ...baseOutfit, headphones: props.listening }))

const talking = ref(false)
const text = ref('')
const mood = ref<OwlMood>('idle')
const shownMood = computed<OwlMood>(() => (!talking.value && props.listening ? 'listening' : mood.value))
let hideTimer: ReturnType<typeof setTimeout> | undefined

const TAP_LINES = ['¡Hola! Sigo aquí leyendo contigo 🦉', '¿Te está gustando? 📖', 'Shhh… estoy concentrado 🤓']
const LISTENING_TAP_LINES = [
  '🎶 ¡Me encanta esta parte!',
  '¿Muy lento? Toca el 1× para cambiar la velocidad ⏩',
  'Cierra los ojos, yo te aviso si pasa algo emocionante 🎧',
  '¿Te vas a dormir? Pon el temporizador 🌙',
]

function say(message: string, m: OwlMood = 'happy', ms = 5000) {
  text.value = message
  mood.value = m
  talking.value = true
  clearTimeout(hideTimer)
  hideTimer = setTimeout(hide, ms)
}

function hide() {
  talking.value = false
  mood.value = 'idle'
}

function onTap() {
  if (talking.value) return hide()
  const lines = props.listening ? LISTENING_TAP_LINES : TAP_LINES
  say(lines[Math.floor(Math.random() * lines.length)], 'happy', 3000)
}

onBeforeUnmount(() => clearTimeout(hideTimer))

defineExpose({ say })
</script>

<template>
  <div
    class="reader-buddy"
    :class="{ 'reader-buddy--talking': talking }"
    :style="bottom ? { bottom: `${bottom}px` } : undefined"
  >
    <transition name="pop">
      <div v-if="talking" class="bubble" @click="hide">{{ text }}</div>
    </transition>
    <LumiOwl :size="72" :mood="shownMood" :outfit="outfit" class="owl" @click="onTap" />
  </div>
</template>

<style scoped>
.reader-buddy {
  position: fixed;
  right: calc(10px + env(safe-area-inset-right, 0px));
  bottom: calc(60px + var(--q-safe-area-inset-bottom, 0px));
  z-index: 2000;
  display: flex;
  align-items: flex-end;
  gap: 6px;
  pointer-events: none;
  /* Sentado sobre la barra inferior: si baja más, tapa el botón de página siguiente */
  transform: translateY(6px);
  transition:
    transform 0.45s cubic-bezier(0.3, 1.5, 0.5, 1),
    bottom 0.3s ease;
}
.reader-buddy--talking {
  transform: translateY(0);
}
.owl {
  pointer-events: auto;
  filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.25));
}
.bubble {
  pointer-events: auto;
  max-width: min(260px, 64vw);
  margin-bottom: 40px;
  padding: 10px 14px;
  border-radius: 16px 16px 4px 16px;
  background: var(--card);
  color: var(--ink);
  box-shadow: var(--shadow);
  font-size: 0.9rem;
  line-height: 1.3;
}
.pop-enter-active {
  transition:
    opacity 0.25s,
    transform 0.35s cubic-bezier(0.3, 1.6, 0.5, 1);
}
.pop-leave-active {
  transition:
    opacity 0.2s,
    transform 0.2s;
}
.pop-enter-from,
.pop-leave-to {
  opacity: 0;
  transform: scale(0.6) translateY(10px);
  transform-origin: bottom right;
}
</style>
