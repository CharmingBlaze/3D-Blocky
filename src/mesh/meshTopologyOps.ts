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

type Uv2 = { u: number; v: number }

function lerpUv(a: Uv2, b: Uv2, t: number): Uv2 {
  return { u: a.u + (b.u - a.u) * t, v: a.v + (b.v - a.v) * t }
}

/** Lightweight topology sanity checks for cut regression tests. */
export function validateCutTopology(obj: SceneObject): string[] {
  const errors: string[] = []
  for (let fi = 0; fi < obj.faces.length; fi++) {
    const face = obj.faces[fi]!
    if (face.length < 3) errors.push(`face ${fi}: fewer than 3 verts`)
    if (new Set(face).size < face.length) errors.push(`face ${fi}: duplicate verts`)
    for (const vi of face) {
      if (vi < 0 || vi >= obj.positions.length) errors.push(`face ${fi}: out-of-range vert`)
    }
    // Degenerate (near-zero area) faces leave holes / z-fight after cuts.
    if (face.length >= 3) {
      let area2 = 0
      const o = obj.positions[face[0]!]!
      for (let i = 1; i + 1 < face.length; i++) {
        const a = obj.positions[face[i]!]!
        const b = obj.positions[face[i + 1]!]!
        const abx = a.x - o.x
        const aby = a.y - o.y
        const abz = a.z - o.z
        const acx = b.x - o.x
        const acy = b.y - o.y
        const acz = b.z - o.z
        const cx = aby * acz - abz * acy
        const cy = abz * acx - abx * acz
        const cz = abx * acy - aby * acx
        area2 += Math.hypot(cx, cy, cz)
      }
      if (area2 < 1e-10) errors.push(`face ${fi}: degenerate area`)
    }
  }

  // Edge valence: closed meshes should not grow non-manifold (3+) edges from a cut.
  const edgeUse = new Map<string, number>()
  for (const face of obj.faces) {
    for (let i = 0; i < face.length; i++) {
      const k = edgeKey(face[i]!, face[(i + 1) % face.length]!)
      edgeUse.set(k, (edgeUse.get(k) ?? 0) + 1)
    }
  }
  for (const [k, n] of edgeUse) {
    if (n > 2) errors.push(`edge ${k}: non-manifold (${n} faces)`)
  }

  if (obj.faceGroups) {
    const covered = new Set<number>()
    for (const group of obj.faceGroups) {
      for (const fi of group) {
        if (fi < 0 || fi >= obj.faces.length) errors.push(`faceGroups: invalid face ${fi}`)
        if (covered.has(fi)) errors.push(`faceGroups: face ${fi} in multiple groups`)
        covered.add(fi)
      }
    }
    for (let fi = 0; fi < obj.faces.length; fi++) {
      if (!covered.has(fi)) errors.push(`faceGroups: face ${fi} missing`)
    }
  }
  if (obj.faceUvIndices) {
    if (obj.faceUvIndices.length !== obj.faces.length) {
      errors.push('faceUvIndices length mismatch')
    } else {
      for (let fi = 0; fi < obj.faces.length; fi++) {
        if (obj.faceUvIndices[fi]!.length !== obj.faces[fi]!.length) {
          errors.push(`face ${fi}: UV ring length mismatch`)
        }
      }
    }
  }
  return errors
}

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
  return splitEdgeAtWithUv(positions, faces, null, null, a, b, t)
}

/**
 * Split edge a-b at t across all incident faces, optionally interpolating UV rings.
 * Shared by knife and loop-cut so seams stay in sync.
 */
export function splitEdgeAtWithUv(
  positions: Vec3[],
  faces: number[][],
  faceUvIndices: number[][] | null,
  uvs: Uv2[] | null,
  a: number,
  b: number,
  t: number
): number {
  const pa = positions[a]!
  const pb = positions[b]!
  const u = Math.max(0.001, Math.min(0.999, t))
  const newVi = positions.length
  positions.push({
    x: pa.x + (pb.x - pa.x) * u,
    y: pa.y + (pb.y - pa.y) * u,
    z: pa.z + (pb.z - pa.z) * u,
  })

  const newFaces: number[][] = []
  const newFaceUvs: number[][] | null = faceUvIndices ? [] : null

  for (let fi = 0; fi < faces.length; fi++) {
    const face = faces[fi]!
    const faceUv = faceUvIndices?.[fi]
    let replaced = false
    for (let i = 0; i < face.length; i++) {
      const va = face[i]!
      const vb = face[(i + 1) % face.length]!
      if ((va === a && vb === b) || (va === b && vb === a)) {
        const next = [...face.slice(0, i + 1), newVi, ...face.slice(i + 1)]
        newFaces.push(next)
        if (newFaceUvs && faceUv && uvs) {
          const ua = faceUv[i]!
          const ub = faceUv[(i + 1) % faceUv.length]!
          const uvA = uvs[ua] ?? { u: 0, v: 0 }
          const uvB = uvs[ub] ?? { u: 0, v: 0 }
          const newUvIndex = uvs.length
          uvs.push(lerpUv(uvA, uvB, va === a ? u : 1 - u))
          newFaceUvs.push([...faceUv.slice(0, i + 1), newUvIndex, ...faceUv.slice(i + 1)])
        } else if (newFaceUvs) {
          newFaceUvs.push(faceUv ? [...faceUv] : [])
        }
        replaced = true
        break
      }
    }
    if (!replaced) {
      newFaces.push([...face])
      if (newFaceUvs) newFaceUvs.push(faceUv ? [...faceUv] : [])
    }
  }

  faces.length = 0
  faces.push(...newFaces)
  if (faceUvIndices && newFaceUvs) {
    faceUvIndices.length = 0
    faceUvIndices.push(...newFaceUvs)
  }
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
  splitFaceAtChordWithUv(faces, faceColors, null, fi, vA, vB)
}

