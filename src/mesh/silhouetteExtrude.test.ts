import { describe, expect, it } from 'vitest'
import { HalfEdgeMesh } from './HalfEdgeMesh'
import { extrudeSilhouette, strokeToFlatOutline } from './silhouetteExtrude'
import { meshSignedVolume } from './meshWinding'
import { meshCentroid } from './MeshBuilder'
import { newellNormal } from './geometry2d'
import { ensureCCW } from './concaveTriangulate'
import type { Vec2 } from '../utils/math'

function inwardFaceCount(
  positions: { x: number; y: number; z: number }[],
  faces: number[][],
  center: { x: number; y: number; z: number }
): number {
  let inward = 0
  for (const face of faces) {
    if (face.length < 3) continue
    const a = positions[face[0]!]!
    const b = positions[face[1]!]!
    const c = positions[face[2]!]!
    const abx = b.x - a.x
    const aby = b.y - a.y
    const abz = b.z - a.z
    const acx = c.x - a.x
    const acy = c.y - a.y
    const acz = c.z - a.z
    const nx = aby * acz - abz * acy
    const ny = abz * acx - abx * acz
    const nz = abx * acy - aby * acx
    let cx = 0
    let cy = 0
    let cz = 0
    for (const vi of face) {
      const p = positions[vi]!
      cx += p.x
      cy += p.y
      cz += p.z
    }
    const inv = 1 / face.length
    cx = cx * inv - center.x
    cy = cy * inv - center.y
    cz = cz * inv - center.z
    if (nx * cx + ny * cy + nz * cz < 0) inward++
  }
  return inward
}

/**
 * Geometric outward check for local-space extrusions (XY silhouette, ±Z depth).
 * Avoids mesh-centroid tests — those lie outside concave open-stroke ribbons
 * and falsely flag correctly wound faces (the previous false-green regression).
 */
function countGeometricallyInwardFaces(
  mesh: HalfEdgeMesh,
  polygon: Vec2[]
): { caps: number; walls: number } {
  const poly = ensureCCW(polygon)
  const n = poly.length
  let caps = 0
  let walls = 0

  expect(mesh.faces.length).toBe(n + 2)

  const frontN = newellNormal(mesh.faces[0]!.map((vi) => mesh.positions[vi]!))
  const backN = newellNormal(mesh.faces[1]!.map((vi) => mesh.positions[vi]!))
  if (frontN.z <= 0) caps++
  if (backN.z >= 0) caps++

  for (let i = 0; i < n; i++) {
    const face = mesh.faces[2 + i]!
    const normal = newellNormal(face.map((vi) => mesh.positions[vi]!))
    // +Z corners in face order encode the boundary walk (works before/after global flip).
    const ordered: number[] = []
    for (const vi of face) {
      if (mesh.positions[vi]!.z > 0) ordered.push(vi % n)
    }
    expect(ordered.length).toBe(2)
    const a = ordered[0]!
    const b = ordered[1]!
    const ex = poly[b]!.x - poly[a]!.x
    const ey = poly[b]!.y - poly[a]!.y
    // CCW silhouette: outward is rotate(edge, 90° CW) = (ey, -ex).
    if (normal.x * ey + normal.y * -ex <= 0) walls++
  }
  return { caps, walls }
}

