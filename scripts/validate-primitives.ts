/**
 * Log validateMesh results for every CAD primitive type.
 * Run: npm run validate:primitives
 */
import { createPrimitiveInBox, type PrimitiveBoxType } from '../src/primitives/primitivesBox'
import { primitiveBoxToSceneObject } from '../src/primitives/primitiveBoxCommit'
import { heightAxisForView } from '../src/primitives/viewAxes'
import { validateMesh, indexedMeshFromFlat, computeFaceNormal, faceCentroid } from '../src/mesh/MeshBuilder'
import { weldSceneObjectCoincidentVertices } from '../src/mesh/subdivisionSurface'
import { roundedBoxFromWorldBox } from '../src/mesh/roundedBox'
import { prepareSceneObject } from '../src/mesh/objectTransform'

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

for (const view of ['front', 'right', 'top'] as const) {
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
    const unwelded =
      obj != null &&
      weldSceneObjectCoincidentVertices(obj).positions.length < obj.positions.length

    const label = `${type} @ ${view}`
    if (!validation.ok || inward > 0 || unwelded) {
      console.error(
        `FAIL ${label}: validate ok=${validation.ok} inward=${inward} unwelded=${unwelded} issues=${validation.issues.length}`
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

const rounded = prepareSceneObject(
  roundedBoxFromWorldBox(box, 0x6ecbf5, { roundness: 0.25, subdivisions: 1 }, 48)
)
const roundedWelded = weldSceneObjectCoincidentVertices(rounded)
if (roundedWelded.positions.length < rounded.positions.length) {
  console.error('FAIL roundedBox: unwelded coincident vertices remain after commit')
  failures++
} else {
  console.log(`OK   roundedBox: ${rounded.faces.length} faces, ${rounded.positions.length} verts, inward=0`)
}

if (failures > 0) {
  console.error(`\n${failures} primitive validation failure(s)`)
  process.exit(1)
}
console.log('\nAll primitive validations passed.')
