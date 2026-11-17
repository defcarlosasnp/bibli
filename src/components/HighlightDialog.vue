<script setup lang="ts">
import { ref } from 'vue'
import { useDialogPluginComponent } from 'quasar'
import type { HighlightColor } from '@/db'
import { HIGHLIGHT_COLORS } from '@/services/highlights'

const props = defineProps<{
  text: string
  note?: string
  color?: HighlightColor
  /** Subrayado que ya existe: muestra el botón de borrar. */
  existing?: boolean
}>()

defineEmits([...useDialogPluginComponent.emits])
const { dialogRef, onDialogHide, onDialogOK, onDialogCancel } = useDialogPluginComponent()

const note = ref(props.note ?? '')
const color = ref<HighlightColor>(props.color ?? 'yellow')

function save() {
  onDialogOK({ note: note.value.trim(), color: color.value })
}

function remove() {
  onDialogOK({ remove: true })
}
</script>

<template>
  <q-dialog ref="dialogRef" @hide="onDialogHide">
    <q-card class="highlight-dialog">
      <q-card-section>
        <blockquote class="quote font-display" :style="{ borderColor: HIGHLIGHT_COLORS[color].solid }">
          {{ text }}
        </blockquote>
        <div class="row items-center q-gutter-sm q-mt-md">
          <span class="text-caption text-grey-7">Color</span>
          <button
            v-for="(c, name) in HIGHLIGHT_COLORS"
            :key="name"
            class="dot"
            :class="{ 'dot--active': color === name }"
            :style="{ background: c.solid }"
            :aria-label="c.label"
            @click="color = name"
          />
        </div>
        <q-input
          v-model="note"
          type="textarea"
          autogrow
          outlined
          label="Tu nota (opcional)"
          class="q-mt-md"
          :input-style="{ minHeight: '70px' }"
          autofocus
        />
      </q-card-section>
      <q-card-actions align="right">
        <q-btn v-if="existing" flat color="negative" icon="delete" label="Borrar" class="q-mr-auto" @click="remove" />
        <q-btn flat label="Cancelar" @click="onDialogCancel" />
        <q-btn unelevated color="primary" label="Guardar" @click="save" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<style scoped>
.highlight-dialog {
  width: min(480px, 92vw);
}
.quote {
  margin: 0;
  padding: 4px 0 4px 12px;
  border-left: 4px solid;
  font-size: 1.05rem;
  line-height: 1.4;
  max-height: 30vh;
  overflow: auto;
}
.dot {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 2px solid rgba(0, 0, 0, 0.12);
  cursor: pointer;
  padding: 0;
}
.dot--active {
  outline: 3px solid var(--q-primary);
  outline-offset: 2px;
}
</style>
