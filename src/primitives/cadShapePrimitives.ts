/**
 * View-aware CAD shapes — doughnut, ring, stairs, star, dome, half circle.
 * Profile silhouettes follow the view you start in; extrusion follows that view's depth axis.
 */
import type { MeshData } from '../blob/types'
import type { ViewType } from '../scene/viewTypes'
import { isOrthoView, orthoViewFromLegacy, type OrthoViewType } from './viewAxes'
import {
  MeshBuilder,
  emptyMeshData,
  finalizeIndexedMesh,
  type IndexedMesh,
} from '../mesh/MeshBuilder'
import type { Vec3 } from '../utils/math'
import {
  VIEW_AXIS_TABLE,
  axisComponent,
  setAxisComponent,
  type Axis,
} from './viewAxes'
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

function finalize(mesh: IndexedMesh, outwardCenter: Vec3, skipOutwardWinding = false): MeshData {
  const data = finalizeIndexedMesh(mesh, {
    outwardCenter,
    facet: false,
    validate: true,
    skipOutwardWinding,
  })
  return data.indices.length === 0 ? emptyMeshData() : data
}

function crossAxes(heightAxis: Axis): [Axis, Axis] {
  const axes = ([0, 1, 2] as Axis[]).filter((a) => a !== heightAxis)
  return [axes[0]!, axes[1]!]
}

function addOnAxis(p: Vec3, axis: Axis, delta: number): Vec3 {
  return setAxisComponent(p, axis, axisComponent(p, axis) + delta)
}

function halfExtents(size: Vec3, axis: Axis): number {
  return axisComponent(size, axis) / 2
}

type ProfileView = OrthoViewType | 'perspective'

function resolveProfileView(baseView: ViewType | null | undefined): ProfileView | null {
  if (!baseView) return null
  if (baseView === 'perspective') return 'perspective'
  if (!isOrthoView(baseView)) return null
  return orthoViewFromLegacy(baseView)!
}

/** Map 2D profile coords + depth along height axis into world space (view you drew in). */
function profileToWorld(
  profileView: ProfileView,
  center: Vec3,
  heightAxis: Axis,
  hu: number,
  vv: number,
  depth: number
): Vec3 {
  if (profileView === 'perspective') {
    return {
      x: center.x + hu,
      y: center.y + depth,
      z: center.z + vv,
    }
  }
  const { h, v } = VIEW_AXIS_TABLE[profileView]
  let p = { ...center }
  p = addOnAxis(p, h, hu)
  p = addOnAxis(p, v, vv)
  p = addOnAxis(p, heightAxis, depth)
  return p
}

function profileHalfExtents(
  profileView: ProfileView,
  size: Vec3,
  heightAxis: Axis
): { halfH: number; halfV: number; halfDepth: number } {
  if (profileView === 'perspective') {
    return {
      halfH: halfExtents(size, 0),
      halfV: halfExtents(size, 2),
      halfDepth: halfExtents(size, heightAxis),
    }
  }
  const { h, v } = VIEW_AXIS_TABLE[profileView]
  return {
    halfH: halfExtents(size, h),
    halfV: halfExtents(size, v),
    halfDepth: halfExtents(size, heightAxis),
  }
}

