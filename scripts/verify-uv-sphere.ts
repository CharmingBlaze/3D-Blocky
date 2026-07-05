/**
 * Verify CAD UV sphere has all faces pointing outward (every height axis).
 * Run: npx tsx scripts/verify-uv-sphere.ts
 */
import { createInscribedUvSphere } from '../src/primitives/primitivesBox'
import { primitiveBoxToSceneObject } from '../src/primitives/primitiveBoxCommit'
import { HalfEdgeMesh } from '../src/mesh/HalfEdgeMesh'
import { heightAxisForView } from '../src/primitives/viewAxes'

const center = { x: 0, y: 0, z: 0 }
const size = { x: 2, y: 2, z: 2 }
const box = { min: { x: -1, y: -1, z: -1 }, max: { x: 1, y: 1, z: 1 } }

function inwardCount(mesh: HalfEdgeMesh, cx: number, cy: number, cz: number): number {
  let inward = 0
  for (const face of mesh.faces) {
    const a = mesh.positions[face[0]!]!
    const b = mesh.positions[face[1]!]!
    const c = mesh.positions[face[2]!]!
    const ux = b.x - a.x
    const uy = b.y - a.y
    const uz = b.z - a.z
    const vx = c.x - a.x
    const vy = c.y - a.y
    const vz = c.z - a.z
    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx
    const fx = (a.x + b.x + c.x) / 3
    const fy = (a.y + b.y + c.y) / 3
    const fz = (a.z + b.z + c.z) / 3
    const dot = nx * (fx - cx) + ny * (fy - cy) + nz * (fz - cz)
    if (dot < 0) inward++
  }
  return inward
}

let failures = 0
for (const view of ['front', 'side', 'top'] as const) {
  const ha = heightAxisForView(view)
  const obj = primitiveBoxToSceneObject('sphere', box, ha, 0x6ecbf5, 48)
  if (!obj) {
    console.error(`FAIL commit sphere @ ${view}: null`)
    failures++
    continue
  }
  const mesh = HalfEdgeMesh.fromObject(obj)
  const inward = inwardCount(mesh, center.x, center.y, center.z)
  const label = `CAD sphere commit @ ${view} (axis ${ha})`
  if (inward > 0) {
    console.error(`FAIL ${label}: inward=${inward}/${mesh.faces.length}`)
    failures++
  } else {
    console.log(`OK   ${label}: ${mesh.faces.length} faces, ${mesh.positions.length} verts`)
  }
}

for (const ha of [0, 1, 2] as const) {
  const data = createInscribedUvSphere(center, size, ha, 8)
  const triCount = data.indices.length / 3
  const label = `UV sphere meshData heightAxis=${ha}`
  if (triCount < 40) {
    console.error(`FAIL ${label}: only ${triCount} triangles`)
    failures++
  } else {
    console.log(`OK   ${label}: ${triCount} triangles`)
  }
}

if (failures > 0) process.exit(1)
console.log('All UV sphere checks passed.')
