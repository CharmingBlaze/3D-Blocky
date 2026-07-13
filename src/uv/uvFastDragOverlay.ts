/** Helpers for UV editor transform-drag: paint once, then blit + overlay. */

export function isUvTransformDragKind(
  kind: string | null | undefined
): kind is 'faceDrag' | 'faceScale' | 'faceRotate' {
  return kind === 'faceDrag' || kind === 'faceScale' || kind === 'faceRotate'
}

export function ensureUvDragStaticCanvas(
  current: HTMLCanvasElement | null,
  width: number,
  height: number
): HTMLCanvasElement {
  const canvas =
    current && current.width === width && current.height === height
      ? current
      : document.createElement('canvas')
  if (canvas.width !== width) canvas.width = width
  if (canvas.height !== height) canvas.height = height
  return canvas
}

export function blitUvDragStatic(
  ctx: CanvasRenderingContext2D,
  source: HTMLCanvasElement
): void {
  ctx.drawImage(source, 0, 0)
}

export function copyCanvasTo(
  source: HTMLCanvasElement,
  target: HTMLCanvasElement
): void {
  const ctx = target.getContext('2d')
  if (!ctx) return
  if (target.width !== source.width) target.width = source.width
  if (target.height !== source.height) target.height = source.height
  ctx.clearRect(0, 0, target.width, target.height)
  ctx.drawImage(source, 0, 0)
}
