/**
 * Refactored CAD box primitives — all geometry exits through MeshBuilder.finalizeIndexedMesh.
 */
import type { MeshData } from '../blob/types'
import { createIcosphere } from '../blob/primitives'
import {
  createLowPolyCapsuleMeshData,
  capsuleRadialSegments,
} from './capsuleMesh'
import {
  MeshBuilder,
  emptyMeshData,
  finalizeIndexedMesh,
  indexedMeshFromFlat,
  type IndexedMesh,
} from '../mesh/MeshBuilder'
import { primitiveSegmentsForBudget } from '../mesh/meshPolyBudget'
import type { Vec3 } from '../utils/math'
import { axisComponent, type Axis } from './viewAxes'
import { boxCenterSize, type WorldBox } from './primitiveBoxMath'
import { createCadShapePrimitive, type CadShapePrimitiveOptions } from './cadShapePrimitives'
import type { ViewType } from '../scene/viewTypes'

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
  const vtx = (dx: number, dy: number, dz: number) => b.addVertex(cx + dx, cy + dy, cz + dz)
  const uv = (u: number, v: number) => b.addUv(u, v)

  // Eight welded corners — shared across all six faces so component edits stay connected.
  const v000 = vtx(-hx, -hy, -hz)
  const v100 = vtx(hx, -hy, -hz)
  const v110 = vtx(hx, hy, -hz)
  const v010 = vtx(-hx, hy, -hz)
  const v001 = vtx(-hx, -hy, hz)
  const v101 = vtx(hx, -hy, hz)
  const v111 = vtx(hx, hy, hz)
  const v011 = vtx(-hx, hy, hz)

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
    v000, v100, v110, v010,
    uv(0, 0), uv(1, 0), uv(1, 1), uv(0, 1)
  )
  pushFace(
    v101, v001, v011, v111,
    uv(0, 0), uv(1, 0), uv(1, 1), uv(0, 1)
  )
  pushFace(
    v001, v000, v010, v011,
    uv(0, 0), uv(1, 0), uv(1, 1), uv(0, 1)
  )
  pushFace(
    v100, v101, v111, v110,
    uv(0, 0), uv(1, 0), uv(1, 1), uv(0, 1)
  )
  pushFace(
    v010, v110, v111, v011,
    uv(0, 0), uv(1, 0), uv(1, 1), uv(0, 1)
  )
  pushFace(
    v001, v101, v100, v000,
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

/** Low-poly capsule — cylindrical body with faceted hemispherical caps. */
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
  return createLowPolyCapsuleMeshData({
    axisMin: -halfH,
    axisMax: halfH,
    radius,
    radialSegs: capsuleRadialSegments(segments),
    mapPoint: (lx, axis, lz) => mapLocal(lx, axis, lz, heightAxis, center),
    outwardCenter: center,
  })
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
  | 'doughnut'
  | 'ring'
  | 'stairs'
  | 'star'
  | 'dome'
  | 'halfCircle'

export type { CadShapePrimitiveOptions }

export function createPrimitiveInBox(
  type: PrimitiveBoxType,
  box: WorldBox,
  heightAxis: Axis,
  segments = primitiveSegmentsForBudget(128),
  options?: CadShapePrimitiveOptions & { baseView?: ViewType | null }
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
    case 'doughnut':
    case 'ring':
    case 'stairs':
    case 'star':
    case 'dome':
    case 'halfCircle':
      return createCadShapePrimitive(type, box, heightAxis, segments, options)
    default:
      return emptyMeshData()
  }
}

export function worldBoxToMeshData(
  type: PrimitiveBoxType,
  min: Vec3,
  max: Vec3,
  heightAxis: Axis,
  segments = 8,
  options?: CadShapePrimitiveOptions & { baseView?: ViewType | null }
): MeshData {
  return createPrimitiveInBox(type, { min, max }, heightAxis, segments, options)
}

export function toTuple(v: Vec3): [number, number, number] {
  return [v.x, v.y, v.z]
}
