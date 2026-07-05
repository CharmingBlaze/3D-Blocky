import { HalfEdgeMesh, type SceneObject } from './HalfEdgeMesh'
import type { ViewType } from '../store/appStore'
import { projectMeshToView } from '../stroke/worldProjection'
import { isOrthoView } from '../primitives/viewAxes'
import type { ShapeKind } from '../vector/types'
import {
  dragBounds,
  dragTriangle,
  extrusionDepth,
} from '../vector/shapeDraftGeometry'
import { generateId, type Vec2 } from '../utils/math'
import { IDENTITY_TRANSFORM } from './objectTransform'
import {
  applyRoundedBoxParams,
  type RoundedBoxParams,
} from './roundedBox'
import { finalizeProjectedShapeMesh } from './meshWinding'

export interface ShapeMeshOptions {
  view: ViewType
  depth: number
  polyBudget: number
  color: number
  name?: string
  roundedBoxParams?: RoundedBoxParams
}

function segmentsForBudget(polyBudget: number, cap = 16): number {
  return Math.max(4, Math.min(cap, Math.floor(Math.sqrt(polyBudget * 1.2))))
}

function sphereResolutionForBudget(polyBudget: number): {
  latRings: number
  lonSegs: number
} {
  let lonSegs = Math.max(6, Math.round(Math.sqrt(polyBudget * 2)))
  lonSegs = Math.min(lonSegs, 32)
  let latRings = Math.max(3, Math.round(lonSegs * 0.55))
  while (2 + (latRings - 1) * lonSegs > polyBudget * 1.25 && lonSegs > 4) {
    lonSegs--
    latRings = Math.max(3, Math.round(lonSegs * 0.55))
  }
  return { latRings, lonSegs }
}

function pushTri(
  mesh: HalfEdgeMesh,
  i0: number,
  i1: number,
  i2: number,
  color: number,
  deferGroup = false
): number {
  const fi = mesh.faces.length
  mesh.faces.push([i0, i1, i2])
  mesh.faceColors.push(color)
  if (!deferGroup) mesh.faceGroups.push([fi])
  return fi
}

function pushQuad(
  mesh: HalfEdgeMesh,
  i0: number,
  i1: number,
  i2: number,
  i3: number,
  color: number
): void {
  const a = mesh.faces.length
  mesh.faces.push([i0, i1, i2])
  mesh.faceColors.push(color)
  mesh.faces.push([i0, i2, i3])
  mesh.faceColors.push(color)
  mesh.faceGroups.push([a, a + 1])
}

function pushCapFan(
  mesh: HalfEdgeMesh,
  center: number,
  ring: number[],
  color: number,
  reverse = false
): void {
  const capFaces: number[] = []
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length
    const a = ring[i]
    const b = ring[j]
    capFaces.push(
      reverse
        ? pushTri(mesh, center, b, a, color, true)
        : pushTri(mesh, center, a, b, color, true)
    )
  }
  mesh.faceGroups.push(capFaces)
}

function addVertex(mesh: HalfEdgeMesh, u: number, v: number, z: number): number {
  const idx = mesh.positions.length
  mesh.positions.push({ x: u, y: v, z })
  return idx
}

/**
 * All primitives are authored in canonical space:
 * - (u, v) = drag work plane (matches clientToPlane coords)
 * - z = extrusion axis perpendicular to that plane (becomes view depth via projectMeshToView)
 */
export function generateLowPolySphere(
  a: Vec2,
  b: Vec2,
  polyBudget: number,
  color: number
): HalfEdgeMesh {
  const { cu, cv, rx, ry } = dragBounds(a, b)
  const rz = Math.sqrt(rx * ry)
  const { latRings, lonSegs } = sphereResolutionForBudget(polyBudget)

  const mesh = new HalfEdgeMesh()
  const ringVerts: number[][] = []

  for (let lat = 0; lat <= latRings; lat++) {
    const theta = (lat / latRings) * Math.PI
    const sinT = Math.sin(theta)
    const cosT = Math.cos(theta)

    if (lat === 0 || lat === latRings) {
      ringVerts.push([addVertex(mesh, cu, cv, rz * cosT)])
      continue
    }

    const ring: number[] = []
    for (let lon = 0; lon < lonSegs; lon++) {
      const phi = (lon / lonSegs) * Math.PI * 2
      ring.push(
        addVertex(
          mesh,
          cu + rx * Math.cos(phi) * sinT,
          cv + ry * Math.sin(phi) * sinT,
          rz * cosT
        )
      )
    }
    ringVerts.push(ring)
  }

  const north = ringVerts[0][0]
  const south = ringVerts[latRings][0]
  const firstRing = ringVerts[1]

  for (let i = 0; i < lonSegs; i++) {
    const j = (i + 1) % lonSegs
    pushTri(mesh, north, firstRing[j], firstRing[i], color)
  }

  for (let lat = 1; lat < latRings - 1; lat++) {
    const ringA = ringVerts[lat]
    const ringB = ringVerts[lat + 1]
    for (let i = 0; i < lonSegs; i++) {
      const j = (i + 1) % lonSegs
      pushQuad(mesh, ringA[i], ringA[j], ringB[j], ringB[i], color)
    }
  }

  const lastRing = ringVerts[latRings - 1]
  for (let i = 0; i < lonSegs; i++) {
    const j = (i + 1) % lonSegs
    pushTri(mesh, south, lastRing[i], lastRing[j], color)
  }

  mesh.buildHalfEdges()
  return mesh
}

