import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { ViewType, ViewportSlotIndex } from '../../scene/viewTypes'
import type { ViewportRuntimeState } from './viewportTypes'

const ViewportRuntimeContext = createContext<ViewportRuntimeState | null>(null)

export function ViewportRuntimeProvider({
  slotIndex,
  view,
  isActive,
  isHovered,
  layoutVisible,
  continuousFrames,
  quality,
  children,
}: ViewportRuntimeState & { children: ReactNode }) {
  const value = useMemo<ViewportRuntimeState>(
    () => ({
      slotIndex,
      view,
      isActive,
      isHovered,
      layoutVisible,
      continuousFrames,
      quality,
    }),
    [slotIndex, view, isActive, isHovered, layoutVisible, continuousFrames, quality]
  )

  return (
    <ViewportRuntimeContext.Provider value={value}>{children}</ViewportRuntimeContext.Provider>
  )
}

export function useViewportRuntime(): ViewportRuntimeState {
  const ctx = useContext(ViewportRuntimeContext)
  if (!ctx) {
    throw new Error('useViewportRuntime must be used within ViewportRuntimeProvider')
  }
  return ctx
}

/** Safe read when a component may render outside a slot (returns defaults). */
export function useViewportRuntimeOptional(): ViewportRuntimeState | null {
  return useContext(ViewportRuntimeContext)
}

export function useViewportSlotIndex(): ViewportSlotIndex {
  const ctx = useContext(ViewportRuntimeContext)
  return ctx?.slotIndex ?? 0
}

export function useViewportView(): ViewType {
  const ctx = useContext(ViewportRuntimeContext)
  return ctx?.view ?? 'perspective'
}
