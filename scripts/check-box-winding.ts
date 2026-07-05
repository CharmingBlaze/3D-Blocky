import { primitiveBoxToSceneObject } from '../src/primitives/primitiveBoxCommit'
import { enforceSceneObjectPolyBudget } from '../src/mesh/meshPolyBudget'
import { prepareSceneObject } from '../src/mesh/objectTransform'
import { heightAxisForView } from '../src/primitives/viewAxes'
import { computeFaceNormal, faceCentroid, meshCentroid } from '../src/mesh/MeshBuilder'
import { HalfEdgeMesh } from '../src/mesh/HalfEdgeMesh'
import { bakeSceneObjectForExport, sceneObjectToThreeMesh } from '../src/io/sceneMeshBridge'

function countInward(obj: { positions: { x: number; y: number; z: number }[]; faces: number[][] }) {
  const ref = meshCentroid(obj.positions)
  let inward = 0
  for (const f of obj.faces) {
    if (f.length !== 3) continue
    const n = computeFaceNormal(obj.positions, f as [number, number, number])
    const c = faceCentroid(obj.positions, f as [number, number, number])
    if (n.x * (c.x - ref.x) + n.y * (c.y - ref.y) + n.z * (c.z - ref.z) < 0) inward++
  }
  return inward
}

const box = { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } }
let obj = primitiveBoxToSceneObject('box', box, heightAxisForView('front'), 0xffffff, 64)!
obj = enforceSceneObjectPolyBudget(prepareSceneObject(obj), 64)
console.log('committed box inward:', countInward(obj), 'faces', obj.faces.length)

const baked = bakeSceneObjectForExport(obj)
console.log('export baked inward:', countInward(baked))

const threeMesh = sceneObjectToThreeMesh(baked, {
  textures: { pixelDocuments: {}, objectTextures: {} },
})
const pos = threeMesh.geometry.getAttribute('position')
const idx = threeMesh.geometry.getIndex()!
const positions = []
for (let i = 0; i < pos.count; i++) {
  positions.push({ x: pos.getX(i), y: pos.getY(i), z: pos.getZ(i) })
}
const faces = []
for (let t = 0; t < idx.count; t += 3) {
  faces.push([idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)])
}
console.log('three export geom inward:', countInward({ positions, faces }))

const renderData = HalfEdgeMesh.fromObject(obj).toMeshData(true, 0)
const rPos = []
for (let i = 0; i < renderData.positions.length; i += 3) {
  rPos.push({
    x: renderData.positions[i]!,
    y: renderData.positions[i + 1]!,
    z: renderData.positions[i + 2]!,
  })
}
const rFaces = []
for (let t = 0; t < renderData.indices.length; t += 3) {
  rFaces.push([renderData.indices[t]!, renderData.indices[t + 1]!, renderData.indices[t + 2]!])
}
console.log('render flat mesh inward:', countInward({ positions: rPos, faces: rFaces }))
