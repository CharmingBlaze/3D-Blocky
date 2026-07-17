import { curvatureSampleClosedLoop } from '../stroke/rdp'
import { type Vec2 } from '../utils/math'
import { ensureCCW } from './concaveTriangulate'
import { HalfEdgeMesh } from './HalfEdgeMesh'
import { computeFaceNormal, meshCentroid } from './MeshBuilder'
import { uv2 } from '../uv/uvTypes'

export interface VerticalShapedCapsuleOptions {
  radialSegments?: number
  /**
   * Soft cap on longitudinal ring divisions (body + both hemi caps).
   * Rings are spaced evenly by meridian arc, not packed at the equator.
   */
  profileRings?: number
  minAngleDeg?: number
  maxBoundaryVerts?: number
  preserveBoundary?: boolean
  /**
   * How much ring width follows the drawn silhouette.
   * 0 = ideal capsule, 1 = full local chord width.
   * Kept low by default so the result remains rounded and never develops
   * pointed/concave side pinches from freehand noise.
   */
  silhouetteInfluence?: number
  color?: number
}

/** Outermost horizontal chord through a CCW polygon at height y. */
function chordAtY(poly: Vec2[], y: number): { x0: number; x1: number } | null {
  const xs: number[] = []
  const n = poly.length
  for (let i = 0; i < n; i++) {
    const a = poly[i]!
    const b = poly[(i + 1) % n]!
    const dy = b.y - a.y
    if (Math.abs(dy) < 1e-10) continue
    const crosses = (a.y <= y && b.y > y) || (b.y <= y && a.y > y)
    if (!crosses) continue
    const t = (y - a.y) / dy
    xs.push(a.x + t * (b.x - a.x))
  }
  if (xs.length < 2) return null
  xs.sort((a, b) => a - b)
  return { x0: xs[0]!, x1: xs[xs.length - 1]! }
}

function boundsY(poly: Vec2[]): { minY: number; maxY: number } {
  let minY = Infinity
  let maxY = -Infinity
  for (const p of poly) {
    minY = Math.min(minY, p.y)
    maxY = Math.max(maxY, p.y)
  }
  return { minY, maxY }
}

/**
 * Stable body radius from the silhouette mid-band (not tip pinches, not a single bulge).
 */
function bodyFitRadius(poly: Vec2[], minY: number, maxY: number): number {
  const height = maxY - minY
  if (height < 1e-4) return 0.35
  const samples: number[] = []
  for (let i = 0; i < 16; i++) {
    const t = 0.2 + (0.6 * i) / 15
    const chord = chordAtY(poly, minY + height * t)
    if (!chord) continue
    samples.push(Math.max(0.35, (chord.x1 - chord.x0) * 0.5))
  }
  if (samples.length === 0) return Math.min(0.35, height * 0.49)
  samples.sort((a, b) => a - b)
  const mid = samples[Math.floor(samples.length * 0.6)]!
  return Math.min(mid, height * 0.49)
}

function centerXAt(poly: Vec2[], y: number, fallback: number): number {
  const chord = chordAtY(poly, y)
  if (!chord) return fallback
  return (chord.x0 + chord.x1) * 0.5
}

/** Map meridian arc length from the bottom pole → (y, radius). */
function sampleMeridian(
  s: number,
  minY: number,
  maxY: number,
  fitR: number,
  bodyLen: number,
  hemiArc: number
): { y: number; radius: number } {
  if (s <= hemiArc) {
    // Equal-angle bottom hemisphere (θ from pole).
    const theta = fitR > 1e-8 ? s / fitR : 0
    return {
      y: minY + fitR * (1 - Math.cos(theta)),
      radius: fitR * Math.sin(theta),
    }
  }
  if (s <= hemiArc + bodyLen) {
    return {
      y: minY + fitR + (s - hemiArc),
      radius: fitR,
    }
  }
  const sTop = s - hemiArc - bodyLen
  const theta = fitR > 1e-8 ? sTop / fitR : 0
  return {
    // Walk from the upper equator to the top pole. The old formula sampled
    // pole → equator while the ring list itself advanced upward, folding the
    // final rings back through the body and producing a flared arrow-shaped cap.
    y: maxY - fitR + fitR * Math.sin(theta),
    radius: fitR * Math.cos(theta),
  }
}

