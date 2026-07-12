import type { SceneObject } from './HalfEdgeMesh'
import {
  edgeKey,
  parseEdgeKey,
  type MeshComponentSelection,
} from './meshSelection'
import type { SelectionMode } from '../store/appStore'
import { cloneSceneObject } from './meshOps'
import { type Vec3, faceNormal, sub3, dot3 } from '../utils/math'
import { remapFaceGroupsAfterReplace, splitFaceGroupsAfterCut } from './faceGroups'
import { cloneMaterial } from '../material/materialTypes'

export function removeUnreferencedVertices(obj: SceneObject): SceneObject {
  const used = new Set<number>()
  for (const face of obj.faces) {
    for (const vi of face) used.add(vi)
  }
  const oldToNew = new Map<number, number>()
  const positions: Vec3[] = []
  for (const vi of [...used].sort((a, b) => a - b)) {
    oldToNew.set(vi, positions.length)
    positions.push({ ...obj.positions[vi] })
  }
  const faces = obj.faces.map((face) => face.map((vi) => oldToNew.get(vi)!))
  let faceUvIndices = obj.faceUvIndices
  if (obj.faceUvIndices?.length) {
    faceUvIndices = obj.faceUvIndices.map((f) => [...f])
  }
  return { ...obj, positions, faces, faceUvIndices }
}

export function collectFacesForSelection(
  obj: SceneObject,
  selection: MeshComponentSelection,
  mode: SelectionMode
): Set<number> {
  const faces = new Set<number>()
  if (mode === 'face') {
    for (const fi of selection.faces) faces.add(fi)
    return faces
  }
  if (mode === 'edge') {
    const edgeSet = new Set(selection.edges)
    for (let fi = 0; fi < obj.faces.length; fi++) {
      const face = obj.faces[fi]
      for (let i = 0; i < face.length; i++) {
        const key = edgeKey(face[i], face[(i + 1) % face.length])
        if (edgeSet.has(key)) faces.add(fi)
      }
    }
    return faces
  }
  if (mode === 'vertex') {
    const verts = new Set(selection.vertices)
    for (let fi = 0; fi < obj.faces.length; fi++) {
      if (obj.faces[fi].some((vi) => verts.has(vi))) faces.add(fi)
    }
  }
  return faces
}

/** Reverse winding on selected faces (or all faces if selection empty in face mode). */
export function flipSelectionNormals(
  obj: SceneObject,
  selection: MeshComponentSelection | null,
  mode: SelectionMode
): SceneObject {
  if (!selection) return cloneSceneObject(obj)

  let faceSet: Set<number>
  if (mode === 'face' && selection.faces.length > 0) {
    faceSet = new Set(selection.faces)
  } else if (mode === 'edge' && selection.edges.length > 0) {
    faceSet = collectFacesForSelection(obj, selection, 'edge')
  } else if (mode === 'vertex' && selection.vertices.length > 0) {
    faceSet = collectFacesForSelection(obj, selection, 'vertex')
  } else {
    faceSet = new Set(obj.faces.map((_, i) => i))
  }

  const faces = obj.faces.map((f, fi) => (faceSet.has(fi) ? [...f].reverse() : [...f]))
  let faceUvIndices = obj.faceUvIndices
  if (faceUvIndices?.length === obj.faces.length) {
    faceUvIndices = faceUvIndices.map((f, fi) => (faceSet.has(fi) ? [...f].reverse() : [...f]))
  }
  return { ...obj, faces, faceUvIndices }
}

