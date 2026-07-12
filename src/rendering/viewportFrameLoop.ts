import { useSyncExternalStore } from 'react'

type InteractionListener = () => void

let interactionRefCount = 0
const listeners = new Set<InteractionListener>()

function notifyInteraction(): void {
  for (const listener of listeners) listener()
}

/** Boost visible viewports to continuous rendering during drag/orbit/gizmo use. Idle slots stay on demand. */
export function pushViewportInteraction(): void {
  interactionRefCount += 1
  if (interactionRefCount === 1) notifyInteraction()
}

export function popViewportInteraction(): void {
  if (interactionRefCount === 0) return
  interactionRefCount -= 1
  if (interactionRefCount === 0) notifyInteraction()
}

export function isViewportInteractionActive(): boolean {
  return interactionRefCount > 0
}

export function subscribeViewportInteraction(onStoreChange: InteractionListener): () => void {
  listeners.add(onStoreChange)
  return () => listeners.delete(onStoreChange)
}

/** Synchronous interaction flag — avoids one-frame demand lag after pointer down. */
export function useViewportInteractionActive(): boolean {
  return useSyncExternalStore(
    subscribeViewportInteraction,
    isViewportInteractionActive,
    () => false
  )
}
