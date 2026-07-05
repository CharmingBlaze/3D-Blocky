import { type Vec2 } from '../utils/math'
import { ensureCCW } from './concaveTriangulate'
import { buildScalarGrid3D, extractDualContour } from './dualContouring'
import {
  computeAdaptiveGridResolution,
  estimateMinCellSize,
} from './fieldSampling'
import { createOrganicField3D, thicknessAt } from './organicVolumeField'
import { buildSilhouetteField } from './silhouetteField'
import { HalfEdgeMesh } from './HalfEdgeMesh'

export interface OrganicVolumeOptions {
  depthScale: number
  roundness?: number
  polyBudget?: number
  stylize?: number
  color?: number
}

function polygonBounds(poly: Vec2[]): {
  minX: number
  minY: number
  maxX: number
  maxY: number
} {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of poly) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  return { minX, minY, maxX, maxY }
}

/**
 * Volume-first organic reconstruction with adaptive sampling:
 * Silhouette → smoothed field → dual contour → safety pass.
 */
export function generateOrganicVolume(
  polygon: Vec2[],
  options: OrganicVolumeOptions,
  lobes?: Vec2[][]
): HalfEdgeMesh {
  const {
    depthScale,
    roundness = 10,
    polyBudget = 48,
    stylize = 0,
    color = 0x7ecba1,
  } = options

  const poly = ensureCCW(polygon)
  const mesh = new HalfEdgeMesh()
  if (poly.length < 3) return mesh

  const resolution = computeAdaptiveGridResolution(poly, polyBudget, lobes)
  const silhouette = buildSilhouetteField(poly, resolution, lobes)

  const bounds2d = polygonBounds(poly)
  const pad = Math.max(bounds2d.maxX - bounds2d.minX, bounds2d.maxY - bounds2d.minY) * 0.08
  const cx = (bounds2d.minX + bounds2d.maxX) / 2
  const cy = (bounds2d.minY + bounds2d.maxY) / 2

  const bounds3d = {
    minX: bounds2d.minX - pad,
    minY: bounds2d.minY - pad,
    maxX: bounds2d.maxX + pad,
    maxY: bounds2d.maxY + pad,
    maxZ: 1,
  }

  const cellSize = estimateMinCellSize(bounds3d, resolution)
  const minThickness = cellSize * 1.6

  const fieldOpts = {
    silhouette,
    depthScale,
    roundness,
    stylize,
    minThickness,
  }

  bounds3d.maxZ = thicknessAt(cx, cy, fieldOpts) * 1.2 + minThickness

  const field3d = createOrganicField3D(fieldOpts)
  const scalarGrid = buildScalarGrid3D(field3d, bounds3d, resolution)

  return extractDualContour(scalarGrid, { isoValue: 0, color })
}

/** Full sketch → mesh pipeline entry point */
export function reconstructOrganicMesh(
  polygon: Vec2[],
  options: OrganicVolumeOptions,
  lobes?: Vec2[][]
): HalfEdgeMesh {
  return generateOrganicVolume(polygon, options, lobes)
}