/** Make all selected faces of the object face outward. If no selection, makes all faces of the object face outward. */
export function makeSelectionOutward(
  obj: SceneObject,
  selection: MeshComponentSelection | null,
  mode: SelectionMode
): SceneObject {
  if (obj.positions.length === 0) return cloneSceneObject(obj)

  // 1. Calculate centroid of the object's vertices (reference point)
  let cx = 0, cy = 0, cz = 0
  for (const p of obj.positions) {
    cx += p.x
    cy += p.y
    cz += p.z
  }
  const center = {
    x: cx / obj.positions.length,
    y: cy / obj.positions.length,
    z: cz / obj.positions.length,
  }

  // 2. Identify which faces we are modifying
  let faceSet: Set<number>
  if (selection && selection.objectId === obj.id) {
    if (mode === 'face' && selection.faces.length > 0) {
      faceSet = new Set(selection.faces)
    } else if (mode === 'edge' && selection.edges.length > 0) {
      faceSet = collectFacesForSelection(obj, selection, 'edge')
    } else if (mode === 'vertex' && selection.vertices.length > 0) {
      faceSet = collectFacesForSelection(obj, selection, 'vertex')
    } else {
      faceSet = new Set(obj.faces.map((_, i) => i))
    }
  } else {
    faceSet = new Set(obj.faces.map((_, i) => i))
  }

  // 3. For each face, if it is in our modify set, calculate normal and centroid.
  // If dot(normal, faceCentroid - center) < 0, reverse the winding order!
  const flippedFaces = new Set<number>()
  const faces = obj.faces.map((face, fi) => {
    if (!faceSet.has(fi) || face.length < 3) return [...face]

    const a = obj.positions[face[0]]
    const b = obj.positions[face[1]]
    const c = obj.positions[face[2]]
    const n = faceNormal(a, b, c)

    let fx = 0, fy = 0, fz = 0
    for (const vi of face) {
      const p = obj.positions[vi]
      fx += p.x
      fy += p.y
      fz += p.z
    }
    const faceCenter = {
      x: fx / face.length,
      y: fy / face.length,
      z: fz / face.length,
    }

    const dir = sub3(faceCenter, center)
    const dot = dot3(n, dir)

    if (dot < -1e-5) {
      flippedFaces.add(fi)
      return [...face].reverse()
    }
    return [...face]
  })

  let faceUvIndices = obj.faceUvIndices
  if (faceUvIndices?.length === obj.faces.length) {
    faceUvIndices = faceUvIndices.map((f, fi) => (flippedFaces.has(fi) ? [...f].reverse() : [...f]))
  }

  return { ...obj, faces, faceUvIndices }
}

/** Split edge a-b at parameter t, inserting a new vertex into all incident face loops. */
export function splitEdgeAt(
  positions: Vec3[],
  faces: number[][],
  a: number,
  b: number,
  t: number
): number {
  const pa = positions[a]
  const pb = positions[b]
  const u = Math.max(0.001, Math.min(0.999, t))
  const newVi = positions.length
  positions.push({
    x: pa.x + (pb.x - pa.x) * u,
    y: pa.y + (pb.y - pa.y) * u,
    z: pa.z + (pb.z - pa.z) * u,
  })

  const newFaces: number[][] = []
  for (const face of faces) {
    let replaced = false
    for (let i = 0; i < face.length; i++) {
      const va = face[i]
      const vb = face[(i + 1) % face.length]
      if (va === a && vb === b) {
        newFaces.push([...face.slice(0, i + 1), newVi, ...face.slice(i + 1)])
        replaced = true
        break
      }
      if (va === b && vb === a) {
        newFaces.push([...face.slice(0, i + 1), newVi, ...face.slice(i + 1)])
        replaced = true
        break
      }
    }
    if (!replaced) newFaces.push([...face])
  }

  faces.length = 0
  faces.push(...newFaces)
  return newVi
}

/** The edge across a quad. Loop cuts intentionally stop at triangles and n-gons. */
function oppositeQuadEdge(face: number[], edge: string): string | null {
  if (face.length !== 4) return null
  const [a, b] = parseEdgeKey(edge)
  for (let i = 0; i < 4; i++) {
    const from = face[i]!
    const to = face[(i + 1) % 4]!
    if ((from === a && to === b) || (from === b && to === a)) {
      return edgeKey(face[(i + 2) % 4]!, face[(i + 3) % 4]!)
    }
  }
  return null
}

function edgeFaceMap(obj: SceneObject): Map<string, number[]> {
  const map = new Map<string, number[]>()
  obj.faces.forEach((face, faceIndex) => {
    for (let i = 0; i < face.length; i++) {
      const key = edgeKey(face[i]!, face[(i + 1) % face.length]!)
      const faces = map.get(key) ?? []
      faces.push(faceIndex)
      map.set(key, faces)
    }
  })
  return map
}

