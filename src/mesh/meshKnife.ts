import type { SceneObject } from './HalfEdgeMesh'
import { cloneSceneObject } from './meshOps'
import { edgeKey } from './meshSelection'
import { removeUnreferencedVertices, splitFaceAtChord } from './meshTopologyOps'
import { splitFaceGroupsAfterCut } from './faceGroups'
import { weldSceneObjectCoincidentVertices } from './subdivisionSurface'
import type { Vec3 } from '../utils/math'
import { worldPointFromObject } from './objectTransform'

const EPS = 1e-6
const MIN_CUT_LEN = 1e-5
/** Reject cuts that explode topology beyond this multiplier. */
const MAX_FACE_GROWTH = 6
const MAX_VERT_GROWTH = 8

type Uv2 = { u: number; v: number }

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

function lerpUv(a: Uv2, b: Uv2, t: number): Uv2 {
  return { u: a.u + (b.u - a.u) * t, v: a.v + (b.v - a.v) * t }
}

function signedDistance(normal: Vec3, planePoint: Vec3, p: Vec3): number {
  return dot3(normal, sub3(p, planePoint))
}

function onCutPlane(normal: Vec3, planePoint: Vec3, p: Vec3): boolean {
  return Math.abs(signedDistance(normal, planePoint, p)) <= EPS * 8
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
  if (t <= EPS || t >= 1 - EPS) return null
  return Math.max(0.001, Math.min(0.999, t))
}

/** Newell normal for an n-gon (mesh-local). */
function faceNormalLocal(positions: Vec3[], face: number[]): Vec3 {
  let nx = 0
  let ny = 0
  let nz = 0
  const n = face.length
  for (let i = 0; i < n; i++) {
    const a = positions[face[i]!]!
    const b = positions[face[(i + 1) % n]!]!
    nx += (a.y - b.y) * (a.z + b.z)
    ny += (a.z - b.z) * (a.x + b.x)
    nz += (a.x - b.x) * (a.y + b.y)
  }
  return normalize3({ x: nx, y: ny, z: nz })
}

/**
 * Faces pointing toward the camera (opposite view look-direction).
 * Blockbench knife only cuts what you draw across — not through the back.
 */
function isFrontFacing(normal: Vec3, viewForward: Vec3): boolean {
  return dot3(normal, viewForward) < -EPS
}

export function buildCutPlane(
  lineStart: Vec3,
  lineEnd: Vec3,
  viewForward: Vec3
): { point: Vec3; normal: Vec3; axis: Vec3 } | null {
  const lineDir = sub3(lineEnd, lineStart)
  if (length3(lineDir) < MIN_CUT_LEN) return null

  const axis = normalize3(lineDir)
  const rawNormal = cross3(axis, normalize3(viewForward))
  if (length3(rawNormal) < EPS) return null
  const planeNormal = normalize3(rawNormal)

  return {
    point: scale3(add3(lineStart, lineEnd), 0.5),
    normal: planeNormal,
    axis,
  }
}

/**
 * Local-space edge hit points along the knife plane, sorted along the cut axis.
 * Only front-facing faces whose chord overlaps the stroke (matches apply).
 */
export function previewKnifeCutLocalPoints(
  obj: SceneObject,
  lineStart: Vec3,
  lineEnd: Vec3,
  viewForward: Vec3
): Vec3[] {
  const plane = buildCutPlane(lineStart, lineEnd, viewForward)
  if (!plane) return []

  const { point: planePoint, normal: planeNormal, axis } = plane
  const segLen = length3(sub3(lineEnd, lineStart))
  const pad = Math.max(EPS * 40, segLen * 0.05)
  const segMin = Math.min(0, dot3(sub3(lineEnd, lineStart), axis)) - pad
  const segMax = Math.max(0, dot3(sub3(lineEnd, lineStart), axis)) + pad

  const hits: Array<{ p: Vec3; t: number }> = []

  for (const face of obj.faces) {
    if (!isFrontFacing(faceNormalLocal(obj.positions, face), viewForward)) continue
    const n = face.length
    const faceHits: Array<{ p: Vec3; t: number }> = []

    for (let i = 0; i < n; i++) {
      const a = face[i]!
      const b = face[(i + 1) % n]!
      const pa = obj.positions[a]!
      const pb = obj.positions[b]!

      if (onCutPlane(planeNormal, planePoint, pa)) {
        faceHits.push({ p: { ...pa }, t: dot3(sub3(pa, lineStart), axis) })
      }

      const sa = signedDistance(planeNormal, planePoint, pa)
      const sb = signedDistance(planeNormal, planePoint, pb)
      if (sa * sb >= -EPS * EPS) continue
      const u = intersectEdgeWithPlane(pa, pb, planePoint, planeNormal)
      if (u === null) continue
      const p = {
        x: pa.x + (pb.x - pa.x) * u,
        y: pa.y + (pb.y - pa.y) * u,
        z: pa.z + (pb.z - pa.z) * u,
      }
      faceHits.push({ p, t: dot3(sub3(p, lineStart), axis) })
    }

    faceHits.sort((a, b) => a.t - b.t)
    const dedup: typeof faceHits = []
    for (const h of faceHits) {
      const last = dedup[dedup.length - 1]
      if (last && Math.abs(last.t - h.t) < EPS * 40) continue
      dedup.push(h)
    }
    if (dedup.length < 2) continue
    const first = dedup[0]!
    const last = dedup[dedup.length - 1]!
    const minT = Math.min(first.t, last.t)
    const maxT = Math.max(first.t, last.t)
    if (maxT < segMin || minT > segMax) continue
    hits.push(first, last)
  }

  hits.sort((a, b) => a.t - b.t)

  const out: Vec3[] = []
  for (const h of hits) {
    const last = out[out.length - 1]
    if (last && length3(sub3(h.p, last)) < EPS * 40) continue
    out.push(h.p)
  }
  return out
}

