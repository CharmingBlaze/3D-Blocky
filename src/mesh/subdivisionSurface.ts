import type { SceneObject } from './HalfEdgeMesh'
import { edgeKey, parseEdgeKey } from './meshSelection'
import { cloneSceneObject } from './meshOps'
import { identityFaceGroups } from './faceGroups'
import { groupCoincidentVertexIndices } from './meshTopology'
import type { Vec3 } from '../utils/math'

const MAX_SUBD_LEVELS = 3

function isDegenerateFace(face: number[]): boolean {
  if (face.length < 3) return true
  return new Set(face).size < 3
}

/**
 * Merge vertices that share the same position (e.g. box UV seams).
 * Catmull-Clark requires welded manifold topology — unwelded corners look "exploded".
 */
export function weldSceneObjectCoincidentVertices(obj: SceneObject): SceneObject {
  if (obj.positions.length === 0 || obj.faces.length === 0) return obj

  const groups = groupCoincidentVertexIndices(obj)
  if (groups.size >= obj.positions.length) return obj

  const oldToNew = new Map<number, number>()
  const newPositions: Vec3[] = []

  for (const indices of groups.values()) {
    const newIdx = newPositions.length
    for (const vi of indices) oldToNew.set(vi, newIdx)
    let x = 0
    let y = 0
    let z = 0
    for (const vi of indices) {
      const p = obj.positions[vi]!
      x += p.x
      y += p.y
      z += p.z
    }
    const n = indices.length
    newPositions.push({ x: x / n, y: y / n, z: z / n })
  }

  const newFaces: number[][] = []
  const newFaceColors: number[] = []
  const oldToNewFace = new Map<number, number>()

  for (let fi = 0; fi < obj.faces.length; fi++) {
    const mapped = obj.faces[fi]!.map((vi) => oldToNew.get(vi)!)
    if (isDegenerateFace(mapped)) continue
    oldToNewFace.set(fi, newFaces.length)
    newFaces.push(mapped)
    newFaceColors.push(obj.faceColors[fi] ?? obj.color)
  }

  if (newFaces.length === 0) return obj

  const faceGroups = obj.faceGroups
    ?.map((group) =>
      group
        .map((fi) => oldToNewFace.get(fi))
        .filter((fi): fi is number => fi !== undefined)
    )
    .filter((group) => group.length > 0)

  return {
    ...obj,
    positions: newPositions,
    faces: newFaces,
    faceColors: newFaceColors,
    faceGroups: faceGroups?.length ? faceGroups : identityFaceGroups(newFaces.length),
    uvs: undefined,
    faceUvIndices: undefined,
    cornerColors: undefined,
    faceColorIndices: undefined,
  }
}

function faceCentroid(positions: Vec3[], face: number[]): Vec3 {
  let x = 0
  let y = 0
  let z = 0
  for (const vi of face) {
    const p = positions[vi]
    x += p.x
    y += p.y
    z += p.z
  }
  const n = face.length || 1
  return { x: x / n, y: y / n, z: z / n }
}

