/**
 * Refactored CAD box primitives — all geometry exits through MeshBuilder.finalizeIndexedMesh.
 */
import type { MeshData } from '../blob/types'
import { createIcosphere } from '../blob/primitives'
import {
  MeshBuilder,
  emptyMeshData,
  finalizeIndexedMesh,
  indexedMeshFromFlat,
  type IndexedMesh,
} from '../mesh/MeshBuilder'
import type { Vec3 } from '../utils/math'
import { axisComponent, type Axis } from './viewAxes'
import { boxCenterSize, type WorldBox } from './primitiveBoxMath'

function mapLocal(lx: number, ly: number, lz: number, heightAxis: Axis, center: Vec3): Vec3 {
  let x = lx
  let y = ly
  let z = lz
  switch (heightAxis) {
    case 0:
      x = ly
      y = lx
      z = lz
      break
    case 1:
      break
    case 2:
      x = lx
      y = lz
      z = ly
      break
  }
  return { x: x + center.x, y: y + center.y, z: z + center.z }
}

/** Welded indexed mesh for scene storage; flat facets are applied at render/export time. */
function finalize(mesh: IndexedMesh, outwardCenter: Vec3): MeshData {
  const data = finalizeIndexedMesh(mesh, { outwardCenter, facet: false, validate: true })
  return data.indices.length === 0 ? emptyMeshData() : data
}

export function createBoxMesh(center: Vec3, size: Vec3): MeshData {
  const hx = size.x / 2
  const hy = size.y / 2
  const hz = size.z / 2
  const cx = center.x
  const cy = center.y
  const cz = center.z

  const b = new MeshBuilder()
  const p = (dx: number, dy: number, dz: number) => b.addVertex(cx + dx, cy + dy, cz + dz)

  const uv = (u: number, v: number) => b.addUv(u, v)

  const pushFace = (
    a: number,
    c: number,
    d: number,
    e: number,
    ua: number,
    uc: number,
    ud: number,
    ue: number
  ) => {
    b.addQuad(a, c, d, e, [ua, uc, ud, ue])
  }

  // Six faces — CCW when viewed from outside.
  pushFace(
    p(-hx, -hy, -hz), p(hx, -hy, -hz), p(hx, hy, -hz), p(-hx, hy, -hz),
    uv(0, 0), uv(1, 0), uv(1, 1), uv(0, 1)
  )
  pushFace(
    p(hx, -hy, hz), p(-hx, -hy, hz), p(-hx, hy, hz), p(hx, hy, hz),
    uv(0, 0), uv(1, 0), uv(1, 1), uv(0, 1)
  )
  pushFace(
    p(-hx, -hy, hz), p(-hx, -hy, -hz), p(-hx, hy, -hz), p(-hx, hy, hz),
    uv(0, 0), uv(1, 0), uv(1, 1), uv(0, 1)
  )
  pushFace(
    p(hx, -hy, -hz), p(hx, -hy, hz), p(hx, hy, hz), p(hx, hy, -hz),
    uv(0, 0), uv(1, 0), uv(1, 1), uv(0, 1)
  )
  pushFace(
    p(-hx, hy, -hz), p(hx, hy, -hz), p(hx, hy, hz), p(-hx, hy, hz),
    uv(0, 0), uv(1, 0), uv(1, 1), uv(0, 1)
  )
  pushFace(
    p(-hx, -hy, hz), p(hx, -hy, hz), p(hx, -hy, -hz), p(-hx, -hy, -hz),
    uv(0, 0), uv(1, 0), uv(1, 1), uv(0, 1)
  )

  return finalize(b.build(), center)
}

function icosphereSubdivisions(segments: number): number {
  if (segments <= 5) return 0
  if (segments <= 9) return 1
  return 2
}

/** Icosphere ellipsoid inscribed in the box — chunky gem-like topology. */
export function createInscribedIcosphere(center: Vec3, size: Vec3, segments = 8): MeshData {
  if (import.meta.env?.DEV) {
    console.log('[CAD trace] createInscribedIcosphere', { center, size, segments })
  }
  const rx = size.x / 2
  const ry = size.y / 2
  const rz = size.z / 2
  if (rx < 1e-6 || ry < 1e-6 || rz < 1e-6) return emptyMeshData()

  const unit = createIcosphere(1, icosphereSubdivisions(segments))
  const positions: number[] = []
  for (let i = 0; i < unit.positions.length; i += 3) {
    positions.push(
      center.x + unit.positions[i]! * rx,
      center.y + unit.positions[i + 1]! * ry,
      center.z + unit.positions[i + 2]! * rz
    )
  }
  const indices: number[] = []
  for (let i = 0; i < unit.indices.length; i++) {
    indices.push(unit.indices[i]!)
  }

  const mesh = indexedMeshFromFlat(positions, indices)
  return finalize(mesh, center)
}