describe('extrudeSilhouette CAD-style topology', () => {
  it('stores n-gon caps and quad side walls for a rectangle', () => {
    const rect = [
      { x: -10, y: -5 },
      { x: 10, y: -5 },
      { x: 10, y: 5 },
      { x: -10, y: 5 },
    ]
    const mesh = extrudeSilhouette(rect, { depth: 12, color: 0xabcdef })
    expect(mesh.positions.length).toBe(8)
    expect(mesh.faces.length).toBe(6)
    expect(mesh.faces.filter((f) => f.length === 4).length).toBe(6)
    expect(mesh.faceColors.every((c) => c === 0xabcdef)).toBe(true)

    const center = meshCentroid(mesh.positions)
    expect(inwardFaceCount(mesh.positions, mesh.faces, center)).toBe(0)
    expect(meshSignedVolume(mesh)).toBeGreaterThan(0)

    // Flat shading duplicates one corner set per face — like a CAD box.
    // 6 quads × 4 corners = 24 render verts
    const data = mesh.toMeshData(true)
    expect(data.positions.length / 3).toBe(24)
  })

  it('keeps a concave n-gon as a single cap face', () => {
    const L = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 8 },
      { x: 8, y: 8 },
      { x: 8, y: 20 },
      { x: 0, y: 20 },
    ]
    const mesh = extrudeSilhouette(L, { depth: 6 })
    expect(mesh.positions.length).toBe(12)
    const caps = mesh.faces.filter((f) => f.length === 6)
    expect(caps.length).toBe(2)
    expect(mesh.faces.filter((f) => f.length === 4).length).toBe(6)
    expect(meshSignedVolume(mesh)).toBeGreaterThan(0)
  })

  it('builds a ribbon outline from an open stroke', () => {
    const path = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    ]
    const outline = strokeToFlatOutline(path, 2)
    expect(outline).not.toBeNull()
    expect(outline!.length).toBe(6)
    const mesh = extrudeSilhouette(outline!, { depth: 4 })
    expect(mesh.faces.some((f) => f.length >= 4)).toBe(true)
    expect(HalfEdgeMesh.fromObject(mesh.toObject('t', 't')).faces.length).toBeGreaterThan(2)
  })

  it('open stroke ribbon keeps outward bottom/top caps and walls (single-sided safe)', () => {
    // Dense curved path — first 3 ribbon verts are nearly collinear (old Newell bug).
    const path: { x: number; y: number }[] = []
    for (let i = 0; i < 24; i++) {
      path.push({ x: i * 3, y: Math.sin(i * 0.35) * 10 })
    }
    const ribbon = strokeToFlatOutline(path, 5)
    expect(ribbon).not.toBeNull()
    const mesh = extrudeSilhouette(ribbon!, { depth: 16 })
    expect(meshSignedVolume(mesh)).toBeGreaterThan(0)

    const caps = mesh.faces.filter((f) => f.length > 4)
    expect(caps.length).toBe(2)

    const inward = countGeometricallyInwardFaces(mesh, ribbon!)
    expect(inward.caps).toBe(0)
    expect(inward.walls).toBe(0)
  })

  it('concave open arc ribbon stays outward even when mesh centroid is outside', () => {
    // C-arc: vertex centroid lies outside the thin ribbon — the old
    // reorientFacesOutward(centroid) heuristic flipped walls/caps wrongly.
    const path: { x: number; y: number }[] = []
    for (let i = 0; i <= 40; i++) {
      const t = (i / 40) * Math.PI * 1.2
      path.push({ x: Math.cos(t) * 40, y: Math.sin(t) * 40 })
    }
    const ribbon = strokeToFlatOutline(path, 3)
    expect(ribbon).not.toBeNull()
    const mesh = extrudeSilhouette(ribbon!, { depth: 16 })
    expect(meshSignedVolume(mesh)).toBeGreaterThan(0)

    const center = meshCentroid(mesh.positions)
    const inside2d = (() => {
      // Ray-cast centroid against ribbon polygon.
      const p = { x: center.x, y: center.y }
      let inside = false
      for (let i = 0, j = ribbon!.length - 1; i < ribbon!.length; j = i++) {
        const pi = ribbon![i]!
        const pj = ribbon![j]!
        if (
          pi.y > p.y !== pj.y > p.y &&
          p.x < ((pj.x - pi.x) * (p.y - pi.y)) / (pj.y - pi.y) + pi.x
        ) {
          inside = !inside
        }
      }
      return inside
    })()
    expect(inside2d).toBe(false)

    const inward = countGeometricallyInwardFaces(mesh, ribbon!)
    expect(inward.caps).toBe(0)
    expect(inward.walls).toBe(0)
  })
})
