/**
 * Log validateMesh results for every CAD primitive type.
 * Run: npm run validate:primitives
 */
import { createPrimitiveInBox, type PrimitiveBoxType } from '../src/primitives/primitivesBox'
import { primitiveBoxToSceneObject } from '../src/primitives/primitiveBoxCommit'
import { heightAxisForView } from '../src/primitives/viewAxes'
import { validateMesh, indexedMeshFromFlat, computeFaceNormal, faceCentroid } from '../src/mesh/MeshBuilder'

const PRIMITIVES: PrimitiveBoxType[] = [
  'box',
  'icosphere',
  'sphere',
  'cone',
  'cylinder',
  'capsule',
  'pyramid',
]

const box = { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } }
const center = { x: 0, y: 0, z: 0 }

function inwardFromObj(positions: { x: number; y: number; z: number }[], faces: number[][]) {
  let inward = 0
  for (const face of faces) {
    if (face.length !== 3) continue
    const tri = face as [number, number, number]
    const n = computeFaceNormal(positions, tri)
    const c = faceCentroid(positions, tri)
    const dot = n.x * c.x + n.y * c.y + n.z * c.z
    if (dot < 0) inward++
  }
  return inward
}

let failures = 0

for (const view of ['front', 'side', 'top'] as const) {
  const ha = heightAxisForView(view)
  for (const type of PRIMITIVES) {
    const data = createPrimitiveInBox(type, box, ha, 8)
    if (data.indices.length === 0) {
      console.log(`SKIP ${type} @ ${view} (empty)`)
      continue
    }

    const flatPositions: number[] = []
    for (let i = 0; i < data.positions.length; i++) {
      flatPositions.push(data.positions[i]!)
    }
    const indices: number[] = []
    for (let i = 0; i < data.indices.length; i++) {
      indices.push(data.indices[i]!)
    }
    const indexed = indexedMeshFromFlat(flatPositions, indices, data.faceGroups)
    const validation = validateMesh(indexed, center)

    const obj = primitiveBoxToSceneObject(type, box, ha, 0x6ecbf5, 48)
    const inward = obj ? inwardFromObj(obj.positions, obj.faces) : -1

    const label = `${type} @ ${view}`
    if (!validation.ok || inward > 0) {
      console.error(
        `FAIL ${label}: validate ok=${validation.ok} inward=${inward} issues=${validation.issues.length}`
      )
      validation.issues.slice(0, 3).forEach((i) => console.error(`  - ${i.message}`))
      failures++
    } else {
      console.log(
        `OK   ${label}: ${obj?.faces.length ?? 0} faces, ${obj?.positions.length ?? 0} verts, inward=0`
      )
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures} primitive validation failure(s)`)
  process.exit(1)
}
console.log('\nAll primitive validations passed.')
