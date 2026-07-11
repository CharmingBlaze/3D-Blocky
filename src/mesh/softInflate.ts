import { ensureCCW, signedArea } from './concaveTriangulate'
import { type Vec2 } from '../utils/math'
import { HalfEdgeMesh } from './HalfEdgeMesh'
import { reorientFacesOutward } from './meshWinding'
import { meshCentroid } from './MeshBuilder'

export interface SoftInflateOptions {
  depth: number
  color?: number
  /** Slices from bottom pole to top pole (more = smoother pillow). */
  rings?: number
}

function polygonCentroid(poly: Vec2[]): { x: number; y: number } {
  const area = signedArea(poly)
  if (Math.abs(area) < 1e-6) {
    return {
      x: poly.reduce((s, p) => s + p.x, 0) / poly.length,
      y: poly.reduce((s, p) => s + p.y, 0) / poly.length,
    }
  }

  let cx = 0
  let cy = 0
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length
    const cross = poly[i].x * poly[j].y - poly[j].x * poly[i].y
    cx += (poly[i].x + poly[j].x) * cross
    cy += (poly[i].y + poly[j].y) * cross
  }
  const factor = 1 / (6 * area)
  return { x: cx * factor, y: cy * factor }
}

/** Side wall between two rings; lower ring must sit at smaller Z than upper ring. */
function stitchRingsUpward(
  mesh: HalfEdgeMesh,
  ringLower: number[],
  ringUpper: number[],
  color: number
): void {
  if (ringLower.length === 1 && ringUpper.length > 1) {
    const pole = ringLower[0]
    for (let si = 0; si < ringUpper.length; si++) {
      const next = (si + 1) % ringUpper.length
      mesh.faces.push([pole, ringUpper[next], ringUpper[si]])
      mesh.faceColors.push(color)
    }
    return
  }

  if (ringUpper.length === 1 && ringLower.length > 1) {
    const pole = ringUpper[0]
    for (let si = 0; si < ringLower.length; si++) {
      const next = (si + 1) % ringLower.length
      mesh.faces.push([pole, ringLower[si], ringLower[next]])
      mesh.faceColors.push(color)
    }
    return
  }

  if (ringLower.length > 1 && ringUpper.length > 1) {
    const segments = ringLower.length
    for (let si = 0; si < segments; si++) {
      const next = (si + 1) % segments
      const lo0 = ringLower[si]!
      const lo1 = ringLower[next]!
      const hi0 = ringUpper[si]!
      const hi1 = ringUpper[next]!
      mesh.faces.push([lo0, lo1, hi1])
      mesh.faces.push([lo0, hi1, hi0])
      mesh.faceColors.push(color, color)
    }
  }
}

/**
 * Paint 3D soft doodle — solid filled pillow; only the outer shell is meshed
 * (no internal slice caps, which caused visible holes in the silhouette).
 * Rings scale radially so silhouette edges stay aligned in depth.
 */
export function generateSoftInflateDome(
  polygon: Vec2[],
  options: SoftInflateOptions
): HalfEdgeMesh {
  const poly = ensureCCW(polygon)
  const n = poly.length
  if (n < 3) return new HalfEdgeMesh()

  const { x: cx, y: cy } = polygonCentroid(poly)
  const depth = Math.max(4, options.depth)
  const color = options.color ?? 0
  const sliceCount = Math.max(4, options.rings ?? 6)

  const mesh = new HalfEdgeMesh()
  const slices: { ring: number[]; z: number }[] = []

  for (let si = 0; si <= sliceCount; si++) {
    const t = si / sliceCount
    const theta = Math.PI * (1 - t)
    const z = (depth / 2) * Math.cos(theta)
    const scale = Math.sin(theta)

    if (scale < 0.001) {
      const pole = mesh.positions.length
      mesh.positions.push({ x: cx, y: cy, z })
      slices.push({ ring: [pole], z })
      continue
    }

    const ring: number[] = []
    for (let i = 0; i < n; i++) {
      const vi = mesh.positions.length
      mesh.positions.push({
        x: cx + (poly[i]!.x - cx) * scale,
        y: cy + (poly[i]!.y - cy) * scale,
        z,
      })
      ring.push(vi)
    }
    slices.push({ ring, z })
  }

  for (let i = 0; i < slices.length - 1; i++) {
    const lower = slices[i]!
    const upper = slices[i + 1]!
    if (lower.z <= upper.z) {
      stitchRingsUpward(mesh, lower.ring, upper.ring, color)
    } else {
      stitchRingsUpward(mesh, upper.ring, lower.ring, color)
    }
  }

  mesh.buildHalfEdges()
  return reorientFacesOutward(mesh, meshCentroid(mesh.positions))
}
