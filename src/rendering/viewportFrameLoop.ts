type InteractionListener = (active: boolean) => void

let interactionRefCount = 0
const listeners = new Set<InteractionListener>()

function notifyInteraction(): void {
  const active = interactionRefCount > 0
  for (const listener of listeners) listener(active)
}

/** Boost all visible viewports to continuous rendering during drag/orbit/gizmo use. */
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

export function subscribeViewportInteraction(listener: InteractionListener): () => void {
  listeners.add(listener)
  listener(interactionRefCount > 0)
  return () => listeners.delete(listener)
}
