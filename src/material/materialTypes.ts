export type MaterialMode = 'solid' | 'vertexGradient' | 'texture'

/** RGBA 0–1 */
export type Rgba4 = [number, number, number, number]

export interface Material {
  mode: MaterialMode
  solidColor?: Rgba4
  textureId?: string
  /** Sampling used when UVs leave the 0–1 texture bounds. */
  textureWrap?: 'clamp' | 'repeat' | 'mirror'
  /** Independent texture transform, applied live without rewriting mesh UVs. */
  textureRepeat?: [number, number]
  textureOffset?: [number, number]
  textureRotation?: number
  /** Multiplied with texture RGB; white preserves the original image. */
  textureTint?: Rgba4
  /** 0 keeps original texture colour; 1 applies the full multiplicative tint. */
  textureTintStrength?: number
  textureLumaAlpha?: boolean
  textureBrightness?: number
  textureShadowDetail?: number
  textureGradient?: { start: Rgba4; end: Rgba4; angle: number }
  opacity: number
  doubleSided: boolean
}

export type GradientDirection = 'x' | 'y' | 'z' | 'radial'

/** Normalized position on the material gradient editor (0–1). */
export interface GradientHandle2D {
  u: number
  v: number
}

export type HarmonyScheme = 'complementary' | 'analogous' | 'triadic' | 'monochromatic'

export interface ColorCornerRef {
  faceIndex: number
  cornerIndex: number
}

export interface CustomPalette {
  id: string
  name: string
  colors: string[]
}

export interface MaterialEditorColor {
  r: number
  g: number
  b: number
  a: number
}

export function rgba4(r: number, g: number, b: number, a = 1): Rgba4 {
  return [r, g, b, a]
}

export function hexToRgba4(hex: string, alpha = 1): Rgba4 {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const n = parseInt(full, 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, alpha]
}

export function rgba4ToHex([r, g, b]: Rgba4): string {
  const ri = Math.round(Math.max(0, Math.min(1, r)) * 255)
  const gi = Math.round(Math.max(0, Math.min(1, g)) * 255)
  const bi = Math.round(Math.max(0, Math.min(1, b)) * 255)
  return `#${((ri << 16) | (gi << 8) | bi).toString(16).padStart(6, '0')}`
}

export function numberToRgba4(color: number, alpha = 1): Rgba4 {
  return [
    ((color >> 16) & 255) / 255,
    ((color >> 8) & 255) / 255,
    (color & 255) / 255,
    alpha,
  ]
}

export function rgba4ToNumber([r, g, b]: Rgba4): number {
  const ri = Math.round(Math.max(0, Math.min(1, r)) * 255)
  const gi = Math.round(Math.max(0, Math.min(1, g)) * 255)
  const bi = Math.round(Math.max(0, Math.min(1, b)) * 255)
  return (ri << 16) | (gi << 8) | bi
}

export function defaultMaterial(color = 0x6ecbf5): Material {
  return {
    mode: 'solid',
    solidColor: numberToRgba4(color),
    opacity: 1,
    // Match historical viewport behavior (solids rendered both sides).
    doubleSided: false,
  }
}

export function cloneMaterial(m: Material): Material {
  return {
    ...m,
    solidColor: m.solidColor ? [...m.solidColor] as Rgba4 : undefined,
    textureTint: m.textureTint ? [...m.textureTint] as Rgba4 : undefined,
    textureRepeat: m.textureRepeat ? [...m.textureRepeat] as [number, number] : undefined,
    textureOffset: m.textureOffset ? [...m.textureOffset] as [number, number] : undefined,
    textureGradient: m.textureGradient
      ? { start: [...m.textureGradient.start] as Rgba4, end: [...m.textureGradient.end] as Rgba4, angle: m.textureGradient.angle }
      : undefined,
  }
}
