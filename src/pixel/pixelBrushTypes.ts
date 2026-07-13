/** Pixel Editor paint-brush tip shapes (Paint Brush tool only). */

export type PixelBrushShape = 'round' | 'square'

export type PixelBrushDef = {
  id: PixelBrushShape
  label: string
  hint: string
}

export const PIXEL_BRUSH_SHAPES: readonly PixelBrushDef[] = [
  { id: 'round', label: 'Round', hint: 'Circular soft/hard tip (use Hardness)' },
  { id: 'square', label: 'Square', hint: 'Square soft/hard tip (use Hardness)' },
] as const

export function pixelBrushIsRound(shape: PixelBrushShape): boolean {
  return shape === 'round'
}

/** Tools that freehand-paint with brush size. */
export function isPixelFreehandPaintTool(
  tool: string
): tool is 'pencil' | 'paintBrush' | 'eraser' {
  return tool === 'pencil' || tool === 'paintBrush' || tool === 'eraser'
}
