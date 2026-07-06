export type PixelBlendMode = 'normal' | 'multiply' | 'add' | 'screen'

export interface PixelLayer {
  id: string
  name: string
  visible: boolean
  opacity: number
  blendMode: PixelBlendMode
  pixels: Uint8ClampedArray
}

export interface PixelDocument {
  id: string
  width: number
  height: number
  layers: PixelLayer[]
  activeLayerId: string
}

export type PixelTool =
  | 'pencil'
  | 'eraser'
  | 'line'
  | 'rectangle'
  | 'ellipse'
  | 'bucket'
  | 'rectSelect'
  | 'lassoSelect'
  | 'eyedropper'

export interface PixelSelection {
  kind: 'rect' | 'lasso'
  /** Inclusive pixel bounds in canvas space (top-left origin). */
  x0: number
  y0: number
  x1: number
  y1: number
  /** Lasso points in canvas pixel coords (optional). */
  lassoPoints?: { x: number; y: number }[]
}

export const PIXEL_SIZE_PRESETS = [
  { label: '64×64', width: 64, height: 64 },
  { label: '128×128', width: 128, height: 128 },
  { label: '256×256', width: 256, height: 256 },
  { label: '512×512', width: 512, height: 512 },
  { label: '16×16', width: 16, height: 16 },
  { label: '32×32', width: 32, height: 32 },
] as const
