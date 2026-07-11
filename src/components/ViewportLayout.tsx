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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.1 : 0.02
    const increase = axis === 'column' ? e.key === 'ArrowRight' : e.key === 'ArrowDown'
    const decrease = axis === 'column' ? e.key === 'ArrowLeft' : e.key === 'ArrowUp'
    if (increase || decrease) {
      e.preventDefault()
      const current = axis === 'column'
        ? useAppStore.getState().viewportColSplit
        : useAppStore.getState().viewportRowSplit
      onDrag(current + (increase ? step : -step))
    } else if (e.key === 'Home') {
      e.preventDefault()
      onDrag(0.18)
    } else if (e.key === 'End') {
      e.preventDefault()
      onDrag(0.82)
    }
  }

  return (
    <div
      className={`viewport-splitter viewport-splitter-${axis}`}
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
      role="separator"
      aria-orientation={axis === 'column' ? 'vertical' : 'horizontal'}
      aria-label={`Resize viewport ${axis === 'column' ? 'columns' : 'rows'}`}
      aria-valuemin={18}
      aria-valuemax={82}
      aria-valuenow={Math.round(
        (axis === 'column'
          ? useAppStore.getState().viewportColSplit
          : useAppStore.getState().viewportRowSplit) * 100
      )}
      tabIndex={0}
    />
  )
}

function ViewportSlot({
  slotIndex,
  view,
  isActive,
  isHovered,
  onActivate,
  onHover,
  onHoverEnd,
  flex,
  layoutVisible,
  maximizedMode,
}: {
  slotIndex: ViewportSlotIndex
  view: ViewType
  isActive: boolean
  isHovered: boolean
  onActivate: () => void
  onHover: () => void
  onHoverEnd: () => void
  flex?: number
  layoutVisible: boolean
  maximizedMode: boolean
}) {
  return (
    <div
      className={`viewport-slot${isActive ? ' active-slot' : ''}${layoutVisible ? '' : ' viewport-slot-dormant'}`}
      style={
        maximizedMode
          ? layoutVisible
            ? { flex: 1 }
            : undefined
          : { flex: flex ?? 1 }
      }
      onPointerEnter={onHover}
      onPointerLeave={(e) => {
        const next = e.relatedTarget
        if (next instanceof Element && next.closest('.viewport-slot')) return
        onHoverEnd()
      }}
    >
      <QuadViewport
        view={view}
        slotIndex={slotIndex}
        isActive={isActive}
        isHovered={isHovered}
        onActivate={onActivate}
        layoutVisible={layoutVisible}
      />
    </div>
  )
}

export function ViewportLayout() {
  const {
    activeView,
    setActiveView,
    maximizedSlot,
    hoveredViewportSlot,
    setHoveredViewportSlot,
    viewportSlotViews,
    viewportColSplit,
    viewportRowSplit,
    setViewportColSplit,
    setViewportRowSplit,
  } = useAppStore(
    useShallow((s) => ({
      activeView: s.activeView,
      setActiveView: s.setActiveView,
      maximizedSlot: s.maximizedSlot,
      hoveredViewportSlot: s.hoveredViewportSlot,
      setHoveredViewportSlot: s.setHoveredViewportSlot,
      viewportSlotViews: s.viewportSlotViews,
      viewportColSplit: s.viewportColSplit,
      viewportRowSplit: s.viewportRowSplit,
      setViewportColSplit: s.setViewportColSplit,
      setViewportRowSplit: s.setViewportRowSplit,
    }))
  )

  const rowB = 1 - viewportRowSplit
  const colB = 1 - viewportColSplit
  const maximizedMode = maximizedSlot !== null
  const row0Visible = !maximizedMode || maximizedSlot === 0 || maximizedSlot === 1
  const row1Visible = !maximizedMode || maximizedSlot === 2 || maximizedSlot === 3
  const slotLayoutVisible = (index: ViewportSlotIndex) =>
    !maximizedMode || maximizedSlot === index

  const hoverSlot = useCallback(
    (index: ViewportSlotIndex) => setHoveredViewportSlot(index),
    [setHoveredViewportSlot]
  )
  const clearHoverSlot = useCallback(
    () => setHoveredViewportSlot(null),
    [setHoveredViewportSlot]
  )

  return (
    <div className={`viewport-layout${maximizedMode ? ' maximized' : ''}`}>
      <div
        className="viewport-row"
        style={{
          flex: maximizedMode ? (row0Visible ? 1 : undefined) : viewportRowSplit,
          display: maximizedMode && !row0Visible ? 'none' : undefined,
        }}
      >
        <ViewportSlot
          slotIndex={0}
          view={viewportSlotViews[0]!}
          isActive={activeView === viewportSlotViews[0]}
          isHovered={hoveredViewportSlot === 0}
          onActivate={() => setActiveView(viewportSlotViews[0]!)}
          onHover={() => hoverSlot(0)}
          onHoverEnd={clearHoverSlot}
          flex={viewportColSplit}
          layoutVisible={slotLayoutVisible(0)}
          maximizedMode={maximizedMode}
        />
        {!maximizedMode && <ResizeHandle axis="column" onDrag={setViewportColSplit} />}
        <ViewportSlot
          slotIndex={1}
          view={viewportSlotViews[1]!}
          isActive={activeView === viewportSlotViews[1]}
          isHovered={hoveredViewportSlot === 1}
          onActivate={() => setActiveView(viewportSlotViews[1]!)}
          onHover={() => hoverSlot(1)}
          onHoverEnd={clearHoverSlot}
          flex={colB}
          layoutVisible={slotLayoutVisible(1)}
          maximizedMode={maximizedMode}
        />
      </div>

      {!maximizedMode && <ResizeHandle axis="row" onDrag={setViewportRowSplit} />}

      <div
        className="viewport-row"
        style={{
          flex: maximizedMode ? (row1Visible ? 1 : undefined) : rowB,
          display: maximizedMode && !row1Visible ? 'none' : undefined,
        }}
      >
        <ViewportSlot
          slotIndex={2}
          view={viewportSlotViews[2]!}
          isActive={activeView === viewportSlotViews[2]}
          isHovered={hoveredViewportSlot === 2}
          onActivate={() => setActiveView(viewportSlotViews[2]!)}
          onHover={() => hoverSlot(2)}
          onHoverEnd={clearHoverSlot}
          flex={viewportColSplit}
          layoutVisible={slotLayoutVisible(2)}
          maximizedMode={maximizedMode}
        />
        {!maximizedMode && <ResizeHandle axis="column" onDrag={setViewportColSplit} />}
        <ViewportSlot
          slotIndex={3}
          view={viewportSlotViews[3]!}
          isActive={activeView === viewportSlotViews[3]}
          isHovered={hoveredViewportSlot === 3}
          onActivate={() => setActiveView(viewportSlotViews[3]!)}
          onHover={() => hoverSlot(3)}
          onHoverEnd={clearHoverSlot}
          flex={colB}
          layoutVisible={slotLayoutVisible(3)}
          maximizedMode={maximizedMode}
        />
      </div>
    </div>
  )
}
