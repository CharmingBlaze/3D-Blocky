import type { OrthoViewType } from '../primitives/viewAxes'
import { HalfEdgeMesh } from './HalfEdgeMesh'
import { viewTowardCamera } from '../stroke/worldProjection'
import { latheRevolutionAxis } from '../stroke/latheProfile'
import type { ViewType } from '../scene/viewTypes'
import { faceNormal, type Vec3 } from '../utils/math'
import {
  computeFaceNormal,
  faceCentroid,
  meshCentroid,
  flipFace,
  type TriangleFace,
} from './MeshBuilder'

/** Signed volume — positive when triangle windings are consistently oriented. */
export function meshSignedVolume(mesh: HalfEdgeMesh): number {
  let volume = 0
  for (const face of mesh.faces) {
    if (face.length < 3) continue
    const a = mesh.positions[face[0]]
    const b = mesh.positions[face[1]]
    const c = mesh.positions[face[2]]
    volume +=
      a.x * (b.y * c.z - c.y * b.z) +
      b.x * (c.y * a.z - a.y * c.z) +
      c.x * (a.y * b.z - b.y * a.z)
  }
  return volume / 6
}

export function flipMeshFaces(mesh: HalfEdgeMesh): void {
  for (const face of mesh.faces) {
    face.reverse()
  }
  mesh.buildHalfEdges()
}

/**
 * Flip individual faces whose normals point toward the reference point.
 * Uses explicit refPoint when provided (preferred for primitives); otherwise mesh centroid.
 */
export function reorientFacesOutward(
  mesh: HalfEdgeMesh,
  refPoint?: { x: number; y: number; z: number }
): HalfEdgeMesh {
  if (mesh.faces.length === 0) return mesh

  const center = refPoint ?? meshCentroid(mesh.positions)
  for (const face of mesh.faces) {
    if (face.length !== 3) continue
    const tri = face as TriangleFace
    const n = computeFaceNormal(mesh.positions, tri)
    const c = faceCentroid(mesh.positions, tri)
    const dx = c.x - center.x
    const dy = c.y - center.y
    const dz = c.z - center.z
    const dot = n.x * dx + n.y * dy + n.z * dz
    if (dot < 0) {
      const flipped = flipFace(tri)
      face[0] = flipped[0]
      face[1] = flipped[1]
      face[2] = flipped[2]
    }
  }
  mesh.buildHalfEdges()
  return mesh
}

/** Flip all faces when signed volume is negative (works on faceted meshes too). */
export function ensurePositiveVolume(mesh: HalfEdgeMesh): HalfEdgeMesh {
  if (meshSignedVolume(mesh) < 0) flipMeshFaces(mesh)
  return mesh
}

/** Orient lathe mesh faces outward after view projection (open or capped). */
export function orientLatheMeshOutward(
  mesh: HalfEdgeMesh,
  view: ViewType,
  axisH: number,
  depth: number
): HalfEdgeMesh {
  if (mesh.faces.length === 0) return mesh

  const { origin, direction } = latheRevolutionAxis(view, axisH, depth)
  let tMin = Infinity
  let tMax = -Infinity
  for (const p of mesh.positions) {
    const t =
      (p.x - origin.x) * direction.x +
      (p.y - origin.y) * direction.y +
      (p.z - origin.z) * direction.z
    if (t < tMin) tMin = t
    if (t > tMax) tMax = t
  }
  const tMid = (tMin + tMax) * 0.5
  const ref = {
    x: origin.x + direction.x * tMid,
    y: origin.y + direction.y * tMid,
    z: origin.z + direction.z * tMid,
  }
  return reorientFacesOutward(mesh, ref)
}

/** True when every face normal points away from `refPoint`. */
export function meshFacesPointAwayFrom(mesh: HalfEdgeMesh, refPoint: Vec3): boolean {
  for (const face of mesh.faces) {
    if (face.length !== 3) continue
    const tri = face as TriangleFace
    const n = computeFaceNormal(mesh.positions, tri)
    const c = faceCentroid(mesh.positions, tri)
    const dx = c.x - refPoint.x
    const dy = c.y - refPoint.y
    const dz = c.z - refPoint.z
    if (n.x * dx + n.y * dy + n.z * dz < -1e-4) return false
  }
  return true
}

/** Ensure closed meshes have outward-facing normals (positive signed volume). */
export function ensureOutwardWinding(mesh: HalfEdgeMesh): HalfEdgeMesh {
  // Open meshes (tubes, sheets) break volume heuristics — skip them.
  if (countNakedEdges(mesh) > 0) {
    mesh.buildHalfEdges()
    return mesh
  }

  // Per-face centroid tests break domes, pillows, and concave doodles — use volume sign only.
  if (meshSignedVolume(mesh) < 0) flipMeshFaces(mesh)
  return mesh
}

/** Flip open single-sided meshes so the visible side faces the active orthographic camera. */
export function orientOpenMeshTowardView(
  mesh: HalfEdgeMesh,
  view: OrthoViewType
): HalfEdgeMesh {
  if (mesh.faces.length === 0) return mesh

  const toward = viewTowardCamera(view)
  const face = mesh.faces[0]!
  if (face.length < 3) return mesh

  const a = mesh.positions[face[0]!]!
  const b = mesh.positions[face[1]!]!
  const c = mesh.positions[face[2]!]!
  const n = faceNormal(a, b, c)
  const dot = n.x * toward.x + n.y * toward.y + n.z * toward.z
  if (dot < 0) flipMeshFaces(mesh)
  return mesh
}

/** After view projection: fix closed solids and orient open caps toward the camera. */
export function finalizeProjectedShapeMesh(
  mesh: HalfEdgeMesh,
  view: OrthoViewType,
  openSurface = false
): HalfEdgeMesh {
  if (openSurface) {
    return orientOpenMeshTowardView(mesh, view)
  }
  if (countNakedEdges(mesh) === 0) {
    return ensureClosedMeshOutward(mesh)
  }
  mesh.buildHalfEdges()
  return mesh
}

/** After view projection, fix closed solids that ended up inside-out. */
export function ensureClosedMeshOutward(mesh: HalfEdgeMesh): HalfEdgeMesh {
  if (countNakedEdges(mesh) > 0) {
    mesh.buildHalfEdges()
    return mesh
  }
  if (meshSignedVolume(mesh) < 0) flipMeshFaces(mesh)
  return mesh
}

export function countNakedEdges(mesh: HalfEdgeMesh): number {
  const edgeFaceCount = new Map<string, number>()
  for (const face of mesh.faces) {
    for (let i = 0; i < face.length; i++) {
      const a = face[i]
      const b = face[(i + 1) % face.length]
      const key = a < b ? `${a}_${b}` : `${b}_${a}`
      edgeFaceCount.set(key, (edgeFaceCount.get(key) ?? 0) + 1)
    }
  }
  let naked = 0
  for (const count of edgeFaceCount.values()) {
    if (count === 1) naked++
  }
  return naked
}
