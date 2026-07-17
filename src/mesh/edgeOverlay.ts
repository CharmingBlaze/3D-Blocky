import type { SceneObject } from './HalfEdgeMesh'
import { edgeKey, parseEdgeKey } from './meshSelection'
import { collectUniqueEdges } from './meshTopology'
import {
  buildEdgeToFacesMap,
  isBoundaryOrDoubleSidedEdge,
  isFaceFrontFacing,
} from './overlayVisibility'
import type * as THREE from 'three'

export type EdgeOverlay = {
  key: string
  edge: [number, number]
}

export function buildEdgeOverlays(
  object: SceneObject,
  onlyKeys?: string[]
): EdgeOverlay[] {
  const edges =
    onlyKeys !== undefined
      ? onlyKeys.map((key) => {
          const [a, b] = parseEdgeKey(key)
          return [a, b] as [number, number]
        })
      : collectUniqueEdges(object)

  return edges.map((edge) => ({
    key: edgeKey(edge[0], edge[1]),
    edge,
  }))
}

/** Pick / marquee: skip edges with no front-facing adjacent face (X-ray off). */
export function isEdgeOverlayPickable(
  object: SceneObject,
  edge: EdgeOverlay | [number, number],
  camera: THREE.Camera,
  edgeFaces = buildEdgeToFacesMap(object)
): boolean {
  const pair = 'edge' in edge ? edge.edge : edge
  const faces = edgeFaces.get(edgeKey(pair[0], pair[1]))
  if (!faces || faces.length === 0) return true
  if (faces.some((fi) => isFaceFrontFacing(object, fi, camera))) return true
  // Thin double-sided sheets share one "outward" facing for both twins, so keep
  // their silhouette edges pickable the same way naked boundary edges are.
  return isBoundaryOrDoubleSidedEdge(object, faces)
}
