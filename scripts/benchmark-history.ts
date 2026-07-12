import { performance } from 'node:perf_hooks'
import type { SceneObject } from '../src/mesh/HalfEdgeMesh'
import {
  captureSceneSnapshot,
  snapshotsEqual,
  type SceneSnapshot,
} from '../src/history/sceneHistory'

function createGrid(id: string, size: number): SceneObject {
  const positions = Array.from({ length: (size + 1) * (size + 1) }, (_, index) => ({
    x: index % (size + 1),
    y: Math.floor(index / (size + 1)),
    z: Math.sin(index * 0.01) * 0.1,
  }))
  const faces: number[][] = []
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const a = y * (size + 1) + x
      faces.push([a, a + 1, a + size + 2, a + size + 1])
    }
  }
  return {
    id,
    name: id,
    positions,
    faces,
    faceColors: new Array(faces.length).fill(0x6ecbf5),
    topologyLocked: false,
    polyBudget: faces.length,
    polyBudgetMode: 'adaptive',
    smoothShading: false,
    facetExaggeration: 0,
    color: 0x6ecbf5,
  }
}

function snapshot(objects: SceneObject[]): SceneSnapshot {
  return {
    objects,
    objectTextures: {},
    pixelDocuments: {},
    referenceImages: [],
    billboardImages: [],
    selectedObjectId: objects[0]?.id ?? null,
    selectionObjectIds: objects[0] ? [objects[0].id] : [],
    meshSelection: null,
  }
}

const input = snapshot([createGrid('grid-100', 100)])
const previous = captureSceneSnapshot(input)

// One untimed pass gives memoized implementations a realistic steady-state warm-up.
const warm = captureSceneSnapshot(input, previous)
snapshotsEqual(previous, warm)

const iterations = 20
const start = performance.now()
for (let i = 0; i < iterations; i++) {
  const captured = captureSceneSnapshot(input, previous)
  if (!snapshotsEqual(previous, captured)) throw new Error('Unchanged snapshot compared unequal')
}
const elapsed = performance.now() - start

const preciseEdit = structuredClone(input)
preciseEdit.objects[0].positions[0].x += 0.000001
if (snapshotsEqual(previous, captureSceneSnapshot(preciseEdit))) {
  throw new Error('Precise vertex edit was not detected')
}
const colorEdit = structuredClone(input)
colorEdit.objects[0].faceColors[0] = 0x00ff00
if (snapshotsEqual(previous, captureSceneSnapshot(colorEdit))) {
  throw new Error('Face color edit was not detected')
}

console.log(`History unchanged grid: ${input.objects[0].positions.length} vertices, ${input.objects[0].faces.length} faces`)
console.log(`${iterations} capture + equality passes: ${elapsed.toFixed(2)}ms (${(elapsed / iterations).toFixed(2)}ms/pass)`)
console.log('Correctness checks: precise vertex and face color edits detected')
