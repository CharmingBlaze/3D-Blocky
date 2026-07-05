/**
 * Verify primitive / vector shape face winding after generation.
 * Run: npx tsx scripts/verify-winding.ts
 */
import { vectorShapeToObject } from '../src/mesh/lowPolyPrimitives'
import { primitiveBoxToSceneObject } from '../src/primitives/primitiveBoxCommit'
import { HalfEdgeMesh } from '../src/mesh/HalfEdgeMesh'
import {
  countNakedEdges,
  meshSignedVolume,
  orientOpenMeshTowardView,
} from '../src/mesh/meshWinding'
import { viewTowardCamera } from '../src/stroke/worldProjection'
import { faceNormal3D } from '../src/uv/uvObject'
import type { ShapeKind } from '../src/vector/types'
import type { PrimitiveBoxType } from '../src/primitives/primitivesBox'
import { heightAxisForView } from '../src/primitives/viewAxes'

const VIEWS = ['front', 'side', 'top'] as const
const SHAPES: ShapeKind[] = [
  'sphere',
  'circle',
  'box',
  'roundedBox',
  'plane',
  'cylinder',
  'capsule',
  'pyramid',
  'cone',
]
const PRIMITIVES: PrimitiveBoxType[] = [
  'box',
  'roundedBox',
  'icosphere',
  'sphere',
  'cone',
  'cylinder',
  'capsule',
  'pyramid',
]

const dragA = { x: -20, y: -20 }
const dragB = { x: 20, y: 20 }
const boxMin = { x: -1, y: -1, z: -1 }
const boxMax = { x: 1, y: 1, z: 1 }

let failures = 0

function checkClosed(name: string, obj: ReturnType<typeof vectorShapeToObject>, welded = true) {
  if (!obj) {
    console.error(`FAIL ${name}: null object`)
    failures++
    return
  }
  const mesh = HalfEdgeMesh.fromObject(obj)
  if (welded) {
    const naked = countNakedEdges(mesh)
    if (naked > 0) {
      console.error(`FAIL ${name}: expected welded closed mesh, ${naked} naked edges`)
      failures++
      return
    }
  }
  const volume = meshSignedVolume(mesh)
  if (volume <= 0) {
    console.error(`FAIL ${name}: non-positive signed volume (${volume})`)
    failures++
    return
  }
  console.log(`OK   ${name}`)
}

function checkOpenDisc(name: string, obj: ReturnType<typeof vectorShapeToObject>, view: (typeof VIEWS)[number]) {
  if (!obj) {
    console.error(`FAIL ${name}: null object`)
    failures++
    return
  }
  const mesh = HalfEdgeMesh.fromObject(obj)
  orientOpenMeshTowardView(mesh, view)
  const toward = viewTowardCamera(view)
  const n = faceNormal3D(mesh.toObject('t', 't'), 0)
  const dot = n.x * toward.x + n.y * toward.y + n.z * toward.z
  if (dot <= 0) {
    console.error(`FAIL ${name}: disc normal faces away from camera (dot=${dot})`)
    failures++
    return
  }
  console.log(`OK   ${name}`)
}

console.log('=== Vector shapes ===')
for (const view of VIEWS) {
  for (const kind of SHAPES) {
    const label = `${kind} @ ${view}`
    const obj = vectorShapeToObject(kind, dragA, dragB, {
      view,
      depth: 0,
      polyBudget: 64,
      color: 0xffffff,
      ...(kind === 'roundedBox'
        ? { roundedBoxParams: { roundness: 0.25, subdivisions: 1 } }
        : {}),
    })
    if (kind === 'circle') checkOpenDisc(label, obj, view)
    else if (kind === 'plane') console.log(`SKIP ${label} (double-sided sheet)`)
    else checkClosed(label, obj)
  }
}

console.log('\n=== CAD primitives ===')
for (const view of VIEWS) {
  for (const type of PRIMITIVES) {
    const label = `${type} box @ ${view} height`
    const obj = primitiveBoxToSceneObject(
      type,
      { min: boxMin, max: boxMax },
      heightAxisForView(view),
      0xffffff,
      64,
      { roundness: 0.25, subdivisions: 1 }
    )
    checkClosed(label, obj, false)
  }
}

console.log(`\n${failures === 0 ? 'All winding checks passed.' : `${failures} check(s) failed.`}`)
process.exit(failures === 0 ? 0 : 1)
