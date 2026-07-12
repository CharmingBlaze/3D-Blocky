import type { ViewMoveBasis } from '../utils/viewNavigation'
import type { ViewportDisplayMode } from '../rendering/viewportDisplay'
import { DEFAULT_VIEWPORT_SLOT_VIEWS } from '../scene/viewTypes'
import type { SelectableViewType, ViewType, ViewportSlotIndex } from '../scene/viewTypes'
import type { ViewportFitFrame } from '../viewport/fitViewports'

export interface FloatingToolbarPosition {
  x: number
  y: number
}

export interface ViewportFitRequest extends ViewportFitFrame {
  /** Monotonic id so every viewport applies even if center/radius match a prior fit. */
  nonce: number
}

export interface ViewportLayoutState {
  activeView: ViewType
  /** Slot index (0–3) when quad layout is maximized to one pane. */
  maximizedSlot: ViewportSlotIndex | null
  /** Viewport slot under the pointer (for hover outline + space maximize). */
  hoveredViewportSlot: ViewportSlotIndex | null
  viewportSlotViews: ViewType[]
  viewportColSplit: number
  viewportRowSplit: number
  sidePanelWidth: number
  showSidePanel: boolean
  showGrid: boolean
  viewportDisplayMode: ViewportDisplayMode
  viewportXRay: boolean
  viewMoveBasis: ViewMoveBasis | null
  showTransformBar: boolean
  transformBarPosition: FloatingToolbarPosition
  showPrimitivesBar: boolean
  primitivesBarPosition: FloatingToolbarPosition
  /** When set, each viewport resets orientation and frames this sphere. */
  viewportFitRequest: ViewportFitRequest | null
}

export interface ViewportLayoutActions {
  setActiveView: (view: ViewType) => void
  setViewportSlotView: (index: ViewportSlotIndex, view: SelectableViewType) => void
  setHoveredViewportSlot: (index: ViewportSlotIndex | null) => void
  toggleMaximizedView: () => void
  setViewportColSplit: (ratio: number) => void
  setViewportRowSplit: (ratio: number) => void
  setSidePanelWidth: (width: number) => void
  setShowSidePanel: (show: boolean) => void
  setShowGrid: (show: boolean) => void
  setViewportDisplayMode: (mode: ViewportDisplayMode) => void
  setViewportXRay: (enabled: boolean) => void
  setViewMoveBasis: (basis: ViewMoveBasis | null) => void
  setShowTransformBar: (show: boolean) => void
  setTransformBarPosition: (position: FloatingToolbarPosition) => void
  setShowPrimitivesBar: (show: boolean) => void
  setPrimitivesBarPosition: (position: FloatingToolbarPosition) => void
  requestViewportFit: (frame: ViewportFitFrame) => void
}

export type ViewportSlice = ViewportLayoutState & ViewportLayoutActions

/** Blender-like solid X-Ray surface opacity (0–1). */
export const VIEWPORT_XRAY_OPACITY = 0.5

export const viewportLayoutInitialState: ViewportLayoutState = {
  activeView: 'front',
  maximizedSlot: null,
  hoveredViewportSlot: null,
  viewportSlotViews: [...DEFAULT_VIEWPORT_SLOT_VIEWS],
  viewportColSplit: 0.5,
  viewportRowSplit: 0.5,
  sidePanelWidth: 240,
  showSidePanel: true,
  showGrid: true,
  viewportDisplayMode: 'model',
  viewportXRay: false,
  viewMoveBasis: null,
  showTransformBar: true,
  transformBarPosition: { x: 20, y: 20 },
  showPrimitivesBar: true,
  primitivesBarPosition: { x: 20, y: 72 },
  viewportFitRequest: null,
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

    setHoveredViewportSlot: (index) =>
      set((s) =>
        s.hoveredViewportSlot === index ? s : ({ hoveredViewportSlot: index } as Partial<T>)
      ),

    toggleMaximizedView: () =>
      set((s) => {
        if (s.maximizedSlot !== null) {
          return { maximizedSlot: null } as Partial<T>
        }
        const slot =
          s.hoveredViewportSlot ?? findActiveSlotForView(s.activeView, s.viewportSlotViews)
        return {
          maximizedSlot: slot,
          activeView: s.viewportSlotViews[slot]!,
        } as Partial<T>
      }),

    setViewportColSplit: (ratio) =>
      set((s) => {
        const next = Math.min(0.82, Math.max(0.18, ratio))
        return Math.abs(s.viewportColSplit - next) < 0.0001
          ? (s as T)
          : ({ viewportColSplit: next } as Partial<T>)
      }),

    setViewportRowSplit: (ratio) =>
      set((s) => {
        const next = Math.min(0.82, Math.max(0.18, ratio))
        return Math.abs(s.viewportRowSplit - next) < 0.0001
          ? (s as T)
          : ({ viewportRowSplit: next } as Partial<T>)
      }),

    setSidePanelWidth: (width) =>
      set((s) => {
        const next = Math.min(420, Math.max(176, width))
        return Math.abs(s.sidePanelWidth - next) < 0.1
          ? (s as T)
          : ({ sidePanelWidth: next } as Partial<T>)
      }),

    setShowSidePanel: (show) => set({ showSidePanel: show } as Partial<T>),

    setShowGrid: (show) => set({ showGrid: show } as Partial<T>),

    setViewportDisplayMode: (mode) =>
      set(
        (mode === 'normals'
          ? { viewportDisplayMode: mode, selectionMode: 'face' }
          : { viewportDisplayMode: mode }) as Partial<T>
      ),

    setViewportXRay: (enabled) => set({ viewportXRay: enabled } as Partial<T>),

    setShowTransformBar: (show) => set({ showTransformBar: show } as Partial<T>),

    setTransformBarPosition: (position) =>
      set((s) => {
        const next = { x: Math.max(8, position.x), y: Math.max(8, position.y) }
        return s.transformBarPosition.x === next.x && s.transformBarPosition.y === next.y
          ? (s as T)
          : ({ transformBarPosition: next } as Partial<T>)
      }),

    setShowPrimitivesBar: (show) => set({ showPrimitivesBar: show } as Partial<T>),

    setPrimitivesBarPosition: (position) =>
      set((s) => {
        const next = { x: Math.max(8, position.x), y: Math.max(8, position.y) }
        return s.primitivesBarPosition.x === next.x && s.primitivesBarPosition.y === next.y
          ? (s as T)
          : ({ primitivesBarPosition: next } as Partial<T>)
      }),

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

    requestViewportFit: (frame) =>
      set((s) => {
        const nonce = (s.viewportFitRequest?.nonce ?? 0) + 1
        return {
          viewportFitRequest: {
            nonce,
            center: { ...frame.center },
            radius: frame.radius,
          },
        } as Partial<T>
      }),
  }
}

function findActiveSlotForView(view: ViewType, slots: ViewType[]): ViewportSlotIndex {
  const index = slots.findIndex((slotView) => slotView === view)
  return (index >= 0 ? index : 0) as ViewportSlotIndex
}
