import { curvatureSampleProfile } from '../stroke/rdp'
import {
  add3,
  cross3,
  dot3,
  normalize3,
  scale3,
  sub3,
  type Vec2,
  type Vec3,
} from '../utils/math'
import { LOW_POLY_CAPSULE_HEMI_RINGS } from '../primitives/capsuleMesh'
import { HalfEdgeMesh } from './HalfEdgeMesh'

export interface TubeOptions {
  radius: number
  radialSegments: number
  minAngleDeg?: number
}

export interface CapsuleSweepOptions extends TubeOptions {
  closed?: boolean
  hemiRings?: number
  color?: number
}

function faceNormal3(mesh: HalfEdgeMesh, face: number[]): Vec3 {
  const a = mesh.positions[face[0]!]!
  const b = mesh.positions[face[1]!]!
  const c = mesh.positions[face[2]!]!
  return normalize3({
    x: (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y),
    y: (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z),
    z: (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x),
  })
}

function faceCentroid3(mesh: HalfEdgeMesh, face: number[]): Vec3 {
  let x = 0
  let y = 0
  let z = 0
  for (const vi of face) {
    const p = mesh.positions[vi]!
    x += p.x
    y += p.y
    z += p.z
  }
  const n = face.length
  return { x: x / n, y: y / n, z: z / n }
}

function dist3(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

function closestPointOnPolyline(
  path: Vec3[],
  point: Vec3
): { closest: Vec3; tangent: Vec3; param: number } {
  let bestDist = Infinity
  let bestClosest: Vec3 = path[0] ?? { x: 0, y: 0, z: 0 }
  let bestTangent: Vec3 = { x: 1, y: 0, z: 0 }
  let bestParam = 0

  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]!
    const b = path[i + 1]!
    const abx = b.x - a.x
    const aby = b.y - a.y
    const abz = b.z - a.z
    const len2 = abx * abx + aby * aby + abz * abz
    if (len2 < 1e-12) continue

    let t = ((point.x - a.x) * abx + (point.y - a.y) * aby + (point.z - a.z) * abz) / len2
    t = Math.max(0, Math.min(1, t))

    const cx = a.x + abx * t
    const cy = a.y + aby * t
    const cz = a.z + abz * t
    const d = Math.hypot(point.x - cx, point.y - cy, point.z - cz)

    if (d < bestDist) {
      bestDist = d
      bestClosest = { x: cx, y: cy, z: cz }
      bestTangent = normalize3({ x: abx, y: aby, z: abz })
      bestParam = i + t
    }
  }

  return { closest: bestClosest, tangent: bestTangent, param: bestParam }
}

function estimateTubeRadius(mesh: HalfEdgeMesh, pathStart: Vec3, pathEnd: Vec3): number {
  let maxR = 1
  for (const p of mesh.positions) {
    const dStart = dist3(p, pathStart)
    const dEnd = dist3(p, pathEnd)
    maxR = Math.max(maxR, Math.min(dStart, dEnd))
  }
  return maxR
}

