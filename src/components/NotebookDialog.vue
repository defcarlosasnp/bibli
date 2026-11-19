<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useDialogPluginComponent, useQuasar } from 'quasar'
import { liveQuery } from 'dexie'
import { db, type BookNote, type NoteKind } from '@/db'

/**
 * Cuaderno del libro: personajes, lugares, teorías o notas libres, sin tener que subrayar nada.
 * Muy útil en sagas largas ("¿quién era este?").
 */
const props = defineProps<{ bookId: number; title: string }>()
defineEmits([...useDialogPluginComponent.emits])
const { dialogRef, onDialogHide, onDialogCancel } = useDialogPluginComponent()
const $q = useQuasar()

const KINDS: { id: NoteKind; label: string; icon: string; placeholder: string }[] = [
  { id: 'character', label: 'Personaje', icon: '🧑', placeholder: 'Nombre (p. ej. Kaladin)' },
  { id: 'place', label: 'Lugar', icon: '🗺️', placeholder: 'Nombre del lugar' },
  { id: 'theory', label: 'Teoría', icon: '💡', placeholder: 'De qué va tu teoría' },
  { id: 'note', label: 'Nota', icon: '📝', placeholder: 'Título' },
]
const kindInfo = (k: NoteKind) => KINDS.find((x) => x.id === k)!

const notes = ref<BookNote[]>([])
const sub = liveQuery(() => db.notes.where('bookId').equals(props.bookId).toArray()).subscribe(
  (list) => (notes.value = list.sort((a, b) => b.updatedAt - a.updatedAt)),
)
onBeforeUnmount(() => sub.unsubscribe())

const filter = ref<NoteKind | null>(null)
const query = ref('')
const visible = computed(() => {
  const q = query.value.trim().toLocaleLowerCase('es')
  return notes.value.filter(
    (n) =>
      (!filter.value || n.kind === filter.value) &&
      (!q || n.title.toLocaleLowerCase('es').includes(q) || n.text.toLocaleLowerCase('es').includes(q)),
  )
})
const countOf = (k: NoteKind) => notes.value.filter((n) => n.kind === k).length

// ---------- Escribir o editar ----------
const editing = ref<{ id?: number; kind: NoteKind; title: string; text: string } | null>(null)

function startNew() {
  editing.value = { kind: filter.value ?? 'character', title: '', text: '' }
}
function startEdit(n: BookNote) {
  editing.value = { id: n.id, kind: n.kind, title: n.title, text: n.text }
}
async function saveNote() {
  const e = editing.value
  if (!e || (!e.title.trim() && !e.text.trim())) return
  const now = Date.now()
  const data = { kind: e.kind, title: e.title.trim(), text: e.text.trim(), updatedAt: now }
  if (e.id) await db.notes.update(e.id, data)
  else await db.notes.add({ ...data, bookId: props.bookId, createdAt: now } as BookNote)
  editing.value = null
}
function removeNote(n: BookNote) {
  $q.dialog({
    title: 'Borrar nota',
    message: `¿Borrar «${n.title || 'esta nota'}»?`,
    cancel: { flat: true, label: 'Cancelar' },
    ok: { label: 'Borrar', color: 'negative', unelevated: true },
  }).onOk(() => db.notes.delete(n.id))
}
</script>

