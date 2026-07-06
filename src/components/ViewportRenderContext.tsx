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

/** Schedule a draw for visible viewports only (demand frameloop). */
export function requestViewportFrame(
  invalidate: () => void,
  layoutVisible: boolean,
  continuousFrames: boolean
): void {
  if (layoutVisible && !continuousFrames) invalidate()
}