/** Orient tube side walls and end caps outward in world space (after view projection). */
export function orientTubeFacesOutward(
  mesh: HalfEdgeMesh,
  pathWorld: Vec3[],
  closed = false
): void {
  if (pathWorld.length < 2 || mesh.faces.length === 0) return

  const pathStart = pathWorld[0]!
  const pathEnd = pathWorld[pathWorld.length - 1]!
  const startTan =
    pathWorld.length >= 2
      ? normalize3({
          x: pathWorld[1]!.x - pathStart.x,
          y: pathWorld[1]!.y - pathStart.y,
          z: pathWorld[1]!.z - pathStart.z,
        })
      : { x: 1, y: 0, z: 0 }
  const endTan =
    pathWorld.length >= 2
      ? normalize3({
          x: pathEnd.x - pathWorld[pathWorld.length - 2]!.x,
          y: pathEnd.y - pathWorld[pathWorld.length - 2]!.y,
          z: pathEnd.z - pathWorld[pathWorld.length - 2]!.z,
        })
      : startTan

  const endRadius = estimateTubeRadius(mesh, pathStart, pathEnd)

  for (const face of mesh.faces) {
    if (face.length < 3) continue

    const center = faceCentroid3(mesh, face)
    const normal = faceNormal3(mesh, face)
    const { closest, param } = closestPointOnPolyline(pathWorld, center)

    const distStart = dist3(center, pathStart)
    const distEnd = dist3(center, pathEnd)
    const atStart = !closed && param < 0.15 && distStart <= endRadius * 1.25
    const atEnd = !closed && param > pathWorld.length - 1.15 && distEnd <= endRadius * 1.25

    if (atStart && distStart <= distEnd) {
      const out = { x: -startTan.x, y: -startTan.y, z: -startTan.z }
      const dot = normal.x * out.x + normal.y * out.y + normal.z * out.z
      if (dot < 0) face.reverse()
      continue
    }

    if (atEnd && distEnd <= distStart) {
      const dot = normal.x * endTan.x + normal.y * endTan.y + normal.z * endTan.z
      if (dot < 0) face.reverse()
      continue
    }

    const rx = center.x - closest.x
    const ry = center.y - closest.y
    const rz = center.z - closest.z
    const rLen = Math.hypot(rx, ry, rz)
    if (rLen < 1e-6) continue

    const dot = (normal.x * rx + normal.y * ry + normal.z * rz) / rLen
    if (dot < 0) face.reverse()
  }

  mesh.buildHalfEdges()
}

/** Tube extrusion along path in canonical XY plane, cross-section in local Z */
export function generateTube(path: Vec2[], options: TubeOptions & { capped?: boolean }): HalfEdgeMesh {
  const { radius, radialSegments, minAngleDeg = 15, capped = false } = options
  const mesh = new HalfEdgeMesh()
  const segments = Math.max(3, radialSegments)

  if (path.length < 2) return mesh

  const sampled = curvatureSampleProfile(path, minAngleDeg)
  const ringVerts: number[][] = []

  for (let pi = 0; pi < sampled.length; pi++) {
    const point = sampled[pi]!
    let tangent: Vec3

    if (pi === 0) {
      tangent = normalize3({
        x: sampled[1]!.x - sampled[0]!.x,
        y: sampled[1]!.y - sampled[0]!.y,
        z: 0,
      })
    } else if (pi === sampled.length - 1) {
      tangent = normalize3({
        x: sampled[pi]!.x - sampled[pi - 1]!.x,
        y: sampled[pi]!.y - sampled[pi - 1]!.y,
        z: 0,
      })
    } else {
      tangent = normalize3({
        x: sampled[pi + 1]!.x - sampled[pi - 1]!.x,
        y: sampled[pi + 1]!.y - sampled[pi - 1]!.y,
        z: 0,
      })
    }

    const binormal = normalize3({ x: -tangent.y, y: tangent.x, z: 0 })
    const normal = { x: 0, y: 0, z: 1 }

    const ring: number[] = []
    for (let si = 0; si < segments; si++) {
      const angle = (si / segments) * Math.PI * 2
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      const vi = mesh.positions.length
      mesh.positions.push({
        x: point.x + (binormal.x * cos + normal.x * sin) * radius,
        y: point.y + (binormal.y * cos + normal.y * sin) * radius,
        z: (binormal.z * cos + normal.z * sin) * radius,
      })
      ring.push(vi)
    }
    ringVerts.push(ring)
  }

  // Three.js TubeGeometry-compatible quad winding (outward-facing in canonical space)
  for (let pi = 0; pi < ringVerts.length - 1; pi++) {
    const ringA = ringVerts[pi]!
    const ringB = ringVerts[pi + 1]!
    for (let si = 0; si < segments; si++) {
      const next = (si + 1) % segments
      mesh.faces.push([ringA[si]!, ringA[next]!, ringB[si]!])
      mesh.faces.push([ringA[next]!, ringB[next]!, ringB[si]!])
      mesh.faceColors.push(0xf5a66e, 0xf5a66e)
    }
  }

  if (capped && ringVerts.length >= 1) {
    const capColor = 0xf5a66e
    const startRing = ringVerts[0]!
    const startCenter = sampled[0]!
    const startPole = mesh.positions.length
    mesh.positions.push({ x: startCenter.x, y: startCenter.y, z: 0 })
    for (let si = 0; si < segments; si++) {
      const next = (si + 1) % segments
      mesh.faces.push([startPole, startRing[si]!, startRing[next]!])
      mesh.faceColors.push(capColor)
    }

    const endRing = ringVerts[ringVerts.length - 1]!
    const endCenter = sampled[sampled.length - 1]!
    const endPole = mesh.positions.length
    mesh.positions.push({ x: endCenter.x, y: endCenter.y, z: 0 })
    for (let si = 0; si < segments; si++) {
      const next = (si + 1) % segments
      mesh.faces.push([endPole, endRing[next]!, endRing[si]!])
      mesh.faceColors.push(capColor)
    }
  }

  mesh.buildHalfEdges()
  return mesh
}