/** Low-poly UV-sphere inscribed in the box — latitude/longitude quads like vector shapes. */
export function createInscribedUvSphere(
  center: Vec3,
  size: Vec3,
  heightAxis: Axis,
  segments = 8
): MeshData {
  const others = ([0, 1, 2] as Axis[]).filter((a) => a !== heightAxis)
  const r0 = axisComponent(size, others[0]) / 2
  const r1 = axisComponent(size, others[1]) / 2
  const height = axisComponent(size, heightAxis)
  if (r0 < 1e-6 || r1 < 1e-6 || height < 1e-6) return emptyMeshData()

  const halfH = height / 2
  const lonSegs = Math.max(6, segments)
  const latRings = Math.max(3, Math.floor(segments * 0.55))
  const b = new MeshBuilder()
  const ringVerts: Array<number | number[]> = []

  for (let lat = 0; lat <= latRings; lat++) {
    const theta = (lat / latRings) * Math.PI
    const sinT = Math.sin(theta)
    const cosT = Math.cos(theta)
    const ly = halfH * cosT

    if (lat === 0 || lat === latRings) {
      const w = mapLocal(0, ly, 0, heightAxis, center)
      ringVerts.push(b.addVertexVec(w))
      continue
    }

    const ring: number[] = []
    for (let lon = 0; lon < lonSegs; lon++) {
      const phi = (lon / lonSegs) * Math.PI * 2
      const lx = r0 * sinT * Math.cos(phi)
      const lz = r1 * sinT * Math.sin(phi)
      ring.push(b.addVertexVec(mapLocal(lx, ly, lz, heightAxis, center)))
    }
    ringVerts.push(ring)
  }

  const north = ringVerts[0] as number
  const south = ringVerts[latRings] as number
  const firstRing = ringVerts[1] as number[]

  for (let i = 0; i < lonSegs; i++) {
    const j = (i + 1) % lonSegs
    b.addTriangle(north, firstRing[j]!, firstRing[i]!)
  }

  for (let lat = 1; lat < latRings - 1; lat++) {
    const ringA = ringVerts[lat] as number[]
    const ringB = ringVerts[lat + 1] as number[]
    for (let i = 0; i < lonSegs; i++) {
      const j = (i + 1) % lonSegs
      b.addQuad(ringA[i]!, ringA[j]!, ringB[j]!, ringB[i]!)
    }
  }

  const lastRing = ringVerts[latRings - 1] as number[]
  for (let i = 0; i < lonSegs; i++) {
    const j = (i + 1) % lonSegs
    b.addTriangle(south, lastRing[i]!, lastRing[j]!)
  }

  return finalize(b.build(), center)
}

/** @deprecated Use createInscribedIcosphere */
export const createInscribedSphere = createInscribedIcosphere

export function createInscribedCylinder(
  center: Vec3,
  size: Vec3,
  heightAxis: Axis,
  segments = 8
): MeshData {
  const others = ([0, 1, 2] as Axis[]).filter((a) => a !== heightAxis)
  const radius = Math.min(axisComponent(size, others[0]), axisComponent(size, others[1])) / 2
  const height = axisComponent(size, heightAxis)
  if (radius < 1e-6 || height < 1e-6) return emptyMeshData()

  const segs = Math.max(3, segments)
  const halfH = height / 2
  const b = new MeshBuilder()

  const bottom: number[] = []
  const top: number[] = []
  for (let i = 0; i < segs; i++) {
    const t = (i / segs) * Math.PI * 2
    const lx = Math.cos(t) * radius
    const lz = Math.sin(t) * radius
    bottom.push(b.addVertexVec(mapLocal(lx, -halfH, lz, heightAxis, center)))
    top.push(b.addVertexVec(mapLocal(lx, halfH, lz, heightAxis, center)))
  }

  const bi = b.addVertexVec(mapLocal(0, -halfH, 0, heightAxis, center))
  const ti = b.addVertexVec(mapLocal(0, halfH, 0, heightAxis, center))

  const sideGroup: number[] = []
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % segs
    sideGroup.push(b.addTriangle(bottom[i]!, bottom[j]!, top[j]!))
    sideGroup.push(b.addTriangle(bottom[i]!, top[j]!, top[i]!))
  }
  b.addFaceGroup(sideGroup)

  const bottomCap: number[] = []
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % segs
    bottomCap.push(b.addTriangle(bi, bottom[j]!, bottom[i]!))
  }
  b.addFaceGroup(bottomCap)

  const topCap: number[] = []
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % segs
    topCap.push(b.addTriangle(ti, top[i]!, top[j]!))
  }
  b.addFaceGroup(topCap)

  return finalize(b.build(), center)
}

