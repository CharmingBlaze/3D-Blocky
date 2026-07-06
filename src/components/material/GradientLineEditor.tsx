import { useCallback, useEffect, useRef, useState } from 'react'
import type { GradientHandle2D, Rgba4 } from '../../material/materialTypes'
import { rgba4ToHex } from '../../material/materialTypes'

const HANDLE_RADIUS = 11

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

function handleToPx(handle: GradientHandle2D, width: number, height: number) {
  return {
    x: handle.u * width,
    y: handle.v * height,
  }
}

function pxToHandle(x: number, y: number, width: number, height: number): GradientHandle2D {
  return {
    u: clamp01(width > 0 ? x / width : 0.5),
    v: clamp01(height > 0 ? y / height : 0.5),
  }
}

function hitHandle(
  px: number,
  py: number,
  handle: GradientHandle2D,
  width: number,
  height: number
): boolean {
  const { x, y } = handleToPx(handle, width, height)
  const dx = px - x
  const dy = py - y
  return dx * dx + dy * dy <= (HANDLE_RADIUS + 4) ** 2
}

export interface GradientLineEditorProps {
  start: GradientHandle2D
  end: GradientHandle2D
  stops: Rgba4[]
  activeStop: 0 | 1
  radial?: boolean
  disabled?: boolean
  onStartChange: (handle: GradientHandle2D) => void
  onEndChange: (handle: GradientHandle2D) => void
  onActiveStopChange: (index: 0 | 1) => void
  onDragBegin?: () => void
  onDragEnd?: () => void
}

export function GradientLineEditor({
  start,
  end,
  stops,
  activeStop,
  radial = false,
  disabled = false,
  onStartChange,
  onEndChange,
  onActiveStopChange,
  onDragBegin,
  onDragEnd,
}: GradientLineEditorProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<0 | 1 | null>(null)
  const [size, setSize] = useState({ w: 280, h: 168 })

  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const cr = entry?.contentRect
      if (!cr) return
      setSize({ w: cr.width, h: cr.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const startPx = handleToPx(start, size.w, size.h)
  const endPx = handleToPx(end, size.w, size.h)

  const angleDeg = (Math.atan2(endPx.y - startPx.y, endPx.x - startPx.x) * 180) / Math.PI + 90
  const gradientCss = `linear-gradient(${angleDeg}deg, ${rgba4ToHex(stops[0] ?? [1, 1, 1, 1])}, ${rgba4ToHex(stops[1] ?? [0, 0, 0, 1])})`

  const pointerPos = useCallback((clientX: number, clientY: number) => {
    const rect = rootRef.current?.getBoundingClientRect()
    if (!rect) return null
    return { x: clientX - rect.left, y: clientY - rect.top }
  }, [])

  const updateDrag = useCallback(
    (index: 0 | 1, px: number, py: number) => {
      const handle = pxToHandle(px, py, size.w, size.h)
      if (index === 0) onStartChange(handle)
      else onEndChange(handle)
    },
    [onEndChange, onStartChange, size.h, size.w]
  )

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (disabled) return
      const pos = pointerPos(e.clientX, e.clientY)
      if (!pos) return

      let target: 0 | 1 | null = null
      if (hitHandle(pos.x, pos.y, start, size.w, size.h)) target = 0
      else if (hitHandle(pos.x, pos.y, end, size.w, size.h)) target = 1
      else return

      e.preventDefault()
      dragRef.current = target
      onActiveStopChange(target)
      onDragBegin?.()
      rootRef.current?.setPointerCapture(e.pointerId)
      updateDrag(target, pos.x, pos.y)
    },
    [disabled, end, onActiveStopChange, onDragBegin, pointerPos, size.h, size.w, start, updateDrag]
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const index = dragRef.current
      if (index === null) return
      const pos = pointerPos(e.clientX, e.clientY)
      if (!pos) return
      updateDrag(index, pos.x, pos.y)
    },
    [pointerPos, updateDrag]
  )

  const endDrag = useCallback((e: React.PointerEvent) => {
    if (dragRef.current === null) return
    dragRef.current = null
    onDragEnd?.()
    try {
      rootRef.current?.releasePointerCapture(e.pointerId)
    } catch {
      /* already released */
    }
  }, [onDragEnd])

  const handles: Array<{ index: 0 | 1; handle: GradientHandle2D; color: Rgba4 }> = [
    { index: 0, handle: start, color: stops[0] ?? [1, 1, 1, 1] },
    { index: 1, handle: end, color: stops[1] ?? [0, 0, 0, 1] },
  ]

  return (
    <div
      ref={rootRef}
      className={`mat-gradient-editor${disabled ? ' disabled' : ''}${radial ? ' radial' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div className="mat-gradient-editor-fill" style={{ background: gradientCss }} />
      {radial && (
        <div
          className="mat-gradient-editor-radial-hint"
          style={{
            left: startPx.x,
            top: startPx.y,
            width: Math.hypot(endPx.x - startPx.x, endPx.y - startPx.y) * 2,
            height: Math.hypot(endPx.x - startPx.x, endPx.y - startPx.y) * 2,
          }}
        />
      )}
      <svg className="mat-gradient-editor-line" aria-hidden>
        <line
          x1={startPx.x}
          y1={startPx.y}
          x2={endPx.x}
          y2={endPx.y}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {handles.map(({ index, handle, color }) => {
        const { x, y } = handleToPx(handle, size.w, size.h)
        return (
          <div
            key={index}
            className={`mat-gradient-handle${activeStop === index ? ' active' : ''}`}
            style={{ left: x, top: y, background: rgba4ToHex(color) }}
            title={`Stop ${index + 1} — drag to position gradient`}
          />
        )
      })}
    </div>
  )
}
