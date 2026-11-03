<script setup lang="ts">
import type { Outfit } from '@/services/lumi'

export type OwlMood = 'idle' | 'happy' | 'excited' | 'sleepy' | 'listening'

withDefaults(defineProps<{ mood?: OwlMood; size?: number; outfit?: Outfit }>(), {
  mood: 'idle',
  size: 120,
  outfit: () => ({}),
})
</script>

<template>
  <div class="owl" :class="`owl--${mood}`" :style="{ width: `${size}px`, height: `${size * 1.1}px` }">
    <svg viewBox="0 0 120 132" xmlns="http://www.w3.org/2000/svg" aria-label="Lumi, tu búho lector">
      <!-- sombra -->
      <ellipse class="shadow" cx="60" cy="127" rx="30" ry="4" fill="rgba(0,0,0,.15)" />

      <g class="body-group">
        <!-- orejas -->
        <path d="M26 34 L22 10 L42 26 Z" fill="#a8693a" />
        <path d="M94 34 L98 10 L78 26 Z" fill="#a8693a" />

        <!-- alas -->
        <g class="wing wing--left">
          <ellipse cx="22" cy="82" rx="13" ry="26" fill="#a8693a" />
        </g>
        <g class="wing wing--right">
          <ellipse cx="98" cy="82" rx="13" ry="26" fill="#a8693a" />
        </g>

        <!-- cuerpo -->
        <ellipse cx="60" cy="74" rx="42" ry="48" fill="#c98a4b" />
        <ellipse cx="60" cy="92" rx="27" ry="28" fill="#f3d9b1" />
        <path
          d="M48 86 q4 4 8 0 M64 86 q4 4 8 0 M54 98 q4 4 8 0 M44 98 q2 3 4 1 M70 98 q2 3 4 1"
          stroke="#d9b98c"
          stroke-width="2"
          fill="none"
          stroke-linecap="round"
        />

        <!-- disco facial -->
        <circle cx="43" cy="56" r="19" fill="#fbeedb" />
        <circle cx="77" cy="56" r="19" fill="#fbeedb" />

        <!-- ojos -->
        <g v-if="mood === 'happy' || mood === 'listening'" stroke="#3b2a20" stroke-width="4" fill="none" stroke-linecap="round">
          <path d="M34 58 q9 -10 18 0" />
          <path d="M68 58 q9 -10 18 0" />
        </g>
        <g v-else-if="mood === 'sleepy'" stroke="#3b2a20" stroke-width="3.5" fill="none" stroke-linecap="round">
          <path d="M35 57 q8 6 16 0" />
          <path d="M69 57 q8 6 16 0" />
        </g>
        <g v-else class="eyes">
          <circle cx="43" cy="56" r="10" fill="#3b2a20" />
          <circle cx="77" cy="56" r="10" fill="#3b2a20" />
          <circle cx="46" cy="52" r="3.5" fill="#fff" />
          <circle cx="80" cy="52" r="3.5" fill="#fff" />
          <circle cx="40" cy="60" r="1.6" fill="#fff" opacity=".7" />
          <circle cx="74" cy="60" r="1.6" fill="#fff" opacity=".7" />
        </g>

        <!-- mejillas -->
        <ellipse cx="30" cy="70" rx="5" ry="3" fill="#f2998a" opacity=".55" />
        <ellipse cx="90" cy="70" rx="5" ry="3" fill="#f2998a" opacity=".55" />

        <!-- pico -->
        <path d="M55 66 L65 66 L60 75 Z" fill="#f29e38" />

        <!-- libro -->
        <g class="book">
          <path d="M36 104 L60 100 L60 120 L36 124 Z" fill="#e2654a" />
          <path d="M84 104 L60 100 L60 120 L84 124 Z" fill="#c94f37" />
          <path d="M39 106 L58 103 M39 110 L58 107 M39 114 L58 111" stroke="#fbeedb" stroke-width="1.4" />
          <path d="M60 100 L60 120" stroke="#8a3524" stroke-width="1.5" />
        </g>

        <!-- patas -->
        <ellipse cx="48" cy="122" rx="7" ry="3.5" fill="#f29e38" />
        <ellipse cx="72" cy="122" rx="7" ry="3.5" fill="#f29e38" />

        <!-- gafas -->
        <g v-if="outfit.glasses === 'sun'" class="glasses">
          <path d="M27 54 L20 50 M93 54 L100 50" stroke="#1d1d2b" stroke-width="2.5" stroke-linecap="round" />
          <rect x="27" y="46" width="32" height="20" rx="9" fill="#1d1d2b" />
          <rect x="61" y="46" width="32" height="20" rx="9" fill="#1d1d2b" />
          <path d="M58 52 q2 -2 4 0" stroke="#1d1d2b" stroke-width="3" fill="none" />
          <path d="M33 50 l8 0 M67 50 l8 0" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".55" />
        </g>
        <g v-else-if="outfit.glasses === 'reading'" class="glasses" fill="rgba(255,255,255,.18)" stroke="#6e4529" stroke-width="3">
          <circle cx="43" cy="56" r="13" />
          <circle cx="77" cy="56" r="13" />
          <path d="M56 54 q4 -3 8 0" fill="none" />
          <path d="M30 54 L22 50 M90 54 L98 50" stroke-linecap="round" />
        </g>

        <!-- auriculares (antes que los gorros, para que el gorro tape la diadema) -->
        <g v-if="outfit.headphones" class="headphones">
          <path d="M18 58 C16 12 104 12 102 58" stroke="#4f9d7e" stroke-width="6" fill="none" stroke-linecap="round" />
          <rect x="8" y="46" width="18" height="26" rx="8" fill="#e2654a" />
          <rect x="94" y="46" width="18" height="26" rx="8" fill="#e2654a" />
          <rect x="12" y="51" width="6" height="16" rx="3" fill="#f29e38" />
          <rect x="102" y="51" width="6" height="16" rx="3" fill="#f29e38" />
        </g>

        <!-- gorros -->
        <g v-if="outfit.hat === 'nightcap' || outfit.hat === 'santa'" class="hat">
          <path
            d="M34 28 C36 6 66 -2 84 6 C98 12 106 24 110 38 C100 28 92 24 86 28 Z"
            :fill="outfit.hat === 'santa' ? '#d64545' : '#5b7bd5'"
          />
          <template v-if="outfit.hat === 'nightcap'">
            <circle cx="56" cy="14" r="1.8" fill="#ffd166" />
            <circle cx="72" cy="10" r="1.4" fill="#ffd166" />
            <circle cx="88" cy="18" r="1.6" fill="#ffd166" />
          </template>
          <rect x="30" y="23" width="60" height="10" rx="5" fill="#f7f3ea" />
          <circle class="pompom" cx="110" cy="40" r="6" fill="#f7f3ea" />
        </g>
        <g v-else-if="outfit.hat === 'party'" class="hat" transform="rotate(10 60 28)">
          <path d="M44 28 L60 -14 L76 28 Z" fill="#f29e38" />
          <path d="M50 12 L70 12 M47 21 L73 21 M54 2 L66 2" stroke="#e2654a" stroke-width="3.5" />
          <circle class="pompom" cx="60" cy="-15" r="5" fill="#4f9d7e" />
        </g>
        <g v-else-if="outfit.hat === 'witch'" class="hat">
          <ellipse cx="60" cy="27" rx="36" ry="6" fill="#3d2458" />
          <path d="M42 27 L56 -12 Q60 -20 66 -12 L76 6 L70 6 L78 27 Z" fill="#5d3a85" />
          <rect x="45" y="18" width="31" height="5" fill="#f29e38" />
        </g>
      </g>

      <g v-if="mood === 'sleepy'" class="zzz" fill="#7a6555" font-family="Fraunces Variable, serif" font-weight="700">
        <text x="98" y="30" font-size="14">z</text>
        <text x="106" y="18" font-size="10">z</text>
      </g>
      <g v-if="mood === 'listening'" class="notes" fill="#4f9d7e" font-weight="700">
        <text x="100" y="34" font-size="16">♪</text>
        <text x="6" y="40" font-size="14">♫</text>
        <text x="108" y="20" font-size="11">♪</text>
      </g>
      <g v-if="mood === 'excited'" class="sparkles" fill="#f29e38">
        <path d="M10 30 l3 -8 l3 8 l8 3 l-8 3 l-3 8 l-3 -8 l-8 -3 Z" />
        <path d="M104 44 l2 -5 l2 5 l5 2 l-5 2 l-2 5 l-2 -5 l-5 -2 Z" />
      </g>
    </svg>
  </div>
