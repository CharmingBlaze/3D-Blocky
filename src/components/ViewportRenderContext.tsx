import { createContext, useContext, useEffect } from 'react'

export interface ViewportRenderState {
  /** False when the slot is hidden during maximize (still mounted). */
  layoutVisible: boolean
  /** When true, canvas uses frameloop="always" instead of demand. */
  continuousFrames: boolean
}

export const ViewportRenderContext = createContext<ViewportRenderState>({
  layoutVisible: true,
  continuousFrames: false,
})

export function useViewportRender(): ViewportRenderState {
  return useContext(ViewportRenderContext)
}

/**
 * At most one pending rAF invalidate per canvas.
 * Large scene updates can otherwise queue hundreds of invalidate() calls.
 */
const pendingByInvalidate = new WeakMap<() => void, number>()

export function scheduleCoalescedInvalidate(invalidate: () => void): void {
  if (pendingByInvalidate.has(invalidate)) return
  const id = requestAnimationFrame(() => {
    pendingByInvalidate.delete(invalidate)
    invalidate()
  })
  pendingByInvalidate.set(invalidate, id)
}

/** Schedule a draw for visible viewports (coalesced; safe under demand and always). */
export function requestViewportFrame(
  invalidate: () => void,
  layoutVisible: boolean,
  _continuousFrames?: boolean
): void {
  if (layoutVisible) scheduleCoalescedInvalidate(invalidate)
}

export function cancelPendingInvalidates(invalidate: () => void): void {
  const id = pendingByInvalidate.get(invalidate)
  if (id == null) return
  cancelAnimationFrame(id)
  pendingByInvalidate.delete(invalidate)
}

/** Cleanup pending rAF when a canvas unmounts. */
export function useCancelInvalidateOnUnmount(invalidate: () => void): void {
  useEffect(() => () => cancelPendingInvalidates(invalidate), [invalidate])
}
