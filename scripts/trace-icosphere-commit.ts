/**
 * End-to-end trace: CAD Icosphere UI commit path → render-ready mesh.
 * Run: npx tsx scripts/trace-icosphere-commit.ts
 */
import { meshDataToHalfEdgeMesh } from '../src/blob/adapters'
import { HalfEdgeMesh, type SceneObject } from '../src/mesh/HalfEdgeMesh'
import {
  computeFaceNormal,
  faceCentroid,
  meshCentroid,
  validateMesh,
  indexedMeshFromFlat,
  type TriangleFace,
} from '../src/mesh/MeshBuilder'
import { ensurePositiveVolume, meshSignedVolume, countNakedEdges } from '../src/mesh/meshWinding'
import { prepareSceneObject } from '../src/mesh/objectTransform'
import { createInscribedIcosphere, createPrimitiveInBox } from '../src/primitives/primitivesBox'
import { primitiveBoxToSceneObject } from '../src/primitives/primitiveBoxCommit'
import { heightAxisForView } from '../src/primitives/viewAxes'
import { resolveFlatShading } from '../src/rendering/viewportDisplay'
import type { Vec3 } from '../src/utils/math'

function countInwardFaces(positions: readonly Vec3[], faces: readonly number[][], ref: Vec3): number {
  let inward = 0
  for (const face of faces) {
    if (face.length !== 3) continue
    const tri = face as TriangleFace
    const n = computeFaceNormal(positions, tri)
    const c = faceCentroid(positions, tri)
    const dot = n.x * (c.x - ref.x) + n.y * (c.y - ref.y) + n.z * (c.z - ref.z)
    if (dot < 0) inward++
  }
  return inward
}

function traceStage(label: string, positions: readonly Vec3[], faces: readonly number[][], ref: Vec3) {
  const inward = countInwardFaces(positions, faces, ref)
  console.log(
    `[${label}] positions=${positions.length} faces=${faces.length} inward=${inward} signedVol=${meshSignedVolume({ positions: [...positions], faces: faces.map((f) => [...f]), faceColors: [], halfEdges: [], topologyLocked: false, uvs: [], faceUvIndices: [], cornerColors: [], faceColorIndices: [], faceGroups: [], buildHalfEdges() {}, getVertexNeighbors() { return [] }, getVertexNormal() { return { x: 0, y: 1, z: 0 } }, toMeshData() { throw new Error() }, vertexCount() { return positions.length }, faceCount() { return faces.length } } as unknown as HalfEdgeMesh).toFixed(4)} naked=${countNakedEdges({ positions: [...positions], faces: faces.map((f) => [...f]), faceColors: [], halfEdges: [], topologyLocked: false, uvs: [], faceUvIndices: [], cornerColors: [], faceColorIndices: [], faceGroups: [], buildHalfEdges() {}, getVertexNeighbors() { return [] }, getVertexNormal() { return { x: 0, y: 1, z: 0 } }, toMeshData() { throw new Error() }, vertexCount() { return positions.length }, faceCount() { return faces.length } } as unknown as HalfEdgeMesh)}`
  )
}

function traceHalfEdge(label: string, mesh: HalfEdgeMesh, ref: Vec3) {
  const inward = countInwardFaces(mesh.positions, mesh.faces, ref)
  console.log(
    `[${label}] positions=${mesh.positions.length} faces=${mesh.faces.length} inward=${inward} signedVol=${meshSignedVolume(mesh).toFixed(4)} naked=${countNakedEdges(mesh)}`
  )
}

function traceRenderMesh(label: string, obj: SceneObject, displayMode: 'model' | 'flat' = 'model') {
  const mesh = HalfEdgeMesh.fromObject(obj)
  const flatShading = resolveFlatShading(displayMode, obj.smoothShading)
  const data = mesh.toMeshData(flatShading, obj.facetExaggeration ?? 0)
  const positions: Vec3[] = []
  for (let i = 0; i < data.positions.length; i += 3) {
    positions.push({
      x: data.positions[i]!,
      y: data.positions[i + 1]!,
      z: data.positions[i + 2]!,
    })
  }
  const faces: number[][] = []
  for (let t = 0; t < data.indices.length; t += 3) {
    faces.push([data.indices[t]!, data.indices[t + 1]!, data.indices[t + 2]!])
  }
  const ref = meshCentroid(positions)
  traceStage(`${label} (render ${displayMode}, flat=${flatShading})`, positions, faces, ref)
}

const box = { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } }
const heightAxis = heightAxisForView('front')
const center = { x: 0, y: 0, z: 0 }

console.log('=== Step 1: createInscribedIcosphere ===')
const raw = createInscribedIcosphere(center, { x: 2, y: 2, z: 2 }, 8)
console.log(`MeshData: positions=${raw.positions.length / 3} indices=${raw.indices.length / 3} tris`)

const preIndexed = indexedMeshFromFlat(
  Array.from(raw.positions),
  Array.from(raw.indices)
)
const preVal = validateMesh(preIndexed, center)
console.log(`validateMesh (reconstructed from MeshData): ok=${preVal.ok} inward=${preVal.issues.filter((i) => i.code === 'inward_face').length}`)

console.log('\n=== Step 2: createPrimitiveInBox ===')
const data = createPrimitiveInBox('icosphere', box, heightAxis, 8)
console.log(`MeshData: positions=${data.positions.length / 3} indices=${data.indices.length / 3} tris`)

console.log('\n=== Step 3: meshDataToHalfEdgeMesh (before ensurePositiveVolume) ===')
const meshBefore = meshDataToHalfEdgeMesh(data, 0x6ecbf5)
traceHalfEdge('after adapter', meshBefore, center)

console.log('\n=== Step 4: ensurePositiveVolume ===')
const volBefore = meshSignedVolume(meshBefore)
const meshAfter = HalfEdgeMesh.fromObject(meshBefore.toObject('t', 't'))
ensurePositiveVolume(meshAfter)
traceHalfEdge(`after ensurePositiveVolume (vol before=${volBefore.toFixed(4)})`, meshAfter, center)

console.log('\n=== Step 5: primitiveBoxToSceneObject (full commit) ===')
const obj = primitiveBoxToSceneObject('icosphere', box, heightAxis, 0x6ecbf5, 64)
if (!obj) {
  console.error('primitiveBoxToSceneObject returned null')
  process.exit(1)
}
console.log(`SceneObject: positions=${obj.positions.length} faces=${obj.faces.length} (UI shows ${obj.positions.length}v)`)
traceHalfEdge('committed SceneObject', HalfEdgeMesh.fromObject(obj), center)

console.log('\n=== Step 6: prepareSceneObject (already applied in commit) ===')
const prepared = prepareSceneObject(obj)
traceHalfEdge('prepared', HalfEdgeMesh.fromObject(prepared), center)

console.log('\n=== Step 7: render path (HalfEdgeMesh.toMeshData → THREE) ===')
traceRenderMesh('final', prepared, 'model')
traceRenderMesh('final', prepared, 'flat')

console.log('\nDone.')
