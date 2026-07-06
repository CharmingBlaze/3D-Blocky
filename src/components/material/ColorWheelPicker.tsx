import { useCallback, useEffect, useRef, useState } from 'react'
import type { Rgba4 } from '../../material/materialTypes'
import { hexToRgba4, rgba4ToHex } from '../../material/materialTypes'
import { useTheme } from '../../theme/useTheme'

interface ColorWheelPickerProps {
  color: Rgba4
  onChange: (color: Rgba4) => void
  onCommit: (color: Rgba4) => void
  showAlpha?: boolean
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  const s = max === 0 ? 0 : d / max
  const v = max
  if (d !== 0) {
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6
        break
      case g:
        h = ((b - r) / d + 2) / 6
        break
      default:
        h = ((r - g) / d + 4) / 6
    }
  }
  return [h, s, v]
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const i = Math.floor(h * 6)
  const f = h * 6 - i
  const p = v * (1 - s)
  const q = v * (1 - f * s)
  const t = v * (1 - (1 - f) * s)
  switch (i % 6) {
    case 0:
      return [v, t, p]
    case 1:
      return [q, v, p]
    case 2:
      return [p, v, t]
    case 3:
      return [p, q, v]
    case 4:
      return [t, p, v]
    default:
      return [v, p, q]
  }
}