/** Flat elliptical disc in the drag plane (z = 0) */
export function generateLowPolyCircle(
  a: Vec2,
  b: Vec2,
  segments: number,
  color: number
): HalfEdgeMesh {
  const { cu, cv, rx, ry } = dragBounds(a, b)
  const segs = Math.max(6, segments)
  const mesh = new HalfEdgeMesh()
  const center = addVertex(mesh, cu, cv, 0)
  const ring: number[] = []
  for (let i = 0; i < segs; i++) {
    const t = (i / segs) * Math.PI * 2
    ring.push(addVertex(mesh, cu + Math.cos(t) * rx, cv + Math.sin(t) * ry, 0))
  }
  for (let i = 0; i < segs; i++) {
    pushTri(mesh, center, ring[i], ring[(i + 1) % segs], color)
  }
  mesh.buildHalfEdges()
  return mesh
}

/** Box — drag rect is the near face (z = 0), depth extends along +Z */
export function generateLowPolyBox(a: Vec2, b: Vec2, color: number): HalfEdgeMesh {
  const { minU, maxU, minV, maxV, w, h } = dragBounds(a, b)
  const depth = extrusionDepth(w, h)
  const mesh = new HalfEdgeMesh()

  const f0 = addVertex(mesh, minU, minV, 0)
  const f1 = addVertex(mesh, maxU, minV, 0)
  const f2 = addVertex(mesh, maxU, maxV, 0)
  const f3 = addVertex(mesh, minU, maxV, 0)
  const b0 = addVertex(mesh, minU, minV, depth)
  const b1 = addVertex(mesh, maxU, minV, depth)
  const b2 = addVertex(mesh, maxU, maxV, depth)
  const b3 = addVertex(mesh, minU, maxV, depth)

  pushQuad(mesh, f0, f1, f2, f3, color)
  pushQuad(mesh, b2, b1, b0, b3, color)
  pushQuad(mesh, f1, b1, b2, f2, color)
  pushQuad(mesh, f3, f2, b2, b3, color)
  pushQuad(mesh, f0, f3, b3, b0, color)
  pushQuad(mesh, f0, b0, b1, f1, color)

  mesh.buildHalfEdges()
  return mesh
}

/** Single quad matching the drag rect in the work plane */
export function generateLowPolyPlane(a: Vec2, b: Vec2, color: number): HalfEdgeMesh {
  const { minU, maxU, minV, maxV } = dragBounds(a, b)
  const mesh = new HalfEdgeMesh()
  const v0 = addVertex(mesh, minU, minV, 0)
  const v1 = addVertex(mesh, maxU, minV, 0)
  const v2 = addVertex(mesh, maxU, maxV, 0)
  const v3 = addVertex(mesh, minU, maxV, 0)
  pushQuad(mesh, v0, v1, v2, v3, color)
  pushQuad(mesh, v0, v3, v2, v1, color)
  mesh.buildHalfEdges()
  return mesh
}

/** Elliptical cylinder — cross-section matches drag ellipse, axis along +Z */
export function generateLowPolyCylinder(
  a: Vec2,
  b: Vec2,
  segments: number,
  color: number
): HalfEdgeMesh {
  const { cu, cv, rx, ry, w, h } = dragBounds(a, b)
  const depth = extrusionDepth(w, h)
  const segs = Math.max(6, segments)
  const mesh = new HalfEdgeMesh()

  const bottom: number[] = []
  const top: number[] = []
  for (let i = 0; i < segs; i++) {
    const t = (i / segs) * Math.PI * 2
    const dx = Math.cos(t) * rx
    const dy = Math.sin(t) * ry
    bottom.push(addVertex(mesh, cu + dx, cv + dy, 0))
    top.push(addVertex(mesh, cu + dx, cv + dy, depth))
  }

  const baseCenter = addVertex(mesh, cu, cv, 0)
  const topCenter = addVertex(mesh, cu, cv, depth)

  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % segs
    pushQuad(mesh, bottom[i], bottom[j], top[j], top[i], color)
  }
  pushCapFan(mesh, baseCenter, bottom, color, true)
  pushCapFan(mesh, topCenter, top, color, false)

  mesh.buildHalfEdges()
  return mesh
}

