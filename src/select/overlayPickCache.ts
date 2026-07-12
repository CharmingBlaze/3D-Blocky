import type { SceneObject } from '../mesh/HalfEdgeMesh'
import { buildEdgeOverlays, type EdgeOverlay } from '../mesh/edgeOverlay'
import { buildFaceOverlayGroups, type FaceOverlayGroup } from '../mesh/faceOverlay'
import { buildVertexOverlayGroups, type VertexOverlayGroup } from '../mesh/vertexOverlay'
import { getMeshAdjacency } from '../mesh/meshAdjacencyCache'

export interface OverlayPickData {
  vertexGroups: VertexOverlayGroup[]
  edgeOverlays: EdgeOverlay[]
  faceGroups: FaceOverlayGroup[]
  vertexToFaces: Map<number, number[]>
  edgeToFaces: Map<string, number[]>
}

/**
 * Derived overlay/pick data keyed by SceneObject identity.
 * Store updates replace the object ref → natural cache miss.
 */
const cache = new WeakMap<SceneObject, OverlayPickData>()

export function getOverlayPickData(object: SceneObject): OverlayPickData {
  let entry = cache.get(object)
  if (!entry) {
    const adj = getMeshAdjacency(object)
    entry = {
      vertexGroups: buildVertexOverlayGroups(object),
      edgeOverlays: buildEdgeOverlays(object),
      faceGroups: buildFaceOverlayGroups(object),
      vertexToFaces: adj.vertexToFaces,
      edgeToFaces: adj.edgeToFaces,
    }
    cache.set(object, entry)
  }
  return entry
}

/** Test helper — WeakMap entries drop with GC; this only clears known refs. */
export function clearOverlayPickCacheForTests(objects: SceneObject[]): void {
  for (const obj of objects) cache.delete(obj)
}
