import type { SceneObject } from './HalfEdgeMesh'
import { cloneSceneObject } from './meshOps'
import { edgeKey } from './meshSelection'
import { triangulatePolygon } from './geometry2d'
import { removeUnreferencedVertices, splitEdgeAt, splitFaceAtChord } from './meshTopologyOps'
import { splitFaceGroupsAfterCut } from './faceGroups'
import { weldSceneObjectCoincidentVertices } from './subdivisionSurface'
import type { Vec3 } from '../utils/math'

const EPS = 1e-6
const MIN_CUT_LEN = 1e-5

function dot3(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

function sub3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

function add3(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }
}

function scale3(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s }
}

function cross3(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}

function length3(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z)
}

function normalize3(v: Vec3): Vec3 {
  const len = length3(v)
  if (len < EPS) return { x: 0, y: 1, z: 0 }
  return scale3(v, 1 / len)
}

function signedDistance(normal: Vec3, planePoint: Vec3, p: Vec3): number {
  return dot3(normal, sub3(p, planePoint))
}

function onCutPlane(normal: Vec3, planePoint: Vec3, p: Vec3): boolean {
  return Math.abs(signedDistance(normal, planePoint, p)) <= EPS
}

function intersectEdgeWithPlane(
  pa: Vec3,
  pb: Vec3,
  planePoint: Vec3,
  planeNormal: Vec3
): number | null {
  const ab = sub3(pb, pa)
  const denom = dot3(ab, planeNormal)
  if (Math.abs(denom) < EPS) return null
  const t = dot3(sub3(planePoint, pa), planeNormal) / denom
  if (t < -EPS || t > 1 + EPS) return null
  if (t <= EPS || t >= 1 - EPS) return null
  return Math.max(0.001, Math.min(0.999, t))
}

function triangulateFacePart(positions: Vec3[], poly: number[]): number[][] {
  if (poly.length <= 3) return [poly]
  const world = poly.map((vi) => positions[vi]!)
  const tris = triangulatePolygon(world)
  return tris.map(([a, b, c]) => [poly[a]!, poly[b]!, poly[c]!])
}

/** Order cut vertices as they appear walking the face boundary. */
function orderCutVertsOnFace(face: number[], cutSet: Set<number>): number[] {
  const ordered: number[] = []
  for (const vi of face) {
    if (cutSet.has(vi)) ordered.push(vi)
  }
  if (ordered.length <= 2) return ordered

  const uniq: number[] = []
  for (const vi of ordered) {
    if (uniq[uniq.length - 1] !== vi) uniq.push(vi)
  }
  if (uniq.length > 1 && uniq[0] === uniq[uniq.length - 1]) uniq.pop()
  return uniq.length >= 2 ? uniq : ordered.slice(0, 2)
}

function buildCutPlane(
  lineStart: Vec3,
  lineEnd: Vec3,
  viewForward: Vec3
): { point: Vec3; normal: Vec3 } | null {
  const lineDir = sub3(lineEnd, lineStart)
  if (length3(lineDir) < MIN_CUT_LEN) return null

  const planeNormal = normalize3(cross3(normalize3(lineDir), normalize3(viewForward)))
  if (length3(planeNormal) < EPS) return null

  return {
    point: scale3(add3(lineStart, lineEnd), 0.5),
    normal: planeNormal,
  }
}

