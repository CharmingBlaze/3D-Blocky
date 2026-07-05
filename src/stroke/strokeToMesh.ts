import { polylineToMesh, isHoleLinePolyline, type PolylineInput } from './polylineToMesh'
import { sketchDoodleToObject } from './sketchDoodle'
import type { SceneObject } from '../mesh/HalfEdgeMesh'

export type StrokeInput = PolylineInput

export function strokeToMesh(input: StrokeInput): SceneObject | null {
  if (input.strokeMode === 'outline') {
    return sketchDoodleToObject(input)
  }
  return polylineToMesh(input)
}

export function isHoleLineStroke(input: StrokeInput): boolean {
  return isHoleLinePolyline(input)
}
