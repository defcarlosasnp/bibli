<script setup lang="ts">
import type { Book } from '@/db'

defineProps<{ book: Book }>()
const emit = defineEmits<{ open: []; edit: []; remove: [] }>()
</script>

<template>
  <q-item clickable class="q-py-sm" @click="emit('open')">
    <q-item-section avatar>
      <div class="thumb shadow-2">
        <img v-if="book.cover" :src="book.cover" :alt="book.title" loading="lazy" />
        <q-icon v-else name="menu_book" size="28px" color="grey-6" />
      </div>
    </q-item-section>
    <q-item-section>
      <q-item-label class="text-weight-medium" lines="2">{{ book.title }}</q-item-label>
      <q-item-label caption>{{ book.author || 'Autor desconocido' }}</q-item-label>
      <div class="row items-center q-gutter-xs q-mt-xs">
        <q-badge :color="book.format === 'pdf' ? 'red-7' : 'teal-7'">{{ book.format.toUpperCase() }}</q-badge>
        <q-chip v-for="tag in book.tags" :key="tag" dense size="sm" icon="label" class="q-my-none">{{ tag }}</q-chip>
      </div>
      <q-linear-progress v-if="book.progress > 0" :value="book.progress" color="amber" class="q-mt-sm" />
    </q-item-section>
    <q-item-section side top>
      <span v-if="book.progress > 0" class="text-caption">{{ Math.round(book.progress * 100) }}%</span>
      <q-btn round dense flat icon="more_vert" @click.stop>
        <q-menu auto-close>
          <q-list dense style="min-width: 140px">
            <q-item clickable @click="emit('edit')">
              <q-item-section avatar><q-icon name="edit" /></q-item-section>
              <q-item-section>Editar</q-item-section>
            </q-item>
            <q-item clickable @click="emit('remove')">
              <q-item-section avatar><q-icon name="delete" color="negative" /></q-item-section>
              <q-item-section>Eliminar</q-item-section>
            </q-item>
          </q-list>
        </q-menu>
      </q-btn>
    </q-item-section>
  </q-item>
</template>

<style scoped>
.thumb {
  width: 48px;
  aspect-ratio: 2 / 3;
  border-radius: 3px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(128, 128, 128, 0.15);
}
.thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
</style>
