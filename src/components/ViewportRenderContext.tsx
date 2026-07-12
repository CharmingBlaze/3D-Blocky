import { createContext, useContext } from 'react'

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

/** Schedule a draw for visible viewports (safe under both demand and always). */
export function requestViewportFrame(
  invalidate: () => void,
  layoutVisible: boolean,
  _continuousFrames?: boolean
): void {
  if (layoutVisible) invalidate()
}
