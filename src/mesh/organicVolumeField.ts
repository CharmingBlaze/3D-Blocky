import type { SilhouetteField } from './silhouetteField'
import { clampedBoundaryDist, medialInfluence } from './silhouetteField'

export interface OrganicField3DOptions {
  silhouette: SilhouetteField
  depthScale: number
  roundness: number
  stylize?: number
  /** Minimum Z half-thickness — must be ≥ 1.5× grid cell size for watertight extraction */
  minThickness?: number
}

function thicknessProfile(
  boundaryDist: number,
  maxDist: number,
  roundness: number,
  meta: number
): number {
  const t = Math.min(1, Math.max(0, boundaryDist / maxDist))
  const bulb = 0.35 + (roundness / 24) * 0.65
  const flatness = 2.4 - bulb * 1.5
  const profile = Math.pow(Math.sin(t * Math.PI * 0.5), flatness) * bulb
  return profile * (0.45 + 0.55 * meta)
}

function depthScaleMin(roundness: number): number {
  return 0.04 + (roundness / 24) * 0.06
}

/** Z-depth at (x,y) from silhouette + smoothed medial field, with minimum thickness */
export function thicknessAt(
  x: number,
  y: number,
  options: OrganicField3DOptions
): number {
  const { silhouette, depthScale, roundness, minThickness = 0 } = options
  const d = clampedBoundaryDist(silhouette, x, y)
  if (d <= 0) return Math.max(depthScale * depthScaleMin(roundness), minThickness)

  const meta = medialInfluence(silhouette, x, y)
  const raw = depthScale * thicknessProfile(d, silhouette.maxInteriorDist, roundness, meta)
  return Math.max(raw, minThickness)
}

/**
 * Unified 3D organic implicit field.
 * Negative inside volume, zero = surface, positive outside.
 */
export function createOrganicField3D(options: OrganicField3DOptions) {
  const { silhouette, stylize = 0 } = options
  const stylizeBias = 1 + stylize * 0.35

  return function field(x: number, y: number, z: number): number {
    const thick = thicknessAt(x, y, options) * stylizeBias
    const boundaryDist = clampedBoundaryDist(silhouette, x, y)

    const xyOutside = -boundaryDist
    const zOutside = Math.abs(z) - thick

    return Math.max(xyOutside, zOutside)
  }
}

export type ScalarField3D = (x: number, y: number, z: number) => number