<template>
  <q-dialog ref="dialogRef" :maximized="$q.screen.lt.sm" @hide="onDialogHide">
    <q-card class="nb-card column no-wrap">
      <q-card-section class="row items-center no-wrap q-pb-sm">
        <div class="col">
          <div class="text-overline">📓 Cuaderno</div>
          <div class="text-h6 font-display ellipsis">{{ title }}</div>
        </div>
        <q-btn flat round icon="close" aria-label="Cerrar" @click="onDialogCancel" />
      </q-card-section>

      <!-- Escribir una nota -->
      <q-card-section v-if="editing" class="q-pt-none">
        <div class="row q-gutter-xs q-mb-sm">
          <q-chip
            v-for="k in KINDS"
            :key="k.id"
            clickable
            :outline="editing.kind !== k.id"
            :color="editing.kind === k.id ? 'accent' : undefined"
            :text-color="editing.kind === k.id ? 'white' : undefined"
            @click="editing.kind = k.id"
          >
            {{ k.icon }}&nbsp;{{ k.label }}
          </q-chip>
        </div>
        <q-input v-model="editing.title" outlined dense autofocus :placeholder="kindInfo(editing.kind).placeholder" />
        <q-input
          v-model="editing.text"
          outlined
          type="textarea"
          autogrow
          class="q-mt-sm"
          placeholder="Lo que quieras recordar: quién es, qué pasó, en qué capítulo aparece…"
          :input-style="{ minHeight: '90px' }"
        />
        <div class="row justify-end q-gutter-sm q-mt-sm">
          <q-btn flat no-caps label="Cancelar" @click="editing = null" />
          <q-btn unelevated rounded no-caps color="accent" label="Guardar" @click="saveNote" />
        </div>
      </q-card-section>

      <template v-else>
        <q-card-section class="q-pt-none">
          <div class="row items-center q-gutter-sm no-wrap">
            <q-input v-model="query" dense outlined clearable class="col" placeholder="Buscar en el cuaderno">
              <template #prepend><q-icon name="search" /></template>
            </q-input>
            <q-btn unelevated rounded no-caps color="accent" icon="add" label="Nota" @click="startNew" />
          </div>
          <div class="nb-filters q-mt-sm">
            <q-chip
              v-for="k in KINDS"
              :key="k.id"
              clickable
              dense
              :outline="filter !== k.id"
              :color="filter === k.id ? 'accent' : undefined"
              :text-color="filter === k.id ? 'white' : undefined"
              @click="filter = filter === k.id ? null : k.id"
            >
              {{ k.icon }}&nbsp;{{ k.label }} <span class="nb-count">{{ countOf(k.id) }}</span>
            </q-chip>
          </div>
        </q-card-section>

        <q-card-section class="col nb-list q-pt-none">
          <div v-if="!notes.length" class="nb-empty">
            <div class="nb-empty__icon">📓</div>
            Apunta aquí personajes, lugares o teorías mientras lees.<br />
            Cuando vuelvas al libro meses después, sabrás quién era quién.
          </div>
          <div v-else-if="!visible.length" class="nb-empty">No hay notas que coincidan.</div>
          <div v-for="n in visible" :key="n.id" class="nb-note" @click="startEdit(n)">
            <div class="row items-start no-wrap">
              <span class="nb-note__icon">{{ kindInfo(n.kind).icon }}</span>
              <div class="col">
                <div class="nb-note__title">{{ n.title || kindInfo(n.kind).label }}</div>
                <div v-if="n.text" class="nb-note__text">{{ n.text }}</div>
              </div>
              <q-btn flat round dense size="sm" icon="delete_outline" aria-label="Borrar" @click.stop="removeNote(n)" />
            </div>
          </div>
        </q-card-section>
      </template>
    </q-card>
  </q-dialog>
</template>

<style scoped>
.nb-card {
  width: 560px;
  max-width: 96vw;
  height: min(78vh, 720px);
}
.nb-filters {
  display: flex;
  flex-wrap: nowrap;
  overflow-x: auto;
  scrollbar-width: none;
}
.nb-filters .q-chip {
  flex-shrink: 0;
}
.nb-count {
  margin-left: 4px;
  opacity: 0.7;
  font-size: 0.8em;
}
.nb-list {
  overflow-y: auto;
}
.nb-note {
  padding: 10px 12px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--accent) 8%, transparent);
  margin-bottom: 8px;
  cursor: pointer;
}
.nb-note__icon {
  font-size: 1.3rem;
  margin-right: 10px;
  line-height: 1.4;
}
.nb-note__title {
  font-weight: 700;
}
.nb-note__text {
  white-space: pre-wrap;
  font-size: 0.9rem;
  opacity: 0.85;
  margin-top: 2px;
}
.nb-empty {
  text-align: center;
  padding: 30px 10px;
  color: var(--ink-soft);
  line-height: 1.5;
}
.nb-empty__icon {
  font-size: 2.4rem;
  margin-bottom: 6px;
}
</style>
