<script setup lang="ts">
import { computed, type UnwrapNestedRefs } from 'vue'
import { RATES, type ReadAloud, type SleepMode } from '@/composables/useReadAloud'
import { QUALITY_LABEL, openVoiceInstaller, voiceHelp } from '@/services/speech'

const props = defineProps<{
  ra: UnwrapNestedRefs<ReadAloud>
  /** Lo que se lee de una vez: "esta página" (PDF) o "este capítulo" (EPUB). */
  chunkName: string
}>()

const SLEEP_OPTIONS: { label: string; value: SleepMode }[] = [
  { label: 'Desactivado', value: null },
  { label: '5 minutos', value: 5 },
  { label: '15 minutos', value: 15 },
  { label: '30 minutos', value: 30 },
  { label: '45 minutos', value: 45 },
  { label: '1 hora', value: 60 },
]

const sleepOptions = computed(() => [...SLEEP_OPTIONS, { label: `Al acabar ${props.chunkName}`, value: 'chunk' as const }])

const help = voiceHelp()
const hasGoodVoice = computed(() => props.ra.voices.some((v) => v.quality === 'natural' || v.quality === 'good'))

function rateLabel(r: number) {
  return `${r.toLocaleString('es', { maximumFractionDigits: 2 })}×`
}
</script>

<template>
  <div class="tts-bar">
    <transition name="line" mode="out-in">
      <div :key="ra.sentence" class="tts-line">{{ ra.sentence || 'Preparando la voz…' }}</div>
    </transition>

    <div class="row items-center no-wrap q-gutter-x-xs">
      <q-btn flat round dense icon="record_voice_over" aria-label="Voz">
        <q-tooltip>Voz</q-tooltip>
        <q-menu anchor="top left" self="bottom left" max-height="70vh" @before-show="ra.refreshVoices()">
          <q-list dense class="voice-list">
            <q-item-label header>Voz</q-item-label>
            <q-item v-close-popup clickable :active="ra.voiceId == null" @click="ra.setVoice(null)">
              <q-item-section avatar><q-icon name="auto_awesome" color="accent" /></q-item-section>
              <q-item-section>
                <q-item-label>Automática</q-item-label>
                <q-item-label caption>
                  La mejor disponible{{ ra.voiceId == null && ra.currentVoice ? `: ${ra.currentVoice.label}` : '' }}
                </q-item-label>
              </q-item-section>
            </q-item>
            <q-item
              v-for="v in ra.voices"
              :key="v.id"
              v-close-popup
              clickable
              :active="ra.voiceId === v.id"
              @click="ra.setVoice(v.id)"
            >
              <q-item-section avatar>
                <q-btn
                  flat
                  round
                  dense
                  icon="play_circle"
                  color="secondary"
                  :aria-label="`Escuchar a ${v.label}`"
                  @click.stop="ra.preview(v.id)"
                >
                  <q-tooltip>Escuchar una muestra</q-tooltip>
                </q-btn>
              </q-item-section>
              <q-item-section>
                <q-item-label>
                  {{ v.label }}
                  <span class="quality" :class="`quality--${v.quality}`">{{ QUALITY_LABEL[v.quality] }}</span>
                </q-item-label>
                <q-item-label caption>{{ v.detail }}</q-item-label>
              </q-item-section>
            </q-item>

            <q-separator class="q-my-xs" />
            <q-expansion-item
              dense
              icon="tips_and_updates"
              label="¿Cómo consigo una voz más natural?"
              header-class="text-accent"
              :default-opened="!hasGoodVoice"
            >
              <div class="help q-px-md q-pb-sm">
                <p v-if="!hasGoodVoice" class="q-mb-xs">Ahora solo tienes voces básicas. Las mejores son gratis:</p>
                <div class="text-weight-bold q-mb-xs">{{ help.title }}</div>
                <ol class="q-pl-md q-my-none">
                  <li v-for="step in help.steps" :key="step">{{ step }}</li>
                </ol>
                <div class="row q-gutter-sm q-mt-sm">
                  <q-btn
                    v-if="help.canOpenInstaller"
                    unelevated
                    dense
                    no-caps
                    color="accent"
                    icon="download"
                    label="Descargar voces"
                    @click="openVoiceInstaller()"
                  />
                  <q-btn flat dense no-caps color="secondary" icon="refresh" label="Actualizar lista" @click="ra.refreshVoices()" />
                </div>
              </div>
            </q-expansion-item>
          </q-list>
        </q-menu>
      </q-btn>

      <q-btn flat round dense :icon="ra.sleepMode != null ? 'bedtime' : 'bedtime_off'" aria-label="Temporizador para dormir">
        <q-badge v-if="ra.sleepLeft" floating color="accent" class="sleep-badge">{{ ra.sleepLeft }}</q-badge>
        <q-badge v-else-if="ra.sleepMode === 'chunk'" floating color="accent" class="sleep-badge">fin</q-badge>
        <q-tooltip>Temporizador para dormir</q-tooltip>
        <q-menu anchor="top left" self="bottom left">
          <q-list dense style="min-width: 200px">
            <q-item-label header>Parar de leer…</q-item-label>
            <q-item
              v-for="o in sleepOptions"
              :key="String(o.value)"
              v-close-popup
              clickable
              :active="ra.sleepMode === o.value"
              @click="ra.setSleep(o.value)"
            >
              <q-item-section>{{ o.label }}</q-item-section>
            </q-item>
          </q-list>
        </q-menu>
      </q-btn>

      <q-space />
      <q-btn flat round icon="replay" aria-label="Frase anterior" @click="ra.skip(-1)">
        <q-tooltip>Frase anterior</q-tooltip>
      </q-btn>
      <q-btn
        round
        unelevated
        color="accent"
        size="md"
        class="play-btn"
        :class="{ 'play-btn--playing': ra.playing }"
        :icon="ra.playing ? 'pause' : 'play_arrow'"
        :aria-label="ra.playing ? 'Pausar' : 'Reproducir'"
        @click="ra.toggle()"
      />
      <q-btn flat round icon="forward" aria-label="Frase siguiente" @click="ra.skip(1)">
        <q-tooltip>Frase siguiente</q-tooltip>
      </q-btn>
      <q-space />

      <q-btn flat dense no-caps class="rate-btn" :label="rateLabel(ra.rate)" aria-label="Velocidad">
        <q-tooltip>Velocidad</q-tooltip>
        <q-menu anchor="top right" self="bottom right">
          <q-list dense style="min-width: 120px">
            <q-item-label header>Velocidad</q-item-label>
            <q-item v-for="r in RATES" :key="r" v-close-popup clickable :active="ra.rate === r" @click="ra.setRate(r)">
              <q-item-section>{{ rateLabel(r) }}</q-item-section>
            </q-item>
          </q-list>
        </q-menu>
      </q-btn>
      <q-btn flat round dense icon="close" aria-label="Dejar de escuchar" @click="ra.close()">
        <q-tooltip>Dejar de escuchar</q-tooltip>
      </q-btn>
    </div>
  </div>
