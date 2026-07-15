import type { Material, Rgba4 } from '../material/materialTypes'
import { rgbaBufferHasAlpha } from '../images/imageAlpha'
import { compositeLayers } from '../pixel/compositeLayers'
import type { PixelDocument } from '../pixel/pixelTypes'
import type { Uv2 } from '../uv/uvTypes'

/** Material fields that affect baked export pixels (not UV sampling). */
export function materialTextureProcessKey(mat: Material): string {
  return [
    mat.textureLumaAlpha ? '1' : '0',
    (mat.textureBrightness ?? 1).toFixed(3),
    (mat.textureShadowDetail ?? 0).toFixed(3),
    mat.textureGradient
      ? `${mat.textureGradient.angle}:${mat.textureGradient.start.join(',')}:${mat.textureGradient.end.join(',')}`
      : '',
    mat.textureTint ? mat.textureTint.join(',') : '',
    (mat.textureTintStrength ?? 0).toFixed(3),
  ].join('|')
}

function applyTint(r: number, g: number, b: number, tint: Rgba4 | undefined, strength: number): [number, number, number] {
  if (!tint || strength <= 0) return [r, g, b]
  const s = Math.max(0, Math.min(1, strength))
  return [
    r * (1 + (tint[0] - 1) * s),
    g * (1 + (tint[1] - 1) * s),
    b * (1 + (tint[2] - 1) * s),
  ]
}

/**
 * Bake viewport material texture effects (luma-alpha, brightness, shadow detail,
 * gradient, tint) into RGBA pixels for export. Matches MeshRenderer sampling.
 */
export function bakeMaterialTexturePixels(
  doc: PixelDocument,
  mat: Material
): { pixels: Uint8ClampedArray; width: number; height: number; hasAlpha: boolean } {
  const source = compositeLayers(doc)
  const needsProcess =
    Boolean(mat.textureLumaAlpha) ||
    (mat.textureBrightness ?? 1) !== 1 ||
    (mat.textureShadowDetail ?? 0) > 0 ||
    Boolean(mat.textureGradient) ||
    ((mat.textureTintStrength ?? 0) > 0 && mat.textureTint)

  if (!needsProcess) {
    const pixels = new Uint8ClampedArray(source)
    return {
      pixels,
      width: doc.width,
      height: doc.height,
      hasAlpha: rgbaBufferHasAlpha(pixels),
    }
  }

  const data = new Uint8ClampedArray(source.length)
  const brightness = Math.max(0.25, Math.min(3, mat.textureBrightness ?? 1))
  const detail = Math.max(0, Math.min(1, mat.textureShadowDetail ?? 0))
  const gamma = 1 - detail * 0.58
  const tintStrength = Math.max(0, Math.min(1, mat.textureTintStrength ?? 0))
  const gradient = mat.textureGradient

  for (let i = 0; i < source.length; i += 4) {
    let r = Math.min(255, Math.pow(source[i]! / 255, gamma) * 255 * brightness)
    let g = Math.min(255, Math.pow(source[i + 1]! / 255, gamma) * 255 * brightness)
    let b = Math.min(255, Math.pow(source[i + 2]! / 255, gamma) * 255 * brightness)

    if (gradient) {
      const pixel = i / 4
      const x = (pixel % doc.width) / Math.max(1, doc.width - 1) - 0.5
      const y = Math.floor(pixel / doc.width) / Math.max(1, doc.height - 1) - 0.5
      const rad = (gradient.angle * Math.PI) / 180
      const t = Math.max(0, Math.min(1, 0.5 + x * Math.cos(rad) + y * Math.sin(rad)))
      r *= gradient.start[0] + (gradient.end[0] - gradient.start[0]) * t
      g *= gradient.start[1] + (gradient.end[1] - gradient.start[1]) * t
      b *= gradient.start[2] + (gradient.end[2] - gradient.start[2]) * t
    }

    ;[r, g, b] = applyTint(r, g, b, mat.textureTint, tintStrength)

    data[i] = Math.max(0, Math.min(255, Math.round(r)))
    data[i + 1] = Math.max(0, Math.min(255, Math.round(g)))
    data[i + 2] = Math.max(0, Math.min(255, Math.round(b)))
    const luma = (data[i]! * 0.2126 + data[i + 1]! * 0.7152 + data[i + 2]! * 0.0722) / 255
    data[i + 3] = mat.textureLumaAlpha
      ? Math.round(source[i + 3]! * Math.max(0, Math.min(1, (luma - 0.025) / 0.32)))
      : source[i + 3]!
  }

  return {
    pixels: data,
    width: doc.width,
    height: doc.height,
    hasAlpha: rgbaBufferHasAlpha(data),
  }
}

/** True when the material's UV transform differs from identity. */
export function materialHasUvTransform(mat: Material): boolean {
  const repeat = mat.textureRepeat ?? [1, 1]
  const offset = mat.textureOffset ?? [0, 0]
  const rot = mat.textureRotation ?? 0
  return (
    Math.abs(repeat[0] - 1) > 1e-6 ||
    Math.abs(repeat[1] - 1) > 1e-6 ||
    Math.abs(offset[0]) > 1e-6 ||
    Math.abs(offset[1]) > 1e-6 ||
    Math.abs(((rot % 360) + 360) % 360) > 1e-6
  )
}

/**
 * Bake Three.js-style texture UV transform into mesh UVs for formats (OBJ)
 * that cannot express repeat/offset/rotation on the sampler.
 */
export function bakeMaterialUvTransform(uvs: Uv2[], mat: Material): Uv2[] {
  if (!materialHasUvTransform(mat)) return uvs.map((uv) => ({ ...uv }))
  const repeat = mat.textureRepeat ?? [1, 1]
  const offset = mat.textureOffset ?? [0, 0]
  const rotDeg = mat.textureRotation ?? 0
  const rot = (((rotDeg % 360) + 360) % 360) * (Math.PI / 180)
  const cos = Math.cos(rot)
  const sin = Math.sin(rot)
  const cx = 0.5
  const cy = 0.5

  return uvs.map((uv) => {
    let u = uv.u * Math.max(0.01, repeat[0])
    let v = uv.v * Math.max(0.01, repeat[1])
    u -= cx
    v -= cy
    const ru = u * cos - v * sin
    const rv = u * sin + v * cos
    return {
      u: ru + cx + offset[0],
      v: rv + cy + offset[1],
    }
  })
}
