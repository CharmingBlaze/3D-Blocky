import type { Material } from '../material/materialTypes'

export interface HairTextureSettings {
  wrap: NonNullable<Material['textureWrap']>
  tintEnabled: boolean
  tint: string
  colorMode: 'image' | 'tint' | 'gradient'
  gradientStart: string
  gradientEnd: string
  gradientAngle: number
  opacity: number
  /** Convert dark image pixels to transparency (useful for strand-on-black images). */
  removeDarkBackground: boolean
  /** Linear RGB multiplier baked into hair texture sampling. */
  brightness: number
  /** Recovers near-black fibre detail without raising the black point. 0–1. */
  shadowDetail: number
}

export const DEFAULT_HAIR_TEXTURE_SETTINGS: HairTextureSettings = {
  wrap: 'repeat',
  tintEnabled: false,
  tint: '#ffffff',
  colorMode: 'image',
  gradientStart: '#8b4513',
  gradientEnd: '#f2c18d',
  gradientAngle: 90,
  opacity: 1,
  removeDarkBackground: true,
  brightness: 1.15,
  shadowDetail: 0.4,
}
