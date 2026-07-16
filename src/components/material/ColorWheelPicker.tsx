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

const WHEEL_SIZE = 148
const SV_WIDTH = 148
const SV_HEIGHT = 110

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

function hsvToRgba4(h: number, s: number, v: number, alpha: number): Rgba4 {
  const [r, g, b] = hsvToRgb(((h % 1) + 1) % 1, s, v)
  return [r, g, b, alpha]
}

export function ColorWheelPicker({ color, onChange, onCommit, showAlpha = true }: ColorWheelPickerProps) {
  const { bgPanel, text, bgDark } = useTheme()
  const wheelRef = useRef<HTMLDivElement>(null)
  const svRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef<'hue' | 'sv' | null>(null)
  const changeRafRef = useRef(0)
  const pendingColorRef = useRef<Rgba4 | null>(null)
  const [dragging, setDragging] = useState(false)
  const [hsv, setHsv] = useState<[number, number, number]>(() => rgbToHsv(color[0], color[1], color[2]))
  const [hexInput, setHexInput] = useState(rgba4ToHex(color))

  const [h, s, v] = hsv
  const displayColor = hsvToRgba4(h, s, v, color[3])

  useEffect(() => {
    if (!dragging) {
      setHsv(rgbToHsv(color[0], color[1], color[2]))
      setHexInput(rgba4ToHex(color))
    }
  }, [color, dragging])

  const scheduleChange = useCallback(
    (next: Rgba4) => {
      pendingColorRef.current = next
      if (changeRafRef.current) return
      changeRafRef.current = requestAnimationFrame(() => {
        changeRafRef.current = 0
        const pending = pendingColorRef.current
        if (pending) onChange(pending)
      })
    },
    [onChange]
  )

  useEffect(
    () => () => {
      if (changeRafRef.current) cancelAnimationFrame(changeRafRef.current)
    },
    []
  )

  const applyHsv = useCallback(
    (nh: number, ns: number, nv: number, alpha: number, commit: boolean) => {
      const next = hsvToRgba4(nh, ns, nv, alpha)
      setHsv([((nh % 1) + 1) % 1, ns, nv])
      setHexInput(rgba4ToHex(next))
      if (commit) {
        if (changeRafRef.current) {
          cancelAnimationFrame(changeRafRef.current)
          changeRafRef.current = 0
        }
        pendingColorRef.current = null
        onChange(next)
        onCommit(next)
        return
      }
      scheduleChange(next)
    },
    [onChange, onCommit, scheduleChange]
  )

  const pickHue = useCallback(
    (clientX: number, clientY: number, commit: boolean) => {
      const el = wheelRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const cx = rect.left + rect.width / 2
      const cy = rect.top + rect.height / 2
      const dx = clientX - cx
      const dy = clientY - cy
      const dist = Math.hypot(dx, dy)
      const outer = rect.width / 2
      const inner = outer - 16
      if (dist < inner * 0.85 || dist > outer) return
      const ang = Math.atan2(dy, dx) + Math.PI / 2
      const nh = ((ang / (Math.PI * 2)) % 1 + 1) % 1
      applyHsv(nh, s, v, color[3], commit)
    },
    [applyHsv, color, s, v]
  )

  const pickSv = useCallback(
    (clientX: number, clientY: number, commit: boolean) => {
      const el = svRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const ns = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
      const nv = Math.max(0, Math.min(1, 1 - (clientY - rect.top) / rect.height))
      applyHsv(h, ns, nv, color[3], commit)
    },
    [applyHsv, color, h]
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
      setDragging(false)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [pickHue, pickSv])

  const hueDeg = Math.round(h * 360)

  return (
    <div className="mat-color-picker">
      <div
        ref={wheelRef}
        className="mat-color-wheel-wrap"
        style={{ width: WHEEL_SIZE, height: WHEEL_SIZE }}
        onPointerDown={(e) => {
          draggingRef.current = 'hue'
          setDragging(true)
          pickHue(e.clientX, e.clientY, false)
        }}
      >
        <div
          className="mat-color-wheel-ring"
          style={{
            background:
              'conic-gradient(from -90deg, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)',
          }}
        />
        <div className="mat-color-wheel-hole" style={{ background: bgPanel }} />
        <div
          className="mat-color-wheel-marker"
          style={{ transform: `rotate(${hueDeg}deg)` }}
          aria-hidden
        >
          <span
            className="mat-color-picker-marker mat-color-wheel-marker-dot"
            style={{
              background: text,
              boxShadow: `0 0 0 2px ${bgDark}, 0 0 0 3px rgba(255,255,255,0.55)`,
            }}
          />
        </div>
      </div>
      <div className="mat-color-sv-wrap">
        <div
          ref={svRef}
          className="mat-color-sv"
          style={{
            width: SV_WIDTH,
            height: SV_HEIGHT,
            background: `linear-gradient(to top, rgb(0 0 0), transparent),
              linear-gradient(to right, rgb(255 255 255), transparent),
              hsl(${hueDeg} 100% 50%)`,
          }}
          onPointerDown={(e) => {
            draggingRef.current = 'sv'
            setDragging(true)
            pickSv(e.clientX, e.clientY, false)
          }}
        />
        <span
          className="mat-color-picker-marker mat-color-sv-marker"
          style={{
            left: `${s * 100}%`,
            top: `${(1 - v) * 100}%`,
          }}
          aria-hidden
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
              onChange(parsed)
              onCommit(parsed)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const parsed = hexToRgba4(hexInput.startsWith('#') ? hexInput : `#${hexInput}`, color[3])
                onChange(parsed)
                onCommit(parsed)
              }
            }}
          />
        </label>
        <label className="mat-field">
          <span>RGB</span>
          <span className="mat-field-readout">
            {Math.round(displayColor[0] * 255)}, {Math.round(displayColor[1] * 255)},{' '}
            {Math.round(displayColor[2] * 255)}
          </span>
        </label>
        <label className="mat-field">
          <span>HSV</span>
          <span className="mat-field-readout">
            {hueDeg}°, {Math.round(s * 100)}%, {Math.round(v * 100)}%
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
              onChange={(e) => applyHsv(h, s, v, Number(e.target.value) / 100, false)}
              onPointerUp={(e) =>
                applyHsv(h, s, v, Number((e.target as HTMLInputElement).value) / 100, true)
              }
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
              rgba(${Math.round(displayColor[0] * 255)}, ${Math.round(displayColor[1] * 255)}, ${Math.round(displayColor[2] * 255)}, ${color[3]})`,
          }}
          title="Active color with alpha"
        />
      )}
    </div>
  )
}
