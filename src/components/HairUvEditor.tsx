import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { compositeLayers } from '../pixel/compositeLayers'
import type { PixelDocument } from '../pixel/pixelTypes'
import { type HairUvTransform, transformHairUv } from '../stroke/hairUvTransform'

const SIZE = 220
const HANDLE = 8
const MIN_SCALE = 0.08

type DragMode = 'move' | 'scale-se' | 'scale-nw' | null

interface HairUvEditorProps {
  transform: HairUvTransform
  onChange: (next: HairUvTransform) => void
  onReset: () => void
  textureDoc: PixelDocument | null
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

/** UV (0–1, V down like image space) → canvas pixels. */
function uvToCanvas(u: number, v: number): { x: number; y: number } {
  return { x: u * SIZE, y: v * SIZE }
}

function rectCorners(t: HairUvTransform): {
  nw: { u: number; v: number }
  se: { u: number; v: number }
} {
  return {
    nw: { u: t.offsetU, v: t.offsetV },
    se: { u: t.offsetU + t.scaleU, v: t.offsetV + t.scaleV },
  }
}

/** Sample tapered hair silhouette in local 0–1 UV (U along length, V across). */
function hairOutlinePoints(steps = 24): { u: number; v: number }[] {
  const pts: { u: number; v: number }[] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const taper =
      t < 0.35 ? (t / 0.35) ** 2 : t > 0.65 ? ((1 - t) / 0.35) ** 2 : 1
    const half = 0.5 * Math.max(0.04, taper)
    pts.push({ u: t, v: 0.5 - half })
  }
  for (let i = steps; i >= 0; i--) {
    const t = i / steps
    const taper =
      t < 0.35 ? (t / 0.35) ** 2 : t > 0.65 ? ((1 - t) / 0.35) ** 2 : 1
    const half = 0.5 * Math.max(0.04, taper)
    pts.push({ u: t, v: 0.5 + half })
  }
  return pts
}

