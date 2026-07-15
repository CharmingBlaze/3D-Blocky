import { ensureCCW, signedArea } from './concaveTriangulate'
import { type Vec2 } from '../utils/math'
import { HalfEdgeMesh } from './HalfEdgeMesh'
import { ensurePositiveVolume } from './meshWinding'

export interface SoftInflateOptions {
  depth: number
  color?: number
  /** Slices from bottom pole to top pole (more = smoother pillow). */
  rings?: number
  /** 0 = restrained/flat shoulder, 1 = full rounded pillow. */
  inflation?: number
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
      // One editable quad per boundary segment. The renderer triangulates this
      // internally, while the authored mesh stays Blockbench/game friendly.
      mesh.faces.push([lo0, lo1, hi1, hi0])
      mesh.faceColors.push(color)
    }
  }
}

/**
 * Paint 3D soft doodle — a low/mid-poly inflated shell made from matched quad
 * rings and two compact polygon caps. Avoids high-valence poles and long triangle
 * fans, producing topology that remains practical to edit or export to games.
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
  // Keep a small cap footprint instead of collapsing every edge into one pole.
  // This distributes curvature over quads and removes the starburst topology.
  const inflation = Math.max(0, Math.min(1, options.inflation ?? 0.65))
  const capScale = 0.34 + (0.08 - 0.34) * inflation
  const profilePower = 1.45 + (0.52 - 1.45) * inflation

  for (let si = 0; si <= sliceCount; si++) {
    const t = si / sliceCount
    const theta = Math.PI * (1 - t)
    const z = (depth / 2) * Math.cos(theta)
    const scale = capScale + (1 - capScale) * Math.pow(Math.sin(theta), profilePower)

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

  // A large smooth-shaded n-gon produces visible diagonal/star pinching because
  // its boundary normals are interpolated across the renderer's triangulation.
  // Insert one compact transition ring on each side so that interpolation is
  // carried by predictable quads, then finish on a shared center vertex. This
  // gives the cap a stable center normal without a renderer-dependent n-gon.
  const bottom = slices[0]!.ring
  const top = slices[slices.length - 1]!.ring
  const innerScale = capScale * 0.22
  const bottomInner: number[] = []
  const topInner: number[] = []
  for (let i = 0; i < n; i++) {
    bottomInner.push(mesh.positions.length)
    mesh.positions.push({
      x: cx + (poly[i]!.x - cx) * innerScale,
      y: cy + (poly[i]!.y - cy) * innerScale,
      z: -depth / 2,
    })
    topInner.push(mesh.positions.length)
    mesh.positions.push({
      x: cx + (poly[i]!.x - cx) * innerScale,
      y: cy + (poly[i]!.y - cy) * innerScale,
      z: depth / 2,
    })
  }

  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n
    mesh.faces.push([bottom[i]!, bottomInner[i]!, bottomInner[next]!, bottom[next]!])
    mesh.faceColors.push(color)
    mesh.faces.push([top[i]!, top[next]!, topInner[next]!, topInner[i]!])
    mesh.faceColors.push(color)
  }

  const bottomCenter = mesh.positions.length
  mesh.positions.push({ x: cx, y: cy, z: -depth / 2 })
  const topCenter = mesh.positions.length
  mesh.positions.push({ x: cx, y: cy, z: depth / 2 })
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n
    mesh.faces.push([bottomCenter, bottomInner[next]!, bottomInner[i]!])
    mesh.faceColors.push(color)
    mesh.faces.push([topCenter, topInner[i]!, topInner[next]!])
    mesh.faceColors.push(color)
  }

  mesh.buildHalfEdges()
  // Ring construction already gives every adjacent face consistent winding.
  // Only flip the complete closed shell if projection changed handedness; never
  // flip individual faces against a centroid (invalid for concave blobs).
  return ensurePositiveVolume(mesh)
}
