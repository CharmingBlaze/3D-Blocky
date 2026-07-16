import { useId, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { ColorWheelPicker } from './ColorWheelPicker'
import { PALETTE } from '../../palette/drawPalette'
import { hexToRgba4, rgba4ToHex, type Rgba4 } from '../../material/materialTypes'
import { useAppStore } from '../../store/appStore'

function colorToHex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`
}

function rgba4ToRgbInt(color: Rgba4): number {
  return (
    (Math.round(color[0] * 255) << 16) |
    (Math.round(color[1] * 255) << 8) |
    Math.round(color[2] * 255)
  )
}

/** Pixel Editor — color wheel, native picker, and scrollable CAD palette grid. */
export function PixelColorSection() {
  const [paletteCollapsed, setPaletteCollapsed] = useState(false)
  const contentId = useId()
  const {
    pixelEditorColor,
    setPixelEditorColorLive,
    commitPixelEditorColor,
    generatePixelHarmonyPalette,
  } = useAppStore(
    useShallow((s) => ({
      pixelEditorColor: s.pixelEditorColor,
      setPixelEditorColorLive: s.setPixelEditorColorLive,
      commitPixelEditorColor: s.commitPixelEditorColor,
      generatePixelHarmonyPalette: s.generatePixelHarmonyPalette,
    }))
  )

  const rgbInt = useMemo(() => rgba4ToRgbInt(pixelEditorColor), [pixelEditorColor])
  const hex = rgba4ToHex(pixelEditorColor)

  return (
    <div className="mat-color-section pixel-color-panel">
      <ColorWheelPicker
        color={pixelEditorColor}
        onChange={setPixelEditorColorLive}
        onCommit={commitPixelEditorColor}
      />

      <div className="palette-bar palette-bar-side pixel-color-palette">
        <button
          type="button"
          className="palette-minimize-toggle"
          onClick={() => setPaletteCollapsed((value) => !value)}
          aria-expanded={!paletteCollapsed}
          aria-controls={contentId}
          title={paletteCollapsed ? 'Expand palette' : 'Minimize palette'}
        >
          <span className="palette-minimize-label">
            <span className="palette-minimize-swatch" style={{ background: hex }} aria-hidden />
            Palette
          </span>
          <span className="side-section-chevron" aria-hidden>
            {paletteCollapsed ? '▸' : '▾'}
          </span>
        </button>
        <div id={contentId} className="palette-minimize-body" hidden={paletteCollapsed}>
          <div className="palette-scroll-box themed-scroll">
            <div className="palette-swatches">
              {PALETTE.map((color, index) => (
                <button
                  key={`${color}-${index}`}
                  type="button"
                  className={`palette-swatch ${rgbInt === color ? 'active' : ''}`}
                  style={{ background: colorToHex(color) }}
                  onClick={() =>
                    commitPixelEditorColor(hexToRgba4(colorToHex(color), pixelEditorColor[3]))
                  }
                  title={colorToHex(color)}
                />
              ))}
            </div>
          </div>
          <label className="palette-custom" title="Custom pen color">
            <span className="palette-custom-preview" style={{ background: hex }} />
            <input
              type="color"
              value={hex.slice(0, 7)}
              onChange={(e) =>
                commitPixelEditorColor(hexToRgba4(e.target.value, pixelEditorColor[3]))
              }
            />
          </label>
        </div>
      </div>

      <div className="mat-harmony-row">
        {(['complementary', 'analogous', 'triadic', 'monochromatic'] as const).map((scheme) => (
          <button
            key={scheme}
            type="button"
            className="side-btn"
            onClick={() => generatePixelHarmonyPalette(scheme)}
          >
            {scheme.slice(0, 4)}
          </button>
        ))}
      </div>

      <p className="side-color-hint muted">
        Pen: {hex} · {Math.round(pixelEditorColor[3] * 100)}% alpha
      </p>
    </div>
  )
}