/** Torus — hole runs along the view depth axis you started in. */
export function createInscribedDoughnut(
  center: Vec3,
  size: Vec3,
  heightAxis: Axis,
  segments = 8
): MeshData {
  const [a0, a1] = crossAxes(heightAxis)
  const r0 = halfExtents(size, a0)
  const r1 = halfExtents(size, a1)
  const outer = Math.min(r0, r1)
  const tubeR = Math.max(outer * 0.28, halfExtents(size, heightAxis) * 0.35, 0.15)
  const majorR = Math.max(outer - tubeR, tubeR * 0.5)
  if (majorR < 1e-6 || tubeR < 1e-6) return emptyMeshData()

  const tubeSegs = Math.max(6, Math.floor(segments * 0.75))
  const ringSegs = Math.max(8, segments)
  const b = new MeshBuilder()
  const grid: number[][] = []

  for (let i = 0; i < tubeSegs; i++) {
    const u = (i / tubeSegs) * Math.PI * 2
    const cu = Math.cos(u)
    const su = Math.sin(u)
    const row: number[] = []
    for (let j = 0; j < ringSegs; j++) {
      const v = (j / ringSegs) * Math.PI * 2
      const cv = Math.cos(v)
      const sv = Math.sin(v)
      const lx = (majorR + tubeR * cu) * cv
      const ly = tubeR * su
      const lz = (majorR + tubeR * cu) * sv
      row.push(b.addVertexVec(mapLocal(lx, ly, lz, heightAxis, center)))
    }
    grid.push(row)
  }

  for (let i = 0; i < tubeSegs; i++) {
    const i1 = (i + 1) % tubeSegs
    for (let j = 0; j < ringSegs; j++) {
      const j1 = (j + 1) % ringSegs
      b.addQuad(grid[i]![j]!, grid[i]![j1]!, grid[i1]![j1]!, grid[i1]![j]!)
    }
  }

  return finalize(b.build(), center, true)
}

/** Flat ring — annulus in the draw-plane, thickness along depth. */
export function createInscribedRing(
  center: Vec3,
  size: Vec3,
  heightAxis: Axis,
  segments = 8,
  baseView?: ViewType | null
): MeshData {
  const profileView = resolveProfileView(baseView)
  const segs = Math.max(8, segments)
  const b = new MeshBuilder()

  if (profileView) {
    const { halfH, halfV, halfDepth } = profileHalfExtents(profileView, size, heightAxis)
    const outerH = Math.max(halfH, 0.25)
    const outerV = Math.max(halfV, 0.25)
    const aspect = Math.min(outerH, outerV) / Math.max(outerH, outerV)
    const innerH = outerH * (0.28 + aspect * 0.42)
    const innerV = outerV * (0.28 + aspect * 0.42)
    const z0 = -halfDepth
    const z1 = halfDepth

    const ring = (rh: number, rv: number, depth: number) => {
      const ringVerts: number[] = []
      for (let i = 0; i < segs; i++) {
        const t = (i / segs) * Math.PI * 2
        ringVerts.push(
          b.addVertexVec(
            profileToWorld(profileView, center, heightAxis, Math.cos(t) * rh, Math.sin(t) * rv, depth)
          )
        )
      }
      return ringVerts
    }

    const outerBot = ring(outerH, outerV, z0)
    const outerTop = ring(outerH, outerV, z1)
    const innerBot = ring(innerH, innerV, z0)
    const innerTop = ring(innerH, innerV, z1)

    for (let i = 0; i < segs; i++) {
      const j = (i + 1) % segs
      b.addQuad(outerBot[i]!, outerBot[j]!, outerTop[j]!, outerTop[i]!)
      b.addQuad(innerTop[i]!, innerTop[j]!, innerBot[j]!, innerBot[i]!)
      b.addQuad(outerBot[i]!, innerBot[i]!, innerBot[j]!, outerBot[j]!)
      b.addQuad(outerTop[i]!, outerTop[j]!, innerTop[j]!, innerTop[i]!)
    }

    return finalize(b.build(), center, true)
  }

  const [a0, a1] = crossAxes(heightAxis)
  const outerR = Math.min(halfExtents(size, a0), halfExtents(size, a1))
  const innerR = outerR * 0.45
  const halfT = Math.max(halfExtents(size, heightAxis), 0.15)
  const outerBot: number[] = []
  const outerTop: number[] = []
  const innerBot: number[] = []
  const innerTop: number[] = []
  for (let i = 0; i < segs; i++) {
    const t = (i / segs) * Math.PI * 2
    const lx = Math.cos(t)
    const lz = Math.sin(t)
    outerBot.push(b.addVertexVec(mapLocal(lx * outerR, -halfT, lz * outerR, heightAxis, center)))
    outerTop.push(b.addVertexVec(mapLocal(lx * outerR, halfT, lz * outerR, heightAxis, center)))
    innerBot.push(b.addVertexVec(mapLocal(lx * innerR, -halfT, lz * innerR, heightAxis, center)))
    innerTop.push(b.addVertexVec(mapLocal(lx * innerR, halfT, lz * innerR, heightAxis, center)))
  }
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % segs
    b.addQuad(outerBot[i]!, outerBot[j]!, outerTop[j]!, outerTop[i]!)
    b.addQuad(innerTop[i]!, innerTop[j]!, innerBot[j]!, innerBot[i]!)
    b.addQuad(outerBot[i]!, innerBot[i]!, innerBot[j]!, outerBot[j]!)
    b.addQuad(outerTop[i]!, outerTop[j]!, innerTop[j]!, innerTop[i]!)
  }
  return finalize(b.build(), center, true)
}

