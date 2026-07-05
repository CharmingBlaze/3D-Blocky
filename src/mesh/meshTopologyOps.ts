import type { SceneObject } from './HalfEdgeMesh'
import {
  edgeKey,
  parseEdgeKey,
  type MeshComponentSelection,
} from './meshSelection'
import type { SelectionMode } from '../store/appStore'
import { cloneSceneObject } from './meshOps'
import type { Vec3 } from '../utils/math'
import { remapFaceGroupsAfterReplace, splitFaceGroupsAfterCut } from './faceGroups'

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
  return { ...obj, faces }
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

function stepLoopVertex(obj: SceneObject, prev: number, curr: number): number | null {
  const candidates: number[] = []
  for (const face of obj.faces) {
    const n = face.length
    for (let i = 0; i < n; i++) {
      const va = face[i]
      const vb = face[(i + 1) % n]
      if (va === prev && vb === curr) {
        candidates.push(face[(i + 2) % n])
      } else if (va === curr && vb === prev) {
        candidates.push(face[(i + n - 1) % n])
      }
    }
  }
  const next = candidates.find((v) => v !== prev)
  return next ?? null
}

function walkLoopFrom(obj: SceneObject, seedKey: string, forward: boolean): string[] {
  const [a0, b0] = parseEdgeKey(seedKey)
  const loop: string[] = [seedKey]
  let prev = forward ? a0 : b0
  let curr = forward ? b0 : a0

  for (let guard = 0; guard < obj.faces.length * 8; guard++) {
    const next = stepLoopVertex(obj, prev, curr)
    if (next === null) break
    const key = edgeKey(curr, next)
    if (key === seedKey || loop.includes(key)) break
    loop.push(key)
    prev = curr
    curr = next
    if (curr === a0 || curr === b0) break
  }
  return loop
}

/** Edge loop through quads / general n-gons (Blender-style ring). */
export function findEdgeLoop(obj: SceneObject, seedKey: string): string[] {
  const fwd = walkLoopFrom(obj, seedKey, true)
  const bwd = walkLoopFrom(obj, seedKey, false)
  const merged = [...bwd.slice(1).reverse(), ...fwd]
  return [...new Set(merged)]
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
  return loop.length >= 1 && facesUsingEdge(obj, a, b) >= 1
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
