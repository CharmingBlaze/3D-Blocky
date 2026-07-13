import { describe, expect, it } from 'vitest'
import { HalfEdgeMesh } from '../mesh/HalfEdgeMesh'
import { countNakedEdges, meshSignedVolume } from '../mesh/meshWinding'
import { strokeToMesh } from '../stroke/strokeToMesh'
import {
  prepareOutlineBoundary,
  PATH_SPINE_HARD_CAP,
  preparePathCenterline,
  regenerateSketchObjectFromSource,
} from './sketchSource'
import { vectorPathToMesh } from '../vector/vectorPathToMesh'
import type { VectorPath } from '../vector/types'

const square = [
  { x: -30, y: -30 },
  { x: 30, y: -30 },
  { x: 30, y: 30 },
  { x: -30, y: 30 },
  { x: -30, y: -30 },
]

/** Distinctive non-convex freehand-like loop (star-ish notch). */
const jaggedLoop = [
  { x: 0, y: 40 },
  { x: 12, y: 18 },
  { x: 38, y: 18 },
  { x: 18, y: 0 },
  { x: 24, y: -28 },
  { x: 0, y: -12 },
  { x: -24, y: -28 },
  { x: -18, y: 0 },
  { x: -38, y: 18 },
  { x: -12, y: 18 },
  { x: 0, y: 40 },
]

const base = {
  points: square,
  view: 'front' as const,
  polyBudget: 128,
  brushDensity: 12,
  rdpTolerance: 2,
  closeThreshold: 12,
  defaultDepth: 0,
  color: 0xff0000,
}

