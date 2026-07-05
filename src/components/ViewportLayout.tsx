import { useCallback, useEffect, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore, type ViewType } from '../store/appStore'
import type { ViewportSlotIndex } from '../scene/viewTypes'
import { QuadViewport } from './QuadViewport'

function ResizeHandle({
  axis,
  onDrag,
}: {
  axis: 'column' | 'row'
  onDrag: (ratio: number) => void
}) {
  const dragRef = useRef<{ pos: number; ratio: number; size: number } | null>(null)
  const listenersRef = useRef<{ onMove: (ev: PointerEvent) => void; onUp: () => void } | null>(
    null
  )

  useEffect(() => {
    return () => {
      const listeners = listenersRef.current
      if (!listeners) return
      window.removeEventListener('pointermove', listeners.onMove)
      window.removeEventListener('pointerup', listeners.onUp)
      window.removeEventListener('pointercancel', listeners.onUp)
      listenersRef.current = null
      dragRef.current = null
    }
  }, [])

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      e.stopPropagation()

      const layout = (e.currentTarget as HTMLElement).closest('.viewport-layout')
      if (!layout) return

      const rect = layout.getBoundingClientRect()
      const isColumn = axis === 'column'
      dragRef.current = {
        pos: isColumn ? e.clientX : e.clientY,
        ratio: isColumn
          ? useAppStore.getState().viewportColSplit
          : useAppStore.getState().viewportRowSplit,
        size: isColumn ? rect.width : rect.height,
      }

      const onMove = (ev: PointerEvent) => {
        if (!dragRef.current) return
        const delta =
          (isColumn ? ev.clientX : ev.clientY) - dragRef.current.pos
        onDrag(dragRef.current.ratio + delta / dragRef.current.size)
      }

      const onUp = () => {
        dragRef.current = null
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
        listenersRef.current = null
      }

      listenersRef.current = { onMove, onUp }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    [axis, onDrag]
  )

  return (
    <div
      className={`viewport-splitter viewport-splitter-${axis}`}
      onPointerDown={handlePointerDown}
      role="separator"
      aria-orientation={axis === 'column' ? 'vertical' : 'horizontal'}
    />
  )
}

function ViewportSlot({
  slotIndex,
  view,
  isActive,
  onActivate,
  flex,
}: {
  slotIndex: ViewportSlotIndex
  view: ViewType
  isActive: boolean
  onActivate: () => void
  flex?: number
}) {
  return (
    <div
      className={`viewport-slot ${isActive ? 'active-slot' : ''}`}
      style={{ flex: flex ?? 1 }}
    >
      <QuadViewport
        view={view}
        slotIndex={slotIndex}
        isActive={isActive}
        onActivate={onActivate}
      />
    </div>
  )
}

export function ViewportLayout() {
  const {
    activeView,
    setActiveView,
    maximizedView,
    viewportSlotViews,
    viewportColSplit,
    viewportRowSplit,
    setViewportColSplit,
    setViewportRowSplit,
  } = useAppStore(
    useShallow((s) => ({
      activeView: s.activeView,
      setActiveView: s.setActiveView,
      maximizedView: s.maximizedView,
      viewportSlotViews: s.viewportSlotViews,
      viewportColSplit: s.viewportColSplit,
      viewportRowSplit: s.viewportRowSplit,
      setViewportColSplit: s.setViewportColSplit,
      setViewportRowSplit: s.setViewportRowSplit,
    }))
  )

  if (maximizedView) {
    const slotIndex = findActiveSlot(maximizedView, viewportSlotViews)
    return (
      <div className="viewport-layout maximized">
        <ViewportSlot
          slotIndex={slotIndex}
          view={maximizedView}
          isActive={activeView === maximizedView}
          onActivate={() => setActiveView(maximizedView)}
        />
      </div>
    )
  }

  const rowB = 1 - viewportRowSplit
  const colB = 1 - viewportColSplit

  return (
    <div className="viewport-layout">
      <div className="viewport-row" style={{ flex: viewportRowSplit }}>
        <ViewportSlot
          slotIndex={0}
          view={viewportSlotViews[0]!}
          isActive={activeView === viewportSlotViews[0]}
          onActivate={() => setActiveView(viewportSlotViews[0]!)}
          flex={viewportColSplit}
        />
        <ResizeHandle axis="column" onDrag={setViewportColSplit} />
        <ViewportSlot
          slotIndex={1}
          view={viewportSlotViews[1]!}
          isActive={activeView === viewportSlotViews[1]}
          onActivate={() => setActiveView(viewportSlotViews[1]!)}
          flex={colB}
        />
      </div>

      <ResizeHandle axis="row" onDrag={setViewportRowSplit} />

      <div className="viewport-row" style={{ flex: rowB }}>
        <ViewportSlot
          slotIndex={2}
          view={viewportSlotViews[2]!}
          isActive={activeView === viewportSlotViews[2]}
          onActivate={() => setActiveView(viewportSlotViews[2]!)}
          flex={viewportColSplit}
        />
        <ResizeHandle axis="column" onDrag={setViewportColSplit} />
        <ViewportSlot
          slotIndex={3}
          view={viewportSlotViews[3]!}
          isActive={activeView === viewportSlotViews[3]}
          onActivate={() => setActiveView(viewportSlotViews[3]!)}
          flex={colB}
        />
      </div>
    </div>
  )
}

function findActiveSlot(view: ViewType, slots: ViewType[]): ViewportSlotIndex {
  const index = slots.findIndex((slotView) => slotView === view)
  return (index >= 0 ? index : 0) as ViewportSlotIndex
}
