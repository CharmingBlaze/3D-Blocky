/** Adobe-style marching ants for pixel selection overlays. */

export function drawMarchingAnts(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  zoom: number,
  dashOffset: number
): void {
  const left = Math.min(x0, x1)
  const top = Math.min(y0, y1)
  const right = Math.max(x0, x1) + 1
  const bottom = Math.max(y0, y1) + 1
  const w = right - left
  const h = bottom - top
  if (w <= 0 || h <= 0) return

  const inv = 1 / Math.max(zoom, 0.5)
  const lw = Math.max(inv, 0.05)
  const dash = Math.max(3 * inv, inv * 2)
  const inset = lw * 0.5

  ctx.save()
  ctx.lineWidth = lw
  ctx.lineJoin = 'miter'
  ctx.setLineDash([dash, dash])

  // Black ants
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.92)'
  ctx.lineDashOffset = dashOffset * inv
  ctx.strokeRect(left + inset, top + inset, w - lw, h - lw)

  // White ants (half-phase) — classic Photoshop look
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)'
  ctx.lineDashOffset = dashOffset * inv + dash
  ctx.strokeRect(left + inset, top + inset, w - lw, h - lw)

  ctx.restore()
}

export function pointInPixelSelection(
  x: number,
  y: number,
  sel: { x0: number; y0: number; x1: number; y1: number }
): boolean {
  const x0 = Math.min(sel.x0, sel.x1)
  const y0 = Math.min(sel.y0, sel.y1)
  const x1 = Math.max(sel.x0, sel.x1)
  const y1 = Math.max(sel.y0, sel.y1)
  return x >= x0 && x <= x1 && y >= y0 && y <= y1
}
