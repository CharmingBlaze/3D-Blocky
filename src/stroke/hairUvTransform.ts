import type { SceneObject } from '../mesh/HalfEdgeMesh'
import { HalfEdgeMesh } from '../mesh/HalfEdgeMesh'

/**
 * How procedural hair UVs (U along length, V across width) map into texture space.
 * Default is identity: full 0–1 texture covers the strand.
 */
export interface HairUvTransform {
  offsetU: number
  offsetV: number
  scaleU: number
  scaleV: number
  flipU: boolean
  flipV: boolean
  /** Counterclockwise degrees around the mapping rect center. */
  rotationDeg: number
}

export const DEFAULT_HAIR_UV_TRANSFORM: HairUvTransform = {
  offsetU: 0,
  offsetV: 0,
  scaleU: 1,
  scaleV: 1,
  flipU: false,
  flipV: false,
  rotationDeg: 0,
}

export function normalizeHairUvTransform(
  partial?: Partial<HairUvTransform> | null
): HairUvTransform {
  const base = DEFAULT_HAIR_UV_TRANSFORM
  if (!partial) return { ...base }
  return {
    offsetU: Number.isFinite(partial.offsetU) ? partial.offsetU! : base.offsetU,
    offsetV: Number.isFinite(partial.offsetV) ? partial.offsetV! : base.offsetV,
    scaleU: Number.isFinite(partial.scaleU) ? Math.max(0.05, partial.scaleU!) : base.scaleU,
    scaleV: Number.isFinite(partial.scaleV) ? Math.max(0.05, partial.scaleV!) : base.scaleV,
    flipU: Boolean(partial.flipU),
    flipV: Boolean(partial.flipV),
    rotationDeg: Number.isFinite(partial.rotationDeg) ? partial.rotationDeg! : base.rotationDeg,
  }
}

export function isDefaultHairUvTransform(t: HairUvTransform): boolean {
  return (
    t.offsetU === 0 &&
    t.offsetV === 0 &&
    t.scaleU === 1 &&
    t.scaleV === 1 &&
    !t.flipU &&
    !t.flipV &&
    ((t.rotationDeg % 360) + 360) % 360 === 0
  )
}

/** Map a procedural hair UV into texture space using the active transform. */
export function transformHairUv(
  u: number,
  v: number,
  transform: HairUvTransform
): { u: number; v: number } {
  const t = normalizeHairUvTransform(transform)
  let lu = t.flipU ? 1 - u : u
  let lv = t.flipV ? 1 - v : v

  const rot = ((t.rotationDeg % 360) + 360) % 360
  const cx = t.offsetU + t.scaleU * 0.5
  const cy = t.offsetV + t.scaleV * 0.5
  let x = (lu - 0.5) * t.scaleU
  let y = (lv - 0.5) * t.scaleV

  if (rot !== 0) {
    const rad = (rot * Math.PI) / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    const rx = x * cos - y * sin
    const ry = x * sin + y * cos
    x = rx
    y = ry
  }

  return { u: cx + x, v: cy + y }
}

export function transformHairUvList(
  uvs: ReadonlyArray<{ u: number; v: number }>,
  transform: HairUvTransform
): { u: number; v: number }[] {
  if (isDefaultHairUvTransform(normalizeHairUvTransform(transform))) {
    return uvs.map((uv) => ({ u: uv.u, v: uv.v }))
  }
  return uvs.map((uv) => transformHairUv(uv.u, uv.v, transform))
}

export function applyHairUvTransformToMesh(
  mesh: HalfEdgeMesh,
  transform: HairUvTransform
): HalfEdgeMesh {
  if (mesh.uvs.length === 0) return mesh
  if (isDefaultHairUvTransform(normalizeHairUvTransform(transform))) return mesh
  mesh.uvs = transformHairUvList(mesh.uvs, transform)
  return mesh
}

/** Bake the active hair UV mapping onto a newly built hair object. */
export function applyHairUvTransformToObject(
  obj: SceneObject,
  transform: HairUvTransform | null | undefined
): SceneObject {
  if (!obj.uvs?.length) return obj
  const t = normalizeHairUvTransform(transform)
  if (isDefaultHairUvTransform(t)) return obj
  return {
    ...obj,
    uvs: transformHairUvList(obj.uvs, t),
  }
}
