import type { MeshData } from '../blob/types'
import {
  MeshBuilder,
  emptyMeshData,
  finalizeIndexedMesh,
  type IndexedMesh,
} from '../mesh/MeshBuilder'
import type { Vec3 } from '../utils/math'
import { primitiveSegmentsForBudget } from '../mesh/meshPolyBudget'

/** Faceted bands from equator toward each pole (excluding the shared equator ring). */
export const LOW_POLY_CAPSULE_HEMI_RINGS = 2

export function capsuleRadialSegments(segments?: number, polyBudget?: number): number {
  if (polyBudget != null) return primitiveSegmentsForBudget(polyBudget, 8)
  return Math.max(6, Math.min(10, segments ?? 8))
}

export interface LowPolyCapsuleParams {
  axisMin: number
  axisMax: number
  radius: number
  radialSegs?: number
  hemiRings?: number
  mapPoint: (lx: number, axis: number, lz: number) => Vec3
  outwardCenter: Vec3
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

function fanPoleToRing(
  b: MeshBuilder,
  pole: number,
  ring: number[],
  poleIsMin: boolean
): number[] {
  const faces: number[] = []
  const segs = ring.length
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % segs
    if (poleIsMin) {
      faces.push(b.addTriangle(pole, ring[j]!, ring[i]!))
    } else {
      faces.push(b.addTriangle(pole, ring[i]!, ring[j]!))
    }
  }
  return faces
}

type RingBuilder = (axisPos: number, scale: number) => number[]

/** Hemisphere cap with pole + rings down to a pre-built equator ring. */
function appendHemisphere(
  b: MeshBuilder,
  mapPoint: (lx: number, axis: number, lz: number) => Vec3,
  poleAxis: number,
  equatorRing: number[],
  fitRadius: number,
  hemiRings: number,
  buildRing: RingBuilder,
  poleIsMin: boolean
): void {
  const pole = b.addVertexVec(mapPoint(0, poleAxis, 0))
  const bands = Math.max(1, hemiRings)
  const ringsFromPole: number[][] = []

  for (let ri = bands - 1; ri >= 1; ri--) {
    const t = ri / bands
    // Ring at axis fraction t from pole → radius = R * sqrt(2t - t²) on a sphere.
    const scale = Math.sqrt(Math.max(0, t * (2 - t)))
    const axisPos = poleIsMin ? poleAxis + fitRadius * t : poleAxis - fitRadius * t
    ringsFromPole.push(buildRing(axisPos, scale))
  }
  ringsFromPole.push(equatorRing)

  const capFaces: number[] = []
  if (ringsFromPole.length > 1) {
    capFaces.push(...fanPoleToRing(b, pole, ringsFromPole[0]!, poleIsMin))
    for (let ri = 0; ri < ringsFromPole.length - 1; ri++) {
      capFaces.push(...connectRings(b, ringsFromPole[ri]!, ringsFromPole[ri + 1]!))
    }
  } else {
    capFaces.push(...fanPoleToRing(b, pole, equatorRing, poleIsMin))
  }
  b.addFaceGroup(capFaces)
}

/**
 * Capsule = low-poly cylinder + two low-poly hemispheres.
 * Cylinder rings and hemisphere equators share the same vertex rings.
 */
export function buildLowPolyCapsuleIndexed(params: LowPolyCapsuleParams): IndexedMesh {
  const {
    axisMin,
    axisMax,
    radius,
    mapPoint,
    radialSegs = 8,
    hemiRings = LOW_POLY_CAPSULE_HEMI_RINGS,
  } = params

  const height = axisMax - axisMin
  if (radius < 1e-6 || height < 1e-6) {
    return { positions: [], faces: [] }
  }

  const segs = Math.max(6, Math.min(10, radialSegs))
  const fitRadius = Math.min(radius, height / 2)
  const cylBottom = axisMin + fitRadius
  const cylTop = axisMax - fitRadius
  const cylLength = cylTop - cylBottom
  const b = new MeshBuilder()

  const buildRing: RingBuilder = (axisPos, scale) => {
    const ring: number[] = []
    for (let i = 0; i < segs; i++) {
      const t = (i / segs) * Math.PI * 2
      const lx = Math.cos(t) * fitRadius * scale
      const lz = Math.sin(t) * fitRadius * scale
      ring.push(b.addVertexVec(mapPoint(lx, axisPos, lz)))
    }
    return ring
  }

  // 1. Cylinder — shared top/bottom rings (same segment count & spacing).
  const bottomRing = buildRing(cylBottom, 1)
  const topRing = cylLength > 1e-5 ? buildRing(cylTop, 1) : bottomRing

  if (topRing !== bottomRing) {
    b.addFaceGroup(connectRings(b, bottomRing, topRing))
  }

  // 2. Hemispheres — equator rings weld to the cylinder rings.
  appendHemisphere(b, mapPoint, axisMin, bottomRing, fitRadius, hemiRings, buildRing, true)
  appendHemisphere(b, mapPoint, axisMax, topRing, fitRadius, hemiRings, buildRing, false)

  return b.build()
}

export function createLowPolyCapsuleMeshData(params: LowPolyCapsuleParams): MeshData {
  const mesh = buildLowPolyCapsuleIndexed(params)
  if (mesh.faces.length === 0) return emptyMeshData()
  const data = finalizeIndexedMesh(mesh, {
    outwardCenter: params.outwardCenter,
    facet: false,
    validate: true,
  })
  return data.indices.length === 0 ? emptyMeshData() : data
}
