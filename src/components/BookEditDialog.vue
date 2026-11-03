<script setup lang="ts">
import { ref } from 'vue'
import { useDialogPluginComponent } from 'quasar'
import type { Book } from '@/db'

const props = defineProps<{ book: Book; allTags: string[] }>()
defineEmits([...useDialogPluginComponent.emits])

const { dialogRef, onDialogHide, onDialogOK, onDialogCancel } = useDialogPluginComponent()

const title = ref(props.book.title)
const author = ref(props.book.author)
const tags = ref([...props.book.tags])
const tagOptions = ref(props.allTags)

function filterTags(val: string, update: (fn: () => void) => void) {
  update(() => {
    const q = val.toLocaleLowerCase('es')
    tagOptions.value = props.allTags.filter((t) => t.toLocaleLowerCase('es').includes(q))
  })
}

function save() {
  onDialogOK({
    title: title.value.trim() || props.book.title,
    author: author.value.trim(),
    tags: [...new Set(tags.value.map((t) => t.trim()).filter(Boolean))],
  })
}
</script>

<template>
  <q-dialog ref="dialogRef" @hide="onDialogHide">
    <q-card style="width: 420px; max-width: 92vw">
      <q-card-section class="text-h6">Editar libro</q-card-section>
      <q-card-section class="q-gutter-md">
        <q-input v-model="title" label="Título" outlined autofocus />
        <q-input v-model="author" label="Autor" outlined />
        <q-select
          v-model="tags"
          label="Colecciones"
          hint="Escribe y pulsa Enter para crear una nueva"
          outlined
          multiple
          use-chips
          use-input
          hide-dropdown-icon
          input-debounce="0"
          new-value-mode="add-unique"
          :options="tagOptions"
          @filter="filterTags"
        />
      </q-card-section>
      <q-card-actions align="right">
        <q-btn flat label="Cancelar" @click="onDialogCancel" />
        <q-btn unelevated color="amber-8" label="Guardar" @click="save" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>
