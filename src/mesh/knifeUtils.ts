import type { Vec3 } from '../utils/math'
import { mirrorWorldPoint, type SymmetryAxis } from '../symmetry/symmetry'
import type { SceneObject } from './HalfEdgeMesh'
import { localPointFromWorld, worldPointFromObject } from './objectTransform'

/** Constrain knife end point to 45° steps in screen space (Blender-style). */
export function constrainKnifeEndWorld(
  start: Vec3,
  end: Vec3,
  project: (world: Vec3) => { x: number; y: number },
  unproject: (screenX: number, screenY: number) => Vec3 | null,
  shiftKey: boolean
): Vec3 {
  if (!shiftKey) return end

  const a = project(start)
  const b = project(end)
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  if (len < 4) return end

  const angle = Math.atan2(dy, dx)
  const step = Math.PI / 4
  const snapped = Math.round(angle / step) * step
  const bx = a.x + Math.cos(snapped) * len
  const by = a.y + Math.sin(snapped) * len
  return unproject(bx, by) ?? end
}

export function knifeSegmentLongEnough(start: Vec3, end: Vec3, min = 1e-4): boolean {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const dz = end.z - start.z
  return dx * dx + dy * dy + dz * dz >= min * min
}

function axisComponent(p: Vec3, axis: SymmetryAxis): number {
  if (axis === 'x') return p.x
  if (axis === 'y') return p.y
  return p.z
}

function vecNearlyEqual(a: Vec3, b: Vec3, eps = 1e-5): boolean {
  return (
    Math.abs(a.x - b.x) <= eps &&
    Math.abs(a.y - b.y) <= eps &&
    Math.abs(a.z - b.z) <= eps
  )
}

/**
 * Reflect a point across the symmetry plane (same formula as sculpt / loop-cut /
 * the dashed overlay). Kept for call sites that already have plane-space coords.
 */
export function mirrorKnifeLocalPoint(
  local: Vec3,
  axis: SymmetryAxis,
  plane: number
): Vec3 {
  return mirrorWorldPoint(local, axis, plane)
}

/**
 * Reflect a knife point across the **world** symmetry plane (dashed overlay),
 * then convert back to object-local for mesh cuts.
 *
 * Must use the same world point that is drawn for the primary marker — never an
 * independent surface re-projection — so |distance to plane| matches on both sides.
 * When the primary lies on the plane, mirrored === primary.
 */
export function mirrorKnifePoint(
  obj: SceneObject,
  local: Vec3,
  axis: SymmetryAxis,
  plane: number,
  /** Authoritative world position of the primary marker (defaults to lifting `local`). */
  world?: Vec3
): { local: Vec3; world: Vec3 } {
  const primaryWorld = world ?? worldPointFromObject(obj, local)
  const mirroredWorld = mirrorWorldPoint(primaryWorld, axis, plane)
  return {
    local: localPointFromWorld(obj, mirroredWorld),
    world: mirroredWorld,
  }
}

/** True when the whole stroke lies on the mirror plane (mirrored cut ≡ primary). */
export function knifePathOnMirrorPlane(
  path: Array<{ world: Vec3; local?: Vec3 }>,
  axis: SymmetryAxis,
  plane: number,
  eps = 1e-4
): boolean {
  if (path.length === 0) return true
  return path.every((p) => Math.abs(axisComponent(p.world, axis) - plane) <= eps)
}

/** True when a mirrored segment is the same stroke as the primary (or its reverse). */
export function knifeSegmentIsMirrorDuplicate(
  a: Vec3,
  b: Vec3,
  mirroredA: Vec3,
  mirroredB: Vec3,
  eps = 1e-5
): boolean {
  return (
    (vecNearlyEqual(a, mirroredA, eps) && vecNearlyEqual(b, mirroredB, eps)) ||
    (vecNearlyEqual(a, mirroredB, eps) && vecNearlyEqual(b, mirroredA, eps))
  )
}

export type KnifePathPoint = {
  world: Vec3
  local: Vec3
}

/**
 * Mirror a knife stroke across the active symmetry plane.
 *
 * Reflects each point in **world** space (same plane as the dashed overlay,
 * sculpt, and loop-cut preview), then recomputes local via the object transform.
 * Object-local axis flips ignore object translation and look asymmetric relative
 * to the center line whenever the mesh is not sitting on the world origin.
 */
export function mirrorKnifePath<T extends KnifePathPoint>(
  path: T[],
  obj: SceneObject,
  axis: SymmetryAxis,
  plane: number
): Array<T & KnifePathPoint> {
  return path.map((p) => {
    const { local, world } = mirrorKnifePoint(obj, p.local, axis, plane, p.world)
    return { ...p, world, local }
  })
}
