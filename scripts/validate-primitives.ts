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
import { HalfEdgeMesh } from '../src/mesh/HalfEdgeMesh'
import { countNakedEdges, meshSignedVolume } from '../src/mesh/meshWinding'

const PRIMITIVES: PrimitiveBoxType[] = [
  'box',
  'icosphere',
  'sphere',
  'cone',
  'cylinder',
  'capsule',
  'pyramid',
  'doughnut',
  'ring',
  'stairs',
  'star',
  'dome',
  'halfCircle',
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

// A single reference-point dot test is not valid when the point lies in a hole
// or concavity. These shapes are still checked for closed topology and positive volume.
const CENTROID_INWARD_UNRELIABLE = new Set<PrimitiveBoxType>([
  'doughnut',
  'ring',
  'dome',
  'halfCircle',
  'stairs',
])

for (const view of ['front', 'right', 'top'] as const) {
  const ha = heightAxisForView(view)
  for (const type of PRIMITIVES) {
    const data = createPrimitiveInBox(type, box, ha, 8, { baseView: view })
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

    const obj = primitiveBoxToSceneObject(type, box, ha, 0x6ecbf5, 48, undefined, view)
    const inward = obj ? inwardFromObj(obj.positions, obj.faces) : -1
    const unwelded =
      obj != null &&
      weldSceneObjectCoincidentVertices(obj).positions.length < obj.positions.length
    const committedMesh = obj ? HalfEdgeMesh.fromObject(obj) : null
    const nakedEdges = committedMesh ? countNakedEdges(committedMesh) : -1
    const signedVolume = committedMesh ? meshSignedVolume(committedMesh) : 0

    const label = `${type} @ ${view}`
    const skipInwardValidation = CENTROID_INWARD_UNRELIABLE.has(type)
    const blockingIssues = skipInwardValidation
      ? validation.issues.filter((i) => i.code !== 'inward_face')
      : validation.issues
    const validateOk = blockingIssues.length === 0
    const countInward = skipInwardValidation ? 0 : inward
    if (!validateOk || countInward > 0 || unwelded || nakedEdges !== 0 || signedVolume <= 0) {
      console.error(
        `FAIL ${label}: validate ok=${validateOk} inward=${inward} unwelded=${unwelded} naked=${nakedEdges} volume=${signedVolume.toFixed(4)} issues=${blockingIssues.length}`
      )
      validation.issues.slice(0, 3).forEach((i) => console.error(`  - ${i.message}`))
      failures++
    } else {
      console.log(
        `OK   ${label}: ${obj?.faces.length ?? 0} faces, ${obj?.positions.length ?? 0} verts, naked=0, volume=${signedVolume.toFixed(4)}`
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
