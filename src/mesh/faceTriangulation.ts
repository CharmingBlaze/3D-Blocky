import type { SceneObject } from './HalfEdgeMesh'
import {
  earClipTriangulate,
  ensureCCW,
  signedArea,
} from './concaveTriangulate'
import {
  planeBasisFromPoints,
  projectPointToPlane2D,
} from './geometry2d'
import type { Vec2, Vec3 } from '../utils/math'

/**
 * Corner-index triangles into a face loop (not topology vertex ids).
 * Canonical triangulation for render / pick / winding / export.
 */
export type FaceCornerTri = [number, number, number]

const faceTrisByObject = new WeakMap<SceneObject, FaceCornerTri[][]>()

/**
 * Triangulate one face loop in 3D. Preserves original corner indices
 * (ear-clip runs in CCW projected space then remaps).
 */
export function triangulateFaceLoop(positions: Vec3[]): FaceCornerTri[] {
  const n = positions.length
  if (n < 3) return []
  if (n === 3) return [[0, 1, 2]]

  // Convex quads: stable diagonal split matching legacy fan for convex cases.
  if (n === 4) {
    const { origin, u, v } = planeBasisFromPoints(positions)
    const poly2D = positions.map((p) => projectPointToPlane2D(p, origin, u, v))
    if (!isProjectedConcave(poly2D)) {
      return [
        [0, 1, 2],
        [0, 2, 3],
      ]
    }
  }

  const { origin, u, v } = planeBasisFromPoints(positions)
  const poly2D = positions.map((p) => projectPointToPlane2D(p, origin, u, v))
  return earClipPreservingIndices(poly2D)
}

function isProjectedConcave(poly: Vec2[]): boolean {
  if (poly.length < 4) return false
  const ccw = ensureCCW(poly)
  for (let i = 0; i < ccw.length; i++) {
    const prev = ccw[(i + ccw.length - 1) % ccw.length]!
    const curr = ccw[i]!
    const next = ccw[(i + 1) % ccw.length]!
    const cross =
      (curr.x - prev.x) * (next.y - prev.y) - (curr.y - prev.y) * (next.x - prev.x)
    if (cross < -1e-6) return true
  }
  return false
}

/** Ear-clip so returned indices refer to the input polygon order. */
function earClipPreservingIndices(poly2D: Vec2[]): FaceCornerTri[] {
  const n = poly2D.length
  if (n < 3) return []

  // Build CCW order as a permutation of original indices.
  let order = poly2D.map((_, i) => i)
  if (signedArea(poly2D) < 0) order = order.reverse()

  const orderedPts = order.map((i) => poly2D[i]!)
  const tris = earClipTriangulate(orderedPts)
  // earClipTriangulate indices into orderedPts; map back to original corners.
  return tris.map(
    ([a, b, c]) => [order[a]!, order[b]!, order[c]!] as FaceCornerTri
  )
}

/** Per-face corner triangles for a SceneObject (WeakMap-cached by identity). */
export function getObjectFaceTriangulation(object: SceneObject): FaceCornerTri[][] {
  let cached = faceTrisByObject.get(object)
  if (cached) return cached

  cached = object.faces.map((face) => {
    if (!face || face.length < 3) return []
    const pts: Vec3[] = []
    for (const vi of face) {
      const p = object.positions[vi]
      if (!p) return []
      pts.push(p)
    }
    return triangulateFaceLoop(pts)
  })
  faceTrisByObject.set(object, cached)
  return cached
}

export function clearFaceTriangulationCacheForTests(objects: SceneObject[]): void {
  for (const obj of objects) faceTrisByObject.delete(obj)
}

/** Triangulate HalfEdgeMesh faces (no cache — mesh mutates during edit). */
export function triangulateMeshFace(
  positions: Vec3[],
  face: number[]
): FaceCornerTri[] {
  if (face.length < 3) return []
  const pts = face.map((vi) => positions[vi]!).filter(Boolean)
  if (pts.length !== face.length) return []
  return triangulateFaceLoop(pts)
}
