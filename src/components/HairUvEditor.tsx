import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { compositeLayers } from '../pixel/compositeLayers'
import type { PixelDocument } from '../pixel/pixelTypes'
import { type HairUvTransform, transformHairUv } from '../stroke/hairUvTransform'
import type { HairTipStyle } from '../mesh/hairRibbon'

const SIZE = 220
const HANDLE = 8
const MIN_SCALE = 0.08
const MIN_ZOOM = 0.04
const MAX_ZOOM = 24

type DragMode = 'move' | 'scale-se' | 'scale-nw' | 'pan' | null
type View2D = { centerU: number; centerV: number; zoom: number }

interface HairUvEditorProps {
  transform: HairUvTransform
  onChange: (next: HairUvTransform) => void
  onReset: () => void
  textureDoc: PixelDocument | null
  shape: HairTipStyle
  onShapeChange: (shape: HairTipStyle) => void
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

function rectCorners(t: HairUvTransform) {
  return {
    nw: { u: t.offsetU, v: t.offsetV },
    se: { u: t.offsetU + t.scaleU, v: t.offsetV + t.scaleV },
  }
}

function hairOutlinePoints(steps = 24, shape: HairTipStyle = 'pointed'): { u: number; v: number }[] {
  const pts: { u: number; v: number }[] = []
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const taper = shape === 'square' ? 1 : t < 0.35 ? (t / 0.35) ** 2 : t > 0.65 ? ((1 - t) / 0.35) ** 2 : 1
    const half = 0.5 * Math.max(0.04, taper)
    pts.push({ u: t, v: 0.5 - half })
  }
  for (let i = steps; i >= 0; i--) {
    const t = i / steps
    const taper = shape === 'square' ? 1 : t < 0.35 ? (t / 0.35) ** 2 : t > 0.65 ? ((1 - t) / 0.35) ** 2 : 1
    const half = 0.5 * Math.max(0.04, taper)
    pts.push({ u: t, v: 0.5 + half })
  }
  return pts
}