describe('outline vs blob stroke modes', () => {
  it('outline fills a flat silhouette, blob fills soft volume', () => {
    const outline = strokeToMesh({ ...base, strokeMode: 'outline' })
    const blob = strokeToMesh({ ...base, strokeMode: 'blob' })
    expect(outline?.name).toBe('Outline')
    expect(outline?.sketchSource?.kind).toBe('outline')
    expect(blob?.name).toBe('Blob')
    expect(blob?.sketchSource?.kind).toBe('soft')
    expect(outline!.positions.length).not.toBe(blob!.positions.length)
    // Clean square → 4 boundary × 2 faces.
    expect(outline!.positions.length).toBe(8)
  })

  it('extrude builds a flat silhouette prism for both modes', () => {
    const extrude = strokeToMesh({
      ...base,
      strokeMode: 'outline',
      extrudeMode: true,
      extrudeAmount: 10,
    })
    const blobExtrude = strokeToMesh({
      ...base,
      strokeMode: 'blob',
      extrudeMode: true,
      extrudeAmount: 10,
    })
    expect(extrude?.name).toBe('Extrude')
    expect(blobExtrude?.name).toBe('Extrude')
    expect(extrude!.positions.length).toBe(blobExtrude!.positions.length)
    // Square → 4 boundary × 2 caps = 8 verts; 2 n-gon caps + 4 side quads.
    expect(extrude!.positions.length).toBe(8)
    expect(extrude!.faces.length).toBe(6)
    expect(extrude!.faces.filter((f) => f.length === 4).length).toBe(6)
  })

  it('keeps key vertices of a non-convex outline instead of collapsing', () => {
    const outline = strokeToMesh({
      ...base,
      points: jaggedLoop,
      strokeMode: 'outline',
    })
    expect(outline).not.toBeNull()
    expect(outline!.sketchSource?.kind).toBe('outline')
    // Front+back copies of the boundary — must keep the notch tips, not a triangle.
    const boundaryVerts = outline!.positions.length / 2
    expect(boundaryVerts).toBeGreaterThanOrEqual(8)
    expect(outline!.faces.some((f) => f.length >= 8)).toBe(true)

    const prepared = prepareOutlineBoundary(
      jaggedLoop.slice(0, -1).map((p) => ({ x: p.x, y: p.y })),
      128,
      true
    )
    expect(prepared).not.toBeNull()
    expect(prepared!.length).toBeGreaterThanOrEqual(8)
    // Tip near (0, 40) should survive light cleanup.
    expect(prepared!.some((p) => Math.hypot(p.x - 0, p.y - 40) < 1.5)).toBe(true)
    // Inner notch tip near (0, -12) should survive (would vanish if collapsed to hull/triangle).
    expect(prepared!.some((p) => Math.hypot(p.x - 0, p.y + 12) < 1.5)).toBe(true)
  })

  it('does not hard-cap a dense freehand outline to ~20 verts', () => {
    const dense: { x: number; y: number }[] = []
    for (let i = 0; i < 48; i++) {
      const t = (i / 48) * Math.PI * 2
      const r = 30 + 8 * Math.sin(t * 5)
      dense.push({ x: Math.cos(t) * r, y: Math.sin(t) * r })
    }
    dense.push(dense[0]!)
    const outline = strokeToMesh({
      ...base,
      points: dense,
      strokeMode: 'outline',
    })
    expect(outline).not.toBeNull()
    const boundaryVerts = outline!.positions.length / 2
    expect(boundaryVerts).toBeGreaterThan(20)
  })

  /** Dense smooth freehand: consecutive turns stay under ~3° (old 4° sampler crushed these). */
  function smoothWavyLoop(count: number): { x: number; y: number }[] {
    const pts: { x: number; y: number }[] = []
    for (let i = 0; i < count; i++) {
      const t = (i / count) * Math.PI * 2
      // Low-frequency wave — gentle bends, not sharp corners.
      const r = 40 + 6 * Math.sin(t * 3) + 3 * Math.sin(t * 7)
      pts.push({ x: Math.cos(t) * r, y: Math.sin(t) * r })
    }
    return pts
  }

  function maxPointToPolylineDist(
    points: { x: number; y: number }[],
    poly: { x: number; y: number }[]
  ): number {
    const n = poly.length
    let maxDist = 0
    for (const p of points) {
      let best = Infinity
      for (let i = 0; i < n; i++) {
        const a = poly[i]!
        const b = poly[(i + 1) % n]!
        const abx = b.x - a.x
        const aby = b.y - a.y
        const len2 = abx * abx + aby * aby
        let t = 0
        if (len2 > 1e-12) {
          t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / len2))
        }
        const qx = a.x + abx * t
        const qy = a.y + aby * t
        best = Math.min(best, Math.hypot(p.x - qx, p.y - qy))
      }
      maxDist = Math.max(maxDist, best)
    }
    return maxDist
  }

  it('keeps a smooth freehand outline close to the stroke (not a jagged coarse polygon)', () => {
    const loop = smoothWavyLoop(120)
    const prepared = prepareOutlineBoundary(loop, 128, true)
    expect(prepared).not.toBeNull()
    // Old 4°/18° curvature sampling + polyBudget/2 left ~15–30 verts → blocky silhouette.
    expect(prepared!.length).toBeGreaterThan(90)
    // Hausdorff-style: every input sample stays near the prepared boundary.
    expect(maxPointToPolylineDist(loop, prepared!)).toBeLessThan(0.75)

    const outline = strokeToMesh({
      ...base,
      points: [...loop, loop[0]!],
      strokeMode: 'outline',
      extrudeAmount: 16,
    })
    expect(outline).not.toBeNull()
    const boundaryVerts = outline!.positions.length / 2
    expect(boundaryVerts).toBeGreaterThan(60)
    expect(outline!.faces.some((f) => f.length > 60)).toBe(true)

    // Editable Sketch regenerate must not re-decimate the silhouette.
    const regen = regenerateSketchObjectFromSource(outline!, {
      polyBudget: 128,
      extrudeDepth: 16,
    })!
    expect(regen.positions.length / 2).toBeGreaterThan(60)
    expect(regen.sketchSource?.relative.length).toBeGreaterThan(60)
  })

  it('extrude outline also preserves smooth freehand boundary fidelity', () => {
    const loop = smoothWavyLoop(100)
    const extrude = strokeToMesh({
      ...base,
      points: [...loop, loop[0]!],
      strokeMode: 'outline',
      extrudeMode: true,
      extrudeAmount: 16,
    })
    expect(extrude).not.toBeNull()
    expect(extrude!.name).toBe('Extrude')
    const boundaryVerts = extrude!.positions.length / 2
    expect(boundaryVerts).toBeGreaterThan(50)
    // Cap face should be the dense n-gon, not a coarse fan proxy.
    expect(extrude!.faces.some((f) => f.length > 50)).toBe(true)
  })

  it('open outline ribbon has outward-facing bottom under single-sided shading', () => {
    // Gentle sine + C-arc (centroid outside) — Outline Path commit across ortho views.
    const sine: { x: number; y: number }[] = []
    for (let i = 0; i < 30; i++) {
      sine.push({ x: i * 4, y: Math.sin(i * 0.4) * 12 })
    }
    const arc: { x: number; y: number }[] = []
    for (let i = 0; i <= 40; i++) {
      const t = (i / 40) * Math.PI * 1.2
      arc.push({ x: Math.cos(t) * 40, y: Math.sin(t) * 40 })
    }

    for (const points of [sine, arc]) {
      for (const view of ['front', 'right', 'top'] as const) {
        const outline = strokeToMesh({
          ...base,
          points,
          view,
          strokeMode: 'outline',
          extrudeMode: true,
          extrudeAmount: 16,
        })
        expect(outline).not.toBeNull()
        expect(outline!.name).toBe('Outline Path')
        expect(outline!.sketchSource?.kind).toBe('outline')
        expect(outline!.sketchSource?.isClosed).toBe(false)

        const mesh = HalfEdgeMesh.fromObject(outline!)
        // Closed prism with consistent outward winding ⇒ positive volume.
        // Do not use mesh-centroid face tests — concave ribbon centroids lie outside
        // the solid and falsely flag correct bottoms/walls (previous false-green).
        expect(countNakedEdges(mesh)).toBe(0)
        expect(meshSignedVolume(mesh)).toBeGreaterThan(0)

        // Two n-gon caps (top/bottom) plus one quad per boundary edge.
        const caps = mesh.faces.filter((f) => f.length > 4)
        expect(caps.length).toBe(2)
        expect(mesh.faces.filter((f) => f.length === 4).length).toBe(caps[0]!.length)
      }
    }
  })

  it('regenerate keeps open outline ribbon outward under single-sided shading', () => {
    const path: { x: number; y: number }[] = []
    for (let i = 0; i <= 36; i++) {
      const t = (i / 36) * Math.PI * 1.1
      path.push({ x: Math.cos(t) * 35, y: Math.sin(t) * 35 })
    }
    const original = strokeToMesh({
      ...base,
      points: path,
      view: 'right',
      strokeMode: 'outline',
      extrudeMode: true,
      extrudeAmount: 16,
    })!
    const regen = regenerateSketchObjectFromSource(original, { extrudeDepth: 16 })!
    const mesh = HalfEdgeMesh.fromObject(regen)
    expect(meshSignedVolume(mesh)).toBeGreaterThan(0)
    expect(regen.name).toBe('Outline Path')
  })

  it('regenerates retained sketch parameters without changing object identity', () => {
    const original = strokeToMesh({ ...base, strokeMode: 'blob' })!
    const updated = regenerateSketchObjectFromSource(original, {
      brushDensity: 20,
      polyBudget: 196,
      extrudeDepth: 22,
    })!
    expect(updated.id).toBe(original.id)
    expect(updated.sketchSource?.brushDensity).toBe(20)
    expect(updated.sketchSource?.polyBudget).toBe(196)
    expect(updated.sketchSource?.extrudeDepth).toBe(22)
  })

  it('Sketch Path stays a tube with quad rings and flat n-gon caps', () => {
    const path: { x: number; y: number }[] = []
    for (let i = 0; i <= 24; i++) {
      const t = i / 24
      path.push({ x: t * 80, y: Math.sin(t * Math.PI * 1.5) * 18 })
    }

    const obj = strokeToMesh({
      ...base,
      points: path,
      strokeMode: 'centerline',
      brushDensity: 14,
    })
    expect(obj).not.toBeNull()
    expect(obj!.name).toBe('Path')
    expect(obj!.sketchSource?.kind).toBe('path')
    expect(obj!.sketchSource?.isClosed).toBe(false)

    const mesh = HalfEdgeMesh.fromObject(obj!)
    expect(countNakedEdges(mesh)).toBe(0)
    expect(meshSignedVolume(mesh)).toBeGreaterThan(0)

    const tris = mesh.faces.filter((f) => f.length === 3)
    const quads = mesh.faces.filter((f) => f.length === 4)
    const caps = mesh.faces.filter((f) => f.length > 4)
    expect(tris.length).toBe(0)
    expect(caps.length).toBe(2)
    expect(quads.length).toBe(mesh.faces.length - 2)

    // Tube radius tracks brush density (not a flat ribbon extrusion).
    const ys = obj!.positions.map((p) => p.y)
    const zs = obj!.positions.map((p) => p.z)
    const spanY = Math.max(...ys) - Math.min(...ys)
    const spanZ = Math.max(...zs) - Math.min(...zs)
    expect(spanZ).toBeGreaterThan(8)
    expect(spanY).toBeGreaterThan(spanZ * 0.5)

    const regen = regenerateSketchObjectFromSource(obj!, { brushDensity: 20 })!
    expect(regen.name).toBe('Path')
    expect(regen.sketchSource?.kind).toBe('path')
    const regenMesh = HalfEdgeMesh.fromObject(regen)
    expect(regenMesh.faces.filter((f) => f.length === 3).length).toBe(0)
    expect(regenMesh.faces.filter((f) => f.length > 4).length).toBe(2)
  })

  it('Sketch Path keeps enough rings to follow a curved stroke at poly budget 128', () => {
    const path: { x: number; y: number }[] = []
    for (let i = 0; i <= 60; i++) {
      const t = i / 60
      path.push({ x: t * 120, y: Math.sin(t * Math.PI * 2) * 28 })
    }

    const prepared = preparePathCenterline(
      path.map((p) => ({ x: p.x - 60, y: p.y })),
      128
    )
    expect(prepared).not.toBeNull()
    // Lower-mid budget (~56), still far above old 12–14° collapse (~2–5).
    expect(prepared!.length).toBeGreaterThan(24)
    expect(prepared!.length).toBeLessThanOrEqual(PATH_SPINE_HARD_CAP)
    expect(maxPointToPolylineDist(path.map((p) => ({ x: p.x - 60, y: p.y })), prepared!)).toBeLessThan(
      1.25
    )

    const obj = strokeToMesh({
      ...base,
      points: path,
      strokeMode: 'centerline',
      polyBudget: 128,
      brushDensity: 12,
    })
    expect(obj).not.toBeNull()

    const mesh = HalfEdgeMesh.fromObject(obj!)
    const quads = mesh.faces.filter((f) => f.length === 4)
    const caps = mesh.faces.filter((f) => f.length > 4)
    expect(caps.length).toBe(2)
    const radial = caps[0]!.length
    expect(radial).toBeGreaterThanOrEqual(6)
    expect(radial).toBeLessThanOrEqual(10)
    const ringCount = quads.length / radial + 1
    // Old 14° sampler left ~2–5 rings → blocky miters; keep lower-mid longitudinal samples.
    expect(ringCount).toBeGreaterThan(20)
    expect(ringCount).toBeLessThanOrEqual(PATH_SPINE_HARD_CAP)
    expect(mesh.faces.filter((f) => f.length === 3).length).toBe(0)

    const regen = regenerateSketchObjectFromSource(obj!, { polyBudget: 128 })!
    const regenMesh = HalfEdgeMesh.fromObject(regen)
    const regenRadial = regenMesh.faces.find((f) => f.length > 4)!.length
    const regenRings = regenMesh.faces.filter((f) => f.length === 4).length / regenRadial + 1
    expect(regenRings).toBeGreaterThan(20)
    expect(regenRings).toBeLessThanOrEqual(PATH_SPINE_HARD_CAP)
  })

  it('open outline sketch thickness widens the ribbon', () => {
    const path = Array.from({ length: 28 }, (_, i) => ({
      x: i * 4,
      y: Math.sin(i * 0.35) * 10,
    }))
    const thin = strokeToMesh({
      ...base,
      points: path,
      strokeMode: 'outline',
      brushDensity: 6,
      extrudeAmount: 12,
    })!
    const thick = strokeToMesh({
      ...base,
      points: path,
      strokeMode: 'outline',
      brushDensity: 24,
      extrudeAmount: 12,
    })!
    const span = (positions: { x: number; y: number }[]) => {
      const xs = positions.map((p) => p.x)
      const ys = positions.map((p) => p.y)
      return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
    }
    expect(span(thick.positions)).toBeGreaterThan(span(thin.positions))
  })

  it('outline poly budget soft-caps boundary fidelity without crushing to ~20 verts', () => {
    const loop = smoothWavyLoop(160)
    const low = prepareOutlineBoundary(loop, 64, true)!
    const high = prepareOutlineBoundary(loop, 256, true)!
    expect(low.length).toBeGreaterThan(20)
    expect(high.length).toBeGreaterThan(low.length)

    const lowMesh = strokeToMesh({
      ...base,
      points: [...loop, loop[0]!],
      strokeMode: 'outline',
      polyBudget: 64,
      extrudeAmount: 12,
    })!
    const highMesh = strokeToMesh({
      ...base,
      points: [...loop, loop[0]!],
      strokeMode: 'outline',
      polyBudget: 256,
      extrudeAmount: 12,
    })!
    expect(lowMesh.positions.length / 2).toBeGreaterThan(20)
    expect(highMesh.positions.length).toBeGreaterThan(lowMesh.positions.length)
  })

  it('outline extrude depth sets prism thickness and keeps signed depth editable', () => {
    const loop = [...square]
    const shallow = strokeToMesh({
      ...base,
      points: loop,
      strokeMode: 'outline',
      extrudeAmount: 6,
    })!
    const deep = strokeToMesh({
      ...base,
      points: loop,
      strokeMode: 'outline',
      extrudeAmount: 28,
    })!
    const flipped = strokeToMesh({
      ...base,
      points: loop,
      strokeMode: 'outline',
      extrudeAmount: -28,
    })!
    const zExtent = (positions: { z: number }[]) => {
      const zs = positions.map((p) => p.z)
      return Math.max(...zs) - Math.min(...zs)
    }
    expect(zExtent(deep.positions)).toBeGreaterThan(zExtent(shallow.positions))
    expect(zExtent(deep.positions)).toBeCloseTo(28, 5)
    expect(zExtent(flipped.positions)).toBeCloseTo(28, 5)
    expect(deep.sketchSource?.extrudeDepth).toBe(28)
    expect(flipped.sketchSource?.extrudeDepth).toBe(-28)
    expect(deep.positions[0]!.z).toBeCloseTo(14, 5)
    expect(flipped.positions[0]!.z).toBeCloseTo(-14, 5)

    const regen = regenerateSketchObjectFromSource(flipped, {
      brushDensity: 18,
      polyBudget: 200,
      extrudeDepth: -20,
    })!
    expect(regen.id).toBe(flipped.id)
    expect(regen.sketchSource?.extrudeDepth).toBe(-20)
    expect(zExtent(regen.positions)).toBeCloseTo(20, 5)
  })

  it('vector pen outline honors poly budget, thickness, and extrude depth', () => {
    const loop = smoothWavyLoop(200)
    const path: VectorPath = {
      id: 'outline-v',
      view: 'front',
      closed: true,
      color: 0xff0000,
      source: 'pen',
      anchors: loop.map((p, i) => ({
        id: `a${i}`,
        position: p,
        inHandle: null,
        outHandle: null,
      })),
    }
    const low = vectorPathToMesh(path, {
      view: 'front',
      polyBudget: 64,
      brushDensity: 8,
      strokeMode: 'outline',
      rdpTolerance: 2,
      closeThreshold: 12,
      defaultDepth: 0,
      color: 0xff0000,
      extrudeAmount: 10,
    })!
    const high = vectorPathToMesh(path, {
      view: 'front',
      polyBudget: 256,
      brushDensity: 8,
      strokeMode: 'outline',
      rdpTolerance: 2,
      closeThreshold: 12,
      defaultDepth: 0,
      color: 0xff0000,
      extrudeAmount: 24,
    })!
    expect(low.name).toBe('Outline')
    expect(low.sketchSource?.kind).toBe('outline')
    expect(high.positions.length).toBeGreaterThan(low.positions.length)
    const zExtent = (positions: { z: number }[]) => {
      const zs = positions.map((p) => p.z)
      return Math.max(...zs) - Math.min(...zs)
    }
    expect(zExtent(high.positions)).toBeGreaterThan(zExtent(low.positions))
    expect(high.sketchSource?.extrudeDepth).toBe(24)
    expect(low.sketchSource?.polyBudget).toBe(64)
    expect(high.sketchSource?.polyBudget).toBe(256)
  })
})