</template>

<style scoped>
.owl {
  display: inline-block;
  cursor: pointer;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}
svg {
  width: 100%;
  height: 100%;
  overflow: visible;
}
.body-group {
  transform-origin: 60px 120px;
  animation: float 3.2s ease-in-out infinite;
}
.shadow {
  transform-origin: 60px 127px;
  animation: shadow 3.2s ease-in-out infinite;
}
.eyes {
  transform-origin: 60px 56px;
  animation: blink 4.5s infinite;
}
.hat {
  transform-origin: 60px 28px;
  animation: hat-sway 3.2s ease-in-out infinite;
}
.pompom {
  transform-box: fill-box;
  transform-origin: center;
  animation: pompom 1.6s ease-in-out infinite;
}
.wing--left {
  transform-origin: 28px 64px;
}
.wing--right {
  transform-origin: 92px 64px;
}

.owl--excited .body-group {
  animation: hop 0.6s ease-in-out infinite;
}
.owl--excited .wing--left {
  animation: flap-left 0.3s ease-in-out infinite alternate;
}
.owl--excited .wing--right {
  animation: flap-right 0.3s ease-in-out infinite alternate;
}
.owl--happy .body-group {
  animation: wiggle 1.4s ease-in-out infinite;
}
.owl--sleepy .body-group {
  animation: breathe 4s ease-in-out infinite;
}
.owl--listening .body-group {
  animation: groove 1.2s ease-in-out infinite;
}
.owl--listening .headphones {
  transform-origin: 60px 40px;
  animation: pompom 0.6s ease-in-out infinite;
}
.notes text {
  animation: note 2.4s ease-out infinite;
}
.notes text:nth-child(2) {
  animation-delay: 0.8s;
}
.notes text:nth-child(3) {
  animation-delay: 1.6s;
}
.zzz text {
  animation: zzz 2.4s ease-in-out infinite;
}
.zzz text:nth-child(2) {
  animation-delay: 0.6s;
}
.sparkles path {
  transform-box: fill-box;
  transform-origin: center;
  animation: twinkle 0.8s ease-in-out infinite alternate;
}
.sparkles path:nth-child(2) {
  animation-delay: 0.4s;
}

