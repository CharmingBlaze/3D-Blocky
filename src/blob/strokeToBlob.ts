import type { SceneObject } from '../mesh/HalfEdgeMesh'
import type { PolylineInput } from '../stroke/polylineToMesh'
import { polylineToMesh } from '../stroke/polylineToMesh'
import { softSketchDoodleToObject } from '../stroke/sketchDoodle'

/** Blob-mode stroke — same silhouette as the drawn path, with faceted shading. */
export function blobStrokeToObject(input: PolylineInput): SceneObject | null {
  if (input.extrudeMode) {
    return polylineToMesh({
      ...input,
      strokeMode: 'outline',
      extrudeMode: true,
      name: input.name ?? 'Extrude',
    })
  }

  const obj = softSketchDoodleToObject(input)
  if (!obj) return null

  const defaultName = obj.sketchSource?.isClosed ? 'Blob' : 'Blob Path'
  return {
    ...obj,
    name: input.name ?? defaultName,
    facetExaggeration: input.stylize ?? 0,
    polyBudgetMode: 'strict',
    smoothShading: false,
  }
}
