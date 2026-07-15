/** True when any texel stores a non-opaque alpha (PNG/WebP/GIF/etc. with transparency). */
export function rgbaBufferHasAlpha(pixels: ArrayLike<number>): boolean {
  for (let i = 3; i < pixels.length; i += 4) {
    if ((pixels[i] ?? 255) < 255) return true
  }
  return false
}