/** True when a and b are neighbors on the face boundary (degenerate chord). */
export function areAdjacentOnFace(face: number[], a: number, b: number): boolean {
  const n = face.length
  const ia = face.indexOf(a)
  const ib = face.indexOf(b)
  if (ia < 0 || ib < 0) return true
  return (ia + 1) % n === ib || (ib + 1) % n === ia
}

/**
 * Split a face into two polygons along chord vA–vB, optionally keeping UV rings aligned.
 */
export function splitFaceAtChordWithUv(
  faces: number[][],
  faceColors: number[],
  faceUvIndices: number[][] | null,
  fi: number,
  vA: number,
  vB: number
): void {
  const face = faces[fi]!
  const ia = face.indexOf(vA)
  const ib = face.indexOf(vB)
  if (ia < 0 || ib < 0 || ia === ib) return

  const color = faceColors[fi]!
  const n = face.length
  const segA: number[] = []
  const segB: number[] = []
  let i = ia
  do {
    segA.push(face[i]!)
    i = (i + 1) % n
  } while (i !== ib)
  segA.push(face[ib]!)

  i = ib
  do {
    segB.push(face[i]!)
    i = (i + 1) % n
  } while (i !== ia)
  segB.push(face[ia]!)

  if (segA.length < 3 || segB.length < 3) return

  let uvA: number[] | null = null
  let uvB: number[] | null = null
  const faceUv = faceUvIndices?.[fi]
  if (faceUv && faceUv.length === n) {
    uvA = []
    uvB = []
    i = ia
    do {
      uvA.push(faceUv[i]!)
      i = (i + 1) % n
    } while (i !== ib)
    uvA.push(faceUv[ib]!)

    i = ib
    do {
      uvB.push(faceUv[i]!)
      i = (i + 1) % n
    } while (i !== ia)
    uvB.push(faceUv[ia]!)
  }

  // Both pieces walk the original ring direction, so winding matches the parent.
  faces[fi] = segA
  faces.push(segB)
  faceColors.push(color)
  if (faceUvIndices) {
    if (uvA && uvB) {
      faceUvIndices[fi] = uvA
      faceUvIndices.push(uvB)
    } else {
      faceUvIndices.push(faceUv ? [...faceUv] : [])
    }
  }
}

/** Insert an edge loop at parameter t along each edge in the loop (Blender/Blockbench). */
export function insertEdgeLoop(
  obj: SceneObject,
  loopEdges: string[],
  t = 0.5,
  seedEdge?: string
): SceneObject {
  if (loopEdges.length === 0) return cloneSceneObject(obj)

  // Blockbench/Blender: opposite edges must share a consistent parametric direction
  // or the inserted loop zig-zags instead of forming a clean ring.
  const seed = seedEdge ?? loopEdges[0]!
  const oriented = orientEdgeLoop(obj, loopEdges, seed)
  const { object } = insertOrientedEdgeLoop(obj, oriented, t)
  return removeUnreferencedVertices(object)
}

/**
 * Insert one edge loop using oriented edges (u→v), preserving faceGroups and UV rings.
 * Does not compact unused verts — callers that chain cuts keep indices stable, then
 * `removeUnreferencedVertices` once at the end.
 */
