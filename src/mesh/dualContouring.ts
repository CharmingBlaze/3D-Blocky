import { type Vec3 } from '../utils/math'
import { HalfEdgeMesh } from './HalfEdgeMesh'
import { meshSafetyPass } from './meshSafety'

export interface ScalarGrid3D {
  origin: Vec3
  spacing: Vec3
  nx: number
  ny: number
  nz: number
  /** Corner samples: (nx+1) × (ny+1) × (nz+1), negative inside */
  values: Float32Array
}

export interface DualContourOptions {
  isoValue?: number
  color?: number
}

function cornerIdx(i: number, j: number, k: number, nx: number, ny: number): number {
  return i + (nx + 1) * j + (nx + 1) * (ny + 1) * k
}

function cornerPos(grid: ScalarGrid3D, i: number, j: number, k: number): Vec3 {
  return {
    x: grid.origin.x + i * grid.spacing.x,
    y: grid.origin.y + j * grid.spacing.y,
    z: grid.origin.z + k * grid.spacing.z,
  }
}

function edgeCrossing(p0: Vec3, p1: Vec3, v0: number, v1: number, iso: number): Vec3 | null {
  if ((v0 <= iso && v1 <= iso) || (v0 > iso && v1 > iso)) return null
  const denom = v1 - v0
  const t = Math.abs(denom) < 1e-12 ? 0.5 : (iso - v0) / denom
  const s = Math.max(0, Math.min(1, t))
  return {
    x: p0.x + (p1.x - p0.x) * s,
    y: p0.y + (p1.y - p0.y) * s,
    z: p0.z + (p1.z - p0.z) * s,
  }
}

function cubeKey(i: number, j: number, k: number): string {
  return `${i},${j},${k}`
}

/**
 * Dual contouring / surface nets — closed manifold surface from scalar field.
 * Produces low-poly facets without triangulation-extrusion artifacts.
 */
export function extractDualContour(
  grid: ScalarGrid3D,
  options: DualContourOptions = {}
): HalfEdgeMesh {
  const { isoValue = 0, color = 0x7ecba1 } = options
  const mesh = new HalfEdgeMesh()
  const { nx, ny, nz, values } = grid

  const cubeVerts = new Map<string, number>()

  const sample = (i: number, j: number, k: number): number => {
    if (i < 0 || j < 0 || k < 0 || i > nx || j > ny || k > nz) return 1
    return values[cornerIdx(i, j, k, nx, ny)]
  }

  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const corners = [
          sample(i, j, k),
          sample(i + 1, j, k),
          sample(i, j + 1, k),
          sample(i + 1, j + 1, k),
          sample(i, j, k + 1),
          sample(i + 1, j, k + 1),
          sample(i, j + 1, k + 1),
          sample(i + 1, j + 1, k + 1),
        ]

        const inside = corners.some((v) => v <= isoValue)
        const outside = corners.some((v) => v > isoValue)
        if (!inside || !outside) continue

        const c000 = cornerPos(grid, i, j, k)
        const c100 = cornerPos(grid, i + 1, j, k)
        const c010 = cornerPos(grid, i, j + 1, k)
        const c110 = cornerPos(grid, i + 1, j + 1, k)
        const c001 = cornerPos(grid, i, j, k + 1)
        const c101 = cornerPos(grid, i + 1, j, k + 1)
        const c011 = cornerPos(grid, i, j + 1, k + 1)
        const c111 = cornerPos(grid, i + 1, j + 1, k + 1)

        const crossings: Vec3[] = []
        const edges: [Vec3, Vec3, number, number][] = [
          [c000, c100, corners[0], corners[1]],
          [c010, c110, corners[2], corners[3]],
          [c001, c101, corners[4], corners[5]],
          [c011, c111, corners[6], corners[7]],
          [c000, c010, corners[0], corners[2]],
          [c100, c110, corners[1], corners[3]],
          [c101, c111, corners[5], corners[7]],
          [c001, c011, corners[4], corners[6]],
          [c000, c001, corners[0], corners[4]],
          [c100, c101, corners[1], corners[5]],
          [c110, c111, corners[3], corners[7]],
          [c010, c011, corners[2], corners[6]],
        ]

        for (const [p0, p1, v0, v1] of edges) {
          const c = edgeCrossing(p0, p1, v0, v1, isoValue)
          if (c) crossings.push(c)
        }

        if (crossings.length === 0) continue

        const vtx = crossings.reduce(
          (acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y, z: acc.z + p.z }),
          { x: 0, y: 0, z: 0 }
        )
        vtx.x /= crossings.length
        vtx.y /= crossings.length
        vtx.z /= crossings.length

        cubeVerts.set(cubeKey(i, j, k), mesh.positions.length)
        mesh.positions.push(vtx)
      }
    }
  }

  const getCube = (i: number, j: number, k: number): number | null => {
    if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return null
    return cubeVerts.get(cubeKey(i, j, k)) ?? null
  }

  const pushQuad = (a: number, b: number, c: number, d: number) => {
    mesh.faces.push([a, b, c])
    mesh.faces.push([a, c, d])
    mesh.faceColors.push(color, color)
  }

  const pushTri = (a: number, b: number, c: number) => {
    mesh.faces.push([a, b, c])
    mesh.faceColors.push(color)
  }

  const edgeCrosses = (v0: number, v1: number): boolean =>
    (v0 <= isoValue && v1 > isoValue) || (v0 > isoValue && v1 <= isoValue)

  for (let k = 0; k <= nz; k++) {
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i < nx; i++) {
        if (!edgeCrosses(sample(i, j, k), sample(i + 1, j, k))) continue
        const q = [
          getCube(i, j, k),
          getCube(i, j - 1, k),
          getCube(i, j - 1, k - 1),
          getCube(i, j, k - 1),
        ].filter((v): v is number => v !== null)
        if (q.length === 4) pushQuad(q[0], q[1], q[2], q[3])
        else if (q.length === 3) pushTri(q[0], q[1], q[2])
      }
    }
  }

  for (let k = 0; k <= nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i <= nx; i++) {
        if (!edgeCrosses(sample(i, j, k), sample(i, j + 1, k))) continue
        const q = [
          getCube(i, j, k),
          getCube(i - 1, j, k),
          getCube(i - 1, j, k - 1),
          getCube(i, j, k - 1),
        ].filter((v): v is number => v !== null)
        if (q.length === 4) pushQuad(q[0], q[3], q[2], q[1])
        else if (q.length === 3) pushTri(q[0], q[2], q[1])
      }
    }
  }

  for (let k = 0; k < nz; k++) {
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i <= nx; i++) {
        if (!edgeCrosses(sample(i, j, k), sample(i, j, k + 1))) continue
        const q = [
          getCube(i, j, k),
          getCube(i - 1, j, k),
          getCube(i - 1, j - 1, k),
          getCube(i, j - 1, k),
        ].filter((v): v is number => v !== null)
        if (q.length === 4) pushQuad(q[0], q[1], q[2], q[3])
        else if (q.length === 3) pushTri(q[0], q[1], q[2])
      }
    }
  }

  removeDegenerateFaces(mesh)
  meshSafetyPass(mesh)
  return mesh
}