function walkQuadLoopBranch(
  obj: SceneObject,
  edgeFaces: Map<string, number[]>,
  seedKey: string,
  startFace: number
): string[] {
  const out: string[] = []
  const seen = new Set<string>([seedKey])
  let edge = seedKey
  let faceIndex = startFace

  for (let guard = 0; guard < obj.faces.length; guard++) {
    const face = obj.faces[faceIndex]
    if (!face) break
    const opposite = oppositeQuadEdge(face, edge)
    if (!opposite || seen.has(opposite)) break
    out.push(opposite)
    seen.add(opposite)

    const nextFace = (edgeFaces.get(opposite) ?? []).find(
      (candidate) => candidate !== faceIndex && obj.faces[candidate]?.length === 4
    )
    if (nextFace === undefined) break
    edge = opposite
    faceIndex = nextFace
  }
  return out
}

/**
 * Blender-style edge ring: cross each quad through its opposite edge, stopping at
 * boundaries, triangles, n-gons, and poles rather than guessing a non-loop path.
 */
export function findEdgeLoop(obj: SceneObject, seedKey: string): string[] {
  const [a, b] = parseEdgeKey(seedKey)
  const edgeFaces = edgeFaceMap(obj)
  const incident = edgeFaces.get(edgeKey(a, b)) ?? []
  if (incident.length === 0) return []

  const loop = new Set<string>([edgeKey(a, b)])
  for (const faceIndex of incident) {
    for (const edge of walkQuadLoopBranch(obj, edgeFaces, seedKey, faceIndex)) loop.add(edge)
  }
  return [...loop]
}

export function splitFaceAtChord(
  faces: number[][],
  faceColors: number[],
  fi: number,
  vA: number,
  vB: number
): void {
  const face = faces[fi]
  const ia = face.indexOf(vA)
  const ib = face.indexOf(vB)
  if (ia < 0 || ib < 0 || ia === ib) return

  const color = faceColors[fi]
  const n = face.length
  const segA: number[] = []
  const segB: number[] = []
  let i = ia
  do {
    segA.push(face[i])
    i = (i + 1) % n
  } while (i !== ib)
  segA.push(face[ib])

  i = ib
  do {
    segB.push(face[i])
    i = (i + 1) % n
  } while (i !== ia)
  segB.push(face[ia])

  if (segA.length < 3 || segB.length < 3) return

  faces[fi] = segA
  faces.push(segB)
  faceColors.push(color)
}

/** Insert an edge loop at parameter t along each edge in the loop (Blender Ctrl+R). */
export function insertEdgeLoop(
  obj: SceneObject,
  loopEdges: string[],
  t = 0.5
): SceneObject {
  if (loopEdges.length === 0) return cloneSceneObject(obj)

  const positions = obj.positions.map((p) => ({ ...p }))
  const faces = obj.faces.map((f) => [...f])
  const faceColors = [...obj.faceColors]
  const splitMap = new Map<number, number[]>()

  const splitVerts = new Map<string, number>()
  for (const key of loopEdges) {
    const [a, b] = parseEdgeKey(key)
    if (a >= positions.length || b >= positions.length) continue
    const vi = splitEdgeAt(positions, faces, a, b, t)
    splitVerts.set(key, vi)
  }

  const splitVertSet = new Set(splitVerts.values())
  for (let fi = 0; fi < faces.length; fi++) {
    const face = faces[fi]
    const onFace = face.filter((vi) => splitVertSet.has(vi))
    if (onFace.length === 2) {
      const before = faces.length
      splitFaceAtChord(faces, faceColors, fi, onFace[0], onFace[1])
      if (faces.length > before) {
        splitMap.set(fi, [fi, faces.length - 1])
      }
    }
  }

  const newFaceSourceOld: number[] = []
  for (let fi = 0; fi < faces.length; fi++) {
    let source = fi
    for (const [oldFi, pieces] of splitMap) {
      if (pieces.includes(fi)) {
        source = oldFi
        break
      }
    }
    newFaceSourceOld.push(source)
  }

  const faceGroups = splitFaceGroupsAfterCut(obj.faceGroups, obj.faces.length, newFaceSourceOld)

  return removeUnreferencedVertices({ ...obj, positions, faces, faceColors, faceGroups })
}

export function loopCutPreviewPositions(
  obj: SceneObject,
  loopEdges: string[],
  t: number
): Vec3[] {
  const out: Vec3[] = []
  for (const key of loopEdges) {
    const [a, b] = parseEdgeKey(key)
    if (a >= obj.positions.length || b >= obj.positions.length) continue
    const pa = obj.positions[a]
    const pb = obj.positions[b]
    const u = Math.max(0.001, Math.min(0.999, t))
    out.push({
      x: pa.x + (pb.x - pa.x) * u,
      y: pa.y + (pb.y - pa.y) * u,
      z: pa.z + (pb.z - pa.z) * u,
    })
  }
  return out
}