function pushUv(mesh: HalfEdgeMesh, u: number, v: number): number {
  const idx = mesh.uvs.length
  mesh.uvs.push(uv2(u, v))
  return idx
}

function addRing(
  mesh: HalfEdgeMesh,
  cx: number,
  y: number,
  radius: number,
  segments: number
): number[] {
  const ring: number[] = []
  for (let si = 0; si < segments; si++) {
    const angle = (si / segments) * Math.PI * 2
    ring.push(mesh.positions.length)
    mesh.positions.push({
      x: cx + Math.cos(angle) * radius,
      y,
      z: Math.sin(angle) * radius,
    })
  }
  return ring
}

function stitchRingPair(
  mesh: HalfEdgeMesh,
  ringA: number[],
  ringB: number[],
  vA: number,
  vB: number,
  color: number
): void {
  const segments = ringA.length
  for (let si = 0; si < segments; si++) {
    const next = (si + 1) % segments
    const u0 = si / segments
    const u1 = (si + 1) / segments
    const uvA0 = pushUv(mesh, u0, vA)
    const uvA1 = pushUv(mesh, u1, vA)
    const uvB0 = pushUv(mesh, u0, vB)
    const uvB1 = pushUv(mesh, u1, vB)
    mesh.faces.push([ringA[si]!, ringA[next]!, ringB[next]!, ringB[si]!])
    mesh.faceUvIndices.push([uvA0, uvA1, uvB1, uvB0])
    mesh.faceColors.push(color)
  }
}

function fanPole(
  mesh: HalfEdgeMesh,
  pole: number,
  ring: number[],
  vPole: number,
  vRing: number,
  color: number,
  poleIsMin: boolean
): void {
  const segments = ring.length
  const uvPole = pushUv(mesh, 0.5, vPole)
  for (let si = 0; si < segments; si++) {
    const next = (si + 1) % segments
    const u0 = si / segments
    const u1 = (si + 1) / segments
    const uv0 = pushUv(mesh, u0, vRing)
    const uv1 = pushUv(mesh, u1, vRing)
    if (poleIsMin) {
      mesh.faces.push([pole, ring[next]!, ring[si]!])
      mesh.faceUvIndices.push([uvPole, uv1, uv0])
    } else {
      mesh.faces.push([pole, ring[si]!, ring[next]!])
      mesh.faceUvIndices.push([uvPole, uv0, uv1])
    }
    mesh.faceColors.push(color)
  }
}

/** Keep faces outward without importing meshWinding (avoids worldProjection cycles). */
function reorientCapsuleFaces(mesh: HalfEdgeMesh): void {
  if (mesh.faces.length === 0) return
  const center = meshCentroid(mesh.positions)
  for (let fi = 0; fi < mesh.faces.length; fi++) {
    const face = mesh.faces[fi]!
    if (face.length < 3) continue
    const n = computeFaceNormal(mesh.positions, [face[0]!, face[1]!, face[2]!])
    let cx = 0
    let cy = 0
    let cz = 0
    for (const vi of face) {
      const p = mesh.positions[vi]!
      cx += p.x
      cy += p.y
      cz += p.z
    }
    const inv = 1 / face.length
    const dot = n.x * (cx * inv - center.x) + n.y * (cy * inv - center.y) + n.z * (cz * inv - center.z)
    if (dot < 0) {
      face.reverse()
      mesh.faceUvIndices[fi]?.reverse()
    }
  }
}

/**
 * Standing capsule from a drawn silhouette bounds.
 * Constant body radius + equal-arc meridian rings → even quads, round tips.
 */
