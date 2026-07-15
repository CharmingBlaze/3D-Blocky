export interface DisplayRect {
  left: number
  top: number
  width: number
  height: number
}

/** Map a pointer on the displayed texture directly to document texels. */
export function pointerToDocumentPixel(
  clientX: number,
  clientY: number,
  rect: DisplayRect,
  documentWidth: number,
  documentHeight: number,
  continuous = false
): { x: number; y: number } | null {
  if (rect.width <= 0 || rect.height <= 0 || documentWidth <= 0 || documentHeight <= 0) {
    return null
  }
  const x = ((clientX - rect.left) / rect.width) * documentWidth
  const y = ((clientY - rect.top) / rect.height) * documentHeight
  if (x < 0 || y < 0 || x >= documentWidth || y >= documentHeight) return null
  return continuous ? { x, y } : { x: Math.floor(x), y: Math.floor(y) }
}
