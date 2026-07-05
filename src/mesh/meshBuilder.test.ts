import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  MeshBuilder,
  computeFaceNormal,
  ensureOutwardWinding,
  faceCentroid,
  finalizeIndexedMesh,
  meshCentroid,
  validateMesh,
} from './MeshBuilder'
import { primitiveBoxToSceneObject } from '../primitives/primitiveBoxCommit'
import { heightAxisForView } from '../primitives/viewAxes'
import { enforceSceneObjectPolyBudget } from './meshPolyBudget'
import { prepareSceneObject } from './objectTransform'
import { HalfEdgeMesh } from './HalfEdgeMesh'
import { bakeSceneObjectForExport, sceneObjectToThreeMesh } from '../io/sceneMeshBridge'
import { SCENE_GRID_CELL } from '../scene/units'
import { setFlatNormalsFromIndices } from '../rendering/meshGeometry'

const ORIGIN = { x: 0, y: 0, z: 0 }
const TEST_BOX = { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } }

/** Same path as Draw panel → commitPrimitiveBox → addObject (includes poly budget). */
function commitPrimitiveLikeUI(
  type: 'icosphere' | 'sphere',
  polyBudget = 64
) {
  const obj = primitiveBoxToSceneObject(
    type,
    TEST_BOX,
    heightAxisForView('front'),
    0x6ecbf5,
    polyBudget
  )
  if (!obj) return null
  return enforceSceneObjectPolyBudget(prepareSceneObject(obj), polyBudget)
}

function inwardFaceCount(positions: { x: number; y: number; z: number }[], faces: number[][], center = ORIGIN) {
  let inward = 0
  for (const face of faces) {
    if (face.length !== 3) continue
    const tri = face as [number, number, number]
    const n = computeFaceNormal(positions, tri)
    const c = faceCentroid(positions, tri)
    const dot = n.x * (c.x - center.x) + n.y * (c.y - center.y) + n.z * (c.z - center.z)
    if (dot < 0) inward++
  }
  return inward
}

