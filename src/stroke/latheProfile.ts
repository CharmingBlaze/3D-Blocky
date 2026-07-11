import { orthoViewFromLegacy, planePointToWorld } from '../primitives/viewAxes'
import { isOrthoView, normalizeViewType } from '../scene/viewTypes'
import type { OrthoViewType, ViewType } from '../scene/viewTypes'
import type { Vec2, Vec3 } from '../utils/math'
import { curvatureSampleProfile, rdpSimplify } from './rdp'

/**
 * Octagonal lathe cross-section — rounder silhouette while staying mid-poly.
 * 8 × ~16 rings ≈ 128 verts.
 */
export const LATHE_RADIAL_SEGMENTS = 8
/** Keep gentle bends from the drawn profile (was 20° — too aggressive). */
export const LATHE_MIN_ANGLE_DEG = 10
/** Max rings along the profile height (low–mid poly). */
export const LATHE_MAX_PROFILE_RINGS = 16
/** RDP tolerance in plane units — follows the stroke silhouette before angle filter. */
export const LATHE_PROFILE_RDP_TOLERANCE = 0.55
/** Minimum spacing between consecutive profile samples before simplify. */
export const LATHE_PROFILE_DEDUPE = 0.22
/** Target vertex budget for lathe mesh commits (~ rings × radial). */
export const LATHE_POLY_BUDGET = 128

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
      return 'Draw an open profile to the right of the leftmost point (rotation axis). Top/Bottom: spins around the vertical axis seen from above.'
    case 'front':
    case 'back':
      return 'Draw an open profile to the right of the leftmost point (rotation axis). Keep the outline on one side — it spins into a vase/column matching your curve.'
    case 'left':
    case 'right':
      return 'Draw an open profile to the right of the leftmost point (rotation axis). Side view: spins vertically from that plane.'
  }
}

/**
 * Drawn stroke → lathe profile that follows the silhouette.
 * Uses RDP + mild curvature filter so gentle curves survive, then caps rings by importance.
 */
export function strokeToLatheProfile(points: Vec2[]): LatheProfileResult | null {
  if (points.length < 2) return null

  const axisH = Math.min(...points.map((p) => p.x))
  const raw: Vec2[] = []

  for (const p of points) {
    // Keep points on/near the drawn side of the axis (fold only tiny overshoots).
    const radius = Math.max(0, p.x - axisH)
    const height = p.y
    const last = raw[raw.length - 1]
    if (last && Math.hypot(radius - last.x, height - last.y) < LATHE_PROFILE_DEDUPE) continue
    raw.push({ x: radius, y: height })
  }

  if (raw.length < 2) return null

  // Follow the drawn polyline first (silhouette fidelity), then angle-filter + ring cap.
  const silhouette = rdpSimplify(raw, LATHE_PROFILE_RDP_TOLERANCE)
  const profile = curvatureSampleProfile(
    silhouette.length >= 2 ? silhouette : raw,
    LATHE_MIN_ANGLE_DEG,
    LATHE_MAX_PROFILE_RINGS
  )
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
