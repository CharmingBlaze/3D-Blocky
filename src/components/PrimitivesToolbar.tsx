import { useEffect, useRef } from 'react'
import { useAppStore, type PrimitiveKind } from '../store/appStore'
import { PRIMITIVE_KINDS } from './SidePanelPrimitivesMenu'
import { PrimitiveIcon } from './PrimitiveIcons'

/** Vertical, draggable CAD primitives palette — click a shape, then draw in the viewport. */
export function PrimitivesToolbar() {
  const show = useAppStore((s) => s.showPrimitivesBar)
  const position = useAppStore((s) => s.primitivesBarPosition)
  const setShow = useAppStore((s) => s.setShowPrimitivesBar)
  const setPosition = useAppStore((s) => s.setPrimitivesBarPosition)
  const activeTool = useAppStore((s) => s.activeTool)
  const activePrimitiveKind = useAppStore((s) => s.activePrimitiveKind)
  const setActivePrimitiveKind = useAppStore((s) => s.setActivePrimitiveKind)
  const dragRef = useRef<{ startX: number; startY: number; x: number; y: number } | null>(null)

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

  const selectPrimitive = (kind: PrimitiveKind) => {
    if (activeTool === 'primitive-box' && activePrimitiveKind === kind) {
      setActivePrimitiveKind(null)
      return
    }
    setActivePrimitiveKind(kind)
  }

  return (
    <div
      className="primitives-toolbar"
      style={{ left: position.x, top: position.y }}
      role="toolbar"
      aria-label="CAD primitives"
    >
      <div
        className="primitives-toolbar-handle"
        onPointerDown={(event) => {
          if (event.button !== 0) return
          event.preventDefault()
          dragRef.current = { startX: event.clientX, startY: event.clientY, x: position.x, y: position.y }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        title="Drag to move primitives panel"
        aria-label="Move primitives panel"
      >
        ⋮⋮
      </div>
      <div className="primitives-toolbar-list">
        {PRIMITIVE_KINDS.map((primitive) => {
          const active = activeTool === 'primitive-box' && activePrimitiveKind === primitive.id
          return (
            <button
              key={primitive.id}
              type="button"
              className={`primitives-toolbar-btn ${active ? 'active' : ''}`}
              onClick={() => selectPrimitive(primitive.id)}
              title={`${primitive.label} — click, then drag in a viewport`}
              aria-label={primitive.label}
              aria-pressed={active}
            >
              <PrimitiveIcon kind={primitive.id} />
            </button>
          )
        })}
      </div>
      <button
        type="button"
        className="primitives-toolbar-close"
        onClick={() => setShow(false)}
        title="Hide primitives panel"
        aria-label="Hide primitives panel"
      >
        ×
      </button>
    </div>
  )
}

export function PrimitivesToolbarToggle() {
  const show = useAppStore((s) => s.showPrimitivesBar)
  const setShow = useAppStore((s) => s.setShowPrimitivesBar)
  return (
    <button
      type="button"
      className={`side-btn side-btn-wide ${show ? 'active' : ''}`}
      onClick={() => setShow(!show)}
      title={show ? 'Hide CAD primitives panel' : 'Show CAD primitives panel'}
    >
      {show ? 'Hide CAD panel' : 'Show CAD panel'}
    </button>
  )
}