function removeDegenerateFaces(mesh: HalfEdgeMesh): void {
  const validFaces: number[][] = []
  const validColors: number[] = []
  for (let fi = 0; fi < mesh.faces.length; fi++) {
    const f = mesh.faces[fi]
    if (f.length < 3) continue
    const a = mesh.positions[f[0]]
    const b = mesh.positions[f[1]]
    const c = mesh.positions[f[2]]
    const ab = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }
    const ac = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z }
    const nx = ab.y * ac.z - ab.z * ac.y
    const ny = ab.z * ac.x - ab.x * ac.z
    const nz = ab.x * ac.y - ab.y * ac.x
    if (Math.hypot(nx, ny, nz) < 1e-10) continue
    validFaces.push(f)
    validColors.push(mesh.faceColors[fi] ?? 0x7ecba1)
  }
  mesh.faces = validFaces
  mesh.faceColors = validColors
}

/** Sample scalar field onto a uniform 3D grid */
export function buildScalarGrid3D(
  field: (x: number, y: number, z: number) => number,
  bounds: { minX: number; minY: number; maxX: number; maxY: number; maxZ: number },
  resolution: number
): ScalarGrid3D {
  const spanX = bounds.maxX - bounds.minX
  const spanY = bounds.maxY - bounds.minY
  const spanZ = bounds.maxZ * 2
  const nx = resolution
  const ny = resolution
  const aspectZ = spanZ / Math.max(spanX, spanY, 1)
  const nz = Math.max(4, Math.min(resolution, Math.round(resolution * aspectZ)))

  const spacing = {
    x: spanX / nx,
    y: spanY / ny,
    z: spanZ / nz,
  }
  const origin = {
    x: bounds.minX,
    y: bounds.minY,
    z: -bounds.maxZ,
  }

  const values = new Float32Array((nx + 1) * (ny + 1) * (nz + 1))
  let idx = 0
  for (let k = 0; k <= nz; k++) {
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i <= nx; i++) {
        const x = origin.x + i * spacing.x
        const y = origin.y + j * spacing.y
        const z = origin.z + k * spacing.z
        values[idx++] = field(x, y, z)
      }
    }
  }

  return { origin, spacing, nx, ny, nz, values }
}