/** One Catmull-Clark subdivision step (Blender Subdivision Surface algorithm). */
export function catmullClarkOnce(obj: SceneObject): SceneObject {
  if (obj.faces.length === 0) return cloneSceneObject(obj)

  const positions = obj.positions.map((p) => ({ ...p }))
  const faces = obj.faces.map((f) => [...f])

  const edgeToFaces = new Map<string, number[]>()
  const vertToFaces = new Map<number, number[]>()
  const vertToEdges = new Map<number, Set<string>>()

  for (let fi = 0; fi < faces.length; fi++) {
    const face = faces[fi]
    for (let i = 0; i < face.length; i++) {
      const a = face[i]
      const b = face[(i + 1) % face.length]
      const key = edgeKey(a, b)
      const list = edgeToFaces.get(key)
      if (list) list.push(fi)
      else edgeToFaces.set(key, [fi])

      if (!vertToFaces.has(a)) vertToFaces.set(a, [])
      vertToFaces.get(a)!.push(fi)

      if (!vertToEdges.has(a)) vertToEdges.set(a, new Set())
      if (!vertToEdges.has(b)) vertToEdges.set(b, new Set())
      vertToEdges.get(a)!.add(key)
      vertToEdges.get(b)!.add(key)
    }
  }

  const facePoints = faces.map((face) => faceCentroid(positions, face))

  const edgePoints = new Map<string, Vec3>()
  for (const [key, adjFaces] of edgeToFaces) {
    const [a, b] = parseEdgeKey(key)
    const pa = positions[a]
    const pb = positions[b]
    if (adjFaces.length >= 2) {
      const f0 = facePoints[adjFaces[0]]
      const f1 = facePoints[adjFaces[1]]
      edgePoints.set(key, {
        x: (pa.x + pb.x + f0.x + f1.x) / 4,
        y: (pa.y + pb.y + f0.y + f1.y) / 4,
        z: (pa.z + pb.z + f0.z + f1.z) / 4,
      })
    } else {
      const f0 = facePoints[adjFaces[0]]
      edgePoints.set(key, {
        x: (pa.x + pb.x + f0.x) / 3,
        y: (pa.y + pb.y + f0.y) / 3,
        z: (pa.z + pb.z + f0.z) / 3,
      })
    }
  }

  const newVertPositions = positions.map((p, vi) => {
    const adjFaceIndices = vertToFaces.get(vi) ?? []
    const n = adjFaceIndices.length
    if (n === 0) return p

    let fx = 0
    let fy = 0
    let fz = 0
    for (const fi of adjFaceIndices) {
      fx += facePoints[fi].x
      fy += facePoints[fi].y
      fz += facePoints[fi].z
    }
    fx /= n
    fy /= n
    fz /= n

    const edges = vertToEdges.get(vi) ?? new Set<string>()
    let rx = 0
    let ry = 0
    let rz = 0
    for (const key of edges) {
      const [a, b] = parseEdgeKey(key)
      const other = a === vi ? b : a
      const op = positions[other]
      rx += (p.x + op.x) / 2
      ry += (p.y + op.y) / 2
      rz += (p.z + op.z) / 2
    }
    const en = edges.size || 1
    rx /= en
    ry /= en
    rz /= en

    const weight = n
    return {
      x: (fx + 2 * rx + (n - 3) * p.x) / weight,
      y: (fy + 2 * ry + (n - 3) * p.y) / weight,
      z: (fz + 2 * rz + (n - 3) * p.z) / weight,
    }
  })

  const newPositions = [...newVertPositions]
  const facePointIndex = facePoints.map((fp) => {
    const idx = newPositions.length
    newPositions.push(fp)
    return idx
  })

  const edgePointIndex = new Map<string, number>()
  for (const [key, ep] of edgePoints) {
    edgePointIndex.set(key, newPositions.length)
    newPositions.push(ep)
  }

  const newFaces: number[][] = []
  const newColors: number[] = []

  for (let fi = 0; fi < faces.length; fi++) {
    const face = faces[fi]
    const fp = facePointIndex[fi]
    const color = obj.faceColors[fi] ?? obj.color
    const n = face.length

    for (let i = 0; i < n; i++) {
      const v0 = face[i]
      const v1 = face[(i + 1) % n]
      const vPrev = face[(i + n - 1) % n]
      const ePrev = edgeKey(vPrev, v0)
      const eNext = edgeKey(v0, v1)
      const epPrev = edgePointIndex.get(ePrev)!
      const epNext = edgePointIndex.get(eNext)!
      const quad = [v0, epNext, fp, epPrev]
      newFaces.push([quad[0], quad[1], quad[2]])
      newFaces.push([quad[0], quad[2], quad[3]])
      newColors.push(color, color)
    }
  }

  return {
    ...obj,
    positions: newPositions,
    faces: newFaces,
    faceColors: newColors,
    faceGroups: identityFaceGroups(newFaces.length),
    smoothShading: true,
    uvs: undefined,
    faceUvIndices: undefined,
    cornerColors: undefined,
    faceColorIndices: undefined,
  }
}

export function subdivideSurfaceLevels(obj: SceneObject, levels: number): SceneObject {
  const clamped = Math.max(0, Math.min(MAX_SUBD_LEVELS, Math.round(levels)))
  if (clamped === 0) return obj
  let current = weldSceneObjectCoincidentVertices(cloneSceneObject(obj))
  for (let i = 0; i < clamped; i++) {
    current = catmullClarkOnce(current)
  }
  return current
}

/** Non-destructive viewport preview — cage stays in `obj`, returns smoothed copy. */
export function resolveSubdivisionPreview(obj: SceneObject): SceneObject {
  if (!obj.subdEnabled || !obj.subdLevels || obj.subdLevels <= 0) return obj
  return subdivideSurfaceLevels(obj, obj.subdLevels)
}

export function clampSubdLevels(levels: number): number {
  return Math.max(0, Math.min(MAX_SUBD_LEVELS, Math.round(levels)))
}

export { MAX_SUBD_LEVELS }
