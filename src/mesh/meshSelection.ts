import type { SceneObject } from './HalfEdgeMesh'
import type { Vec3 } from '../utils/math'
import * as THREE from 'three'
import { localPointFromWorld, worldPointFromObject } from './objectTransform'

export interface MeshComponentSelection {
  objectId: string
  vertices: number[]
  edges: string[]
  faces: number[]
}

export function edgeKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`
}

export function parseEdgeKey(key: string): [number, number] {
  const [a, b] = key.split('-').map(Number)
  return [a, b]
}

export function emptyMeshSelection(objectId: string): MeshComponentSelection {
  return { objectId, vertices: [], edges: [], faces: [] }
}

export function getAffectedVertices(
  selection: MeshComponentSelection,
  obj: SceneObject
): Set<number> {
  const verts = new Set<number>()
  for (const vi of selection.vertices) verts.add(vi)
  for (const key of selection.edges) {
    const [a, b] = parseEdgeKey(key)
    verts.add(a)
    verts.add(b)
  }
  for (const fi of selection.faces) {
    const face = obj.faces[fi]
    if (!face) continue
    for (const vi of face) verts.add(vi)
  }
  return verts
}

export function selectionHasComponents(selection: MeshComponentSelection | null): boolean {
  if (!selection) return false
  return selection.vertices.length > 0 || selection.edges.length > 0 || selection.faces.length > 0
}

export function translateVertexPositions(
  obj: SceneObject,
  vertexIndices: Set<number>,
  basePositions: Record<number, Vec3>,
  localDelta: Vec3
): Vec3[] {
  return obj.positions.map((p, i) => {
    if (!vertexIndices.has(i) || !basePositions[i]) return { ...p }
    const base = basePositions[i]
    return {
      x: base.x + localDelta.x,
      y: base.y + localDelta.y,
      z: base.z + localDelta.z,
    }
  })
}

export function meshSelectionWorldCenter(
  object: SceneObject,
  selection: MeshComponentSelection
): Vec3 {
  const verts = getAffectedVertices(selection, object)
  if (verts.size === 0) return { x: 0, y: 0, z: 0 }

  let x = 0
  let y = 0
  let z = 0
  for (const vi of verts) {
    const w = worldPointFromObject(object, object.positions[vi])
    x += w.x
    y += w.y
    z += w.z
  }
  const n = verts.size
  return { x: x / n, y: y / n, z: z / n }
}

const _startM = new THREE.Matrix4()
const _curM = new THREE.Matrix4()
const _w = new THREE.Vector3()

/** Apply move / rotate / scale gizmo delta to selected mesh vertices in world space. */
export function transformMeshSelectionWithGizmo(
  object: SceneObject,
  vertexIndices: Set<number>,
  basePositions: Record<number, Vec3>,
  _pivotWorld: Vec3,
  startPosition: THREE.Vector3,
  startQuaternion: THREE.Quaternion,
  startScale: THREE.Vector3,
  currentPosition: THREE.Vector3,
  currentQuaternion: THREE.Quaternion,
  currentScale: THREE.Vector3
): Vec3[] {
  _startM.compose(startPosition, startQuaternion, startScale)
  _curM.compose(currentPosition, currentQuaternion, currentScale)

  const invStart = _startM.clone().invert()

  const snapshot: SceneObject = {
    ...object,
    positions: object.positions.map((p, i) => basePositions[i] ?? p),
  }

  return object.positions.map((p, i) => {
    if (!vertexIndices.has(i) || !basePositions[i]) return { ...p }

    const world = worldPointFromObject(snapshot, basePositions[i])
    _w.set(world.x, world.y, world.z)
    _w.applyMatrix4(invStart).applyMatrix4(_curM)

    return localPointFromWorld(object, { x: _w.x, y: _w.y, z: _w.z })
  })
}