/** Stepped block — risers vertical (+Y), treads run forward (+Z), base on world XZ. */
export function createInscribedStairs(
  center: Vec3,
  size: Vec3,
  _heightAxis: Axis,
  _segments = 8,
  _baseView?: ViewType | null
): MeshData {
  const hx = size.x / 2
  const hy = size.y / 2
  const hz = size.z / 2
  const baseY = center.y - hy
  const topY = center.y + hy
  const cx = center.x
  const cz = center.z
  const zFront = cz - hz
  const zBack = cz + hz

  const steps = Math.max(2, Math.min(14, Math.round((2 * hy) / Math.max(hz * 0.45, 0.5))))
  const rise = (2 * hy) / steps
  const tread = (2 * hz) / steps

  const b = new MeshBuilder()

  const quad = (
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    qcx: number,
    cy: number,
    cz0: number,
    dx: number,
    dy: number,
    dz: number
  ) => {
    b.addQuad(
      b.addVertex(ax, ay, az),
      b.addVertex(bx, by, bz),
      b.addVertex(qcx, cy, cz0),
      b.addVertex(dx, dy, dz)
    )
  }

  // Underside
  quad(
    cx - hx,
    baseY,
    zFront,
    cx + hx,
    baseY,
    zFront,
    cx + hx,
    baseY,
    zBack,
    cx - hx,
    baseY,
    zBack
  )

  // Back wall (full height)
  quad(
    cx + hx,
    baseY,
    zBack,
    cx - hx,
    baseY,
    zBack,
    cx - hx,
    topY,
    zBack,
    cx + hx,
    topY,
    zBack
  )

  for (let s = 0; s < steps; s++) {
    const z0 = zFront + s * tread
    const z1 = z0 + tread
    const y0 = baseY + s * rise
    const y1 = y0 + rise

    // Riser — vertical face at the front of this step
    quad(cx - hx, y0, z0, cx + hx, y0, z0, cx + hx, y1, z0, cx - hx, y1, z0)
    // Tread — horizontal face for this step only (not the full remaining depth)
    quad(cx - hx, y1, z0, cx + hx, y1, z0, cx + hx, y1, z1, cx - hx, y1, z1)

    // Solid side panels under this tread (stepped silhouette in side view)
    quad(cx - hx, baseY, z0, cx - hx, baseY, z1, cx - hx, y1, z1, cx - hx, y1, z0)
    quad(cx + hx, baseY, z1, cx + hx, baseY, z0, cx + hx, y1, z0, cx + hx, y1, z1)
  }

  // Box center often sits in empty air above lower steps — use a point inside the solid.
  const solidRef = { x: cx, y: baseY + rise * 0.5, z: zBack - tread * 0.5 }
  return finalize(b.build(), solidRef)
}

function starProfilePoints(outerH: number, outerV: number, points: number): [number, number][] {
  const innerH = outerH * 0.42
  const innerV = outerV * 0.42
  const total = points * 2
  const out: [number, number][] = []
  for (let i = 0; i < total; i++) {
    const a = (i / total) * Math.PI * 2 - Math.PI / 2
    const rH = i % 2 === 0 ? outerH : innerH
    const rV = i % 2 === 0 ? outerV : innerV
    out.push([Math.cos(a) * rH, Math.sin(a) * rV])
  }
  return out
}

