<script setup lang="ts">
import { ref } from 'vue'
import { useDialogPluginComponent } from 'quasar'
import type { Book } from '@/db'

/** Elegir en qué estanterías está un libro, o crear una nueva. */
const props = defineProps<{ book: Book; allTags: string[] }>()
defineEmits([...useDialogPluginComponent.emits])

const { dialogRef, onDialogHide, onDialogOK, onDialogCancel } = useDialogPluginComponent()

const shelves = ref([...props.allTags])
const chosen = ref(new Set(props.book.tags))
const newName = ref('')

function toggle(name: string) {
  if (chosen.value.has(name)) chosen.value.delete(name)
  else chosen.value.add(name)
}

function addShelf() {
  const name = newName.value.trim()
  if (!name) return
  const existing = shelves.value.find((s) => s.localeCompare(name, 'es', { sensitivity: 'base' }) === 0)
  if (!existing) shelves.value.push(name)
  chosen.value.add(existing ?? name)
  newName.value = ''
}

function save() {
  addShelf()
  onDialogOK([...chosen.value])
}
</script>

<template>
  <q-dialog ref="dialogRef" @hide="onDialogHide">
    <q-card style="width: 380px; max-width: 92vw">
      <q-card-section class="q-pb-none">
        <div class="text-h6">Estanterías</div>
        <div class="text-caption ellipsis">{{ book.title }}</div>
      </q-card-section>
      <q-list v-if="shelves.length" class="q-mt-sm">
        <q-item v-for="s in shelves" :key="s" tag="label" clickable dense @click.prevent="toggle(s)">
          <q-item-section avatar>
            <q-checkbox :model-value="chosen.has(s)" color="accent" class="no-pointer-events" />
          </q-item-section>
          <q-item-section>{{ s }}</q-item-section>
        </q-item>
      </q-list>
      <q-card-section>
        <q-input
          v-model="newName"
          dense
          outlined
          :placeholder="shelves.length ? 'Nueva estantería' : 'Nombre, p. ej. Pendientes o Sanderson'"
          @keyup.enter="addShelf"
        >
          <template #prepend><q-icon name="add" /></template>
          <template v-if="newName.trim()" #append>
            <q-btn flat dense no-caps color="accent" label="Crear" @click="addShelf" />
          </template>
        </q-input>
      </q-card-section>
      <q-card-actions align="right">
        <q-btn flat label="Cancelar" @click="onDialogCancel" />
        <q-btn unelevated color="accent" label="Guardar" @click="save" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>
