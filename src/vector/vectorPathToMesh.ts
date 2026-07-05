import type { SceneObject } from '../mesh/HalfEdgeMesh'
import type { ViewType, StrokeMode } from '../store/appStore'
import { blobStrokeToObject } from '../blob/strokeToBlob'
import { polylineToMesh, type PolylineInput } from '../stroke/polylineToMesh'
import { flattenVectorPath } from './bezier'
import type { VectorPath } from './types'

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
  extrudeAmount?: number
}

function meshPointsFromPath(path: VectorPath): { x: number; y: number }[] {
  const points = flattenVectorPath(path, 0.35)
  if (points.length < 2) return points
  if (!path.closed) return points

  const first = points[0]
  const last = points[points.length - 1]
  if (Math.hypot(first.x - last.x, first.y - last.y) > 0.5) {
    return [...points, { ...first }]
  }
  return points
}

export function vectorPathMeshName(
  strokeMode: StrokeMode,
  extrudeMode: boolean,
  closed: boolean
): string {
  if (extrudeMode && closed) return 'Extrude'
  if (strokeMode === 'blob') return 'Blob'
  if (strokeMode === 'centerline') return 'Path'
  return closed ? 'Outline' : 'Path'
}

/** Build a 3D mesh from a finished vector pen path using the active fill mode. */
export function vectorPathToMesh(
  path: VectorPath,
  options: VectorPathMeshOptions
): SceneObject | null {
  const points = meshPointsFromPath(path)
  if (points.length < 2) return null

  const name = vectorPathMeshName(options.strokeMode, !!options.extrudeMode, path.closed)

  const base: PolylineInput = {
    points,
    view: path.view,
    polyBudget: options.polyBudget,
    brushDensity: options.brushDensity,
    strokeMode: options.strokeMode,
    rdpTolerance: options.rdpTolerance,
    closeThreshold: options.closeThreshold,
    defaultDepth: options.defaultDepth,
    color: path.color,
    stylize: options.stylize,
    extrudeMode: options.extrudeMode,
    extrudeAmount: options.extrudeAmount,
    name,
    pathClosed: path.closed,
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

  if (options.strokeMode === 'outline') {
    if (!path.closed) {
      return polylineToMesh({ ...base, strokeMode: 'centerline' })
    }
    return polylineToMesh({ ...base, strokeMode: 'outline', extrudeMode: false })
  }

  return polylineToMesh(base)
}