export function HairUvEditor({ transform, onChange, onReset, textureDoc }: HairUvEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragRef = useRef<{
    mode: DragMode
    startX: number
    startY: number
    start: HairUvTransform
  } | null>(null)
  const [hoverHandle, setHoverHandle] = useState<'nw' | 'se' | 'body' | null>(null)

  const paint = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, SIZE, SIZE)

    const tile = 12
    for (let y = 0; y < SIZE; y += tile) {
      for (let x = 0; x < SIZE; x += tile) {
        const on = ((x / tile) + (y / tile)) % 2 === 0
        ctx.fillStyle = on ? '#2a2d36' : '#1e2128'
        ctx.fillRect(x, y, tile, tile)
      }
    }

    if (textureDoc) {
      try {
        const composite = compositeLayers(textureDoc)
        const img = new ImageData(
          new Uint8ClampedArray(composite),
          textureDoc.width,
          textureDoc.height
        )
        const off = document.createElement('canvas')
        off.width = textureDoc.width
        off.height = textureDoc.height
        off.getContext('2d')!.putImageData(img, 0, 0)
        ctx.imageSmoothingEnabled = false
        ctx.drawImage(off, 0, 0, SIZE, SIZE)
      } catch {
        // keep checkerboard
      }
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.06)'
      ctx.font = '11px ui-sans-serif, system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('No texture — UV ready', SIZE / 2, SIZE / 2)
    }

    ctx.strokeStyle = 'rgba(255,255,255,0.12)'
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let i = 1; i < 4; i++) {
      const p = (i / 4) * SIZE
      ctx.moveTo(p, 0)
      ctx.lineTo(p, SIZE)
      ctx.moveTo(0, p)
      ctx.lineTo(SIZE, p)
    }
    ctx.stroke()

    const t = transform
    const { nw, se } = rectCorners(t)
    const a = uvToCanvas(nw.u, nw.v)
    const b = uvToCanvas(se.u, se.v)
    const rx = Math.min(a.x, b.x)
    const ry = Math.min(a.y, b.y)
    const rw = Math.abs(b.x - a.x)
    const rh = Math.abs(b.y - a.y)

    ctx.fillStyle = 'rgba(110, 203, 245, 0.18)'
    ctx.strokeStyle = 'rgba(110, 203, 245, 0.95)'
    ctx.lineWidth = 1.5
    ctx.fillRect(rx, ry, rw, rh)
    ctx.strokeRect(rx, ry, rw, rh)

    const outline = hairOutlinePoints()
    ctx.beginPath()
    outline.forEach((p, i) => {
      const mapped = transformHairUv(p.u, p.v, t)
      const c = uvToCanvas(mapped.u, mapped.v)
      if (i === 0) ctx.moveTo(c.x, c.y)
      else ctx.lineTo(c.x, c.y)
    })
    ctx.closePath()
    ctx.fillStyle = 'rgba(236, 180, 120, 0.35)'
    ctx.strokeStyle = 'rgba(236, 180, 120, 0.9)'
    ctx.lineWidth = 1.25
    ctx.fill()
    ctx.stroke()

    {
      const p0 = transformHairUv(t.flipU ? 0.85 : 0.15, 0.5, t)
      const p1 = transformHairUv(t.flipU ? 0.15 : 0.85, 0.5, t)
      const c0 = uvToCanvas(p0.u, p0.v)
      const c1 = uvToCanvas(p1.u, p1.v)
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(c0.x, c0.y)
      ctx.lineTo(c1.x, c1.y)
      ctx.stroke()
      const ang = Math.atan2(c1.y - c0.y, c1.x - c0.x)
      ctx.beginPath()
      ctx.moveTo(c1.x, c1.y)
      ctx.lineTo(c1.x - 7 * Math.cos(ang - 0.4), c1.y - 7 * Math.sin(ang - 0.4))
      ctx.lineTo(c1.x - 7 * Math.cos(ang + 0.4), c1.y - 7 * Math.sin(ang + 0.4))
      ctx.closePath()
      ctx.fillStyle = 'rgba(255,255,255,0.55)'
      ctx.fill()
    }

    const drawHandle = (u: number, v: number, active: boolean) => {
      const c = uvToCanvas(u, v)
      ctx.fillStyle = active ? '#6ecbf5' : '#e8eaef'
      ctx.strokeStyle = '#0f1115'
      ctx.lineWidth = 1
      ctx.fillRect(c.x - HANDLE / 2, c.y - HANDLE / 2, HANDLE, HANDLE)
      ctx.strokeRect(c.x - HANDLE / 2, c.y - HANDLE / 2, HANDLE, HANDLE)
    }
    drawHandle(nw.u, nw.v, hoverHandle === 'nw')
    drawHandle(se.u, se.v, hoverHandle === 'se')

    ctx.fillStyle = 'rgba(255,255,255,0.45)'
    ctx.font = '10px ui-sans-serif, system-ui, sans-serif'
    ctx.textAlign = 'left'
    ctx.fillText('U →', 6, SIZE - 6)
    ctx.textAlign = 'right'
    ctx.fillText('V ↓', SIZE - 6, 14)
  }, [textureDoc, transform, hoverHandle])

  useEffect(() => {
    paint()
  }, [paint])

  const hitTest = (x: number, y: number): DragMode => {
    const { nw, se } = rectCorners(transform)
    const nwC = uvToCanvas(nw.u, nw.v)
    const seC = uvToCanvas(se.u, se.v)
    if (Math.hypot(x - nwC.x, y - nwC.y) <= HANDLE + 2) return 'scale-nw'
    if (Math.hypot(x - seC.x, y - seC.y) <= HANDLE + 2) return 'scale-se'
    const rx = Math.min(nwC.x, seC.x)
    const ry = Math.min(nwC.y, seC.y)
    const rw = Math.abs(seC.x - nwC.x)
    const rh = Math.abs(seC.y - nwC.y)
    if (x >= rx && x <= rx + rw && y >= ry && y <= ry + rh) return 'move'
    return null
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * SIZE
    const y = ((e.clientY - rect.top) / rect.height) * SIZE
    const mode = hitTest(x, y)
    if (!mode) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = {
      mode,
      startX: x,
      startY: y,
      start: { ...transform },
    }
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * SIZE
    const y = ((e.clientY - rect.top) / rect.height) * SIZE

    const drag = dragRef.current
    if (!drag) {
      const hit = hitTest(x, y)
      setHoverHandle(hit === 'scale-nw' ? 'nw' : hit === 'scale-se' ? 'se' : hit === 'move' ? 'body' : null)
      return
    }

    const du = (x - drag.startX) / SIZE
    const dv = (y - drag.startY) / SIZE
    const s = drag.start

    if (drag.mode === 'move') {
      onChange({
        ...s,
        offsetU: clamp(s.offsetU + du, -0.5, 1.5),
        offsetV: clamp(s.offsetV + dv, -0.5, 1.5),
      })
      return
    }

    if (drag.mode === 'scale-se') {
      onChange({
        ...s,
        scaleU: clamp(s.scaleU + du, MIN_SCALE, 2),
        scaleV: clamp(s.scaleV + dv, MIN_SCALE, 2),
      })
      return
    }

    if (drag.mode === 'scale-nw') {
      const seU = s.offsetU + s.scaleU
      const seV = s.offsetV + s.scaleV
      const newScaleU = clamp(s.scaleU - du, MIN_SCALE, 2)
      const newScaleV = clamp(s.scaleV - dv, MIN_SCALE, 2)
      onChange({
        ...s,
        offsetU: seU - newScaleU,
        offsetV: seV - newScaleV,
        scaleU: newScaleU,
        scaleV: newScaleV,
      })
    }
  }

  const endDrag = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current) {
      dragRef.current = null
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        /* already released */
      }
    }
  }

  return (
    <div className="hair-uv-editor">
      <div className="hair-uv-editor-label">
        Hair UV mapping
        <span className="hair-uv-editor-hint">Drag strip · corners scale</span>
      </div>
      <canvas
        ref={canvasRef}
        className="hair-uv-canvas"
        width={SIZE}
        height={SIZE}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{
          cursor:
            hoverHandle === 'nw' || hoverHandle === 'se'
              ? 'nwse-resize'
              : hoverHandle === 'body'
                ? 'move'
                : 'default',
        }}
        aria-label="Hair UV mapping editor"
      />
      <div className="hair-uv-toolbar">
        <button
          type="button"
          className="side-btn"
          onClick={() => onChange({ ...transform, flipU: !transform.flipU })}
          title="Flip along length (U)"
        >
          Flip H
        </button>
        <button
          type="button"
          className="side-btn"
          onClick={() => onChange({ ...transform, flipV: !transform.flipV })}
          title="Flip across width (V)"
        >
          Flip V
        </button>
        <button
          type="button"
          className="side-btn"
          onClick={() =>
            onChange({
              ...transform,
              rotationDeg: (((transform.rotationDeg + 90) % 360) + 360) % 360,
            })
          }
          title="Rotate mapping 90°"
        >
          Rotate 90°
        </button>
        <button type="button" className="side-btn" onClick={onReset} title="Reset to full texture">
          Reset
        </button>
      </div>
      <p className="hair-uv-meta muted">
        U {transform.offsetU.toFixed(2)}→{(transform.offsetU + transform.scaleU).toFixed(2)} · V{' '}
        {transform.offsetV.toFixed(2)}→{(transform.offsetV + transform.scaleV).toFixed(2)}
        {transform.flipU || transform.flipV
          ? ` · flip${transform.flipU ? ' H' : ''}${transform.flipV ? ' V' : ''}`
          : ''}
        {((transform.rotationDeg % 360) + 360) % 360 !== 0
          ? ` · ${(((transform.rotationDeg % 360) + 360) % 360).toFixed(0)}°`
          : ''}
      </p>
    </div>
  )
}