/** Star prism — star outline matches the draw view, extruded along depth. */
export function createInscribedStar(
  center: Vec3,
  size: Vec3,
  heightAxis: Axis,
  _segments = 8,
  baseView?: ViewType | null
): MeshData {
  const profileView = resolveProfileView(baseView)
  const b = new MeshBuilder()
  const points = 5

  if (profileView) {
    const { halfH, halfV, halfDepth } = profileHalfExtents(profileView, size, heightAxis)
    const profile = starProfilePoints(Math.max(halfH, 0.25), Math.max(halfV, 0.25), points)
    const n = profile.length
    const bot: number[] = []
    const top: number[] = []
    for (const [hu, vv] of profile) {
      bot.push(b.addVertexVec(profileToWorld(profileView, center, heightAxis, hu, vv, -halfDepth)))
      top.push(b.addVertexVec(profileToWorld(profileView, center, heightAxis, hu, vv, halfDepth)))
    }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      b.addQuad(bot[i]!, bot[j]!, top[j]!, top[i]!)
    }
    const bi = b.addVertexVec(profileToWorld(profileView, center, heightAxis, 0, 0, -halfDepth))
    const ti = b.addVertexVec(profileToWorld(profileView, center, heightAxis, 0, 0, halfDepth))
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      b.addTriangle(bi, bot[j]!, bot[i]!)
      b.addTriangle(ti, top[i]!, top[j]!)
    }
    return finalize(b.build(), center)
  }

  const [a0, a1] = crossAxes(heightAxis)
  const outerR = Math.min(halfExtents(size, a0), halfExtents(size, a1))
  const halfDepth = halfExtents(size, heightAxis)
  const profile = starProfilePoints(outerR, outerR, points)
  const n = profile.length
  const bot: number[] = []
  const top: number[] = []
  for (const [lx, lz] of profile) {
    bot.push(b.addVertexVec(mapLocal(lx, -halfDepth, lz, heightAxis, center)))
    top.push(b.addVertexVec(mapLocal(lx, halfDepth, lz, heightAxis, center)))
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    b.addQuad(bot[i]!, bot[j]!, top[j]!, top[i]!)
  }
  const bi = b.addVertexVec(mapLocal(0, -halfDepth, 0, heightAxis, center))
  const ti = b.addVertexVec(mapLocal(0, halfDepth, 0, heightAxis, center))
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    b.addTriangle(bi, bot[j]!, bot[i]!)
    b.addTriangle(ti, top[i]!, top[j]!)
  }
  return finalize(b.build(), center)
}

/** Dome — hemisphere with flat base on world XZ, rising along +Y (correct in front/top/perspective). */
export function createInscribedDome(
  center: Vec3,
  size: Vec3,
  _heightAxis: Axis,
  segments = 8,
  _baseView?: ViewType | null
): MeshData {
  const hx = size.x / 2
  const hy = size.y / 2
  const hz = size.z / 2
  const R = Math.min(hx, hz, 2 * hy)
  if (R < 1e-6) return emptyMeshData()

  const baseY = center.y - hy
  const cx = center.x
  const cz = center.z

  const lonSegs = Math.max(8, segments)
  const latSegs = Math.max(3, Math.floor(segments * 0.55))
  const b = new MeshBuilder()
  const rings: number[][] = []

  for (let lat = 0; lat < latSegs; lat++) {
    const theta = (lat / latSegs) * (Math.PI / 2)
    const ringR = R * Math.cos(theta)
    const y = baseY + R * Math.sin(theta)
    const ring: number[] = []
    for (let lon = 0; lon < lonSegs; lon++) {
      const phi = (lon / lonSegs) * Math.PI * 2
      ring.push(
        b.addVertex(
          cx + ringR * Math.cos(phi),
          y,
          cz + ringR * Math.sin(phi)
        )
      )
    }
    rings.push(ring)
  }

  const apex = b.addVertex(cx, baseY + R, cz)
  const lastRing = rings[latSegs - 1]!
  for (let i = 0; i < lonSegs; i++) {
    const j = (i + 1) % lonSegs
    b.addTriangle(apex, lastRing[i]!, lastRing[j]!)
  }

  for (let lat = 0; lat < latSegs - 1; lat++) {
    const ringA = rings[lat]!
    const ringB = rings[lat + 1]!
    for (let i = 0; i < lonSegs; i++) {
      const j = (i + 1) % lonSegs
      b.addQuad(ringA[i]!, ringA[j]!, ringB[j]!, ringB[i]!)
    }
  }

  const baseCenter = b.addVertex(cx, baseY, cz)
  const baseRing = rings[0]!
  for (let i = 0; i < lonSegs; i++) {
    const j = (i + 1) % lonSegs
    b.addTriangle(baseCenter, baseRing[j]!, baseRing[i]!)
  }

  return finalize(b.build(), center, true)
}

