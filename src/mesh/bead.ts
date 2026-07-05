import { curvatureSampleProfile } from '../stroke/rdp'
import type { EllipseFit } from '../stroke/strokeCapture'
import { type Vec2 } from '../utils/math'
import { HalfEdgeMesh } from './HalfEdgeMesh'
import { generateLathe } from './lathe'

export interface BeadOptions {
  radialSegments: number
  profileRings?: number
  minAngleDeg?: number
}

/**
 * Bead generator: fit ellipse from stroke, revolve soft ellipsoid profile.
 * Output in canonical XY plane centered on origin — caller applies plane offset.
 */
export function generateBeadFromEllipse(
  ellipse: EllipseFit,
  options: BeadOptions
): HalfEdgeMesh {
  const { radialSegments, minAngleDeg = 18 } = options
  const { rx, ry } = ellipse

  const rawProfile: Vec2[] = []
  const steps = Math.max(6, options.profileRings ?? 8)
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const v = -ry + t * 2 * ry
    const nv = ry > 0 ? v / ry : 0
    const r = rx * Math.sqrt(Math.max(0, 1 - nv * nv * 0.92))
    rawProfile.push({ x: r, y: v })
  }

  const profile = curvatureSampleProfile(rawProfile, minAngleDeg, steps + 2)
  return generateLathe(profile, {
    radialSegments,
    minAngleDeg,
    axis: 'y',
    depth: 0,
  })
}

/** Bead from raw silhouette points (fallback) */
export function generateBeadFromSilhouette(
  silhouette: Vec2[],
  radialSegments: number,
  minAngleDeg = 18
): HalfEdgeMesh {
  const cx = silhouette.reduce((s, p) => s + p.x, 0) / silhouette.length
  const cy = silhouette.reduce((s, p) => s + p.y, 0) / silhouette.length

  const radii = silhouette.map((p) => Math.hypot(p.x - cx, p.y - cy))
  const rx = Math.max(...radii, 0.5)
  const minY = Math.min(...silhouette.map((p) => p.y))
  const maxY = Math.max(...silhouette.map((p) => p.y))
  const ry = Math.max((maxY - minY) / 2, 0.5)

  return generateBeadFromEllipse(
    { cx, cy, rx, ry, aspectRatio: Math.min(rx, ry) / Math.max(rx, ry), circularity: 0.8 },
    { radialSegments, minAngleDeg }
  )
}