function cutWeldedMeshOnce(
  obj: SceneObject,
  lineStart: Vec3,
  lineEnd: Vec3,
  viewForward: Vec3
): SceneObject | null {
  const plane = buildCutPlane(lineStart, lineEnd, viewForward)
  if (!plane) return null

  const { point: planePoint, normal: planeNormal } = plane
  const positions = obj.positions.map((p) => ({ ...p }))
  const faces = obj.faces.map((f) => [...f])
  const faceColors = [...obj.faceColors]
  const vertCountBefore = positions.length

  const edgeHits = new Map<string, number>()
  const seenEdges = new Set<string>()

  for (const face of faces) {
    const n = face.length
    for (let i = 0; i < n; i++) {
      const a = face[i]!
      const b = face[(i + 1) % n]!
      const key = edgeKey(a, b)
      if (seenEdges.has(key)) continue
      seenEdges.add(key)

      const pa = positions[a]!
      const pb = positions[b]!
      const sa = signedDistance(planeNormal, planePoint, pa)
      const sb = signedDistance(planeNormal, planePoint, pb)
      if (sa * sb >= -EPS * EPS) continue

      const t = intersectEdgeWithPlane(pa, pb, planePoint, planeNormal)
      if (t === null) continue
      edgeHits.set(key, t)
    }
  }

  const cutVertSet = new Set<number>()
  for (let vi = 0; vi < vertCountBefore; vi++) {
    if (onCutPlane(planeNormal, planePoint, positions[vi]!)) cutVertSet.add(vi)
  }

  if (edgeHits.size === 0 && cutVertSet.size === 0) return null

  for (const [key, t] of edgeHits) {
    const [a, b] = key.split('-').map(Number)
    const newVi = splitEdgeAt(positions, faces, a!, b!, t)
    cutVertSet.add(newVi)
  }

  const toSplit: { fi: number; a: number; b: number }[] = []
  for (let fi = 0; fi < faces.length; fi++) {
    const ordered = orderCutVertsOnFace(faces[fi]!, cutVertSet)
    if (ordered.length === 2) {
      toSplit.push({ fi, a: ordered[0]!, b: ordered[1]! })
    } else if (ordered.length > 2) {
      for (let i = 0; i + 1 < ordered.length; i += 2) {
        toSplit.push({ fi, a: ordered[i]!, b: ordered[i + 1]! })
      }
    }
  }

  for (let i = toSplit.length - 1; i >= 0; i--) {
    const { fi, a, b } = toSplit[i]!
    splitFaceAtChord(faces, faceColors, fi, a, b)
  }

  const outFaces: number[][] = []
  const outColors: number[] = []
  const newFaceSourceOld: number[] = []
  for (let fi = 0; fi < faces.length; fi++) {
    const parts = triangulateFacePart(positions, faces[fi]!)
    for (const part of parts) {
      outFaces.push(part)
      outColors.push(faceColors[fi] ?? obj.color)
      newFaceSourceOld.push(fi)
    }
  }

  const faceGroups = splitFaceGroupsAfterCut(obj.faceGroups, obj.faces.length, newFaceSourceOld)

  return removeUnreferencedVertices({
    ...obj,
    positions,
    faces: outFaces,
    faceColors: outColors,
    faceGroups,
    uvs: undefined,
    faceUvIndices: undefined,
    cornerColors: undefined,
    faceColorIndices: undefined,
  })
}

/**
 * Blockbench / Blender-style knife in mesh-local space.
 * `lineStart`/`lineEnd` and `viewForward` must be in the object's mesh-local coordinates.
 */
export function knifeCutObject(
  obj: SceneObject,
  lineStart: Vec3,
  lineEnd: Vec3,
  viewForward: Vec3
): SceneObject {
  if (length3(sub3(lineEnd, lineStart)) < MIN_CUT_LEN) return obj

  let current = weldSceneObjectCoincidentVertices(cloneSceneObject(obj))
  const cut = cutWeldedMeshOnce(current, lineStart, lineEnd, viewForward)
  return cut ?? obj
}

/** Apply multiple cut segments sequentially (Blender-style chained cuts). */
export function knifeCutSegments(
  obj: SceneObject,
  segments: Array<{ start: Vec3; end: Vec3 }>,
  viewForward: Vec3
): SceneObject {
  let current = obj
  for (const seg of segments) {
    current = knifeCutObject(current, seg.start, seg.end, viewForward)
  }
  return current
}
