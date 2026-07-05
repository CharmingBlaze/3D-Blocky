import {
  countReflexVertices,
  isConcavePolygon,
  signedArea,
} from './concaveTriangulate'
import { gridResolutionCap } from './meshPolyBudget'
import { type Vec2 } from '../utils/math'

export interface SilhouetteComplexity {
  span: number
  area: number
  reflexCount: number
  lobeCount: number
  isConcave: boolean
  aspectRatio: number
  minNeckWidth: number
}

export function analyzeSilhouetteComplexity(
  polygon: Vec2[],
  lobes?: Vec2[][]
): SilhouetteComplexity {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of polygon) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  const w = maxX - minX
  const h = maxY - minY
  const span = Math.max(w, h, 1)
  const area = Math.abs(signedArea(polygon))
  const aspectRatio = span / Math.max(Math.sqrt(area), 1)

  let minNeckWidth = span
  const n = polygon.length
  for (let i = 0; i < n; i++) {
    const p = polygon[i]
    let minDist = Infinity
    for (let j = 0; j < n; j++) {
      if (j === i) continue
      minDist = Math.min(minDist, Math.hypot(p.x - polygon[j].x, p.y - polygon[j].y))
    }
    minNeckWidth = Math.min(minNeckWidth, minDist)
  }

  return {
    span,
    area,
    reflexCount: countReflexVertices(polygon),
    lobeCount: lobes?.length ?? 1,
    isConcave: isConcavePolygon(polygon),
    aspectRatio,
    minNeckWidth,
  }
}

/**
 * Adaptive grid resolution from silhouette complexity + poly budget.
 * Finer where curvature/necks/lobes demand it; coarser on flat large shapes.
 */
export function computeAdaptiveGridResolution(
  polygon: Vec2[],
  polyBudget: number,
  lobes?: Vec2[][]
): number {
  const c = analyzeSilhouetteComplexity(polygon, lobes)
  const budgetCap = gridResolutionCap(polyBudget)
  const budgetBase = Math.max(8, Math.min(budgetCap, Math.round(Math.cbrt(polyBudget * 5))))

  let factor = 1

  if (c.isConcave) factor += 0.1
  factor += c.reflexCount * 0.06
  factor += (c.lobeCount - 1) * 0.14

  if (c.aspectRatio > 2.2) factor += 0.12
  if (c.minNeckWidth < c.span * 0.12) factor += 0.16

  const flatness = c.area / (c.span * c.span)
  if (flatness > 0.45) factor -= 0.08

  const res = Math.round(budgetBase * factor)
  return Math.max(8, Math.min(budgetCap, res))
}

export function estimateMinCellSize(
  bounds: { minX: number; minY: number; maxX: number; maxY: number; maxZ: number },
  resolution: number
): number {
  const spanX = bounds.maxX - bounds.minX
  const spanY = bounds.maxY - bounds.minY
  const spanZ = bounds.maxZ * 2
  const nx = resolution
  const ny = resolution
  const nz = Math.max(4, Math.min(resolution, Math.round(resolution * (spanZ / Math.max(spanX, spanY, 1)))))
  return Math.min(spanX / nx, spanY / ny, spanZ / nz)
}
