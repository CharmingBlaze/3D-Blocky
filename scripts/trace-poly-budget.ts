/**
 * Trace addObject poly-budget path (the step unit tests skip).
 */
import { meshDataToHalfEdgeMesh } from '../src/blob/adapters'
import { HalfEdgeMesh } from '../src/mesh/HalfEdgeMesh'
import { computeFaceNormal, faceCentroid, meshCentroid } from '../src/mesh/MeshBuilder'
import { enforceSceneObjectPolyBudget } from '../src/mesh/meshPolyBudget'
import { meshSignedVolume } from '../src/mesh/meshWinding'
import { prepareSceneObject } from '../src/mesh/objectTransform'
import { primitiveBoxToSceneObject } from '../src/primitives/primitiveBoxCommit'
import { heightAxisForView } from '../src/primitives/viewAxes'
import { resolveFlatShading } from '../src/rendering/viewportDisplay'
import type { SceneObject } from '../src/mesh/HalfEdgeMesh'

function countInward(mesh: HalfEdgeMesh): number {
  const ref = meshCentroid(mesh.positions)
  let inward = 0
  for (const face of mesh.faces) {
    if (face.length !== 3) continue
    const n = computeFaceNormal(mesh.positions, face as [number, number, number])
    const c = faceCentroid(mesh.positions, face as [number, number, number])
    if (n.x * (c.x - ref.x) + n.y * (c.y - ref.y) + n.z * (c.z - ref.z) < 0) inward++
  }
  return inward
}

const box = { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } }
const ha = heightAxisForView('front')

console.log('=== Commit path (welded storage + poly budget) ===')
const obj = primitiveBoxToSceneObject('icosphere', box, ha, 0xffffff, 64)!
const prepared = prepareSceneObject(obj)
console.log(`after commit: ${prepared.positions.length}v ${prepared.faces.length}f inward=${countInward(HalfEdgeMesh.fromObject(prepared))}`)

console.log('running enforceSceneObjectPolyBudget(64)...')
const t0 = Date.now()
const budgeted = enforceSceneObjectPolyBudget(prepared, 64)
console.log(`after budget (${Date.now() - t0}ms): ${budgeted.positions.length}v ${budgeted.faces.length}f inward=${countInward(HalfEdgeMesh.fromObject(budgeted))} vol=${meshSignedVolume(HalfEdgeMesh.fromObject(budgeted)).toFixed(4)}`)

function traceRender(obj: SceneObject) {
  const mesh = HalfEdgeMesh.fromObject(obj)
  const flatShading = resolveFlatShading(obj.smoothShading, 'model')
  const data = mesh.toMeshData(flatShading, obj.facetExaggeration ?? 0)
  const positions = []
  for (let i = 0; i < data.positions.length; i += 3) {
    positions.push({ x: data.positions[i]!, y: data.positions[i + 1]!, z: data.positions[i + 2]! })
  }
  const faces = []
  for (let t = 0; t < data.indices.length; t += 3) {
    faces.push([data.indices[t]!, data.indices[t + 1]!, data.indices[t + 2]!])
  }
  const ref = meshCentroid(positions)
  let inward = 0
  for (const face of faces) {
    const n = computeFaceNormal(positions, face as [number, number, number])
    const c = faceCentroid(positions, face as [number, number, number])
    if (n.x * (c.x - ref.x) + n.y * (c.y - ref.y) + n.z * (c.z - ref.z) < 0) inward++
  }
  console.log(
    `[render toMeshData flat=${flatShading}] renderVerts=${positions.length} tris=${faces.length} inward=${inward}`
  )
}

console.log('\n=== Render path (MeshRenderer buildGeometry equivalent) ===')
traceRender(budgeted)