/** Chords across every affected quad, suitable for a continuous loop-cut preview. */
export function loopCutPreviewSegments(
  obj: SceneObject,
  loopEdges: string[],
  t: number
): Array<[Vec3, Vec3]> {
  const loop = new Set(loopEdges)
  const u = Math.max(0.001, Math.min(0.999, t))
  const segments: Array<[Vec3, Vec3]> = []
  for (const face of obj.faces) {
    if (face.length !== 4) continue
    const points: Vec3[] = []
    for (let i = 0; i < 4; i++) {
      const a = face[i]!
      const b = face[(i + 1) % 4]!
      if (!loop.has(edgeKey(a, b))) continue
      const pa = obj.positions[a]!
      const pb = obj.positions[b]!
      points.push({
        x: pa.x + (pb.x - pa.x) * u,
        y: pa.y + (pb.y - pa.y) * u,
        z: pa.z + (pb.z - pa.z) * u,
      })
    }
    if (points.length === 2) segments.push([points[0]!, points[1]!])
  }
  return segments
}

export function facesUsingEdge(obj: SceneObject, a: number, b: number): number {
  let count = 0
  for (const face of obj.faces) {
    for (let i = 0; i < face.length; i++) {
      const va = face[i]
      const vb = face[(i + 1) % face.length]
      if ((va === a && vb === b) || (va === b && vb === a)) count++
    }
  }
  return count
}

export function isValidLoopSeed(obj: SceneObject, seedKey: string): boolean {
  const [a, b] = parseEdgeKey(seedKey)
  if (a >= obj.positions.length || b >= obj.positions.length) return false
  const loop = findEdgeLoop(obj, seedKey)
  return loop.length >= 2 && facesUsingEdge(obj, a, b) >= 1
}

function facesToSubdivide(
  obj: SceneObject,
  selection: MeshComponentSelection | null,
  mode: SelectionMode
): Set<number> {
  if (!selection || mode === 'object') {
    return new Set(obj.faces.map((_, i) => i))
  }
  if (mode === 'face' && selection.faces.length > 0) {
    return new Set(selection.faces)
  }
  if (mode === 'edge' && selection.edges.length > 0) {
    return collectFacesForSelection(obj, selection, 'edge')
  }
  if (mode === 'vertex' && selection.vertices.length > 0) {
    return collectFacesForSelection(obj, selection, 'vertex')
  }
  return new Set(obj.faces.map((_, i) => i))
}

/** Split an edge-subdivided face loop into corner faces + center face. */
function subdivideFaceLoop(face: number[]): number[][] {
  const n = face.length / 2
  if (n < 3 || face.length % 2 !== 0) return [face]

  const corners: number[] = []
  const mids: number[] = []
  for (let i = 0; i < face.length; i++) {
    if (i % 2 === 0) corners.push(face[i])
    else mids.push(face[i])
  }

  const parts: number[][] = []
  for (let i = 0; i < n; i++) {
    parts.push([corners[i], mids[i], mids[(i - 1 + n) % n]])
  }
  parts.push([...mids])
  return parts
}

