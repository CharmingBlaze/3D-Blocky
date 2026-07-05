import type { CustomPalette, HarmonyScheme } from './materialTypes'
import { hexToRgba4, rgba4ToHex } from './materialTypes'

export interface PresetPalette {
  id: string
  name: string
  colors: string[]
  builtin: true
}

/** Built-in retro palettes — add new presets here only. */
export const PRESET_PALETTES: PresetPalette[] = [
  {
    id: 'gameboy',
    name: 'Game Boy',
    builtin: true,
    colors: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'],
  },
  {
    id: 'pico8',
    name: 'PICO-8',
    builtin: true,
    colors: [
      '#000000', '#1D2B53', '#7E2553', '#008751', '#AB5236', '#5F574F', '#C2C3C7', '#FFF1E8',
      '#FF004D', '#FFA300', '#FFEC27', '#00E436', '#29ADFF', '#83769C', '#FF77A8', '#FFCCAA',
    ],
  },
  {
    id: 'cga',
    name: 'CGA',
    builtin: true,
    colors: [
      '#000000', '#0000AA', '#00AA00', '#00AAAA', '#AA0000', '#AA00AA', '#AA5500', '#AAAAAA',
      '#555555', '#5555FF', '#55FF55', '#55FFFF', '#FF5555', '#FF55FF', '#FFFF55', '#FFFFFF',
    ],
  },
  {
    id: 'nes',
    name: 'NES',
    builtin: true,
    colors: [
      '#7C7C7C', '#0000FC', '#0000BC', '#4428BC', '#940084', '#A80020', '#A81000', '#881400',
      '#503000', '#007800', '#006800', '#005800', '#004058', '#000000', '#000000', '#000000',
      '#BCBCBC', '#0078F8', '#0058F8', '#6844FC', '#D800CC', '#E40058', '#F83800', '#E45C10',
      '#AC7C00', '#00B800', '#00A800', '#00A844', '#008888', '#000000', '#000000', '#000000',
      '#F8F8F8', '#3CBCFC', '#6888FC', '#9878F8', '#F878F8', '#F85898', '#F87858', '#FCA044',
      '#F8B800', '#B8F818', '#58D854', '#58F898', '#00E8D8', '#787878', '#000000', '#000000',
      '#FCFCFC', '#A4E4FC', '#B8B8F8', '#D8B8F8', '#F8B8F8', '#F8A4C0', '#F0D0B0', '#FCE0A8',
      '#F8D878', '#D8F878', '#B8F8B8', '#B8F8D8', '#00FCFC', '#F8D8F8', '#000000', '#000000',
    ],
  },
]

export const CUSTOM_PALETTE_ID = 'custom'

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

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

/** Generate a small palette from a base color using standard harmony rules. */
export function generateHarmonyPalette(baseHex: string, scheme: HarmonyScheme): string[] {
  const [r, g, b] = hexToRgba4(baseHex).slice(0, 3) as [number, number, number]
  const [h, s, v] = rgbToHsv(r, g, b)

  const toHex = (hr: number, hs: number, hv: number) => {
    const [rr, gg, bb] = hsvToRgb(((hr % 1) + 1) % 1, clamp01(hs), clamp01(hv))
    return rgba4ToHex([rr, gg, bb, 1])
  }

  switch (scheme) {
    case 'complementary':
      return [
        baseHex,
        toHex(h + 0.5, s, v),
        toHex(h, s * 0.65, v * 0.85),
        toHex(h + 0.5, s * 0.65, v * 0.85),
        toHex(h, s * 0.35, v * 0.55),
      ]
    case 'analogous':
      return [
        toHex(h - 0.08, s, v * 0.9),
        toHex(h - 0.04, s, v),
        baseHex,
        toHex(h + 0.04, s, v),
        toHex(h + 0.08, s, v * 0.9),
      ]
    case 'triadic':
      return [
        baseHex,
        toHex(h + 1 / 3, s, v),
        toHex(h + 2 / 3, s, v),
        toHex(h, s * 0.5, v * 0.75),
        toHex(h + 1 / 3, s * 0.5, v * 0.75),
      ]
    case 'monochromatic':
    default:
      return [
        toHex(h, s, v * 0.35),
        toHex(h, s * 0.85, v * 0.55),
        toHex(h, s * 0.7, v * 0.75),
        baseHex,
        toHex(h, s * 0.55, v),
      ]
  }
}

export function loadCustomPalettes(): CustomPalette[] {
  try {
    const raw = localStorage.getItem('lpo-custom-palettes')
    if (!raw) return [{ id: 'custom-default', name: 'My Palette', colors: [] }]
    const parsed = JSON.parse(raw) as CustomPalette[]
    return parsed.length > 0 ? parsed : [{ id: 'custom-default', name: 'My Palette', colors: [] }]
  } catch {
    return [{ id: 'custom-default', name: 'My Palette', colors: [] }]
  }
}

export function saveCustomPalettes(palettes: CustomPalette[]): void {
  try {
    localStorage.setItem('lpo-custom-palettes', JSON.stringify(palettes))
  } catch {
    /* ignore */
  }
}

export function loadPixelPenPalettes(): CustomPalette[] {
  try {
    const raw = localStorage.getItem('lpo-pixel-pen-palettes')
    if (!raw) return [{ id: 'pixel-pen-default', name: 'Pen swatches', colors: [] }]
    const parsed = JSON.parse(raw) as CustomPalette[]
    return parsed.length > 0
      ? parsed
      : [{ id: 'pixel-pen-default', name: 'Pen swatches', colors: [] }]
  } catch {
    return [{ id: 'pixel-pen-default', name: 'Pen swatches', colors: [] }]
  }
}

export function savePixelPenPalettes(palettes: CustomPalette[]): void {
  try {
    localStorage.setItem('lpo-pixel-pen-palettes', JSON.stringify(palettes))
  } catch {
    /* ignore */
  }
}

export function paletteColorsById(
  paletteId: string,
  customPalettes: CustomPalette[]
): string[] {
  if (paletteId === CUSTOM_PALETTE_ID) {
    return customPalettes[0]?.colors ?? []
  }
  const custom = customPalettes.find((p) => p.id === paletteId)
  if (custom) return custom.colors
  const preset = PRESET_PALETTES.find((p) => p.id === paletteId)
  return preset?.colors ?? PRESET_PALETTES[0]!.colors
}

export function allPaletteOptions(customPalettes: CustomPalette[]): Array<{ id: string; name: string }> {
  return [
    ...PRESET_PALETTES.map((p) => ({ id: p.id, name: p.name })),
    ...customPalettes.map((p) => ({ id: p.id, name: p.name })),
  ]
}
