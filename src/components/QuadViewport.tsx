import { ViewportPanel } from './viewport/ViewportPanel'
import type { ViewportSlotProps } from './viewport/viewportTypes'

/** Thin wrapper kept for ViewportLayout imports; prefer ViewportPanel / ViewportSlot. */
export function QuadViewport(props: ViewportSlotProps) {
  return <ViewportPanel {...props} />
}

export { ViewportPanel as ViewportSlot }