export function insertOrientedEdgeLoop(
  obj: SceneObject,
  orientedEdges: { u: number; v: number }[],
  t: number
): { object: SceneObject; splitVerts: Map<string, number> } {
  if (orientedEdges.length === 0) {
    return { object: cloneSceneObject(obj), splitVerts: new Map() }
  }

  const positions = obj.positions.map((p) => ({ ...p }))
  const faces = obj.faces.map((f) => [...f])
  const faceColors = [...obj.faceColors]
  const beforeFaces = faces.length
  const hasUv =
    Boolean(obj.uvs?.length) &&
    Boolean(obj.faceUvIndices?.length) &&
    obj.faceUvIndices!.length === obj.faces.length
  const uvs: Uv2[] | null = hasUv ? obj.uvs!.map((u) => ({ ...u })) : null
  const faceUvIndices: number[][] | null = hasUv
    ? obj.faceUvIndices!.map((f) => [...f])
    : null

  const splitMap = new Map<number, number[]>()
  const splitVerts = new Map<string, number>()
  const u = Math.max(0.001, Math.min(0.999, t))

  for (const edge of orientedEdges) {
    if (edge.u >= positions.length || edge.v >= positions.length) continue
    const key = edgeKey(edge.u, edge.v)
    if (splitVerts.has(key)) continue
    const vi = splitEdgeAtWithUv(
      positions,
      faces,
      faceUvIndices,
      uvs,
      edge.u,
      edge.v,
      u
    )
    splitVerts.set(key, vi)
  }

  const splitVertSet = new Set(splitVerts.values())
  for (let fi = 0; fi < beforeFaces; fi++) {
    const face = faces[fi]!
    const onFace: number[] = []
    for (const vi of face) {
      if (splitVertSet.has(vi) && onFace[onFace.length - 1] !== vi) onFace.push(vi)
    }
    if (onFace.length < 2) continue
    const a = onFace[0]!
    const b = onFace[onFace.length - 1]!
    if (areAdjacentOnFace(face, a, b)) continue
    const before = faces.length
    splitFaceAtChordWithUv(faces, faceColors, faceUvIndices, fi, a, b)
    if (faces.length > before) {
      splitMap.set(fi, [fi, faces.length - 1])
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
    newFaceSourceOld.push(source < beforeFaces ? source : 0)
  }

  const faceGroups = splitFaceGroupsAfterCut(obj.faceGroups, beforeFaces, newFaceSourceOld)

  const object: SceneObject = {
    ...obj,
    positions,
    faces,
    faceColors,
    faceGroups,
    uvs: uvs ?? obj.uvs,
    faceUvIndices: faceUvIndices ?? obj.faceUvIndices,
  }

  return { object, splitVerts }
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

/** Insert multiple edge loops at specified tValues along each edge in the loop. */
export function insertMultipleEdgeLoops(
  obj: SceneObject,
  loopEdges: string[],
  seedEdge: string,
  tValues: number[]
): SceneObject {
  if (loopEdges.length === 0 || tValues.length === 0) return cloneSceneObject(obj)

  const orientedEdges = orientEdgeLoop(obj, loopEdges, seedEdge)
  const sortedT = [...tValues].sort((a, b) => a - b)
  let current = cloneSceneObject(obj)
  let currentEdges = [...orientedEdges]
  let prevT = 0

  for (const tVal of sortedT) {
    const denom = 1 - prevT
    const tRelative = denom > 1e-5 ? (tVal - prevT) / denom : 0.5

    const { object, splitVerts } = insertOrientedEdgeLoop(current, currentEdges, tRelative)
    current = object

    // Indices stay stable (no mid-pass compaction): next cut is midVert → original end.
    currentEdges = currentEdges.flatMap((edge) => {
      const vi = splitVerts.get(edgeKey(edge.u, edge.v))
      if (vi === undefined) return []
      return [{ u: vi, v: edge.v }]
    })

    prevT = tVal
  }

  return removeUnreferencedVertices(current)
}

export function orientEdgeLoop(
  obj: SceneObject,
  loopEdges: string[],
  seedEdge: string
): { u: number; v: number }[] {
  const seed = parseEdgeKey(seedEdge)
  const seedOriented = { u: seed[0], v: seed[1] } // Start orientation
  const edgeSet = new Set(loopEdges)

  // We walk around the loop.
  // Let's build a map from each sorted edge to its oriented version.
  const orientedMap = new Map<string, { u: number; v: number }>()
  orientedMap.set(edgeKey(seed[0], seed[1]), seedOriented)

  const edgeFaces = edgeFaceMap(obj)
  const queue = [seedOriented]
  const seen = new Set<string>([edgeKey(seed[0], seed[1])])

  while (queue.length > 0) {
    const curr = queue.shift()!
    const currKey = edgeKey(curr.u, curr.v)

    // Find faces sharing this edge
    const faces = edgeFaces.get(currKey) ?? []
    for (const fi of faces) {
      const face = obj.faces[fi]
      if (!face || face.length !== 4) continue

      // Find opposite edge of the quad face
      let foundIndex = -1
      let forward = true
      for (let i = 0; i < 4; i++) {
        if (face[i] === curr.u && face[(i + 1) % 4] === curr.v) {
          foundIndex = i
          forward = true
          break
        }
        if (face[i] === curr.v && face[(i + 1) % 4] === curr.u) {
          foundIndex = i
          forward = false
          break
        }
      }
      if (foundIndex === -1) continue

      let opposite: { u: number; v: number }
      if (forward) {
        opposite = {
          u: face[(foundIndex + 3) % 4]!,
          v: face[(foundIndex + 2) % 4]!,
        }
      } else {
        opposite = {
          u: face[(foundIndex + 2) % 4]!,
          v: face[(foundIndex + 3) % 4]!,
        }
      }

      const oppKey = edgeKey(opposite.u, opposite.v)
      if (edgeSet.has(oppKey) && !seen.has(oppKey)) {
        seen.add(oppKey)
        orientedMap.set(oppKey, opposite)
        queue.push(opposite)
      }
    }
  }

  return loopEdges.map(
    (key) => orientedMap.get(key) ?? { u: parseEdgeKey(key)[0], v: parseEdgeKey(key)[1] }
  )
}