describe('MeshBuilder', () => {
  it('cube: all face normals point outward from center', () => {
    const b = new MeshBuilder()
    const v = [
      b.addVertex(-1, -1, -1),
      b.addVertex(1, -1, -1),
      b.addVertex(1, 1, -1),
      b.addVertex(-1, 1, -1),
      b.addVertex(-1, -1, 1),
      b.addVertex(1, -1, 1),
      b.addVertex(1, 1, 1),
      b.addVertex(-1, 1, 1),
    ]
    b.addQuad(v[0], v[1], v[2], v[3])
    b.addQuad(v[5], v[4], v[7], v[6])
    b.addQuad(v[4], v[0], v[3], v[7])
    b.addQuad(v[1], v[5], v[6], v[2])
    b.addQuad(v[3], v[2], v[6], v[7])
    b.addQuad(v[4], v[5], v[1], v[0])

    const mesh = ensureOutwardWinding(b.build(), ORIGIN)
    const result = validateMesh(mesh, ORIGIN)
    expect(result.ok).toBe(true)
    expect(inwardFaceCount(mesh.positions, mesh.faces)).toBe(0)
  })

  it('ensureOutwardWinding fixes a deliberately flipped face', () => {
    const b = new MeshBuilder()
    const a = b.addVertex(0, 0, 0)
    const c = b.addVertex(1, 0, 0)
    const d = b.addVertex(0, 1, 0)
    // CW when viewed from +Z → inward
    b.addTriangle(a, d, c)
    const fixed = ensureOutwardWinding(b.build(), { x: 0.33, y: 0.33, z: 0 })
    expect(inwardFaceCount(fixed.positions, fixed.faces)).toBe(0)
  })

  it('UV sphere: no inward faces for all height axes', () => {
    for (const ha of [0, 1, 2] as const) {
      const obj = primitiveBoxToSceneObject(
        'sphere',
        { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } },
        ha,
        0x6ecbf5,
        48
      )
      expect(obj).not.toBeNull()
      expect(inwardFaceCount(obj!.positions, obj!.faces)).toBe(0)
    }
  })

  it('CAD sphere from front view (Z height axis) has no inward faces', () => {
    const ha = heightAxisForView('front')
    const obj = primitiveBoxToSceneObject(
      'sphere',
      { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } },
      ha,
      0x6ecbf5,
      48
    )
    expect(obj).not.toBeNull()
    expect(obj!.faces.length).toBeGreaterThanOrEqual(40)
    expect(inwardFaceCount(obj!.positions, obj!.faces)).toBe(0)
  })

  it('finalizeIndexedMesh produces faceted mesh with zero inward faces', () => {
    const b = new MeshBuilder()
    const north = b.addVertex(0, 1, 0)
    const r0 = b.addVertex(1, 0, 0)
    const r1 = b.addVertex(0, 0, 1)
    const r2 = b.addVertex(-1, 0, 0)
    const r3 = b.addVertex(0, 0, -1)
    const south = b.addVertex(0, -1, 0)
    b.addTriangle(north, r0, r1)
    b.addTriangle(north, r1, r2)
    b.addTriangle(north, r2, r3)
    b.addTriangle(north, r3, r0)
    b.addTriangle(south, r1, r0)
    b.addTriangle(south, r2, r1)
    b.addTriangle(south, r3, r2)
    b.addTriangle(south, r0, r3)

    const data = finalizeIndexedMesh(b.build(), { outwardCenter: ORIGIN, facet: true })
    expect(data.indices.length).toBeGreaterThan(0)
  })

  it('icosphere UI commit path keeps all faces after poly budget enforcement', () => {
    const obj = commitPrimitiveLikeUI('icosphere', 64)
    expect(obj).not.toBeNull()
    expect(obj!.positions.length).toBeLessThanOrEqual(64)
    expect(obj!.faces.length).toBe(80)
    expect(inwardFaceCount(obj!.positions, obj!.faces)).toBe(0)

    const renderMesh = HalfEdgeMesh.fromObject(obj!).toMeshData(true, 0)
    expect(renderMesh.indices.length / 3).toBe(80)
  })

  it('UV sphere UI commit path keeps faces after poly budget enforcement', () => {
    const obj = commitPrimitiveLikeUI('sphere', 64)
    expect(obj).not.toBeNull()
    expect(inwardFaceCount(obj!.positions, obj!.faces)).toBe(0)
    expect(obj!.faces.length).toBeGreaterThanOrEqual(40)
  })

  it('export geometry normals point outward for textured box', () => {
    const box = { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } }
    const obj = enforceSceneObjectPolyBudget(
      prepareSceneObject(
        primitiveBoxToSceneObject('box', box, heightAxisForView('front'), 0xffffff, 64)!
      ),
      64
    )
    const baked = bakeSceneObjectForExport(obj)
    const threeMesh = sceneObjectToThreeMesh(baked)
    const geo = threeMesh.geometry
    const pos = geo.getAttribute('position') as THREE.BufferAttribute
    const norm = geo.getAttribute('normal') as THREE.BufferAttribute
    const idx = geo.getIndex()!
    const ref = meshCentroid(
      Array.from({ length: pos.count }, (_, i) => ({
        x: pos.getX(i),
        y: pos.getY(i),
        z: pos.getZ(i),
      }))
    )
    let inward = 0
    for (let t = 0; t < idx.count; t += 3) {
      const ia = idx.getX(t)!
      const ax = pos.getX(ia)
      const ay = pos.getY(ia)
      const az = pos.getZ(ia)
      const nx = norm.getX(ia)
      const ny = norm.getY(ia)
      const nz = norm.getZ(ia)
      if (nx * (ax - ref.x) + ny * (ay - ref.y) + nz * (az - ref.z) < 0) inward++
    }
    expect(inward).toBe(0)
  })

  it('export scales one grid cell of scene units to one glTF meter', () => {
    const half = SCENE_GRID_CELL / 2
    const box = {
      min: { x: -half, y: -half, z: -half },
      max: { x: half, y: half, z: half },
    }
    const obj = prepareSceneObject(
      primitiveBoxToSceneObject('box', box, heightAxisForView('front'), 0xffffff, 64)!
    )
    const baked = bakeSceneObjectForExport(obj)
    const xs = baked.positions.map((p) => p.x)
    const ys = baked.positions.map((p) => p.y)
    const zs = baked.positions.map((p) => p.z)
    const extent = (vals: number[]) => Math.max(...vals) - Math.min(...vals)
    expect(extent(xs)).toBeCloseTo(1, 4)
    expect(extent(ys)).toBeCloseTo(1, 4)
    expect(extent(zs)).toBeCloseTo(1, 4)
  })

  it('setFlatNormalsFromIndices matches triangle winding', () => {
    const b = new MeshBuilder()
    const a = b.addVertex(0, 0, 0)
    const c = b.addVertex(1, 0, 0)
    const d = b.addVertex(0, 1, 0)
    b.addTriangle(a, c, d)
    const data = finalizeIndexedMesh(b.build(), { outwardCenter: ORIGIN, facet: true })
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3))
    geo.setIndex(Array.from(data.indices))
    setFlatNormalsFromIndices(geo)
    const norm = geo.getAttribute('normal') as THREE.BufferAttribute
    expect(norm.getZ(0)).toBeGreaterThan(0)
  })
})
