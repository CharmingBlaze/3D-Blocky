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
import { heightAxisForView, setAxisComponent, type Axis } from '../primitives/viewAxes'
import { vectorShapeToObject } from './lowPolyPrimitives'
import { polylineToMesh } from '../stroke/polylineToMesh'
import { meshSignedVolume } from './meshWinding'
import type { SceneObject } from './HalfEdgeMesh'
import { weldSceneObjectCoincidentVertices } from '../mesh/subdivisionSurface'
import { roundedBoxFromWorldBox } from '../mesh/roundedBox'
import { prepareSceneObject } from '../mesh/objectTransform'
import { enforceSceneObjectPolyBudget } from './meshPolyBudget'
import { prepareSceneObject } from './objectTransform'
import { HalfEdgeMesh } from './HalfEdgeMesh'
import { bakeSceneObjectForExport, sceneObjectToThreeMesh } from '../io/sceneMeshBridge'
import { SCENE_GRID_CELL } from '../scene/units'
import { setFlatNormalsFromIndices } from '../rendering/meshGeometry'

const ORIGIN = { x: 0, y: 0, z: 0 }
const TEST_BOX = { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } }
const ORTHO_VIEWS = ['front', 'top', 'right'] as const
type WorldAxis = 'x' | 'y' | 'z'

function axisExtent(obj: SceneObject, axis: WorldAxis): number {
  let min = Infinity
  let max = -Infinity
  for (const p of obj.positions) {
    const v = p[axis]
    min = Math.min(min, v)
    max = Math.max(max, v)
  }
  return max - min
}

function dominantWorldAxis(obj: SceneObject): WorldAxis {
  const ranked = (['x', 'y', 'z'] as const)
    .map((axis) => ({ axis, extent: axisExtent(obj, axis) }))
    .sort((a, b) => b.extent - a.extent)
  return ranked[0]!.axis
}

function worldAxisForHeightAxis(heightAxis: Axis): WorldAxis {
  return heightAxis === 0 ? 'x' : heightAxis === 1 ? 'y' : 'z'
}

function cadCapsuleBox(heightAxis: Axis, height: number, diameter: number) {
  const r = diameter / 2
  const halfH = height / 2
  const min = setAxisComponent({ x: -r, y: -r, z: -r }, heightAxis, -halfH)
  const max = setAxisComponent({ x: r, y: r, z: r }, heightAxis, halfH)
  return { min, max }
}
const CAD_PRIMITIVE_TYPES = [
  'box',
  'icosphere',
  'sphere',
  'cone',
  'cylinder',
  'capsule',
  'pyramid',
] as const

