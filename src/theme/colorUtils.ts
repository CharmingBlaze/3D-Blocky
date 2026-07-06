function parseHexColor(hex: string): [number, number, number] | null {
  let h = hex.trim()
  if (h.startsWith('#')) h = h.slice(1)
  if (h.length === 3) {
    h = `${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`
  }
  if (h.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(h)) return null
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
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