/** Blender-style subdivide: midpoint every edge of selected faces, split into smaller faces. */
export function subdivideObject(
  obj: SceneObject,
  selection: MeshComponentSelection | null,
  mode: SelectionMode
): SceneObject {
  const faceSet = facesToSubdivide(obj, selection, mode)
  if (faceSet.size === 0) return cloneSceneObject(obj)

  const positions = obj.positions.map((p) => ({ ...p }))
  const faces = obj.faces.map((f) => [...f])
  const faceColors = [...obj.faceColors]

  const edgesToSplit = new Set<string>()
  for (const fi of faceSet) {
    const face = obj.faces[fi]
    if (!face) continue
    for (let i = 0; i < face.length; i++) {
      edgesToSplit.add(edgeKey(face[i], face[(i + 1) % face.length]))
    }
  }

  for (const key of edgesToSplit) {
    const [a, b] = parseEdgeKey(key)
    splitEdgeAt(positions, faces, a, b, 0.5)
  }

  const outFaces: number[][] = []
  const outColors: number[] = []
  const oldToNew = new Map<number, number[]>()
  let nextFi = 0

  for (let fi = 0; fi < faces.length; fi++) {
    const color = faceColors[fi]
    if (faceSet.has(fi)) {
      const replacements: number[] = []
      for (const part of subdivideFaceLoop(faces[fi])) {
        outFaces.push(part)
        outColors.push(color)
        replacements.push(nextFi++)
      }
      oldToNew.set(fi, replacements)
    } else {
      outFaces.push(faces[fi])
      outColors.push(color)
      oldToNew.set(fi, [nextFi++])
    }
  }

  const faceGroups = remapFaceGroupsAfterReplace(obj.faceGroups, obj.faces.length, oldToNew)

  return removeUnreferencedVertices({
    ...obj,
    positions,
    faces: outFaces,
    faceColors: outColors,
    faceGroups,
  })
}

function isDegenerateFace(face: number[]): boolean {
  if (face.length < 3) return true
  if (new Set(face).size < 3) return true
  for (let i = 0; i < face.length; i++) {
    if (face[i] === face[(i + 1) % face.length]) return true
  }
  return false
}

function remapFaceGroupsAfterFaceFilter(
  faceGroups: number[][] | undefined,
  oldToNewFace: Map<number, number>
): number[][] | undefined {
  if (!faceGroups?.length) return faceGroups
  return faceGroups
    .map((group) =>
      group
        .map((fi) => oldToNewFace.get(fi))
        .filter((fi): fi is number => fi !== undefined)
    )
    .filter((group) => group.length > 0)
}

/** Collapse vertices into one (at their average position). */
export function mergeVertices(
  obj: SceneObject,
  vertexIndices: number[]
): { object: SceneObject; mergedVertexIndex: number } | null {
  const unique = [...new Set(vertexIndices)].filter(
    (vi) => vi >= 0 && vi < obj.positions.length
  )
  if (unique.length < 2) return null

  const survivor = unique[0]!
  const mergeSet = new Set(unique)

  const positions = obj.positions.map((p) => ({ ...p }))
  let sx = 0
  let sy = 0
  let sz = 0
  for (const vi of unique) {
    const p = positions[vi]
    if (!p) return null
    sx += p.x
    sy += p.y
    sz += p.z
  }
  const count = unique.length
  positions[survivor] = { x: sx / count, y: sy / count, z: sz / count }

  const remapVi = (vi: number) => (mergeSet.has(vi) ? survivor : vi)

  const newFaces: number[][] = []
  const newFaceColors: number[] = []
  const newFaceUvIndices: number[][] = []
  const oldToNewFace = new Map<number, number>()
  const hasUv = Boolean(obj.faceUvIndices?.length)

  for (let fi = 0; fi < obj.faces.length; fi++) {
    const remapped = obj.faces[fi]!.map(remapVi)
    if (isDegenerateFace(remapped)) continue
    oldToNewFace.set(fi, newFaces.length)
    newFaces.push(remapped)
    newFaceColors.push(obj.faceColors[fi] ?? obj.color)
    if (hasUv && obj.faceUvIndices?.[fi]) {
      newFaceUvIndices.push([...obj.faceUvIndices[fi]])
    }
  }

  if (newFaces.length === 0) return null

  const faceGroups = remapFaceGroupsAfterFaceFilter(obj.faceGroups, oldToNewFace)

  const used = new Set<number>()
  for (const face of newFaces) {
    for (const vi of face) used.add(vi)
  }

  const oldToNew = new Map<number, number>()
  const compactPositions: Vec3[] = []
  for (const vi of [...used].sort((a, b) => a - b)) {
    oldToNew.set(vi, compactPositions.length)
    compactPositions.push({ ...positions[vi]! })
  }

  const compactFaces = newFaces.map((face) => face.map((vi) => oldToNew.get(vi)!))
  const mergedVertexIndex = oldToNew.get(survivor)
  if (mergedVertexIndex === undefined) return null

  return {
    object: {
      ...obj,
      positions: compactPositions,
      faces: compactFaces,
      faceColors: newFaceColors,
      faceGroups,
      faceUvIndices: hasUv ? newFaceUvIndices : obj.faceUvIndices,
    },
    mergedVertexIndex,
  }
}

