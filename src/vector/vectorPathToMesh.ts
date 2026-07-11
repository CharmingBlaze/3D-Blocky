import type { SceneObject } from '../mesh/HalfEdgeMesh'
import type { ViewType, StrokeMode } from '../store/appStore'
import { blobStrokeToObject } from '../blob/strokeToBlob'
import { polylineToMesh, type PolylineInput } from '../stroke/polylineToMesh'
import { flattenVectorPath } from './bezier'
import type { VectorPath } from './types'
import {
  VECTOR_PEN_FLATTEN_ERROR,
  VECTOR_PEN_LATHE_FLATTEN_ERROR,
  VECTOR_PEN_POLY_BUDGET,
} from './vectorPenLimits'
import { LATHE_POLY_BUDGET } from '../stroke/latheProfile'

export { VECTOR_PEN_POLY_BUDGET } from './vectorPenLimits'

export interface VectorPathMeshOptions {
  view: ViewType
  polyBudget: number
  brushDensity: number
  strokeMode: StrokeMode
  rdpTolerance: number
  closeThreshold: number
  defaultDepth: number
  color: number
  stylize?: number
  extrudeMode?: boolean
  latheMode?: boolean
  latheCaps?: boolean
  extrudeAmount?: number
}

function meshPointsFromPath(path: VectorPath, latheMode = false): { x: number; y: number }[] {
  const points = flattenVectorPath(
    path,
    latheMode ? VECTOR_PEN_LATHE_FLATTEN_ERROR : VECTOR_PEN_FLATTEN_ERROR
  )
  if (points.length < 2) return points
  if (!path.closed) return points

  const first = points[0]!
  const last = points[points.length - 1]!
  if (Math.hypot(first.x - last.x, first.y - last.y) <= 0.5) {
    return points.slice(0, -1)
  }
  return points
}

export function vectorPathMeshName(
  strokeMode: StrokeMode,
  extrudeMode: boolean,
  latheMode: boolean,
  closed: boolean
): string {
  if (latheMode) return 'Lathe'
  if (extrudeMode) return closed ? 'Doodle' : 'Capsule'
  if (strokeMode === 'blob') return 'Blob'
  if (strokeMode === 'centerline') return 'Path'
  if (strokeMode === 'capsule') return 'Capsule'
  return closed ? 'Doodle' : 'Path'
}

/** Build a 3D mesh from a finished vector pen path using the active fill mode. */
export function vectorPathToMesh(
  path: VectorPath,
  options: VectorPathMeshOptions
): SceneObject | null {
  const points = meshPointsFromPath(path, !!options.latheMode)
  if (points.length < 2) return null

  const name = vectorPathMeshName(
    options.strokeMode,
    !!options.extrudeMode,
    !!options.latheMode,
    path.closed
  )

  const base: PolylineInput = {
    points,
    view: path.view,
    polyBudget: options.latheMode ? LATHE_POLY_BUDGET : VECTOR_PEN_POLY_BUDGET,
    brushDensity: options.brushDensity,
    strokeMode: options.strokeMode,
    rdpTolerance: options.rdpTolerance,
    closeThreshold: options.closeThreshold,
    defaultDepth: options.defaultDepth,
    color: path.color,
    stylize: options.stylize,
    extrudeMode: options.extrudeMode,
    latheMode: options.latheMode,
    latheCaps: options.latheCaps,
    extrudeAmount: options.extrudeAmount,
    name,
    pathClosed: path.closed,
    preserveDetail: true,
  }

  if (options.latheMode) {
    return polylineToMesh({
      ...base,
      strokeMode: 'outline',
      extrudeMode: false,
      latheMode: true,
    })
  }

  if (options.extrudeMode) {
    return polylineToMesh({
      ...base,
      strokeMode: 'outline',
      extrudeMode: true,
    })
  }

  if (options.strokeMode === 'blob') {
    return blobStrokeToObject(base)
  }

  if (options.strokeMode === 'centerline') {
    return polylineToMesh({ ...base, strokeMode: 'centerline' })
  }

  if (options.strokeMode === 'capsule') {
    return polylineToMesh({ ...base, strokeMode: 'capsule' })
  }

  if (options.strokeMode === 'outline') {
    if (!path.closed) {
      return polylineToMesh({ ...base, strokeMode: 'centerline' })
    }
    return polylineToMesh({ ...base, strokeMode: 'outline', extrudeMode: false })
  }

  return polylineToMesh(base)
}
