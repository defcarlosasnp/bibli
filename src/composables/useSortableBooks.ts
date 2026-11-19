import { onBeforeUnmount, watch, type ComponentPublicInstance, type Ref } from 'vue'
import Sortable from 'sortablejs'

/**
 * Arrastrar libros para cambiar su orden. Cada libro lleva data-id en el DOM.
 * SortableJS mueve el elemento en el DOM; aquí se deshace ese movimiento y se avisa con el nuevo
 * orden de ids, para que sea Vue quien vuelva a pintar la lista (si no, se desincronizan).
 * En pantallas táctiles hay que mantener pulsado un momento, para no estorbar al desplazamiento.
 */
export function useSortableBooks(
  target: Ref<HTMLElement | ComponentPublicInstance | null | undefined>,
  draggable: string,
  onReorder: (ids: number[]) => void,
) {
  let sortable: Sortable | null = null
  let restoreBefore: Node | null = null

  watch(
    target,
    (node) => {
      sortable?.destroy()
      sortable = null
      const el = node && ('$el' in node ? (node.$el as HTMLElement) : node)
      if (!(el instanceof HTMLElement)) return
      sortable = Sortable.create(el, {
        draggable,
        animation: 180,
        delay: 260,
        delayOnTouchOnly: true,
        touchStartThreshold: 6,
        ghostClass: 'drag-ghost',
        chosenClass: 'drag-chosen',
        onStart: (e) => {
          restoreBefore = e.item.nextSibling
        },
        onEnd: (e) => {
          if (e.oldIndex === e.newIndex) return
          const ids = [...el.querySelectorAll<HTMLElement>('[data-id]')].map((n) => Number(n.dataset.id))
          e.from.insertBefore(e.item, restoreBefore)
          onReorder(ids)
        },
      })
    },
    { flush: 'post' },
  )

  onBeforeUnmount(() => sortable?.destroy())
}
