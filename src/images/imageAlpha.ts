/** True when any texel stores a non-opaque alpha (PNG/WebP/GIF/etc. with transparency). */
export function rgbaBufferHasAlpha(pixels: ArrayLike<number>): boolean {
  for (let i = 3; i < pixels.length; i += 4) {
    if ((pixels[i] ?? 255) < 255) return true
  }
  return false
}

/** True when any texel in a document-space rect has non-opaque alpha. */
export function rgbaBufferRegionHasAlpha(
  pixels: ArrayLike<number>,
  width: number,
  rect: { x: number; y: number; w: number; h: number }
): boolean {
  if (rect.w <= 0 || rect.h <= 0 || width <= 0) return false
  const x1 = rect.x + rect.w
  const y1 = rect.y + rect.h
  for (let y = rect.y; y < y1; y++) {
    for (let x = rect.x; x < x1; x++) {
      if ((pixels[(y * width + x) * 4 + 3] ?? 255) < 255) return true
    }
  }
  return false
}
