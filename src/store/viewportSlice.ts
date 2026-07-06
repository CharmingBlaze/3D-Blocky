import type { ViewMoveBasis } from '../utils/viewNavigation'
import type { ViewportDisplayMode } from '../rendering/viewportDisplay'
import { DEFAULT_VIEWPORT_SLOT_VIEWS } from '../scene/viewTypes'
import type { SelectableViewType, ViewType, ViewportSlotIndex } from '../scene/viewTypes'

export interface ViewportLayoutState {
  activeView: ViewType
  maximizedView: ViewType | null
  viewportSlotViews: ViewType[]
  viewportColSplit: number
  viewportRowSplit: number
  sidePanelWidth: number
  showGrid: boolean
  viewportDisplayMode: ViewportDisplayMode
  viewportXRay: boolean
  viewMoveBasis: ViewMoveBasis | null
}

export interface ViewportLayoutActions {
  setActiveView: (view: ViewType) => void
  setViewportSlotView: (index: ViewportSlotIndex, view: SelectableViewType) => void
  toggleMaximizedView: () => void
  setViewportColSplit: (ratio: number) => void
  setViewportRowSplit: (ratio: number) => void
  setSidePanelWidth: (width: number) => void
  setShowGrid: (show: boolean) => void
  setViewportDisplayMode: (mode: ViewportDisplayMode) => void
  setViewportXRay: (enabled: boolean) => void
  setViewMoveBasis: (basis: ViewMoveBasis | null) => void
}

export type ViewportSlice = ViewportLayoutState & ViewportLayoutActions

export const viewportLayoutInitialState: ViewportLayoutState = {
  activeView: 'front',
  maximizedView: null,
  viewportSlotViews: [...DEFAULT_VIEWPORT_SLOT_VIEWS],
  viewportColSplit: 0.5,
  viewportRowSplit: 0.5,
  sidePanelWidth: 240,
  showGrid: true,
  viewportDisplayMode: 'model',
  viewportXRay: false,
  viewMoveBasis: null,
}

export function createViewportSlice<T extends ViewportLayoutState>(
  set: (partial: Partial<T> | ((state: T) => Partial<T>)) => void
): ViewportLayoutActions {
  return {
    setActiveView: (view) => set({ activeView: view } as Partial<T>),

    setViewportSlotView: (index, view) =>
      set((s) => {
        const viewportSlotViews = [...s.viewportSlotViews] as ViewType[]
        viewportSlotViews[index] = view
        return { viewportSlotViews } as Partial<T>
      }),

    toggleMaximizedView: () =>
      set((s) => ({
        maximizedView: s.maximizedView ? null : s.activeView,
      }) as Partial<T>),

    setViewportColSplit: (ratio) =>
      set({ viewportColSplit: Math.min(0.82, Math.max(0.18, ratio)) } as Partial<T>),

    setViewportRowSplit: (ratio) =>
      set({ viewportRowSplit: Math.min(0.82, Math.max(0.18, ratio)) } as Partial<T>),

    setSidePanelWidth: (width) =>
      set({ sidePanelWidth: Math.min(420, Math.max(176, width)) } as Partial<T>),

    setShowGrid: (show) => set({ showGrid: show } as Partial<T>),

    setViewportDisplayMode: (mode) => set({ viewportDisplayMode: mode } as Partial<T>),

    setViewportXRay: (enabled) => set({ viewportXRay: enabled } as Partial<T>),

    setViewMoveBasis: (basis) =>
      set((s) => {
        const prev = s.viewMoveBasis
        if (prev === basis) return s as T
        if (!prev || !basis) return { viewMoveBasis: basis } as Partial<T>
        if (
          prev.right.x === basis.right.x &&
          prev.right.y === basis.right.y &&
          prev.right.z === basis.right.z &&
          prev.up.x === basis.up.x &&
          prev.up.y === basis.up.y &&
          prev.up.z === basis.up.z
        ) {
          return s as T
        }
        return { viewMoveBasis: basis } as Partial<T>
      }),
  }
}
