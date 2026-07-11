function parseHexColor(hex: string): [number, number, number] | null {
  let h = hex.trim()
  if (h.startsWith('#')) h = h.slice(1)
  if (h.length === 3) {
    h = `${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`
  }
  if (h.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(h)) return null
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
}

function channelToLinear(channel: number): number {
  const s = channel / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

/** Relative luminance 0–1 (WCAG). Higher = lighter surface. */
export function relativeLuminance(hex: string): number {
  const rgb = parseHexColor(hex)
  if (!rgb) return 0
  const [r, g, b] = rgb.map(channelToLinear)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** True when a surface hex is light enough that dark text is needed. */
export function isLightHex(hex: string): boolean {
  return relativeLuminance(hex) > 0.45
}

/** Darken a hex color toward black. `amount` is 0 (unchanged) to 1 (black). */
export function darkenHex(hex: string, amount: number): string {
  const rgb = parseHexColor(hex)
  if (!rgb) return hex
  const t = Math.max(0, Math.min(1, amount))
  const f = 1 - t
  const r = Math.round(rgb[0] * f)
  const g = Math.round(rgb[1] * f)
  const b = Math.round(rgb[2] * f)
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

/** Lighten a hex color toward white. `amount` is 0 (unchanged) to 1 (white). */
export function lightenHex(hex: string, amount: number): string {
  const rgb = parseHexColor(hex)
  if (!rgb) return hex
  const t = Math.max(0, Math.min(1, amount))
  const r = Math.round(rgb[0] + (255 - rgb[0]) * t)
  const g = Math.round(rgb[1] + (255 - rgb[1]) * t)
  const b = Math.round(rgb[2] + (255 - rgb[2]) * t)
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}
