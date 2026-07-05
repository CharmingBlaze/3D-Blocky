import { useMemo } from 'react'
import { ColorWheelPicker } from './ColorWheelPicker'
import { PRESET_PALETTES } from '../../material/palettes'
import type { CustomPalette, HarmonyScheme, Rgba4 } from '../../material/materialTypes'
import { hexToRgba4, rgba4ToHex } from '../../material/materialTypes'

export interface ColorPickerSectionProps {
  color: Rgba4
  paletteId: string
  customPalettes: CustomPalette[]
  onChange: (color: Rgba4) => void
  onCommit: (color: Rgba4) => void
  onPaletteIdChange: (id: string) => void
  onAddSwatch: () => void
  onHarmony: (scheme: HarmonyScheme) => void
  hintLabel?: string
}

/** Shared color wheel + palette strip (material paint or pixel pen). */
export function ColorPickerSection({
  color,
  paletteId,
  customPalettes,
  onChange,
  onCommit,
  onPaletteIdChange,
  onAddSwatch,
  onHarmony,
  hintLabel = 'Color',
}: ColorPickerSectionProps) {
  const paletteOptions = useMemo(
    () => [
      ...PRESET_PALETTES.map((p) => ({ id: p.id, name: p.name })),
      ...customPalettes.map((p) => ({ id: p.id, name: p.name })),
    ],
    [customPalettes]
  )

  const swatches = useMemo(() => {
    const preset = PRESET_PALETTES.find((p) => p.id === paletteId)
    if (preset) return preset.colors
    const custom = customPalettes.find((p) => p.id === paletteId)
    return custom?.colors ?? PRESET_PALETTES[0]!.colors
  }, [paletteId, customPalettes])

  const schemes: HarmonyScheme[] = ['complementary', 'analogous', 'triadic', 'monochromatic']

  return (
    <div className="mat-color-section">
      <ColorWheelPicker color={color} onChange={onChange} onCommit={onCommit} />
      <label className="mat-field">
        <span>Palette</span>
        <select
          className="shape-kind-select side-select"
          value={paletteId}
          onChange={(e) => onPaletteIdChange(e.target.value)}
        >
          {paletteOptions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <div className="mat-palette-grid">
        {swatches.map((hex, i) => (
          <button
            key={`${hex}-${i}`}
            type="button"
            className="mat-palette-swatch"
            style={{ background: hex }}
            title={hex}
            onClick={() => onCommit(hexToRgba4(hex, color[3]))}
          />
        ))}
        <button type="button" className="mat-palette-swatch add" onClick={onAddSwatch} title="Add swatch">
          +
        </button>
      </div>
      <div className="mat-harmony-row">
        {schemes.map((scheme) => (
          <button key={scheme} type="button" className="side-btn" onClick={() => onHarmony(scheme)}>
            {scheme.slice(0, 4)}
          </button>
        ))}
      </div>
      <p className="side-color-hint muted">
        {hintLabel}: {rgba4ToHex(color)} · {Math.round(color[3] * 100)}% alpha
      </p>
    </div>
  )
}
