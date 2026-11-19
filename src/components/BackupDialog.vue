<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useDialogPluginComponent, useQuasar } from 'quasar'
import { backupFileName, createBackup, libraryBytes, restoreBackup, saveBackup } from '@/services/backup'

defineEmits([...useDialogPluginComponent.emits])
const { dialogRef, onDialogHide, onDialogCancel } = useDialogPluginComponent()
const $q = useQuasar()

const withBooks = ref(true)
const booksMB = ref<number | null>(null)
const busy = ref<'create' | 'restore' | null>(null)
const progress = ref(0)
/** Copia ya generada, esperando a que el usuario toque "Guardar" (Safari exige un toque). */
const ready = ref<{ blob: Blob; name: string } | null>(null)
const fileInput = ref<HTMLInputElement>()

onMounted(async () => {
  booksMB.value = Math.max(1, Math.round((await libraryBytes()) / 1048576))
})

const mb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1048576))} MB`

async function create() {
  busy.value = 'create'
  progress.value = 0
  ready.value = null
  try {
    const blob = await createBackup(withBooks.value, (f) => (progress.value = f))
    ready.value = { blob, name: backupFileName(withBooks.value) }
  } catch (err) {
    console.error(err)
    $q.notify({ type: 'negative', message: 'No se pudo crear la copia. ¿Queda espacio en el aparato?' })
  } finally {
    busy.value = null
  }
}

async function save() {
  if (!ready.value) return
  try {
    await saveBackup(ready.value.blob, ready.value.name)
  } catch (err) {
    console.error(err)
    $q.notify({ type: 'negative', message: 'No se pudo guardar la copia' })
  }
}

async function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  busy.value = 'restore'
  progress.value = 0
  try {
    const r = await restoreBackup(file, (f) => (progress.value = f))
    const parts = []
    if (r.added) parts.push(`${r.added} libro${r.added === 1 ? '' : 's'} añadido${r.added === 1 ? '' : 's'}`)
    if (r.updated) parts.push(`${r.updated} actualizado${r.updated === 1 ? '' : 's'}`)
    if (r.highlights) parts.push(`${r.highlights} subrayado${r.highlights === 1 ? '' : 's'}`)
    $q.notify({
      type: 'positive',
      icon: 'cloud_done',
      message: parts.length ? `Copia recuperada: ${parts.join(', ')}` : 'Copia recuperada: ya tenías todo',
      timeout: 5000,
    })
    if (r.missing) {
      $q.notify({
        type: 'warning',
        message: `${r.missing} libro${r.missing === 1 ? ' no venía' : 's no venían'} en la copia (era solo de datos). Añádelos y recuperarán su progreso al volver a cargar la copia.`,
        timeout: 8000,
      })
    }
    onDialogCancel()
  } catch (err) {
    console.error(err)
    $q.notify({
      type: 'negative',
      message: (err as Error).message === 'not-backup' ? 'Ese archivo no es una copia de Bibli' : 'No se pudo leer la copia',
    })
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <q-dialog ref="dialogRef" :persistent="!!busy" @hide="onDialogHide">
    <q-card class="backup-card">
      <q-card-section class="row items-center no-wrap q-pb-sm">
        <q-icon name="cloud_sync" size="28px" color="accent" class="q-mr-sm" />
        <div>
          <div class="text-h6 font-display">Copia de seguridad</div>
          <div class="text-caption text-grey-7">Para no perder nada o pasar tu biblioteca a otro aparato</div>
        </div>
      </q-card-section>

      <q-card-section class="q-pt-sm">
        <div class="text-subtitle2 q-mb-xs">Guardar una copia</div>
        <div class="text-body2 text-grey-8 q-mb-sm">
          Incluye tu progreso, marcadores, estanterías, subrayados, notas, estadísticas y logros.
        </div>
        <q-toggle v-model="withBooks" color="accent" :disable="!!busy" class="q-mb-xs">
          Incluir los libros
          <span v-if="booksMB != null" class="text-grey-7">(unos {{ booksMB }} MB)</span>
        </q-toggle>
        <div v-if="!withBooks" class="text-caption text-grey-7 q-mb-sm">
          Copia pequeña. En el otro aparato tendrás que añadir los mismos libros: al hacerlo recuperan su progreso.
        </div>

        <template v-if="busy === 'create'">
          <div class="text-caption q-mt-sm">Preparando… {{ Math.round(progress * 100) }}%</div>
          <q-linear-progress :value="progress" color="accent" rounded class="q-mt-xs" />
        </template>
        <div v-else-if="ready" class="ready q-mt-sm">
          <q-icon name="check_circle" color="positive" size="22px" />
          <span class="col">Copia lista · {{ mb(ready.blob.size) }}</span>
          <q-btn unelevated rounded no-caps color="accent" icon="save_alt" label="Guardar" @click="save" />
        </div>
        <q-btn
          v-else
          unelevated
          rounded
          no-caps
          color="accent"
          icon="backup"
          label="Crear copia"
          class="q-mt-sm"
          :disable="!!busy"
          @click="create"
        />
      </q-card-section>

      <q-separator inset />

      <q-card-section>
        <div class="text-subtitle2 q-mb-xs">Recuperar una copia</div>
        <div class="text-body2 text-grey-8 q-mb-sm">
          Se junta con lo que ya tienes aquí: no se borra nada y los libros repetidos no se duplican.
        </div>
        <template v-if="busy === 'restore'">
          <div class="text-caption">Recuperando… {{ Math.round(progress * 100) }}%</div>
          <q-linear-progress :value="progress" color="secondary" rounded class="q-mt-xs" />
        </template>
        <q-btn
          v-else
          outline
          rounded
          no-caps
          color="primary"
          icon="restore"
          label="Elegir archivo de copia"
          :disable="!!busy"
          @click="fileInput?.click()"
        />
        <input ref="fileInput" type="file" accept=".zip,application/zip" hidden @change="onFile" />
      </q-card-section>

      <q-card-actions align="right">
        <q-btn flat label="Cerrar" :disable="!!busy" @click="onDialogCancel" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<style scoped>
.backup-card {
  width: 460px;
  max-width: 94vw;
}
.ready {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 8px 8px 12px;
  border-radius: 14px;
  background: color-mix(in srgb, var(--leaf) 12%, transparent);
}
</style>