/** Half circle — semicircular arch in the draw view, extruded along depth. */
export function createInscribedHalfCircle(
  center: Vec3,
  size: Vec3,
  heightAxis: Axis,
  segments = 8,
  baseView?: ViewType | null
): MeshData {
  const profileView = resolveProfileView(baseView)
  const segs = Math.max(6, segments)
  const b = new MeshBuilder()

  if (profileView) {
    const { halfH, halfV, halfDepth } = profileHalfExtents(profileView, size, heightAxis)
    const h = Math.max(halfH, 0.25)
    const v = Math.max(halfV, 0.25)
    const archSegs = segs
    const bot: number[] = []
    const top: number[] = []

    const archHu = (a: number) => Math.cos(a) * h
    const archVv = (a: number) => -v + Math.sin(a) * (2 * v)

    for (let i = 0; i <= archSegs; i++) {
      const a = Math.PI * (i / archSegs)
      const hu = archHu(a)
      const vv = archVv(a)
      bot.push(b.addVertexVec(profileToWorld(profileView, center, heightAxis, hu, vv, -halfDepth)))
      top.push(b.addVertexVec(profileToWorld(profileView, center, heightAxis, hu, vv, halfDepth)))
    }

    const flipProfile =
      profileView !== 'perspective' && profileView !== 'front' && profileView !== 'bottom'
    const profileQuad = (a: number, b0: number, c: number, d: number) => {
      if (flipProfile) b.addQuad(a, d, c, b0)
      else b.addQuad(a, b0, c, d)
    }

    for (let i = 0; i < archSegs; i++) {
      profileQuad(bot[i]!, bot[i + 1]!, top[i + 1]!, top[i]!)
    }

    const flatBot: number[] = []
    const flatTop: number[] = []
    for (let i = 0; i <= archSegs; i++) {
      const t = i / archSegs
      const hu = Math.cos(Math.PI * t) * h
      flatBot.push(b.addVertexVec(profileToWorld(profileView, center, heightAxis, hu, -v, -halfDepth)))
      flatTop.push(b.addVertexVec(profileToWorld(profileView, center, heightAxis, hu, -v, halfDepth)))
    }
    for (let i = 0; i < archSegs; i++) {
      profileQuad(flatBot[i]!, flatBot[i + 1]!, flatTop[i + 1]!, flatTop[i]!)
    }

    const leftBot = b.addVertexVec(profileToWorld(profileView, center, heightAxis, -h, -v, -halfDepth))
    const leftTop = b.addVertexVec(profileToWorld(profileView, center, heightAxis, -h, -v, halfDepth))
    const rightBot = b.addVertexVec(profileToWorld(profileView, center, heightAxis, h, -v, -halfDepth))
    const rightTop = b.addVertexVec(profileToWorld(profileView, center, heightAxis, h, -v, halfDepth))
    const depthSign =
      profileView === 'perspective' ? 1 : VIEW_AXIS_TABLE[profileView].dSign * VIEW_AXIS_TABLE[profileView].vSign
    if (depthSign < 0) {
      b.addQuad(leftBot, rightBot, rightTop, leftTop)
    } else {
      b.addQuad(leftBot, leftTop, rightTop, rightBot)
    }

    const capPivotBot = b.addVertexVec(profileToWorld(profileView, center, heightAxis, 0, -v, -halfDepth))
    const capPivotTop = b.addVertexVec(profileToWorld(profileView, center, heightAxis, 0, -v, halfDepth))
    for (let i = 0; i < archSegs; i++) {
      if (flipProfile) {
        b.addTriangle(capPivotBot, bot[i]!, bot[i + 1]!)
        b.addTriangle(capPivotTop, top[i + 1]!, top[i]!)
      } else {
        b.addTriangle(capPivotBot, bot[i + 1]!, bot[i]!)
        b.addTriangle(capPivotTop, top[i]!, top[i + 1]!)
      }
    }

    return finalize(b.build(), center, true)
  }

  const [a0, a1] = crossAxes(heightAxis)
  const halfA0 = Math.max(halfExtents(size, a0), 0.25)
  const halfA1 = Math.max(halfExtents(size, a1), 0.25)
  const halfDepth = halfExtents(size, heightAxis)
  const bot: number[] = []
  const top: number[] = []
  for (let i = 0; i <= segs; i++) {
    const a = Math.PI * (i / segs)
    const lx = Math.cos(a) * halfA0
    const ly = -halfA1 + Math.sin(a) * (2 * halfA1)
    bot.push(b.addVertexVec(mapLocal(lx, ly, -halfDepth, heightAxis, center)))
    top.push(b.addVertexVec(mapLocal(lx, ly, halfDepth, heightAxis, center)))
  }
  for (let i = 0; i < segs; i++) {
    b.addQuad(bot[i]!, top[i]!, top[i + 1]!, bot[i + 1]!)
  }
  const flatBot = b.addVertexVec(mapLocal(-halfA0, -halfA1, -halfDepth, heightAxis, center))
  const flatTop = b.addVertexVec(mapLocal(-halfA0, -halfA1, halfDepth, heightAxis, center))
  const flatBot2 = b.addVertexVec(mapLocal(halfA0, -halfA1, -halfDepth, heightAxis, center))
  const flatTop2 = b.addVertexVec(mapLocal(halfA0, -halfA1, halfDepth, heightAxis, center))
  b.addQuad(flatBot, flatTop, flatTop2, flatBot2)

  const capPivotBot = b.addVertexVec(mapLocal(0, -halfA1, -halfDepth, heightAxis, center))
  const capPivotTop = b.addVertexVec(mapLocal(0, -halfA1, halfDepth, heightAxis, center))
  for (let i = 0; i < segs; i++) {
    b.addTriangle(capPivotBot, bot[i + 1]!, bot[i]!)
    b.addTriangle(capPivotTop, top[i]!, top[i + 1]!)
  }

  return finalize(b.build(), center)
}

export interface CadShapePrimitiveOptions {
  baseView?: ViewType | null
}

export function createCadShapePrimitive(
  type:
    | 'doughnut'
    | 'ring'
    | 'stairs'
    | 'star'
    | 'dome'
    | 'halfCircle',
  box: WorldBox,
  heightAxis: Axis,
  segments: number,
  options?: CadShapePrimitiveOptions
): MeshData {
  const { center, size } = boxCenterSize(box)
  const baseView = options?.baseView
  switch (type) {
    case 'doughnut':
      return createInscribedDoughnut(center, size, heightAxis, segments)
    case 'ring':
      return createInscribedRing(center, size, heightAxis, segments, baseView)
    case 'stairs':
      return createInscribedStairs(center, size, heightAxis, segments, baseView)
    case 'star':
      return createInscribedStar(center, size, heightAxis, segments, baseView)
    case 'dome':
      return createInscribedDome(center, size, heightAxis, segments)
    case 'halfCircle':
      return createInscribedHalfCircle(center, size, heightAxis, segments, baseView)
    default:
      return emptyMeshData()
  }
}