</template>

<style scoped>
.tts-bar {
  padding: 8px 10px 2px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
}
.tts-line {
  font-family: var(--font-display);
  font-style: italic;
  font-size: 0.95rem;
  line-height: 1.3;
  min-height: 2.6em;
  padding: 0 6px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-align: center;
}
.voice-list {
  width: min(340px, 90vw);
}
.quality {
  display: inline-block;
  margin-left: 4px;
  padding: 0 6px;
  border-radius: 8px;
  font-size: 0.7rem;
  font-weight: 700;
  vertical-align: middle;
}
.quality--natural {
  background: rgba(242, 158, 56, 0.2);
  color: #b86b12;
}
.quality--good {
  background: rgba(79, 157, 126, 0.18);
  color: #2f7a5c;
}
.quality--standard {
  background: rgba(128, 128, 128, 0.15);
  color: #777;
}
.quality--robotic {
  background: rgba(217, 83, 79, 0.15);
  color: #b2403c;
}
.help {
  font-size: 0.85rem;
  line-height: 1.4;
}
.rate-btn {
  font-weight: 700;
  min-width: 48px;
}
.sleep-badge {
  font-size: 0.65rem;
  padding: 1px 4px;
  top: -2px;
  right: -10px;
}
.play-btn--playing {
  animation: pulse 2s ease-in-out infinite;
}
@keyframes pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(242, 158, 56, 0.55);
  }
  50% {
    box-shadow: 0 0 0 10px rgba(242, 158, 56, 0);
  }
}
.line-enter-active,
.line-leave-active {
  transition:
    opacity 0.2s,
    transform 0.2s;
}
.line-enter-from {
  opacity: 0;
  transform: translateY(6px);
}
.line-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>