function connectRings(b: MeshBuilder, ringA: number[], ringB: number[]): number[] {
  const faces: number[] = []
  const segs = ringA.length
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % segs
    faces.push(b.addTriangle(ringA[i]!, ringA[j]!, ringB[j]!))
    faces.push(b.addTriangle(ringA[i]!, ringB[j]!, ringB[i]!))
  }
  return faces
}

/** Low-poly capsule inscribed in the box — hemispherical caps on a cylindrical body. */
export function createInscribedCapsule(
  center: Vec3,
  size: Vec3,
  heightAxis: Axis,
  segments = 8
): MeshData {
  const others = ([0, 1, 2] as Axis[]).filter((a) => a !== heightAxis)
  const radius = Math.min(axisComponent(size, others[0]), axisComponent(size, others[1])) / 2
  const height = axisComponent(size, heightAxis)
  if (radius < 1e-6 || height < 1e-6) return emptyMeshData()

  const halfH = height / 2
  if (halfH <= radius) {
    return createInscribedIcosphere(center, size, segments)
  }

  const segs = Math.max(6, segments)
  const capRings = Math.max(2, Math.floor(segs / 2))
  const bodyHalf = halfH - radius
  const b = new MeshBuilder()

  const buildRing = (y: number, scale: number): number[] => {
    const ring: number[] = []
    for (let i = 0; i < segs; i++) {
      const t = (i / segs) * Math.PI * 2
      const lx = Math.cos(t) * radius * scale
      const lz = Math.sin(t) * radius * scale
      ring.push(b.addVertexVec(mapLocal(lx, y, lz, heightAxis, center)))
    }
    return ring
  }

  const bottomRings: number[][] = []
  for (let ri = 0; ri < capRings; ri++) {
    const phi = (ri / capRings) * (Math.PI / 2)
    const y = -bodyHalf - radius * Math.sin(phi)
    bottomRings.push(buildRing(y, Math.cos(phi)))
  }

  const topRings: number[][] = []
  for (let ri = 0; ri < capRings; ri++) {
    const phi = (ri / capRings) * (Math.PI / 2)
    const y = bodyHalf + radius * Math.sin(phi)
    topRings.push(buildRing(y, Math.cos(phi)))
  }

  const bi = b.addVertexVec(mapLocal(0, -halfH, 0, heightAxis, center))
  const ti = b.addVertexVec(mapLocal(0, halfH, 0, heightAxis, center))

  const bottomCap: number[] = []
  for (let ri = 0; ri < capRings - 1; ri++) {
    bottomCap.push(...connectRings(b, bottomRings[ri]!, bottomRings[ri + 1]!))
  }
  const lastBottom = bottomRings[capRings - 1]!
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % segs
    bottomCap.push(b.addTriangle(bi, lastBottom[j]!, lastBottom[i]!))
  }
  b.addFaceGroup(bottomCap)

  b.addFaceGroup(connectRings(b, bottomRings[0]!, topRings[0]!))

  const topCap: number[] = []
  for (let ri = 0; ri < capRings - 1; ri++) {
    topCap.push(...connectRings(b, topRings[ri]!, topRings[ri + 1]!))
  }
  const lastTop = topRings[capRings - 1]!
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % segs
    topCap.push(b.addTriangle(ti, lastTop[i]!, lastTop[j]!))
  }
  b.addFaceGroup(topCap)

  return finalize(b.build(), center)
}

