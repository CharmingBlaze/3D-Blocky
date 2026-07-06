import { orthoViewFromLegacy, planePointToWorld } from '../primitives/viewAxes'
import { isOrthoView, normalizeViewType } from '../scene/viewTypes'
import type { OrthoViewType, ViewType } from '../scene/viewTypes'
import type { Vec2, Vec3 } from '../utils/math'
import { curvatureSampleProfile } from './rdp'

/** Hex-style lathe cross-section — chunky but readable. */
export const LATHE_RADIAL_SEGMENTS = 6
/** Drop collinear profile points; keep corners from the drawn stroke. */
export const LATHE_MIN_ANGLE_DEG = 20
/** Max rings along the profile height (low-poly budget). */
export const LATHE_MAX_PROFILE_RINGS = 14
/** Target vertex budget for lathe mesh commits. */
export const LATHE_POLY_BUDGET = 96

export interface LatheProfileResult {
  /** (radius, planeHeight) pairs in draw order. */
  profile: Vec2[]
  /** Screen-plane X of the revolution axis (leftmost stroke point). */
  axisH: number
}

/** Lathe works in any orthographic viewport (not perspective). */
export function isLatheViewSupported(view: ViewType): boolean {
  return isOrthoView(view)
}

/** Short UI hint for how the profile is revolved in a given ortho view. */
export function getLatheViewHint(view: ViewType): string {
  const ortho = isOrthoView(view) ? (normalizeViewType(view) as OrthoViewType) : null
  if (!ortho) {
    return 'Switch to an orthographic viewport (Front, Side, Top, etc.) to draw a lathe profile.'
  }
  switch (ortho) {
    case 'top':
    case 'bottom':
      return 'Draw an open profile in Top or Bottom view. The leftmost point is the rotation axis — the shape spins around the vertical axis seen from above.'
    case 'front':
    case 'back':
      return 'Draw an open profile in Front or Back view. The leftmost point is the rotation axis — the shape spins vertically (columns, vases, wheels).'
    case 'left':
    case 'right':
      return 'Draw an open profile in a Side view. The leftmost point is the rotation axis — the shape spins vertically from the side plane.'
  }
}

/** Drawn stroke → lathe profile, simplified for low-poly rings while keeping shape corners. */
export function strokeToLatheProfile(points: Vec2[]): LatheProfileResult | null {
  if (points.length < 2) return null

  const axisH = Math.min(...points.map((p) => p.x))
  const raw: Vec2[] = []

  for (const p of points) {
    const radius = Math.abs(p.x - axisH)
    const height = p.y
    const last = raw[raw.length - 1]
    if (last && Math.hypot(radius - last.x, height - last.y) < 0.5) continue
    raw.push({ x: radius, y: height })
  }

  if (raw.length < 2) return null

  const profile = curvatureSampleProfile(raw, LATHE_MIN_ANGLE_DEG, LATHE_MAX_PROFILE_RINGS)
  if (profile.length < 2) return null

  return { profile, axisH }
}

export function latheAxisHFromPoints(points: Vec2[]): number {
  if (points.length === 0) return 0
  return Math.min(...points.map((p) => p.x))
}

/** World-space revolution axis for a lathe drawn in an orthographic view. */
export function latheRevolutionAxis(
  view: ViewType,
  axisH: number,
  depth: number
): { origin: Vec3; direction: Vec3 } {
  const ortho = orthoViewFromLegacy(view)
  if (!ortho) {
    return { origin: { x: axisH, y: 0, z: depth }, direction: { x: 0, y: 1, z: 0 } }
  }
  const origin = planePointToWorld(ortho, axisH, 0, depth)
  const above = planePointToWorld(ortho, axisH, 1, depth)
  const dx = above.x - origin.x
  const dy = above.y - origin.y
  const dz = above.z - origin.z
  const len = Math.hypot(dx, dy, dz) || 1
  return {
    origin,
    direction: { x: dx / len, y: dy / len, z: dz / len },
  }
}