/** Same path as Draw panel → commitPrimitiveBox → addObject (includes poly budget). */
function commitPrimitiveLikeUI(
  type: 'icosphere' | 'sphere',
  polyBudget = 128
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
    expect(obj!.faces.length).toBeGreaterThanOrEqual(20)
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
    expect(obj!.faces.length).toBeGreaterThanOrEqual(20)
  })

  it('CAD box uses eight welded corner vertices', () => {
    const obj = primitiveBoxToSceneObject(
      'box',
      TEST_BOX,
      heightAxisForView('front'),
      0x6ecbf5,
      64
    )
    expect(obj).not.toBeNull()
    expect(obj!.positions.length).toBe(8)
    expect(obj!.faces.length).toBe(12)
    expect(inwardFaceCount(obj!.positions, obj!.faces)).toBe(0)
  })

  it('CAD capsule is cylinder plus two hemispheres with shared rings', () => {
    const obj = primitiveBoxToSceneObject(
      'capsule',
      TEST_BOX,
      heightAxisForView('front'),
      0x6ecbf5,
      128
    )
    expect(obj).not.toBeNull()
    expect(obj!.positions.length).toBeGreaterThanOrEqual(18)
    expect(obj!.positions.length).toBeLessThan(40)
    expect(inwardFaceCount(obj!.positions, obj!.faces)).toBe(0)

    const tallBox = { min: { x: -1, y: -1, z: -3 }, max: { x: 1, y: 1, z: 3 } }
    const tall = primitiveBoxToSceneObject(
      'capsule',
      tallBox,
      heightAxisForView('front'),
      0x6ecbf5,
      128
    )
    expect(tall).not.toBeNull()
    expect(tall!.positions.length).toBeGreaterThan(obj!.positions.length)
  })

  it.each(ORTHO_VIEWS)('CAD capsule long axis follows the starting view (%s)', (view) => {
    const heightAxis = heightAxisForView(view)
    const obj = primitiveBoxToSceneObject(
      'capsule',
      cadCapsuleBox(heightAxis, 24, 8),
      heightAxis,
      0x6ecbf5,
      128
    )
    expect(obj).not.toBeNull()
    expect(dominantWorldAxis(obj!)).toBe(worldAxisForHeightAxis(heightAxis))
  })

  it.each(ORTHO_VIEWS)('vector capsule long axis follows the draw view (%s)', (view) => {
    const obj = vectorShapeToObject(
      'capsule',
      { x: 0, y: 0 },
      { x: 12, y: 36 },
      {
        view,
        depth: 0,
        polyBudget: 128,
        color: 0x6ecbf5,
      }
    )
    expect(obj).not.toBeNull()
    const depthAxis = worldAxisForHeightAxis(heightAxisForView(view))
    expect(axisExtent(obj!, depthAxis)).toBeGreaterThan(30)
  })

  it('vector capsule in front view points into the screen, not along vertical drag', () => {
    const obj = vectorShapeToObject(
      'capsule',
      { x: 0, y: 0 },
      { x: 12, y: 36 },
      { view: 'front', depth: 0, polyBudget: 128, color: 0x6ecbf5 }
    )
    expect(obj).not.toBeNull()
    expect(axisExtent(obj!, 'z')).toBeGreaterThan(axisExtent(obj!, 'y') - 1)
  })

  it('vector pen keeps outline corners on a low-poly capsule pillow', () => {
    const diamond = [
      { x: 0, y: 30 },
      { x: 25, y: 0 },
      { x: 0, y: -30 },
      { x: -25, y: 0 },
    ]
    const obj = polylineToMesh({
      points: diamond,
      view: 'front',
      polyBudget: 128,
      brushDensity: 12,
      strokeMode: 'outline',
      rdpTolerance: 2,
      closeThreshold: 12,
      defaultDepth: 0,
      color: 0xff0000,
      extrudeMode: false,
      pathClosed: true,
      preserveDetail: true,
    })
    expect(obj).not.toBeNull()
    expect(obj!.name).toBe('Doodle')
    expect(obj!.positions.length).toBeGreaterThanOrEqual(14)
    expect(obj!.positions.length).toBeLessThan(80)
    expect(obj!.polyBudgetMode).toBe('adaptive')
    const center = meshCentroid(obj!.positions)
    expect(inwardFaceCount(obj!.positions, obj!.faces, center)).toBe(0)
  })

  it('vector pen caps dense outline curves to low-poly capsule rings', () => {
    const denseLoop: { x: number; y: number }[] = []
    for (let i = 0; i < 64; i++) {
      const t = (i / 64) * Math.PI * 2
      denseLoop.push({ x: Math.cos(t) * 40, y: Math.sin(t) * 30 })
    }
    const obj = polylineToMesh({
      points: denseLoop,
      view: 'front',
      polyBudget: 128,
      brushDensity: 12,
      strokeMode: 'outline',
      rdpTolerance: 2,
      closeThreshold: 12,
      defaultDepth: 0,
      color: 0xff00ff,
      pathClosed: true,
      preserveDetail: true,
    })
    expect(obj).not.toBeNull()
    expect(obj!.positions.length).toBeLessThan(120)
    expect(obj!.faces.length).toBeLessThan(220)
  })

  it('closed outline extrude builds a capsule pillow doodle, not a flat prism', () => {
    const square = [
      { x: -20, y: -20 },
      { x: 20, y: -20 },
      { x: 20, y: 20 },
      { x: -20, y: 20 },
      { x: -20, y: -20 },
    ]
    const obj = polylineToMesh({
      points: square,
      view: 'front',
      polyBudget: 128,
      brushDensity: 12,
      strokeMode: 'outline',
      rdpTolerance: 2,
      closeThreshold: 12,
      defaultDepth: 0,
      color: 0xff0000,
      extrudeMode: true,
      extrudeAmount: 8,
      pathClosed: true,
    })
    expect(obj).not.toBeNull()
    expect(obj!.name).toBe('Doodle')
    expect(obj!.positions.length).toBeGreaterThan(8)
    expect(obj!.faces.length).toBeGreaterThan(12)
    const center = meshCentroid(obj!.positions)
    expect(inwardFaceCount(obj!.positions, obj!.faces, center)).toBe(0)
    expect(meshSignedVolume(HalfEdgeMesh.fromObject(obj!))).toBeGreaterThan(0)
  })

  it.each(CAD_PRIMITIVE_TYPES)('CAD %s keeps welded topology for component edits', (type) => {
    const obj = primitiveBoxToSceneObject(
      type,
      TEST_BOX,
      heightAxisForView('front'),
      0x6ecbf5,
      64
    )
    expect(obj).not.toBeNull()
    expect(obj!.positions.length).toBeGreaterThan(0)
    expect(inwardFaceCount(obj!.positions, obj!.faces)).toBe(0)

    const welded = weldSceneObjectCoincidentVertices(obj!)
    expect(welded.positions.length).toBe(obj!.positions.length)
  })

  it('rounded CAD box keeps welded topology for component edits', () => {
    const obj = prepareSceneObject(
      roundedBoxFromWorldBox(TEST_BOX, 0x6ecbf5, { roundness: 0.25, subdivisions: 2 }, 64)
    )
    expect(obj.positions.length).toBeGreaterThan(0)
    expect(inwardFaceCount(obj.positions, obj.faces)).toBe(0)

    const welded = weldSceneObjectCoincidentVertices(obj)
    expect(welded.positions.length).toBe(obj.positions.length)
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