interface SweepFrame {
  center: Vec3
  tangent: Vec3
  normal: Vec3
  binormal: Vec3
}

function vec2To3(p: Vec2): Vec3 {
  return { x: p.x, y: p.y, z: 0 }
}

function rotateAroundAxis(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const kxv = cross3(axis, v)
  const kdv = dot3(axis, v)
  return add3(add3(scale3(v, cos), scale3(kxv, sin)), scale3(axis, kdv * (1 - cos)))
}

/** Parallel-transport frames along a 3D polyline (avoids Frenet twist on bends). */
function buildSweepFrames(curve: Vec3[], closed: boolean): SweepFrame[] {
  const n = curve.length
  if (n < 2) return []

  const frames: SweepFrame[] = []
  const firstTan = normalize3(sub3(curve[1]!, curve[0]!))
  const seed: Vec3 = Math.abs(firstTan.y) < 0.99 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 }
  let normal = normalize3(cross3(seed, firstTan))
  let binormal = normalize3(cross3(firstTan, normal))
  frames.push({ center: curve[0]!, tangent: firstTan, normal, binormal })

  for (let i = 1; i < n; i++) {
    const prev = frames[i - 1]!
    const prevTan = prev.tangent
    const nextIdx = closed && i === n - 1 ? 0 : Math.min(i + 1, n - 1)
    const prevIdx = i === 1 ? (closed ? n - 1 : 0) : i - 1
    const tangent = normalize3(sub3(curve[nextIdx]!, curve[prevIdx]!))

    const axis = cross3(prevTan, tangent)
    const axisLen = Math.hypot(axis.x, axis.y, axis.z)
    let rotatedNormal = prev.normal
    if (axisLen > 1e-6) {
      const a = normalize3(axis)
      const angle = Math.acos(Math.max(-1, Math.min(1, dot3(prevTan, tangent))))
      rotatedNormal = rotateAroundAxis(rotatedNormal, a, angle)
    }
    normal = normalize3(sub3(rotatedNormal, scale3(tangent, dot3(rotatedNormal, tangent))))
    binormal = normalize3(cross3(tangent, normal))
    frames.push({ center: curve[i]!, tangent, normal, binormal })
  }

  return frames
}

function addRing(
  mesh: HalfEdgeMesh,
  frame: SweepFrame,
  radius: number,
  segments: number,
  scale = 1
): number[] {
  const ring: number[] = []
  const r = radius * scale
  for (let si = 0; si < segments; si++) {
    const angle = (si / segments) * Math.PI * 2
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const offset = add3(scale3(frame.normal, cos * r), scale3(frame.binormal, sin * r))
    ring.push(mesh.positions.length)
    mesh.positions.push(add3(frame.center, offset))
  }
  return ring
}

function connectRingQuads(
  mesh: HalfEdgeMesh,
  ringA: number[],
  ringB: number[],
  segments: number,
  color: number
): void {
  for (let si = 0; si < segments; si++) {
    const next = (si + 1) % segments
    mesh.faces.push([ringA[si]!, ringA[next]!, ringB[si]!])
    mesh.faces.push([ringA[next]!, ringB[next]!, ringB[si]!])
    mesh.faceColors.push(color, color)
  }
}

