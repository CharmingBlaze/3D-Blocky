import { curvatureSampleClosedLoop } from '../stroke/rdp'
import { type Vec2 } from '../utils/math'
import { ensureCCW } from './concaveTriangulate'
import { HalfEdgeMesh } from './HalfEdgeMesh'
import { uv2 } from '../uv/uvTypes'

export interface VerticalShapedCapsuleOptions {
  radialSegments?: number
  /** Samples along the vertical (Y) axis, including caps. */
  profileRings?: number
  minAngleDeg?: number
  maxBoundaryVerts?: number
  preserveBoundary?: boolean
  color?: number
}

interface Slice {
  y: number
  cx: number
  radius: number
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

function collectSlices(poly: Vec2[], profileRings: number): Slice[] {
  let minY = Infinity
  let maxY = -Infinity
  for (const p of poly) {
    minY = Math.min(minY, p.y)
    maxY = Math.max(maxY, p.y)
  }
  const height = maxY - minY
  if (height < 1e-4) return []

  const count = Math.max(4, profileRings)
  const slices: Slice[] = []
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1)
    const y = minY + height * (0.02 + 0.96 * t)
    const chord = chordAtY(poly, y)
    if (!chord) continue
    const radius = Math.max(0.35, (chord.x1 - chord.x0) * 0.5)
    const cx = (chord.x0 + chord.x1) * 0.5
    const tip = Math.min(t, 1 - t)
    const taper = tip < 0.12 ? Math.sqrt(Math.max(0.05, tip / 0.12)) : 1
    slices.push({ y, cx, radius: radius * taper })
  }
  return slices
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

    // Quad: A0 → A1 → B1 → B0 (outward for CCW rings viewed from outside)
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

/**
 * Standing capsule shaped to a drawn silhouette.
 * Long axis = plane Y (vertical in the draw view); cross-section is circular in XZ.
 * Bakes cylindrical UVs (U around, V along height) so the body is one clean island.
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
    color = 0xf5a66e,
  } = options

  const mesh = new HalfEdgeMesh()
  const ccw = ensureCCW(polygon)
  const boundary = preserveBoundary
    ? ccw
    : curvatureSampleClosedLoop(ccw, minAngleDeg, maxBoundaryVerts)
  if (boundary.length < 3) return mesh

  const slices = collectSlices(boundary, profileRings)
  if (slices.length < 2) return mesh

  const segments = Math.max(6, Math.min(24, radialSegments))
  const first = slices[0]!
  const last = slices[slices.length - 1]!
  const ringCount = slices.length

  const bottomPole = mesh.positions.length
  mesh.positions.push({ x: first.cx, y: first.y - first.radius * 0.35, z: 0 })

  const rings: number[][] = []
  for (const slice of slices) {
    rings.push(addRing(mesh, slice.cx, slice.y, Math.max(0.35, slice.radius), segments))
  }

  const topPole = mesh.positions.length
  mesh.positions.push({ x: last.cx, y: last.y + last.radius * 0.35, z: 0 })

  // V: poles at 0/1, body rings evenly in between.
  const vForRing = (ri: number) => (ri + 1) / (ringCount + 1)

  fanPole(mesh, bottomPole, rings[0]!, 0, vForRing(0), color, true)
  for (let ri = 0; ri < rings.length - 1; ri++) {
    stitchRingPair(mesh, rings[ri]!, rings[ri + 1]!, vForRing(ri), vForRing(ri + 1), color)
  }
  fanPole(mesh, topPole, rings[rings.length - 1]!, 1, vForRing(ringCount - 1), color, false)

  mesh.buildHalfEdges()
  return mesh
}
