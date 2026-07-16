import {
  outlineSketchDoodleToObject,
  pathSketchDoodleToObject,
  sharpSketchDoodleToObject,
  hairSketchDoodleToObject,
  roundedHairSketchDoodleToObject,
  ribbonSketchDoodleToObject,
  taperedTubeSketchDoodleToObject,
  capsuleSketchDoodleToObject,
} from './sketchDoodle'
import { polylineToMesh, isHoleLinePolyline, type PolylineInput } from './polylineToMesh'
import type { SceneObject } from '../mesh/HalfEdgeMesh'

export type StrokeInput = PolylineInput

export function strokeToMesh(input: StrokeInput): SceneObject | null {
  if (input.view === 'perspective' && !input.planeFrame) return null
  if (input.latheMode) {
    return polylineToMesh({
      ...input,
      latheMode: true,
      extrudeMode: false,
      name: input.name ?? 'Lathe',
    })
  }
  if (input.extrudeMode) {
    // Sketch Outline / Blob + Extrude: high-fidelity silhouette (not RDP + mesh simplify).
    if (input.strokeMode === 'outline' || input.strokeMode === 'blob') {
      return sharpSketchDoodleToObject({
        ...input,
        strokeMode: 'outline',
        name: input.name ?? undefined,
      })
    }
    // Path + Extrude: keep Path as a tube (not Extrude's open-capsule branch).
    if (input.strokeMode === 'centerline') {
      return pathSketchDoodleToObject({
        ...input,
        name: input.name ?? 'Path',
      })
    }
    // Hair modes ignore Extrude toggle — keep their own geometry builders.
    if (input.strokeMode === 'hair-paths') {
      return hairSketchDoodleToObject(input, 'path')
    }
    if (input.strokeMode === 'hair-strips') {
      return hairSketchDoodleToObject(input, 'strip')
    }
    if (input.strokeMode === 'hair-round') {
      return roundedHairSketchDoodleToObject(input)
    }
    return polylineToMesh({
      ...input,
      extrudeMode: true,
    })
  }
  if (input.strokeMode === 'outline') {
    return outlineSketchDoodleToObject(input)
  }
  if (input.strokeMode === 'centerline') {
    return pathSketchDoodleToObject(input)
  }
  if (input.strokeMode === 'capsule') {
    return capsuleSketchDoodleToObject(input)
  }
  if (input.strokeMode === 'ribbon') {
    return ribbonSketchDoodleToObject(input)
  }
  if (input.strokeMode === 'tapered-tube') {
    return taperedTubeSketchDoodleToObject(input)
  }
  if (input.strokeMode === 'hair-paths') {
    return hairSketchDoodleToObject(input, 'path')
  }
  if (input.strokeMode === 'hair-strips') {
    return hairSketchDoodleToObject(input, 'strip')
  }
  if (input.strokeMode === 'hair-round') {
    return roundedHairSketchDoodleToObject(input)
  }
  return polylineToMesh(input)
}

export function isHoleLineStroke(input: StrokeInput): boolean {
  return isHoleLinePolyline(input)
}