function fanPoleRing(
  mesh: HalfEdgeMesh,
  pole: number,
  ring: number[],
  outward: boolean,
  color: number
): void {
  const segments = ring.length
  for (let si = 0; si < segments; si++) {
    const next = (si + 1) % segments
    if (outward) {
      mesh.faces.push([pole, ring[si]!, ring[next]!])
    } else {
      mesh.faces.push([pole, ring[next]!, ring[si]!])
    }
    mesh.faceColors.push(color)
  }
}

/** Faceted hemisphere cap at an open sweep end (multi-ring, not a flat disk). */
function appendSweepEndCap(
  mesh: HalfEdgeMesh,
  frame: SweepFrame,
  equatorRing: number[],
  radius: number,
  segments: number,
  hemiRings: number,
  atStart: boolean,
  color: number
): void {
  const bands = Math.max(1, hemiRings)
  const sign = atStart ? -1 : 1
  const pole = add3(frame.center, scale3(frame.tangent, sign * radius))
  const poleIdx = mesh.positions.length
  mesh.positions.push(pole)

  const capRings: number[][] = []
  for (let ri = bands - 1; ri >= 1; ri--) {
    const t = ri / bands
    const scale = Math.sqrt(Math.max(0, t * (2 - t)))
    const ringCenter = add3(frame.center, scale3(frame.tangent, sign * radius * (1 - t)))
    const capFrame: SweepFrame = { ...frame, center: ringCenter }
    capRings.push(addRing(mesh, capFrame, radius, segments, scale))
  }
  capRings.push(equatorRing)

  if (capRings.length > 1) {
    fanPoleRing(mesh, poleIdx, capRings[0]!, !atStart, color)
    for (let ri = 0; ri < capRings.length - 1; ri++) {
      connectRingQuads(mesh, capRings[ri]!, capRings[ri + 1]!, segments, color)
    }
  } else {
    fanPoleRing(mesh, poleIdx, equatorRing, !atStart, color)
  }
}

function normalizeClosedSpine(path: Vec2[], closed: boolean): Vec2[] {
  if (!closed || path.length < 2) return path
  const first = path[0]!
  const last = path[path.length - 1]!
  if (Math.hypot(first.x - last.x, first.y - last.y) < 0.5) {
    return path.slice(0, -1)
  }
  return path
}

/**
 * Sweep a low-poly pill cross-section along a 2D path.
 * Canonical space: path in XY, cross-section in the plane perpendicular to tangent.
 */
export function generateCapsuleSweep(path: Vec2[], options: CapsuleSweepOptions): HalfEdgeMesh {
  const {
    radius,
    radialSegments,
    minAngleDeg = 15,
    closed = false,
    hemiRings = LOW_POLY_CAPSULE_HEMI_RINGS,
    color = 0xf5a66e,
  } = options

  const mesh = new HalfEdgeMesh()
  const segments = Math.max(6, Math.min(10, radialSegments))
  if (path.length < 2 || radius < 1e-6) return mesh

  const spine = normalizeClosedSpine(path, closed)
  const sampled = curvatureSampleProfile(spine, minAngleDeg)
  if (sampled.length < 2) return mesh

  const curve = sampled.map(vec2To3)
  const frames = buildSweepFrames(curve, closed)
  if (frames.length < 2) return mesh

  const ringVerts: number[][] = frames.map((frame) => addRing(mesh, frame, radius, segments))

  const ringCount = ringVerts.length
  for (let ri = 0; ri < ringCount - 1; ri++) {
    connectRingQuads(mesh, ringVerts[ri]!, ringVerts[ri + 1]!, segments, color)
  }

  if (closed && ringCount > 2) {
    connectRingQuads(mesh, ringVerts[ringCount - 1]!, ringVerts[0]!, segments, color)
  } else if (ringCount >= 1) {
    appendSweepEndCap(mesh, frames[0]!, ringVerts[0]!, radius, segments, hemiRings, true, color)
    appendSweepEndCap(
      mesh,
      frames[ringCount - 1]!,
      ringVerts[ringCount - 1]!,
      radius,
      segments,
      hemiRings,
      false,
      color
    )
  }

  mesh.buildHalfEdges()
  return mesh
}