/** Pyramid — triangle silhouette: apex at drag apex (z = 0), triangular base at +Z */
export function generateLowPolyPyramid(a: Vec2, b: Vec2, color: number): HalfEdgeMesh {
  const [bl, br, apex2d] = dragTriangle(a, b)
  const { h } = dragBounds(a, b)
  const depth = Math.max(h, 1)
  const mesh = new HalfEdgeMesh()

  const apex = addVertex(mesh, apex2d.x, apex2d.y, 0)
  const b0 = addVertex(mesh, bl.x, bl.y, depth)
  const b1 = addVertex(mesh, br.x, br.y, depth)
  const b2 = addVertex(mesh, apex2d.x, apex2d.y, depth)

  pushTri(mesh, b0, b1, b2, color)
  pushTri(mesh, apex, b0, b1, color)
  pushTri(mesh, apex, b1, b2, color)
  pushTri(mesh, apex, b2, b0, color)

  mesh.buildHalfEdges()
  return mesh
}

/** Cone — triangle silhouette: apex at drag apex (z = 0), circular base at +Z */
export function generateLowPolyCone(
  a: Vec2,
  b: Vec2,
  segments: number,
  color: number
): HalfEdgeMesh {
  const [, , apex2d] = dragTriangle(a, b)
  const { cu, rx, h, maxV } = dragBounds(a, b)
  const depth = Math.max(h, 1)
  const segs = Math.max(6, segments)
  const mesh = new HalfEdgeMesh()

  const apex = addVertex(mesh, apex2d.x, apex2d.y, 0)
  const baseCenterV = maxV - rx
  const baseRing: number[] = []
  for (let i = 0; i < segs; i++) {
    const t = (i / segs) * Math.PI * 2
    baseRing.push(
      addVertex(mesh, cu + Math.cos(t) * rx, baseCenterV + Math.sin(t) * rx, depth)
    )
  }
  const baseCenter = addVertex(mesh, cu, baseCenterV, depth)

  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % segs
    pushTri(mesh, apex, baseRing[i], baseRing[j], color)
  }
  pushCapFan(mesh, baseCenter, baseRing, color, true)

  mesh.buildHalfEdges()
  return mesh
}

/** Capsule — elliptical cross-section, hemispherical caps at z = 0 and z = depth */
export function generateLowPolyCapsule(
  a: Vec2,
  b: Vec2,
  segments: number,
  color: number
): HalfEdgeMesh {
  const { cu, cv, rx, ry, w, h } = dragBounds(a, b)
  const depth = extrusionDepth(w, h)
  const r = Math.min(rx, ry)
  const segs = Math.max(6, segments)
  const capRings = Math.max(2, Math.floor(segs / 2))
  const mesh = new HalfEdgeMesh()

  if (depth <= 2 * r) {
    const squashed = generateLowPolySphere(a, b, Math.max(24, segs * 4), color)
    let zMin = Infinity
    let zMax = -Infinity
    for (const p of squashed.positions) {
      zMin = Math.min(zMin, p.z)
      zMax = Math.max(zMax, p.z)
    }
    const zSpan = zMax - zMin || 1
    for (const p of squashed.positions) {
      p.z = ((p.z - zMin) / zSpan) * depth
    }
    return squashed
  }

  const bodyZ0 = r
  const bodyZ1 = depth - r

  const buildRing = (z: number, scale: number): number[] => {
    const ring: number[] = []
    for (let i = 0; i < segs; i++) {
      const t = (i / segs) * Math.PI * 2
      ring.push(addVertex(mesh, cu + Math.cos(t) * rx * scale, cv + Math.sin(t) * ry * scale, z))
    }
    return ring
  }

  const bottomRings: number[][] = []
  for (let ri = 0; ri < capRings; ri++) {
    const phi = (ri / capRings) * (Math.PI / 2)
    const z = bodyZ0 - r * Math.sin(phi)
    bottomRings.push(buildRing(z, Math.cos(phi)))
  }

  const topRings: number[][] = []
  for (let ri = 0; ri < capRings; ri++) {
    const phi = (ri / capRings) * (Math.PI / 2)
    const z = bodyZ1 + r * Math.sin(phi)
    topRings.push(buildRing(z, Math.cos(phi)))
  }

  const bottomPole = addVertex(mesh, cu, cv, 0)
  const topPole = addVertex(mesh, cu, cv, depth)

  const connectRings = (ringA: number[], ringB: number[]) => {
    for (let i = 0; i < segs; i++) {
      const j = (i + 1) % segs
      pushQuad(mesh, ringA[i]!, ringB[i]!, ringB[j]!, ringA[j]!, color)
    }
  }

  for (let ri = 0; ri < capRings - 1; ri++) {
    connectRings(bottomRings[ri]!, bottomRings[ri + 1]!)
  }
  const lastBottom = bottomRings[capRings - 1]!
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % segs
    pushTri(mesh, bottomPole, lastBottom[j]!, lastBottom[i]!, color)
  }

  connectRings(bottomRings[0]!, topRings[0]!)

  for (let ri = 0; ri < capRings - 1; ri++) {
    connectRings(topRings[ri]!, topRings[ri + 1]!)
  }
  const lastTop = topRings[capRings - 1]!
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % segs
    pushTri(mesh, topPole, lastTop[i]!, lastTop[j]!, color)
  }

  mesh.buildHalfEdges()
  return mesh
}

