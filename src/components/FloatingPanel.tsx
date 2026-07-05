import { useCallback, useEffect, useRef, type ReactNode } from 'react'

export interface FloatingPanelState {
  x: number
  y: number
  width: number
  height: number
  minimized: boolean
}

interface FloatingPanelProps {
  title: string
  open: boolean
  state: FloatingPanelState
  minWidth?: number
  minHeight?: number
  onClose: () => void
  onStateChange: (state: FloatingPanelState) => void
  children: ReactNode
}

type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

export function FloatingPanel({
  title,
  open,
  state,
  minWidth = 320,
  minHeight = 240,
  onClose,
  onStateChange,
  children,
}: FloatingPanelProps) {
  const stateRef = useRef(state)
  stateRef.current = state

  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(
    null
  )
  const resizeRef = useRef<{
    dir: ResizeDir
    startX: number
    startY: number
    orig: FloatingPanelState
  } | null>(null)

  const onDragStart = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return
    if (e.target instanceof HTMLElement && e.target.closest('.floating-panel-btn')) return
    e.preventDefault()
    const s = stateRef.current
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: s.x, origY: s.y }
    e.currentTarget.setPointerCapture(e.pointerId)
  }, [])

  const onResizeStart = useCallback((dir: ResizeDir, e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    resizeRef.current = {
      dir,
      startX: e.clientX,
      startY: e.clientY,
      orig: { ...stateRef.current },
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }, [])

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (dragRef.current) {
        const d = dragRef.current
        const s = stateRef.current
        onStateChange({
          ...s,
          x: d.origX + (e.clientX - d.startX),
          y: d.origY + (e.clientY - d.startY),
        })
      }
      if (resizeRef.current) {
        const r = resizeRef.current
        const dx = e.clientX - r.startX
        const dy = e.clientY - r.startY
        let { x, y, width, height } = r.orig
        const dir = r.dir
        if (dir.includes('e')) width = Math.max(minWidth, r.orig.width + dx)
        if (dir.includes('w')) {
          width = Math.max(minWidth, r.orig.width - dx)
          x = r.orig.x + (r.orig.width - width)
        }
        if (dir.includes('s')) height = Math.max(minHeight, r.orig.height + dy)
        if (dir.includes('n')) {
          height = Math.max(minHeight, r.orig.height - dy)
          y = r.orig.y + (r.orig.height - height)
        }
        onStateChange({ ...r.orig, x, y, width, height, minimized: false })
      }
    }
    const onUp = () => {
      dragRef.current = null
      resizeRef.current = null
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [minHeight, minWidth, onStateChange])

  if (!open) return null

  const toggleMinimize = () => {
    const s = stateRef.current
    onStateChange({ ...s, minimized: !s.minimized })
  }

  const onTitleDoubleClick = (e: React.MouseEvent) => {
    if (e.target instanceof HTMLElement && e.target.closest('.floating-panel-btn')) return
    toggleMinimize()
  }

  const handles: ResizeDir[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

  return (
    <div
      className={`floating-panel${state.minimized ? ' floating-panel-minimized' : ''}`}
      style={{
        left: state.x,
        top: state.y,
        width: state.width,
        height: state.minimized ? 36 : state.height,
      }}
    >
      <div
        className="floating-panel-titlebar"
        onPointerDown={onDragStart}
        onDoubleClick={onTitleDoubleClick}
        title={state.minimized ? 'Double-click to restore' : 'Double-click to minimize'}
      >
        <span className="floating-panel-title">{title}</span>
        <div className="floating-panel-chrome">
          <button
            type="button"
            className="floating-panel-btn"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              toggleMinimize()
            }}
            title="Minimize"
          >
            {state.minimized ? '▢' : '—'}
          </button>
          <button
            type="button"
            className="floating-panel-btn"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation()
              onClose()
            }}
            title="Close"
          >
            ×
          </button>
        </div>
      </div>
      {!state.minimized && (
        <>
          <div className="floating-panel-body">{children}</div>
          {handles.map((dir) => (
            <div
              key={dir}
              className={`floating-panel-resize floating-panel-resize-${dir}`}
              onPointerDown={(e) => onResizeStart(dir, e)}
            />
          ))}
        </>
      )}
    </div>
  )
}