export function previewKnifeCutWorldPoints(
  obj: SceneObject,
  localStart: Vec3,
  localEnd: Vec3,
  localViewForward: Vec3
): Vec3[] {
  return previewKnifeCutLocalPoints(obj, localStart, localEnd, localViewForward).map((p) =>
    worldPointFromObject(obj, p)
  )
}

/** Order cut verts as they appear walking the face boundary (stable pairing). */
function orderCutVertsOnFace(face: number[], cutSet: Set<number>): number[] {
  const ordered: number[] = []
  for (const vi of face) {
    if (cutSet.has(vi) && ordered[ordered.length - 1] !== vi) ordered.push(vi)
  }
  if (ordered.length > 1 && ordered[0] === ordered[ordered.length - 1]) ordered.pop()
  return ordered
}

function splitEdgeAtWithUv(
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

function splitFaceAtChordWithUv(
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

function cutIsSafe(
  beforeFaces: number,
  beforeVerts: number,
  afterFaces: number,
  afterVerts: number
): boolean {
  if (afterFaces < 1 || afterVerts < 3) return false
  if (afterFaces > beforeFaces * MAX_FACE_GROWTH) return false
  if (afterVerts > beforeVerts * MAX_VERT_GROWTH) return false
  return true
}

/**
 * Surface knife: view-aligned plane, but only on front-facing faces whose
 * cut chord overlaps the drawn segment — not a full through-mesh bandsaw.
 */
function cutWeldedMeshOnce(
  obj: SceneObject,
  lineStart: Vec3,
  lineEnd: Vec3,
  viewForward: Vec3
): SceneObject | null {
  const plane = buildCutPlane(lineStart, lineEnd, viewForward)
  if (!plane) return null

  const { point: planePoint, normal: planeNormal, axis } = plane
  const segLen = length3(sub3(lineEnd, lineStart))
  const pad = Math.max(EPS * 40, segLen * 0.05)
  const segT0 = 0
  const segT1 = dot3(sub3(lineEnd, lineStart), axis)
  const segMin = Math.min(segT0, segT1) - pad
  const segMax = Math.max(segT0, segT1) + pad

  const positions = obj.positions.map((p) => ({ ...p }))
  const faces = obj.faces.map((f) => [...f])
  const faceColors = [...obj.faceColors]
  const hasUv =
    Boolean(obj.uvs?.length) &&
    Boolean(obj.faceUvIndices?.length) &&
    obj.faceUvIndices!.length === obj.faces.length
  const uvs: Uv2[] | null = hasUv ? obj.uvs!.map((u) => ({ ...u })) : null
  const faceUvIndices: number[][] | null = hasUv
    ? obj.faceUvIndices!.map((f) => [...f])
    : null

  const beforeFaces = faces.length
  const beforeVerts = positions.length

  const frontFaceSet = new Set<number>()
  for (let fi = 0; fi < faces.length; fi++) {
    if (isFrontFacing(faceNormalLocal(positions, faces[fi]!), viewForward)) {
      frontFaceSet.add(fi)
    }
  }
  if (frontFaceSet.size === 0) return null

  const intervalsOverlap = (a0: number, a1: number, b0: number, b1: number) => {
    const minA = Math.min(a0, a1)
    const maxA = Math.max(a0, a1)
    const minB = Math.min(b0, b1)
    const maxB = Math.max(b0, b1)
    return maxA >= minB && maxB >= minA
  }

  // Per front face: find the plane chord; keep it only if it overlaps the stroke.
  const edgeHits = new Map<string, number>()
  const cutVertSet = new Set<number>()

  for (const fi of frontFaceSet) {
    const face = faces[fi]!
    const n = face.length
    const faceHits: Array<
      | { kind: 'edge'; key: string; t: number; along: number; vi?: undefined }
      | { kind: 'vert'; vi: number; along: number; key?: undefined; t?: undefined }
    > = []

    for (let i = 0; i < n; i++) {
      const a = face[i]!
      const b = face[(i + 1) % n]!
      const pa = positions[a]!
      const pb = positions[b]!

      if (onCutPlane(planeNormal, planePoint, pa)) {
        faceHits.push({
          kind: 'vert',
          vi: a,
          along: dot3(sub3(pa, lineStart), axis),
        })
      }

      const sa = signedDistance(planeNormal, planePoint, pa)
      const sb = signedDistance(planeNormal, planePoint, pb)
      if (sa * sb >= -EPS * EPS) continue

      const t = intersectEdgeWithPlane(pa, pb, planePoint, planeNormal)
      if (t === null) continue
      const hit = {
        x: pa.x + (pb.x - pa.x) * t,
        y: pa.y + (pb.y - pa.y) * t,
        z: pa.z + (pb.z - pa.z) * t,
      }
      faceHits.push({
        kind: 'edge',
        key: edgeKey(a, b),
        t,
        along: dot3(sub3(hit, lineStart), axis),
      })
    }

    // Dedup nearly-identical along-params (vert counted twice, etc.)
    faceHits.sort((a, b) => a.along - b.along)
    const dedup: typeof faceHits = []
    for (const h of faceHits) {
      const last = dedup[dedup.length - 1]
      if (last && Math.abs(last.along - h.along) < EPS * 40) continue
      dedup.push(h)
    }

    if (dedup.length < 2) continue
    // Use the outermost pair along the cut for a single chord.
    const first = dedup[0]!
    const last = dedup[dedup.length - 1]!
    if (!intervalsOverlap(first.along, last.along, segMin, segMax)) continue

    if (first.kind === 'edge') edgeHits.set(first.key, first.t)
    else cutVertSet.add(first.vi)
    if (last.kind === 'edge') edgeHits.set(last.key, last.t)
    else cutVertSet.add(last.vi)
  }

  if (edgeHits.size === 0 && cutVertSet.size === 0) return null

  for (const [key, t] of edgeHits) {
    const [a, b] = key.split('-').map(Number)
    const newVi = splitEdgeAtWithUv(
      positions,
      faces,
      faceUvIndices,
      uvs,
      a!,
      b!,
      t
    )
    cutVertSet.add(newVi)
  }

  const toSplit: { fi: number; a: number; b: number }[] = []
  for (let fi = 0; fi < beforeFaces; fi++) {
    if (!frontFaceSet.has(fi)) continue
    const ordered = orderCutVertsOnFace(faces[fi]!, cutVertSet)
    if (ordered.length === 2) {
      toSplit.push({ fi, a: ordered[0]!, b: ordered[1]! })
    }
  }

  const newFaceSourceOld: number[] = faces.map((_, fi) => fi)
  toSplit.sort((a, b) => b.fi - a.fi)
  for (const { fi, a, b } of toSplit) {
    if (fi >= faces.length) continue
    if (!faces[fi]!.includes(a) || !faces[fi]!.includes(b)) continue
    const beforeLen = faces.length
    splitFaceAtChordWithUv(faces, faceColors, faceUvIndices, fi, a, b)
    if (faces.length === beforeLen) {
      splitFaceAtChord(faces, faceColors, fi, a, b)
    }
    if (faces.length > beforeLen) {
      newFaceSourceOld[fi] = fi < beforeFaces ? fi : newFaceSourceOld[fi] ?? fi
      while (newFaceSourceOld.length < faces.length) {
        newFaceSourceOld.push(fi < beforeFaces ? fi : newFaceSourceOld[fi] ?? 0)
      }
    }
  }

  if (!cutIsSafe(beforeFaces, beforeVerts, faces.length, positions.length)) {
    return null
  }

  while (newFaceSourceOld.length < faces.length) {
    newFaceSourceOld.push(Math.min(newFaceSourceOld.length, beforeFaces - 1))
  }
  const faceGroups = splitFaceGroupsAfterCut(
    obj.faceGroups,
    beforeFaces,
    newFaceSourceOld.slice(0, faces.length)
  )

  const result: SceneObject = {
    ...obj,
    positions,
    faces,
    faceColors,
    faceGroups,
    uvs: uvs ?? obj.uvs,
    faceUvIndices: faceUvIndices ?? obj.faceUvIndices,
  }

  return removeUnreferencedVertices(result)
}

/**
 * Blockbench-style surface knife in mesh-local space.
 * Cuts front-facing faces along a view-aligned plane, clipped to the stroke.
 */
export function knifeCutObject(
  obj: SceneObject,
  lineStart: Vec3,
  lineEnd: Vec3,
  viewForward: Vec3
): SceneObject {
  if (length3(sub3(lineEnd, lineStart)) < MIN_CUT_LEN) return obj

  const current = weldSceneObjectCoincidentVertices(cloneSceneObject(obj))
  const cut = cutWeldedMeshOnce(current, lineStart, lineEnd, viewForward)
  return cut ?? obj
}

/** Apply multiple cut segments sequentially. */
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
