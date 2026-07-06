import { polylineToMesh, isHoleLinePolyline, type PolylineInput } from './polylineToMesh'
import { sketchDoodleToObject } from './sketchDoodle'
import type { SceneObject } from '../mesh/HalfEdgeMesh'

export type StrokeInput = PolylineInput

export function strokeToMesh(input: StrokeInput): SceneObject | null {
  if (input.extrudeMode) {
    const strokeMode =
      input.strokeMode === 'centerline'
        ? 'centerline'
        : input.strokeMode === 'blob'
          ? 'outline'
          : input.strokeMode
    return polylineToMesh({
      ...input,
      strokeMode,
      extrudeMode: true,
    })
  }
  if (input.strokeMode === 'outline') {
    return sketchDoodleToObject(input)
  }
  return polylineToMesh(input)
}

export function isHoleLineStroke(input: StrokeInput): boolean {
  return isHoleLinePolyline(input)
}
