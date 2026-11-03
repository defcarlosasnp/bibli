<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import LumiOwl, { type OwlMood } from './LumiOwl.vue'
import { outfitFor } from '@/services/lumi'

// En el lector Lumi se pone sus gafas de leer (y conserva el gorro si toca).
const outfit = { ...outfitFor(), glasses: 'reading' as const }

const talking = ref(false)
const text = ref('')
const mood = ref<OwlMood>('idle')
let hideTimer: ReturnType<typeof setTimeout> | undefined

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
  if (talking.value) hide()
  else say(['¡Hola! Sigo aquí leyendo contigo 🦉', '¿Te está gustando? 📖', 'Shhh… estoy concentrado 🤓'][Math.floor(Math.random() * 3)], 'happy', 3000)
}

onBeforeUnmount(() => clearTimeout(hideTimer))

defineExpose({ say })
</script>

<template>
  <div class="reader-buddy" :class="{ 'reader-buddy--talking': talking }">
    <transition name="pop">
      <div v-if="talking" class="bubble" @click="hide">{{ text }}</div>
    </transition>
    <LumiOwl :size="72" :mood="mood" :outfit="outfit" class="owl" @click="onTap" />
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
  transform: translateY(46px);
  transition: transform 0.45s cubic-bezier(0.3, 1.5, 0.5, 1);
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
