import { useEffect, useRef } from 'react'
import { useAppStore, type SelectionMode } from '../store/appStore'

const SELECTION_MODES: { id: SelectionMode; label: string; title: string }[] = [
  { id: 'object', label: 'Object', title: 'Select objects (1 / Q)' },
  { id: 'vertex', label: 'Vertex', title: 'Select vertices (2)' },
  { id: 'edge', label: 'Edge', title: 'Select edges (3)' },
  { id: 'face', label: 'Face', title: 'Select faces (4)' },
]

/** Compact, draggable transform controls kept close to the working canvas. */
export function TransformToolbar() {
  const show = useAppStore((s) => s.showTransformBar)
  const position = useAppStore((s) => s.transformBarPosition)
  const setShow = useAppStore((s) => s.setShowTransformBar)
  const setPosition = useAppStore((s) => s.setTransformBarPosition)
  const setActiveTool = useAppStore((s) => s.setActiveTool)
  const activateSelectTool = useAppStore((s) => s.activateSelectTool)
  const setSelectionMode = useAppStore((s) => s.setSelectionMode)
  const activeTool = useAppStore((s) => s.activeTool)
  const selectionMode = useAppStore((s) => s.selectionMode)
  const dragRef = useRef<{ startX: number; startY: number; x: number; y: number } | null>(null)

  const isSelectTool =
    activeTool === 'select-object' ||
    activeTool === 'select-vertex' ||
    activeTool === 'select-edge' ||
    activeTool === 'select-face'

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return
      setPosition({ x: drag.x + event.clientX - drag.startX, y: drag.y + event.clientY - drag.startY })
    }
    const onEnd = () => {
      dragRef.current = null
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onEnd)
    window.addEventListener('pointercancel', onEnd)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onEnd)
      window.removeEventListener('pointercancel', onEnd)
    }
  }, [setPosition])

  if (!show) return null

  return (
    <div className="transform-toolbar" style={{ left: position.x, top: position.y }} role="toolbar" aria-label="Transform tools">
      <div
        className="transform-toolbar-handle"
        onPointerDown={(event) => {
          if (event.button !== 0) return
          event.preventDefault()
          dragRef.current = { startX: event.clientX, startY: event.clientY, x: position.x, y: position.y }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        title="Drag to move transform bar"
        aria-label="Move transform bar"
      >
        ⋮⋮
      </div>
      <span className="transform-toolbar-label" aria-hidden>
        Selection
      </span>
      {SELECTION_MODES.map((mode) => (
        <button
          key={mode.id}
          type="button"
          className={`transform-toolbar-btn ${isSelectTool && selectionMode === mode.id ? 'active' : ''}`}
          onClick={() => setSelectionMode(mode.id)}
          title={mode.title}
        >
          {mode.label}
        </button>
      ))}
      <span className="transform-toolbar-divider" aria-hidden />
      <button
        type="button"
        className={`transform-toolbar-btn ${isSelectTool ? 'active' : ''}`}
        onClick={activateSelectTool}
        title="Select (G)"
      >
        Select
      </button>
      <button
        type="button"
        className={`transform-toolbar-btn ${activeTool === 'move' ? 'active' : ''}`}
        onClick={() => setActiveTool('move')}
        title="Move (W)"
      >
        Move
      </button>
      <button
        type="button"
        className={`transform-toolbar-btn ${activeTool === 'rotate' ? 'active' : ''}`}
        onClick={() => setActiveTool('rotate')}
        title="Rotate (R)"
      >
        Rotate
      </button>
      <button
        type="button"
        className={`transform-toolbar-btn ${activeTool === 'scale' ? 'active' : ''}`}
        onClick={() => setActiveTool('scale')}
        title="Scale (S)"
      >
        Scale
      </button>
      <button type="button" className="transform-toolbar-close" onClick={() => setShow(false)} title="Hide transform bar" aria-label="Hide transform bar">
        ×
      </button>
    </div>
  )
}

export function TransformToolbarToggle() {
  const show = useAppStore((s) => s.showTransformBar)
  const setShow = useAppStore((s) => s.setShowTransformBar)
  return (
    <button
      type="button"
      className={`side-btn side-btn-wide ${show ? 'active' : ''}`}
      onClick={() => setShow(!show)}
      title={show ? 'Hide floating transform bar' : 'Show floating transform bar'}
    >
      {show ? 'Hide transform bar' : 'Show transform bar'}
    </button>
  )
}