/** Subdivided rounded box — drag rect is the near face (z = 0), depth extends along +Z */
export function generateLowPolyRoundedBox(
  a: Vec2,
  b: Vec2,
  color: number,
  params: RoundedBoxParams,
  polyBudget = 48
): HalfEdgeMesh {
  const base = generateLowPolyBox(a, b, color)
  const obj = base.toObject('temp', 'RoundedBox', {
    color,
    polyBudget,
    smoothShading: false,
  })
  const rounded = applyRoundedBoxParams(obj, params, polyBudget)
  const mesh = HalfEdgeMesh.fromObject(rounded)
  mesh.buildHalfEdges()
  return mesh
}

export function generateShapeMesh(
  kind: ShapeKind,
  a: Vec2,
  b: Vec2,
  polyBudget: number,
  color: number,
  roundedBoxParams?: RoundedBoxParams
): HalfEdgeMesh | null {
  const segs = segmentsForBudget(polyBudget)

  let mesh: HalfEdgeMesh | null = null
  switch (kind) {
    case 'sphere':
      mesh = generateLowPolySphere(a, b, polyBudget, color)
      break
    case 'circle':
      mesh = generateLowPolyCircle(a, b, segs, color)
      break
    case 'box':
      mesh = generateLowPolyBox(a, b, color)
      break
    case 'roundedBox':
      mesh = generateLowPolyRoundedBox(
        a,
        b,
        color,
        roundedBoxParams ?? { roundness: 0.25, subdivisions: 1 },
        polyBudget
      )
      break
    case 'plane':
      mesh = generateLowPolyPlane(a, b, color)
      break
    case 'cylinder':
      mesh = generateLowPolyCylinder(a, b, segs, color)
      break
    case 'capsule':
      mesh = generateLowPolyCapsule(a, b, segs, color)
      break
    case 'pyramid':
      mesh = generateLowPolyPyramid(a, b, color)
      break
    case 'cone':
      mesh = generateLowPolyCone(a, b, segs, color)
      break
    default:
      return null
  }

  return mesh
}

const SHAPE_NAMES: Record<ShapeKind, string> = {
  sphere: 'Sphere',
  circle: 'Circle',
  box: 'Box',
  roundedBox: 'Rounded Box',
  plane: 'Plane',
  cylinder: 'Cylinder',
  capsule: 'Capsule',
  pyramid: 'Pyramid',
  cone: 'Cone',
}

export function vectorShapeToObject(
  kind: ShapeKind,
  a: Vec2,
  b: Vec2,
  options: ShapeMeshOptions
): SceneObject | null {
  const mesh = generateShapeMesh(
    kind,
    a,
    b,
    options.polyBudget,
    options.color,
    options.roundedBoxParams
  )
  if (!mesh || mesh.vertexCount() === 0) return null

  projectMeshToView(mesh, options.view, options.depth)
  if (isOrthoView(options.view)) {
    finalizeProjectedShapeMesh(mesh, options.view, kind === 'circle')
  }

  return mesh.toObject(generateId(), options.name ?? SHAPE_NAMES[kind], {
    polyBudget: options.polyBudget,
    color: options.color,
    polyBudgetMode: 'strict',
    transform: {
      position: { ...IDENTITY_TRANSFORM.position },
      rotation: { ...IDENTITY_TRANSFORM.rotation },
      scale: { ...IDENTITY_TRANSFORM.scale },
    },
  })
}

export function isEllipseDragShape(kind: ShapeKind): boolean {
  return kind === 'sphere' || kind === 'circle' || kind === 'capsule'
}

export function isTriangleDragShape(kind: ShapeKind): boolean {
  return kind === 'pyramid' || kind === 'cone'
}

export function isRectDragShape(kind: ShapeKind): boolean {
  return kind === 'box' || kind === 'roundedBox' || kind === 'plane' || kind === 'cylinder'
}
