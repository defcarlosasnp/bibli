<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useDialogPluginComponent } from 'quasar'
import { cleanWord, define, type DictionaryResult } from '@/services/dictionary'
import { checkAchievements, countDictionaryLookup } from '@/services/achievements'
import LumiOwl from './LumiOwl.vue'

const props = defineProps<{ text: string }>()
defineEmits([...useDialogPluginComponent.emits])
const { dialogRef, onDialogHide, onDialogCancel } = useDialogPluginComponent()

const word = cleanWord(props.text)
const loading = ref(true)
const result = ref<DictionaryResult | null>(null)
const failed = ref(false)

onMounted(async () => {
  try {
    result.value = await define(word)
    if (result.value) {
      countDictionaryLookup()
      checkAchievements()
    }
  } catch {
    failed.value = true
  } finally {
    loading.value = false
  }
})

const raeUrl = `https://dle.rae.es/${encodeURIComponent(word)}`
</script>

<template>
  <q-dialog ref="dialogRef" position="bottom" @hide="onDialogHide">
    <q-card class="dict">
      <q-card-section class="row items-center no-wrap q-pb-none">
        <div class="col">
          <div class="word font-display">{{ word }}</div>
          <div v-if="result && result.lemma !== result.word" class="text-caption text-grey-7">
            forma de «{{ result.lemma }}»
          </div>
        </div>
        <q-btn flat round dense icon="close" aria-label="Cerrar" @click="onDialogCancel" />
      </q-card-section>

      <q-card-section class="body">
        <div v-if="loading" class="row items-center q-gutter-sm text-grey-7">
          <q-spinner-dots color="accent" size="28px" />
          <span>Lumi está buscando en el diccionario…</span>
        </div>

        <div v-else-if="result">
          <div v-for="(entry, i) in result.entries" :key="i" class="q-mb-sm">
            <div class="kind">{{ entry.kind }}</div>
            <ol class="defs">
              <li v-for="(d, j) in entry.definitions" :key="j">{{ d }}</li>
            </ol>
          </div>
          <div class="text-caption text-grey-7">
            Fuente: <a :href="result.url" target="_blank" rel="noopener">Wikcionario</a>
            <template v-if="result.language === 'es'">
              · <a :href="raeUrl" target="_blank" rel="noopener">Ver en la RAE</a>
            </template>
          </div>
        </div>

        <div v-else class="row items-center no-wrap q-gutter-md">
          <LumiOwl mood="sleepy" :size="56" />
          <div>
            <div v-if="failed">No pude conectarme. El diccionario necesita internet 📶</div>
            <div v-else>No encontré «{{ word }}» en el diccionario.</div>
            <a :href="raeUrl" target="_blank" rel="noopener" class="text-caption">Probar en la RAE</a>
          </div>
        </div>
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<style scoped>
.dict {
  width: min(560px, 100vw);
  border-radius: 20px 20px 0 0;
  padding-bottom: var(--q-safe-area-inset-bottom, 0px);
}
.word {
  font-size: 1.6rem;
  font-weight: 700;
}
.body {
  max-height: 55vh;
  overflow: auto;
}
.kind {
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--q-accent);
}
.defs {
  margin: 4px 0 0;
  padding-left: 20px;
  line-height: 1.45;
}
.defs li + li {
  margin-top: 4px;
}
</style>