export function HairUvEditor({ transform, onChange, onReset, textureDoc, shape, onShapeChange }: HairUvEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragRef = useRef<{
    mode: DragMode
    startX: number
    startY: number
    start: HairUvTransform
    startView: View2D
  } | null>(null)
  const [view, setView] = useState<View2D>({ centerU: 0.5, centerV: 0.5, zoom: 0.9 })
  const [hoverHandle, setHoverHandle] = useState<'nw' | 'se' | 'body' | null>(null)

  const uvToCanvas = useCallback((u: number, v: number) => ({
    x: SIZE / 2 + (u - view.centerU) * SIZE * view.zoom,
    y: SIZE / 2 + (v - view.centerV) * SIZE * view.zoom,
  }), [view])

  const canvasToUv = useCallback((x: number, y: number) => ({
    u: view.centerU + (x - SIZE / 2) / (SIZE * view.zoom),
    v: view.centerV + (y - SIZE / 2) / (SIZE * view.zoom),
  }), [view])

  const fitTexture = useCallback(() => setView({ centerU: 0.5, centerV: 0.5, zoom: 0.9 }), [])

  const fitUv = useCallback(() => {
    const mapped = hairOutlinePoints(36, shape).map((p) => transformHairUv(p.u, p.v, transform))
    const minU = Math.min(...mapped.map((p) => p.u))
    const maxU = Math.max(...mapped.map((p) => p.u))
    const minV = Math.min(...mapped.map((p) => p.v))
    const maxV = Math.max(...mapped.map((p) => p.v))
    const span = Math.max(maxU - minU, maxV - minV, 0.05)
    setView({ centerU: (minU + maxU) / 2, centerV: (minV + maxV) / 2, zoom: clamp(0.78 / span, MIN_ZOOM, MAX_ZOOM) })
  }, [transform, shape])

  const paint = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.clearRect(0, 0, SIZE, SIZE)

    const tile = 12
    for (let y = 0; y < SIZE; y += tile) for (let x = 0; x < SIZE; x += tile) {
      ctx.fillStyle = ((x / tile) + (y / tile)) % 2 === 0 ? '#2a2d36' : '#1e2128'
      ctx.fillRect(x, y, tile, tile)
    }

    const texA = uvToCanvas(0, 0)
    const texB = uvToCanvas(1, 1)
    if (textureDoc) {
      try {
        const off = document.createElement('canvas')
        off.width = textureDoc.width
        off.height = textureDoc.height
        off.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(compositeLayers(textureDoc)), textureDoc.width, textureDoc.height), 0, 0)
        ctx.imageSmoothingEnabled = false
        ctx.drawImage(off, texA.x, texA.y, texB.x - texA.x, texB.y - texA.y)
      } catch { /* checkerboard remains */ }
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.06)'
      ctx.fillRect(texA.x, texA.y, texB.x - texA.x, texB.y - texA.y)
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.28)'
    ctx.lineWidth = 1
    ctx.strokeRect(texA.x, texA.y, texB.x - texA.x, texB.y - texA.y)

    const topLeft = canvasToUv(0, 0)
    const bottomRight = canvasToUv(SIZE, SIZE)
    const step = view.zoom > 3 ? 0.1 : view.zoom > 0.55 ? 0.25 : view.zoom > 0.12 ? 1 : 5
    ctx.beginPath()
    for (let u = Math.floor(topLeft.u / step) * step; u <= bottomRight.u; u += step) {
      const p = uvToCanvas(u, 0).x
      ctx.moveTo(p, 0); ctx.lineTo(p, SIZE)
    }
    for (let v = Math.floor(topLeft.v / step) * step; v <= bottomRight.v; v += step) {
      const p = uvToCanvas(0, v).y
      ctx.moveTo(0, p); ctx.lineTo(SIZE, p)
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.09)'
    ctx.stroke()

    const { nw, se } = rectCorners(transform)
    const a = uvToCanvas(nw.u, nw.v)
    const b = uvToCanvas(se.u, se.v)
    ctx.fillStyle = 'rgba(110, 203, 245, 0.13)'
    ctx.strokeStyle = 'rgba(110, 203, 245, 0.78)'
    ctx.lineWidth = 1.25
    ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y))
    ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y))

    const outline = hairOutlinePoints(24, shape)
    ctx.beginPath()
    outline.forEach((p, i) => {
      const mapped = transformHairUv(p.u, p.v, transform)
      const c = uvToCanvas(mapped.u, mapped.v)
      if (i === 0) ctx.moveTo(c.x, c.y); else ctx.lineTo(c.x, c.y)
    })
    ctx.closePath()
    ctx.fillStyle = 'rgba(236, 180, 120, 0.35)'
    ctx.strokeStyle = 'rgba(236, 180, 120, 0.95)'
    ctx.lineWidth = 1.5
    ctx.fill(); ctx.stroke()

    const drawHandle = (u: number, v: number, active: boolean) => {
      const c = uvToCanvas(u, v)
      ctx.fillStyle = active ? '#6ecbf5' : '#e8eaef'
      ctx.strokeStyle = '#0f1115'
      ctx.fillRect(c.x - HANDLE / 2, c.y - HANDLE / 2, HANDLE, HANDLE)
      ctx.strokeRect(c.x - HANDLE / 2, c.y - HANDLE / 2, HANDLE, HANDLE)
    }
    drawHandle(nw.u, nw.v, hoverHandle === 'nw')
    drawHandle(se.u, se.v, hoverHandle === 'se')

    ctx.font = '10px ui-sans-serif, system-ui, sans-serif'
    ctx.fillStyle = 'rgba(255,255,255,0.55)'
    ctx.textAlign = 'left'; ctx.fillText('U →', 6, SIZE - 6)
    ctx.textAlign = 'right'; ctx.fillText(`${Math.round(view.zoom * 100)}%`, SIZE - 6, 14)
  }, [textureDoc, transform, shape, hoverHandle, view, uvToCanvas, canvasToUv])

  useEffect(() => { paint() }, [paint])

  const hitTest = (x: number, y: number): DragMode => {
    const { nw, se } = rectCorners(transform)
    const a = uvToCanvas(nw.u, nw.v)
    const b = uvToCanvas(se.u, se.v)
    if (Math.hypot(x - a.x, y - a.y) <= HANDLE + 2) return 'scale-nw'
    if (Math.hypot(x - b.x, y - b.y) <= HANDLE + 2) return 'scale-se'
    if (x >= Math.min(a.x, b.x) && x <= Math.max(a.x, b.x) && y >= Math.min(a.y, b.y) && y <= Math.max(a.y, b.y)) return 'move'
    return null
  }

  const eventPoint = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: ((e.clientX - rect.left) / rect.width) * SIZE, y: ((e.clientY - rect.top) / rect.height) * SIZE }
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    e.stopPropagation()
    const { x, y } = eventPoint(e)
    const mode = e.button === 1 ? 'pan' : e.button === 0 ? hitTest(x, y) : null
    if (!mode) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { mode, startX: x, startY: y, start: { ...transform }, startView: { ...view } }
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    e.stopPropagation()
    const { x, y } = eventPoint(e)
    const drag = dragRef.current
    if (!drag) {
      const hit = hitTest(x, y)
      setHoverHandle(hit === 'scale-nw' ? 'nw' : hit === 'scale-se' ? 'se' : hit === 'move' ? 'body' : null)
      return
    }
    const dx = x - drag.startX
    const dy = y - drag.startY
    if (drag.mode === 'pan') {
      setView({ ...drag.startView, centerU: drag.startView.centerU - dx / (SIZE * drag.startView.zoom), centerV: drag.startView.centerV - dy / (SIZE * drag.startView.zoom) })
      return
    }
    const du = dx / (SIZE * view.zoom)
    const dv = dy / (SIZE * view.zoom)
    const s = drag.start
    if (drag.mode === 'move') onChange({ ...s, offsetU: clamp(s.offsetU + du, -12, 12), offsetV: clamp(s.offsetV + dv, -12, 12) })
    if (drag.mode === 'scale-se') onChange({ ...s, scaleU: clamp(s.scaleU + du, MIN_SCALE, 12), scaleV: clamp(s.scaleV + dv, MIN_SCALE, 12) })
    if (drag.mode === 'scale-nw') {
      const scaleU = clamp(s.scaleU - du, MIN_SCALE, 12)
      const scaleV = clamp(s.scaleV - dv, MIN_SCALE, 12)
      onChange({ ...s, offsetU: s.offsetU + s.scaleU - scaleU, offsetV: s.offsetV + s.scaleV - scaleV, scaleU, scaleV })
    }
  }

  const endDrag = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    e.stopPropagation()
    dragRef.current = null
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* released */ }
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const consumeWheel = (e: WheelEvent) => {
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()
      const rect = canvas.getBoundingClientRect()
      const x = ((e.clientX - rect.left) / rect.width) * SIZE
      const y = ((e.clientY - rect.top) / rect.height) * SIZE
      setView((current) => {
        const beforeU = current.centerU + (x - SIZE / 2) / (SIZE * current.zoom)
        const beforeV = current.centerV + (y - SIZE / 2) / (SIZE * current.zoom)
        const zoom = clamp(current.zoom * Math.exp(-e.deltaY * 0.0015), MIN_ZOOM, MAX_ZOOM)
        return {
          zoom,
          centerU: beforeU - (x - SIZE / 2) / (SIZE * zoom),
          centerV: beforeV - (y - SIZE / 2) / (SIZE * zoom),
        }
      })
    }
    canvas.addEventListener('wheel', consumeWheel, { passive: false, capture: true })
    return () => canvas.removeEventListener('wheel', consumeWheel, { capture: true })
  }, [])

  const zoomBy = (factor: number) => setView((v) => ({ ...v, zoom: clamp(v.zoom * factor, MIN_ZOOM, MAX_ZOOM) }))
  const quarterTurn = Math.round((((transform.rotationDeg % 360) + 360) % 360) / 90) % 2 === 1
  const visualWidth = quarterTurn ? transform.scaleV : transform.scaleU
  const visualHeight = quarterTurn ? transform.scaleU : transform.scaleV
  const setVisualSize = (axis: 'width' | 'height', value: number) => {
    const next = clamp(value || MIN_SCALE, MIN_SCALE, 12)
    if (axis === 'width') onChange({ ...transform, ...(quarterTurn ? { scaleV: next } : { scaleU: next }) })
    else onChange({ ...transform, ...(quarterTurn ? { scaleU: next } : { scaleV: next }) })
  }

  return (
    <div className="hair-uv-editor">
      <div className="hair-uv-editor-label">
        Hair UV mapping
        <span className="hair-uv-editor-hint">Wheel zoom · Middle-drag pan</span>
      </div>
      <div className="hair-uv-canvas-wrap">
        <canvas ref={canvasRef} className="hair-uv-canvas" width={SIZE} height={SIZE}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}
          onAuxClick={(e) => { e.preventDefault(); e.stopPropagation() }}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation() }}
          style={{ cursor: dragRef.current?.mode === 'pan' ? 'grabbing' : hoverHandle === 'nw' || hoverHandle === 'se' ? 'nwse-resize' : hoverHandle === 'body' ? 'move' : 'crosshair' }}
          aria-label="Hair UV mapping editor" />
        <div className="hair-uv-view-controls">
          <button type="button" onClick={() => zoomBy(1.3)} title="Zoom in">+</button>
          <button type="button" onClick={() => zoomBy(1 / 1.3)} title="Zoom out">−</button>
        </div>
      </div>
      <div className="hair-uv-view-toolbar">
        <button type="button" className="side-btn" onClick={fitUv} title="Center and fit the complete hair UV">Fit UV</button>
        <button type="button" className="side-btn" onClick={fitTexture} title="Return camera to the full 0–1 texture">View texture</button>
      </div>
      <div className="hair-uv-shape-controls" aria-label="Hair UV shape">
        <span>Shape</span>
        <div>
          <button type="button" className={`side-btn ${shape === 'pointed' ? 'active' : ''}`} onClick={() => onShapeChange('pointed')}>Pointed</button>
          <button type="button" className={`side-btn ${shape === 'square' ? 'active' : ''}`} onClick={() => onShapeChange('square')}>Square</button>
        </div>
      </div>
      <div className="hair-uv-size-controls">
        <label>
          <span>UV width</span>
          <input type="number" min="0.08" max="12" step="0.01" value={Number(visualWidth.toFixed(3))} onChange={(e) => setVisualSize('width', Number(e.target.value))} />
        </label>
        <label>
          <span>UV height</span>
          <input type="number" min="0.08" max="12" step="0.01" value={Number(visualHeight.toFixed(3))} onChange={(e) => setVisualSize('height', Number(e.target.value))} />
        </label>
      </div>
      <div className="hair-uv-toolbar">
        <button type="button" className="side-btn" onClick={() => onChange({ ...transform, flipU: !transform.flipU })}>Flip H</button>
        <button type="button" className="side-btn" onClick={() => onChange({ ...transform, flipV: !transform.flipV })}>Flip V</button>
        <button type="button" className="side-btn" onClick={() => onChange({ ...transform, rotationDeg: (((transform.rotationDeg + 90) % 360) + 360) % 360 })}>Rotate 90°</button>
        <button type="button" className="side-btn" onClick={() => { onReset(); fitTexture() }}>Reset UV</button>
      </div>
      <p className="hair-uv-meta muted">
        U {transform.offsetU.toFixed(2)}→{(transform.offsetU + transform.scaleU).toFixed(2)} · V {transform.offsetV.toFixed(2)}→{(transform.offsetV + transform.scaleV).toFixed(2)}
        {transform.flipU || transform.flipV ? ` · flip${transform.flipU ? ' H' : ''}${transform.flipV ? ' V' : ''}` : ''}
        {((transform.rotationDeg % 360) + 360) % 360 !== 0 ? ` · ${(((transform.rotationDeg % 360) + 360) % 360).toFixed(0)}°` : ''}
      </p>
    </div>
  )
}
