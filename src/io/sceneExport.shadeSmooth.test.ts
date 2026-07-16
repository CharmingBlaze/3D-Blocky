import { describe, expect, it } from 'vitest'
import type { MeshStandardMaterial } from 'three'
import { prepareSceneObject } from '../mesh/objectTransform'
import { exportSceneOBJ } from './sceneExport'
import { sceneObjectToThreeMesh } from './sceneMeshBridge'

function unitBox(smoothShading: boolean) {
  return prepareSceneObject({
    id: 'export-box',
    name: 'ExportBox',
    positions: [
      { x: -1, y: -1, z: -1 },
      { x: 1, y: -1, z: -1 },
      { x: 1, y: 1, z: -1 },
      { x: -1, y: 1, z: -1 },
      { x: -1, y: -1, z: 1 },
      { x: 1, y: -1, z: 1 },
      { x: 1, y: 1, z: 1 },
      { x: -1, y: 1, z: 1 },
    ],
    faces: [
      [0, 1, 2, 3],
      [5, 4, 7, 6],
      [4, 0, 3, 7],
      [1, 5, 6, 2],
      [3, 2, 6, 7],
      [4, 5, 1, 0],
    ],
    faceColors: [0xffffff, 0xffffff, 0xffffff, 0xffffff, 0xffffff, 0xffffff],
    color: 0xffffff,
    topologyLocked: false,
    polyBudget: 32,
    polyBudgetMode: 'adaptive',
    smoothShading,
    facetExaggeration: 0,
  })
}

describe('shade smooth export', () => {
  it('OBJ writes smooth groups and vertex normals when Shade Smooth is on', () => {
    const { obj } = exportSceneOBJ([unitBox(true)], 'scene')
    expect(obj).toContain('s 1')
    expect(obj).toMatch(/^vn /m)
    expect(obj).toMatch(/f \d+\/\/\d+/)
  })

  it('OBJ writes s off and no normals when flat', () => {
    const { obj } = exportSceneOBJ([unitBox(false)], 'scene')
    expect(obj).toContain('s off')
    expect(obj).not.toMatch(/^vn /m)
  })

  it('GLB mesh build uses smooth normals and shared verts when Shade Smooth is on', () => {
    const mesh = sceneObjectToThreeMesh(unitBox(true))
    if (Array.isArray(mesh.material)) throw new Error('Expected one export material')
    const mat = mesh.material as MeshStandardMaterial
    expect(mat.flatShading).toBe(false)

    const pos = mesh.geometry.getAttribute('position')
    const nrm = mesh.geometry.getAttribute('normal')
    expect(pos.count).toBe(8) // welded box corners, not per-face duplicates
    expect(nrm).toBeTruthy()
    expect(nrm!.count).toBe(8)

    // Corner normal should not be axis-aligned face normal (smooth average).
    const nx = Math.abs(nrm!.getX(0))
    const ny = Math.abs(nrm!.getY(0))
    const nz = Math.abs(nrm!.getZ(0))
    expect(nx).toBeGreaterThan(0.1)
    expect(ny).toBeGreaterThan(0.1)
    expect(nz).toBeGreaterThan(0.1)

    mesh.geometry.dispose()
    ;(mesh.material as { dispose: () => void }).dispose()
  })

  it('GLB mesh build stays flat-shaded when Shade Smooth is off', () => {
    const mesh = sceneObjectToThreeMesh(unitBox(false))
    if (Array.isArray(mesh.material)) throw new Error('Expected one export material')
    const mat = mesh.material as MeshStandardMaterial
    expect(mat.flatShading).toBe(true)
    // Flat path duplicates corners per face.
    expect(mesh.geometry.getAttribute('position').count).toBeGreaterThan(8)

    mesh.geometry.dispose()
    ;(mesh.material as { dispose: () => void }).dispose()
  })
})
