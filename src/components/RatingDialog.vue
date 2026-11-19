<script setup lang="ts">
import { ref } from 'vue'
import { useDialogPluginComponent } from 'quasar'
import type { Book } from '@/db'
import { FINISHED_THRESHOLD } from '@/services/stats'

/** ¿Qué te pareció? Estrellas y una reseña corta (opcional). */
const props = defineProps<{ book: Book }>()
defineEmits([...useDialogPluginComponent.emits])
const { dialogRef, onDialogHide, onDialogOK, onDialogCancel } = useDialogPluginComponent()

const rating = ref(props.book.rating ?? 0)
const review = ref(props.book.review ?? '')
const LABELS = ['', 'No me gustó', 'Regular', 'Estuvo bien', 'Me gustó mucho', '¡Me encantó!']

function save() {
  onDialogOK({ rating: rating.value || undefined, review: review.value.trim() || undefined })
}
</script>

<template>
  <q-dialog ref="dialogRef" @hide="onDialogHide">
    <q-card class="rate-card">
      <q-card-section class="row no-wrap items-center q-gutter-md">
        <img v-if="book.cover" :src="book.cover" class="rate-cover" :alt="book.title" />
        <div class="col">
          <div class="text-overline">{{ book.rating ? 'Tu valoración' : book.progress >= FINISHED_THRESHOLD ? '¡Terminado! 🎉' : 'Valorar' }}</div>
          <div class="text-h6 font-display rate-title">{{ book.title }}</div>
          <div class="text-caption">{{ book.author }}</div>
        </div>
      </q-card-section>
      <q-card-section class="text-center q-pt-none">
        <div class="q-mb-xs">¿Qué te pareció?</div>
        <q-rating v-model="rating" :max="5" size="2.4em" color="accent" icon="star_border" icon-selected="star" />
        <div class="text-caption rate-label">{{ LABELS[rating] }}</div>
        <q-input
          v-model="review"
          type="textarea"
          autogrow
          outlined
          maxlength="400"
          class="q-mt-md"
          placeholder="Una frase sobre el libro (opcional)"
        />
      </q-card-section>
      <q-card-actions align="right">
        <q-btn flat no-caps label="Ahora no" @click="onDialogCancel" />
        <q-btn unelevated rounded no-caps color="accent" label="Guardar" :disable="!rating" @click="save" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<style scoped>
.rate-card {
  width: 400px;
  max-width: 94vw;
}
.rate-cover {
  width: 64px;
  aspect-ratio: 2 / 3;
  object-fit: cover;
  border-radius: 3px 6px 6px 3px;
  box-shadow: 0 6px 14px -4px rgba(0, 0, 0, 0.45);
}
.rate-title {
  line-height: 1.2;
}
.rate-label {
  min-height: 1.2em;
  color: var(--accent);
  font-weight: 600;
}
</style>