export function createInscribedCone(
  center: Vec3,
  size: Vec3,
  heightAxis: Axis,
  segments = 8
): MeshData {
  const others = ([0, 1, 2] as Axis[]).filter((a) => a !== heightAxis)
  const radius = Math.min(axisComponent(size, others[0]), axisComponent(size, others[1])) / 2
  const height = axisComponent(size, heightAxis)
  if (radius < 1e-6 || height < 1e-6) return emptyMeshData()

  const segs = Math.max(3, segments)
  const halfH = height / 2
  const b = new MeshBuilder()

  const ai = b.addVertexVec(mapLocal(0, halfH, 0, heightAxis, center))
  const baseRing: number[] = []
  for (let i = 0; i < segs; i++) {
    const t = (i / segs) * Math.PI * 2
    const lx = Math.cos(t) * radius
    const lz = Math.sin(t) * radius
    baseRing.push(b.addVertexVec(mapLocal(lx, -halfH, lz, heightAxis, center)))
  }
  const ci = b.addVertexVec(mapLocal(0, -halfH, 0, heightAxis, center))

  const side: number[] = []
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % segs
    side.push(b.addTriangle(ai, baseRing[i]!, baseRing[j]!))
  }
  b.addFaceGroup(side)

  const cap: number[] = []
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % segs
    cap.push(b.addTriangle(ci, baseRing[j]!, baseRing[i]!))
  }
  b.addFaceGroup(cap)

  return finalize(b.build(), center)
}

export function createInscribedPyramid(
  center: Vec3,
  size: Vec3,
  heightAxis: Axis
): MeshData {
  const others = ([0, 1, 2] as Axis[]).filter((a) => a !== heightAxis)
  const w = axisComponent(size, others[0])
  const d = axisComponent(size, others[1])
  const height = axisComponent(size, heightAxis)
  if (w < 1e-6 || d < 1e-6 || height < 1e-6) return emptyMeshData()

  const hw = w / 2
  const hd = d / 2
  const halfH = height / 2
  const b = new MeshBuilder()

  const apex = b.addVertexVec(mapLocal(0, halfH, 0, heightAxis, center))
  const b0 = b.addVertexVec(mapLocal(-hw, -halfH, -hd, heightAxis, center))
  const b1 = b.addVertexVec(mapLocal(hw, -halfH, -hd, heightAxis, center))
  const b2 = b.addVertexVec(mapLocal(hw, -halfH, hd, heightAxis, center))
  const b3 = b.addVertexVec(mapLocal(-hw, -halfH, hd, heightAxis, center))

  b.addFaceGroup([b.addTriangle(b0, b2, b1), b.addTriangle(b0, b3, b2)])
  b.addFaceGroup([b.addTriangle(apex, b0, b1)])
  b.addFaceGroup([b.addTriangle(apex, b1, b2)])
  b.addFaceGroup([b.addTriangle(apex, b2, b3)])
  b.addFaceGroup([b.addTriangle(apex, b3, b0)])

  return finalize(b.build(), center)
}

export type PrimitiveBoxType =
  | 'box'
  | 'roundedBox'
  | 'icosphere'
  | 'sphere'
  | 'cone'
  | 'cylinder'
  | 'capsule'
  | 'pyramid'

export function createPrimitiveInBox(
  type: PrimitiveBoxType,
  box: WorldBox,
  heightAxis: Axis,
  segments = 8
): MeshData {
  const { center, size } = boxCenterSize(box)
  switch (type) {
    case 'box':
      return createBoxMesh(center, size)
    case 'roundedBox':
      return emptyMeshData()
    case 'icosphere':
      return createInscribedIcosphere(center, size, segments)
    case 'sphere':
      return createInscribedUvSphere(center, size, heightAxis, segments)
    case 'cylinder':
      return createInscribedCylinder(center, size, heightAxis, segments)
    case 'capsule':
      return createInscribedCapsule(center, size, heightAxis, segments)
    case 'cone':
      return createInscribedCone(center, size, heightAxis, segments)
    case 'pyramid':
      return createInscribedPyramid(center, size, heightAxis)
    default:
      return emptyMeshData()
  }
}

export function worldBoxToMeshData(
  type: PrimitiveBoxType,
  min: Vec3,
  max: Vec3,
  heightAxis: Axis,
  segments = 8
): MeshData {
  return createPrimitiveInBox(type, { min, max }, heightAxis, segments)
}

export function toTuple(v: Vec3): [number, number, number] {
  return [v.x, v.y, v.z]
}