export function generateVerticalShapedCapsule(
  polygon: Vec2[],
  options: VerticalShapedCapsuleOptions = {}
): HalfEdgeMesh {
  const {
    radialSegments = 8,
    profileRings = 10,
    minAngleDeg = 12,
    maxBoundaryVerts = 32,
    preserveBoundary = false,
    silhouetteInfluence = 0.3,
    color = 0xf5a66e,
  } = options

  const mesh = new HalfEdgeMesh()
  const ccw = ensureCCW(polygon)
  const boundary = preserveBoundary
    ? ccw
    : curvatureSampleClosedLoop(ccw, minAngleDeg, maxBoundaryVerts)
  if (boundary.length < 3) return mesh

  const { minY, maxY } = boundsY(boundary)
  const height = maxY - minY
  if (height < 1e-4) return mesh

  const fitR = bodyFitRadius(boundary, minY, maxY)
  const segments = Math.max(6, Math.min(16, radialSegments))
  const bodyLen = Math.max(0, height - 2 * fitR)
  const hemiArc = fitR * (Math.PI * 0.5)
  const totalArc = bodyLen + 2 * hemiArc
  if (totalArc < 1e-4) return mesh

  // Aim for roughly square quads: ring spacing ≈ equator edge length.
  const equatorEdge = (2 * Math.PI * fitR) / segments
  const fromSpacing = Math.max(6, Math.round(totalArc / Math.max(0.5, equatorEdge)))
  // profileRings is a soft complexity cap (not "pack this many into the body").
  const maxLong = Math.max(6, Math.min(18, profileRings + 4))
  const longSegs = Math.max(6, Math.min(maxLong, fromSpacing))

  const midY = (minY + maxY) * 0.5
  const bodyCx = centerXAt(boundary, midY, 0)
  const influence = Math.max(0, Math.min(0.5, silhouetteInfluence))

  type RingSlot = { ring: number[]; v: number }
  const slots: RingSlot[] = []
  const span = Math.max(1e-6, height)

  const bottomPole = mesh.positions.length
  mesh.positions.push({
    x: centerXAt(boundary, minY + fitR * 0.15, bodyCx),
    y: minY,
    z: 0,
  })

  // Even meridian samples between the poles (exclude poles themselves).
  for (let i = 1; i < longSegs; i++) {
    const s = (totalArc * i) / longSegs
    const { y, radius } = sampleMeridian(s, minY, maxY, fitR, bodyLen, hemiArc)
    if (radius < 1e-4) continue
    const localChord = chordAtY(boundary, y)
    const localRadius = localChord
      ? Math.max(fitR * 0.72, Math.min(fitR * 1.28, (localChord.x1 - localChord.x0) * 0.5))
      : fitR
    const shapedBodyRadius = fitR + (localRadius - fitR) * influence
    const shapedRadius = radius * (shapedBodyRadius / Math.max(1e-6, fitR))
    const cx = centerXAt(boundary, y, bodyCx)
    slots.push({
      ring: addRing(mesh, cx, y, Math.max(0.35, shapedRadius), segments),
      v: (y - minY) / span,
    })
  }

  const topPole = mesh.positions.length
  mesh.positions.push({
    x: centerXAt(boundary, maxY - fitR * 0.15, bodyCx),
    y: maxY,
    z: 0,
  })

  if (slots.length === 0) return mesh

  fanPole(mesh, bottomPole, slots[0]!.ring, 0, slots[0]!.v, color, true)
  for (let ri = 0; ri < slots.length - 1; ri++) {
    stitchRingPair(
      mesh,
      slots[ri]!.ring,
      slots[ri + 1]!.ring,
      slots[ri]!.v,
      slots[ri + 1]!.v,
      color
    )
  }
  fanPole(mesh, topPole, slots[slots.length - 1]!.ring, 1, slots[slots.length - 1]!.v, color, false)

  reorientCapsuleFaces(mesh)
  mesh.buildHalfEdges()
  return mesh
}