export function ColorWheelPicker({ color, onChange, onCommit, showAlpha = true }: ColorWheelPickerProps) {
  const { bgPanel, text, bgDark } = useTheme()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const svRef = useRef<HTMLCanvasElement>(null)
  const draggingRef = useRef<'hue' | 'sv' | null>(null)
  const [h, s, v] = rgbToHsv(color[0], color[1], color[2])
  const [hexInput, setHexInput] = useState(rgba4ToHex(color))

  useEffect(() => {
    setHexInput(rgba4ToHex(color))
  }, [color])

  const emit = useCallback(
    (nh: number, ns: number, nv: number, alpha: number, commit: boolean) => {
      const [r, g, b] = hsvToRgb(((nh % 1) + 1) % 1, ns, nv)
      const next: Rgba4 = [r, g, b, alpha]
      onChange(next)
      if (commit) onCommit(next)
    },
    [onChange, onCommit]
  )

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const size = canvas.width
    const cx = size / 2
    const cy = size / 2
    const outer = size / 2 - 2
    const inner = outer - 14
    ctx.clearRect(0, 0, size, size)
    // Hue 0° (red) at 12 o'clock — match pick/marker math (not canvas default 3 o'clock).
    for (let hueDeg = 0; hueDeg < 360; hueDeg++) {
      const start = ((hueDeg - 90 - 1) * Math.PI) / 180
      const end = ((hueDeg - 90 + 1) * Math.PI) / 180
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.arc(cx, cy, outer, start, end)
      ctx.closePath()
      ctx.fillStyle = `hsl(${hueDeg}, 100%, 50%)`
      ctx.fill()
    }
    ctx.beginPath()
    ctx.arc(cx, cy, inner, 0, Math.PI * 2)
    ctx.fillStyle = bgPanel
    ctx.fill()
    const markerAngle = h * Math.PI * 2 - Math.PI / 2
    const mx = cx + Math.cos(markerAngle) * (inner + 7)
    const my = cy + Math.sin(markerAngle) * (inner + 7)
    ctx.beginPath()
    ctx.arc(mx, my, 5, 0, Math.PI * 2)
    ctx.fillStyle = text
    ctx.fill()
    ctx.strokeStyle = bgDark
    ctx.lineWidth = 1.5
    ctx.stroke()
  }, [h, bgPanel, text, bgDark])

  useEffect(() => {
    const canvas = svRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const w = canvas.width
    const hPx = canvas.height
    const [hr, hg, hb] = hsvToRgb(((h % 1) + 1) % 1, 1, 1)
    ctx.fillStyle = `rgb(${Math.round(hr * 255)}, ${Math.round(hg * 255)}, ${Math.round(hb * 255)})`
    ctx.fillRect(0, 0, w, hPx)
    const white = ctx.createLinearGradient(0, 0, w, 0)
    white.addColorStop(0, '#fff')
    white.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = white
    ctx.fillRect(0, 0, w, hPx)
    const black = ctx.createLinearGradient(0, 0, 0, hPx)
    black.addColorStop(0, 'rgba(0,0,0,0)')
    black.addColorStop(1, '#000')
    ctx.fillStyle = black
    ctx.fillRect(0, 0, w, hPx)
    ctx.beginPath()
    ctx.arc(s * w, (1 - v) * hPx, 5, 0, Math.PI * 2)
    ctx.strokeStyle = text
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.strokeStyle = bgDark
    ctx.lineWidth = 1
    ctx.stroke()
  }, [h, s, v, text, bgDark])

  const pickHue = useCallback(
    (clientX: number, clientY: number, commit: boolean) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2
      const ang = Math.atan2(clientY - cy, clientX - cx) + Math.PI / 2
      const nh = ((ang / (Math.PI * 2)) % 1 + 1) % 1
      emit(nh, s, v, color[3], commit)
    },
    [color, emit, s, v]
  )

  const pickSv = useCallback(
    (clientX: number, clientY: number, commit: boolean) => {
      const canvas = svRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const ns = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      const nv = Math.max(0, Math.min(1, 1 - (clientY - rect.top) / rect.height))
      emit(h, ns, nv, color[3], commit)
    },
    [color, emit, h]
  )

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (draggingRef.current === 'hue') pickHue(e.clientX, e.clientY, false)
      if (draggingRef.current === 'sv') pickSv(e.clientX, e.clientY, false)
    }
    const onUp = (e: PointerEvent) => {
      if (draggingRef.current === 'hue') pickHue(e.clientX, e.clientY, true)
      if (draggingRef.current === 'sv') pickSv(e.clientX, e.clientY, true)
      draggingRef.current = null
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [pickHue, pickSv])

  return (
    <div className="mat-color-picker">
      <div className="mat-color-wheel-wrap">
        <canvas
          ref={canvasRef}
          width={120}
          height={120}
          className="mat-color-wheel"
          onPointerDown={(e) => {
            draggingRef.current = 'hue'
            pickHue(e.clientX, e.clientY, false)
          }}
        />
      </div>
      <div className="mat-color-sv-wrap">
        <canvas
          ref={svRef}
          width={140}
          height={100}
          className="mat-color-sv"
          onPointerDown={(e) => {
            draggingRef.current = 'sv'
            pickSv(e.clientX, e.clientY, false)
          }}
        />
      </div>
      <div className="mat-color-fields">
        <label className="mat-field">
          <span>Hex</span>
          <input
            type="text"
            value={hexInput}
            onChange={(e) => setHexInput(e.target.value)}
            onBlur={() => {
              const parsed = hexToRgba4(hexInput.startsWith('#') ? hexInput : `#${hexInput}`, color[3])
              onCommit(parsed)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const parsed = hexToRgba4(hexInput.startsWith('#') ? hexInput : `#${hexInput}`, color[3])
                onCommit(parsed)
              }
            }}
          />
        </label>
        <label className="mat-field">
          <span>RGB</span>
          <span className="mat-field-readout">
            {Math.round(color[0] * 255)}, {Math.round(color[1] * 255)}, {Math.round(color[2] * 255)}
          </span>
        </label>
        <label className="mat-field">
          <span>HSV</span>
          <span className="mat-field-readout">
            {Math.round(h * 360)}°, {Math.round(s * 100)}%, {Math.round(v * 100)}%
          </span>
        </label>
        {showAlpha && (
          <label className="mat-field mat-alpha-field">
            <span>Alpha</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(color[3] * 100)}
              onChange={(e) => emit(h, s, v, Number(e.target.value) / 100, false)}
              onPointerUp={(e) => emit(h, s, v, Number((e.target as HTMLInputElement).value) / 100, true)}
            />
            <span className="mat-field-readout">{Math.round(color[3] * 100)}%</span>
          </label>
        )}
      </div>
      {showAlpha && (
        <div
          className="mat-alpha-preview"
          style={{
            background: `linear-gradient(45deg, #80808040 25%, transparent 25%) 0 0 / 10px 10px,
              linear-gradient(-45deg, #80808040 25%, transparent 25%) 0 0 / 10px 10px,
              rgba(${Math.round(color[0] * 255)}, ${Math.round(color[1] * 255)}, ${Math.round(color[2] * 255)}, ${color[3]})`,
          }}
          title="Active color with alpha"
        />
      )}
    </div>
  )
}
