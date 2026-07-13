import { describe, expect, it } from 'vitest'
import { HalfEdgeMesh } from '../mesh/HalfEdgeMesh'
import {
  planePathToWorld,
  planePointToStrokeFrame,
  projectMeshToView,
  worldPointToStrokePlane2D,
  type StrokePlaneFrame,
} from './worldProjection'
import { strokeToMesh } from './strokeToMesh'

/** Camera looking down -Z from +Z, with X right and Y up — like a default front-ish perspective. */
const facingNegZ: StrokePlaneFrame = {
  origin: { x: 10, y: 20, z: 30 },
  right: { x: 1, y: 0, z: 0 },
  up: { x: 0, y: 1, z: 0 },
}

describe('perspective stroke plane projection', () => {
  it('round-trips plane coords through a locked camera-facing frame', () => {
    const world = planePointToStrokeFrame(5, -3, facingNegZ, 2)
    expect(world).toEqual({ x: 15, y: 17, z: 32 })
    expect(worldPointToStrokePlane2D(world, facingNegZ)).toEqual({ x: 5, y: -3 })
  })

  it('projectMeshToView places canonical XY onto the stroke frame', () => {
    const mesh = new HalfEdgeMesh()
    mesh.positions.push({ x: 4, y: 2, z: 1 }, { x: 0, y: 0, z: 0 })
    projectMeshToView(mesh, 'perspective', 0, facingNegZ)
    expect(mesh.positions[0]).toEqual({ x: 14, y: 22, z: 31 })
    expect(mesh.positions[1]).toEqual({ x: 10, y: 20, z: 30 })
  })

  it('planePathToWorld uses the frame when view is perspective', () => {
    const path = planePathToWorld(
      [
        { x: 1, y: 0 },
        { x: 0, y: 2 },
      ],
      'perspective',
      0,
      facingNegZ
    )
    expect(path).toEqual([
      { x: 11, y: 20, z: 30 },
      { x: 10, y: 22, z: 30 },
    ])
  })

  it('builds hair mesh in perspective when a plane frame is provided', () => {
    const wavy = Array.from({ length: 20 }, (_, i) => ({
      x: i * 3,
      y: Math.sin(i * 0.4) * 8,
    }))
    const obj = strokeToMesh({
      points: wavy,
      view: 'perspective',
      polyBudget: 128,
      brushDensity: 12,
      strokeMode: 'hair-paths',
      rdpTolerance: 2,
      closeThreshold: 12,
      defaultDepth: 0,
      color: 0xaa6633,
      extrudeAmount: 16,
      planeFrame: facingNegZ,
    })
    expect(obj).not.toBeNull()
    expect(obj?.name).toBe('Hair Paths')
    expect(obj?.sketchSource?.planeFrame).toEqual(facingNegZ)
    // Placed on the locked frame (origin z=30), not the legacy XY→z=depth fallback.
    const zs = obj!.positions.map((p) => p.z)
    const zMid = (Math.min(...zs) + Math.max(...zs)) / 2
    expect(zMid).toBeGreaterThan(25)
    expect(zMid).toBeLessThan(35)
  })

  it('rejects perspective strokes without a plane frame', () => {
    const obj = strokeToMesh({
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      view: 'perspective',
      polyBudget: 64,
      brushDensity: 8,
      strokeMode: 'hair-strips',
      rdpTolerance: 2,
      closeThreshold: 12,
      defaultDepth: 0,
      color: 0xaa6633,
    })
    expect(obj).toBeNull()
  })
})