/** True if `faces` already contains a reverse-wound copy of `face` (any start corner). */
function hasReverseWoundFace(faces: number[][], face: number[]): boolean {
  if (face.length < 3) return false
  const rev = [...face].reverse()
  for (const other of faces) {
    if (other.length !== rev.length) continue
    for (let start = 0; start < other.length; start++) {
      let match = true
      for (let i = 0; i < rev.length; i++) {
        if (other[(start + i) % other.length] !== rev[i]) {
          match = false
          break
        }
      }
      if (match) return true
    }
  }
  return false
}

export interface MakeDoubleSidedResult {
  object: SceneObject
  /** New back-face indices appended to the mesh. */
  addedFaces: number[]
}

/** Duplicate selected faces with reversed winding to make them double-sided, sharing UVs. */
export function makeSelectionDoubleSided(
  obj: SceneObject,
  selection: MeshComponentSelection | null,
  mode: SelectionMode
): MakeDoubleSidedResult {
  if (!selection) return { object: cloneSceneObject(obj), addedFaces: [] }

  let faceSet: Set<number>
  if (mode === 'face' && selection.faces.length > 0) {
    faceSet = new Set(selection.faces)
  } else if (mode === 'edge' && selection.edges.length > 0) {
    faceSet = collectFacesForSelection(obj, selection, 'edge')
  } else if (mode === 'vertex' && selection.vertices.length > 0) {
    faceSet = collectFacesForSelection(obj, selection, 'vertex')
  } else {
    return { object: cloneSceneObject(obj), addedFaces: [] }
  }

  if (faceSet.size === 0) return { object: cloneSceneObject(obj), addedFaces: [] }

  const newFaces = obj.faces.map((f) => [...f])
  const newFaceUvIndices = obj.faceUvIndices?.map((f) => [...f])
  const newFaceColorIndices = obj.faceColorIndices?.map((f) => [...f])
  const newFaceColors = [...obj.faceColors]
  const newFaceMaterials = obj.faceMaterials?.map((m) => (m ? cloneMaterial(m) : null))
  const newFaceGroups = obj.faceGroups?.map((g) => [...g])
  const addedFaces: number[] = []

  const selected = [...faceSet].sort((a, b) => a - b)
  for (const fi of selected) {
    const origFace = obj.faces[fi]
    if (!origFace || origFace.length < 3) continue
    if (hasReverseWoundFace(newFaces, origFace)) continue

    const revFace = [...origFace].reverse()
    const newFi = newFaces.length
    newFaces.push(revFace)
    addedFaces.push(newFi)

    newFaceColors.push(obj.faceColors[fi] ?? obj.color)

    if (newFaceUvIndices && obj.faceUvIndices?.[fi]) {
      newFaceUvIndices.push([...obj.faceUvIndices[fi]!].reverse())
    } else if (newFaceUvIndices) {
      // Keep parallel array length even if this face had no UVs.
      newFaceUvIndices.push([])
    }

    if (newFaceColorIndices && obj.faceColorIndices?.[fi]) {
      newFaceColorIndices.push([...obj.faceColorIndices[fi]!].reverse())
    } else if (newFaceColorIndices) {
      newFaceColorIndices.push([])
    }

    if (newFaceMaterials) {
      const mat = obj.faceMaterials?.[fi]
      newFaceMaterials.push(mat ? cloneMaterial(mat) : null)
    }

    if (newFaceGroups) {
      // Keep front+back in the same authored group when present; otherwise own group.
      let grouped = false
      for (const group of newFaceGroups) {
        if (group.includes(fi)) {
          group.push(newFi)
          grouped = true
          break
        }
      }
      if (!grouped) newFaceGroups.push([newFi])
    }
  }

  if (addedFaces.length === 0) {
    return { object: cloneSceneObject(obj), addedFaces: [] }
  }

  return {
    object: {
      ...obj,
      faces: newFaces,
      faceColors: newFaceColors,
      faceGroups: newFaceGroups ?? obj.faceGroups,
      faceUvIndices: newFaceUvIndices ?? obj.faceUvIndices,
      faceColorIndices: newFaceColorIndices ?? obj.faceColorIndices,
      faceMaterials: newFaceMaterials ?? obj.faceMaterials,
    },
    addedFaces,
  }
}
