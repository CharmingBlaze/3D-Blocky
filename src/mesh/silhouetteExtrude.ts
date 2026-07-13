import { earClipTriangulate, ensureCCW } from './concaveTriangulate'
import { type Vec2 } from '../utils/math'
import { HalfEdgeMesh } from './HalfEdgeMesh'
import { ensurePositiveVolume } from './meshWinding'

function triangulatePolygon(poly: Vec2[]): [number, number, number][] {
  const triangles = earClipTriangulate(poly)
  if (triangles.length >= poly.length - 2) return triangles

  const fallback: [number, number, number][] = []
  for (let i = 1; i < poly.length - 1; i++) {
    fallback.push([0, i, i + 1])
  }
  return fallback.length > 0 ? fallback : triangles
}

export { triangulatePolygon }

export interface SilhouetteExtrudeOptions {
  depth: number
  color?: number
}

/** Build a closed 2D outline from an open stroke for flat extrusion. */
export function strokeToFlatOutline(points: Vec2[], halfWidth: number): Vec2[] | null {
  if (points.length < 2 || halfWidth <= 0) return null

  const left: Vec2[] = []
  const right: Vec2[] = []

  for (let i = 0; i < points.length; i++) {
    const prev = points[Math.max(0, i - 1)]
    const curr = points[i]
    const next = points[Math.min(points.length - 1, i + 1)]

    let tx = next.x - prev.x
    let ty = next.y - prev.y
    let len = Math.hypot(tx, ty)
    if (len < 1e-8) {
      tx = next.x - curr.x
      ty = next.y - curr.y
      len = Math.hypot(tx, ty) || 1
    }
    tx /= len
    ty /= len

    const nx = -ty
    const ny = tx

    left.push({ x: curr.x + nx * halfWidth, y: curr.y + ny * halfWidth })
    right.push({ x: curr.x - nx * halfWidth, y: curr.y - ny * halfWidth })
  }

  return [...left, ...right.reverse()]
}

/**
 * Extrude a concave 2D silhouette into a 3D solid (canonical XY plane, depth along local Z).
 * Stores CAD-style topology: one n-gon per cap + one quad per side wall.
 * Triangulation is deferred to render/export (same as primitive boxes).
 */
export function extrudeSilhouette(
  polygon: Vec2[],
  options: SilhouetteExtrudeOptions
): HalfEdgeMesh {
  const { depth, color = 0x7ecba1 } = options
  const poly = ensureCCW(polygon)
  const mesh = new HalfEdgeMesh()
  const half = depth / 2

  if (poly.length < 3) return mesh

  const n = poly.length
  const frontOffset = 0
  const backOffset = n

  for (let i = 0; i < n; i++) {
    mesh.positions.push({ x: poly[i].x, y: poly[i].y, z: half })
  }
  for (let i = 0; i < n; i++) {
    mesh.positions.push({ x: poly[i].x, y: poly[i].y, z: -half })
  }

  // Cap faces as single planar n-gons (front CCW from +Z, back reversed).
  const frontCap: number[] = []
  const backCap: number[] = []
  for (let i = 0; i < n; i++) {
    frontCap.push(frontOffset + i)
    backCap.push(backOffset + (n - 1 - i))
  }
  mesh.faces.push(frontCap, backCap)
  mesh.faceColors.push(color, color)

  // Side walls — one quad per boundary edge (shared verts with caps).
  // CCW silhouette: walk front i→j then down; outward is rotate(edge, +90° CW) in XY,
  // so winding must be [f0, b0, b1, f1]. The old [f0, f1, b1, b0] pointed inward.
  // Do NOT reorientFacesOutward(centroid) here — ribbon centroids often lie outside
  // concave outlines and that heuristic flips walls/caps incorrectly under single-sided.
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const f0 = frontOffset + i
    const f1 = frontOffset + j
    const b0 = backOffset + i
    const b1 = backOffset + j
    mesh.faces.push([f0, b0, b1, f1])
    mesh.faceColors.push(color)
  }

  mesh.buildHalfEdges()
  return ensurePositiveVolume(mesh)
}

/** Merge multiple lobe meshes into one */
export function mergeMeshes(meshes: HalfEdgeMesh[], color = 0x7ecba1): HalfEdgeMesh {
  const result = new HalfEdgeMesh()
  for (const m of meshes) {
    const base = result.positions.length
    for (const p of m.positions) {
      result.positions.push({ ...p })
    }
    for (let fi = 0; fi < m.faces.length; fi++) {
      result.faces.push(m.faces[fi].map((vi) => vi + base))
      result.faceColors.push(m.faceColors[fi] ?? color)
    }
  }
  result.buildHalfEdges()
  return result
}

/**
 * Full concave silhouette pipeline: extrude per lobe + merge.
 */
export function generateConcaveSilhouette(
  lobes: Vec2[][],
  depth: number,
  color = 0x7ecba1
): HalfEdgeMesh {
  const parts = lobes.map((lobe) =>
    extrudeSilhouette(lobe, { depth, color })
  )
  return parts.length === 1 ? parts[0] : mergeMeshes(parts, color)
}