@keyframes hat-sway {
  0%,
  100% {
    rotate: 0deg;
  }
  50% {
    rotate: -4deg;
  }
}
@keyframes pompom {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(2px) scale(1.08);
  }
}
@keyframes float {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-5px);
  }
}
@keyframes shadow {
  0%,
  100% {
    transform: scaleX(1);
    opacity: 1;
  }
  50% {
    transform: scaleX(0.85);
    opacity: 0.7;
  }
}
@keyframes blink {
  0%,
  92%,
  100% {
    transform: scaleY(1);
  }
  95% {
    transform: scaleY(0.1);
  }
}
@keyframes hop {
  0%,
  100% {
    transform: translateY(0) scale(1, 1);
  }
  30% {
    transform: translateY(0) scale(1.06, 0.94);
  }
  60% {
    transform: translateY(-14px) scale(0.96, 1.04);
  }
}
@keyframes flap-left {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(28deg);
  }
}
@keyframes flap-right {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(-28deg);
  }
}
@keyframes wiggle {
  0%,
  100% {
    transform: rotate(0deg);
  }
  25% {
    transform: rotate(-5deg);
  }
  75% {
    transform: rotate(5deg);
  }
}
@keyframes breathe {
  0%,
  100% {
    transform: scale(1, 1);
  }
  50% {
    transform: scale(1.03, 0.98);
  }
}
@keyframes groove {
  0%,
  100% {
    transform: rotate(-4deg) translateY(0);
  }
  25% {
    transform: rotate(0deg) translateY(-3px);
  }
  50% {
    transform: rotate(4deg) translateY(0);
  }
  75% {
    transform: rotate(0deg) translateY(-3px);
  }
}
@keyframes note {
  0% {
    opacity: 0;
    transform: translate(0, 6px) rotate(-10deg);
  }
  30% {
    opacity: 1;
  }
  100% {
    opacity: 0;
    transform: translate(8px, -18px) rotate(12deg);
  }
}
@keyframes zzz {
  0% {
    opacity: 0;
    transform: translate(0, 4px);
  }
  50% {
    opacity: 1;
  }
  100% {
    opacity: 0;
    transform: translate(6px, -10px);
  }
}
@keyframes twinkle {
  from {
    transform: scale(0.6) rotate(0deg);
    opacity: 0.5;
  }
  to {
    transform: scale(1.1) rotate(20deg);
    opacity: 1;
  }
}
</style>
