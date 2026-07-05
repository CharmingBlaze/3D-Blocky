import { ensureCCW } from './concaveTriangulate'
import {
  buildDistanceField,
  extractMedialAxis,
  sampleDistance,
  type Grid2D,
  type MedialNode,
} from './distanceTransform'
import { signedArea } from './concaveTriangulate'
import { type Vec2 } from '../utils/math'

export interface SilhouetteField {
  polygon: Vec2[]
  grid: Grid2D
  seeds: MedialNode[]
  lobeSeeds: MedialNode[][]
  maxInteriorDist: number
  /** Gaussian smoothing σ for medial influence (proportional to silhouette area) */
  medialSigma: number
}

function maxInteriorDistance(grid: Grid2D): number {
  let max = 0.01
  for (let i = 0; i < grid.data.length; i++) {
    if (grid.data[i] > max) max = grid.data[i]
  }
  return max
}

function curvatureAt(grid: Grid2D, col: number, row: number): number {
  const { cols, data } = grid
  const c = col
  const r = row
  if (c < 1 || r < 1 || c >= cols - 1 || r >= grid.rows - 1) return 0
  const v = data[r * cols + c]
  const dx = data[r * cols + c + 1] - data[r * cols + c - 1]
  const dy = data[(r + 1) * cols + c] - data[(r - 1) * cols + c]
  const dxx = data[r * cols + c + 1] - 2 * v + data[r * cols + c - 1]
  const dyy = data[(r + 1) * cols + c] - 2 * v + data[(r - 1) * cols + c]
  return Math.abs(dxx) + Math.abs(dyy) + Math.hypot(dx, dy) * 0.25
}

function lobeInfluenceAt(seeds: MedialNode[], x: number, y: number, sigma: number): number {
  let sum = 0
  for (const s of seeds) {
    const dx = x - s.x
    const dy = y - s.y
    const r = s.radius + sigma
    sum += Math.exp(-(dx * dx + dy * dy) / (2 * r * r))
  }
  return Math.min(1, sum / Math.max(1, seeds.length * 0.28))
}

/** Log-sum-exp soft max — smooth union of lobe influences */
function softUnion(values: number[], k = 6): number {
  if (values.length === 0) return 0
  if (values.length === 1) return values[0]
  const max = Math.max(...values)
  let sum = 0
  for (const v of values) sum += Math.exp(k * (v - max))
  return max + Math.log(sum) / k
}

/**
 * Smoothed medial influence with soft lobe union.
 * Avoids hard discontinuities that break dual contouring.
 */
export function medialInfluence(field: SilhouetteField, x: number, y: number): number {
  const { seeds, lobeSeeds, medialSigma } = field
  const groups = lobeSeeds.length > 1 ? lobeSeeds : [seeds]

  const lobeValues = groups.map((group) =>
    lobeInfluenceAt(group.length > 0 ? group : seeds, x, y, medialSigma)
  )

  return softUnion(lobeValues)
}

/**
 * Convert 2D outline → soft silhouette field seed.
 * Inside = low/negative, outside = positive. Lobes use soft union.
 */
export function buildSilhouetteField(
  polygon: Vec2[],
  resolution = 32,
  lobes?: Vec2[][]
): SilhouetteField {
  const poly = ensureCCW(polygon)
  const grid = buildDistanceField(poly, resolution)
  const seeds = extractMedialAxis(grid)
  const maxInteriorDist = maxInteriorDistance(grid)
  const area = Math.abs(signedArea(poly))
  const medialSigma = Math.sqrt(area) * 0.06 + grid.cellSize * 0.5

  const lobeSeeds: MedialNode[][] = []
  const activeLobes = lobes && lobes.length > 1 ? lobes : [poly]

  for (const lobe of activeLobes) {
    const lobeGrid = buildDistanceField(ensureCCW(lobe), Math.max(16, Math.floor(resolution * 0.75)))
    let lobeNodes = extractMedialAxis(lobeGrid)

    lobeNodes = lobeNodes.map((n) => {
      const col = Math.round((n.x - lobeGrid.minX) / lobeGrid.cellSize - 0.5)
      const row = Math.round((n.y - lobeGrid.minY) / lobeGrid.cellSize - 0.5)
      const curv = curvatureAt(lobeGrid, col, row)
      return { ...n, radius: (n.radius + medialSigma * 0.3) * (1 + curv * 0.12) }
    })
    lobeSeeds.push(lobeNodes)
  }

  return { polygon: poly, grid, seeds, lobeSeeds, maxInteriorDist, medialSigma }
}

/** Clamped boundary distance — stabilizes steep concave corners */
export function clampedBoundaryDist(field: SilhouetteField, x: number, y: number): number {
  const d = sampleDistance(field.grid, x, y)
  return Math.max(-field.maxInteriorDist, Math.min(d, field.maxInteriorDist))
}
