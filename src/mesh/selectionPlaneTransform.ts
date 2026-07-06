import * as THREE from 'three'
import type { ViewType } from '../store/appStore'
import type { OrthoViewType } from '../scene/viewTypes'
import { normalizeViewType } from '../scene/viewTypes'
import type { ViewMoveBasis } from '../utils/viewNavigation'
import { orthoViewNudgeDelta } from '../utils/viewNavigation'
import type { SceneObject } from './HalfEdgeMesh'
import {
  ensureTransform,
  localPointFromWorld,
  worldPointFromObject,
} from './objectTransform'
import { meshSelectionWorldCenter, type MeshComponentSelection } from './meshSelection'
import type { Vec3 } from '../utils/math'

export type SelectionPlaneTransformOp = 'flipH' | 'flipV' | 'rotate90'

export interface ViewScreenAxes {
  right: Vec3
  up: Vec3
  forward: Vec3
}

const _axis = new THREE.Vector3()
const _pivot = new THREE.Vector3()
const _point = new THREE.Vector3()
const _q = new THREE.Quaternion()

export function viewScreenAxes(
  view: ViewType,
  perspectiveBasis: ViewMoveBasis | null
): ViewScreenAxes | null {
  if (view === 'perspective') {
    if (!perspectiveBasis) return null
    const right = perspectiveBasis.right
    const up = perspectiveBasis.up
    const forward = cross3(up, right)
    const len = length3(forward)
    if (len < 1e-8) return null
    return {
      right,
      up,
      forward: scale3(forward, 1 / len),
    }
  }

  const ortho = normalizeViewType(view) as OrthoViewType
  const right = orthoViewNudgeDelta(ortho, 'right', 1)
  const up = orthoViewNudgeDelta(ortho, 'up', 1)
  const forward = cross3(up, right)
  return { right, up, forward }
}

function cross3(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}

function length3(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z)
}

function scale3(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s }
}

function reflectWorldPoint(world: Vec3, pivot: Vec3, axis: Vec3): Vec3 {
  const dx = world.x - pivot.x
  const dy = world.y - pivot.y
  const dz = world.z - pivot.z
  const dot = 2 * (dx * axis.x + dy * axis.y + dz * axis.z)
  return {
    x: world.x - dot * axis.x,
    y: world.y - dot * axis.y,
    z: world.z - dot * axis.z,
  }
}

function rotateWorldPoint(world: Vec3, pivot: Vec3, axis: Vec3, angleRad: number): Vec3 {
  _pivot.set(pivot.x, pivot.y, pivot.z)
  _point.set(world.x, world.y, world.z)
  _axis.set(axis.x, axis.y, axis.z)
  _q.setFromAxisAngle(_axis, angleRad)
  _point.sub(_pivot).applyQuaternion(_q).add(_pivot)
  return { x: _point.x, y: _point.y, z: _point.z }
}

function transformWorldPoint(
  world: Vec3,
  pivot: Vec3,
  op: SelectionPlaneTransformOp,
  axes: ViewScreenAxes
): Vec3 {
  if (op === 'flipH') return reflectWorldPoint(world, pivot, axes.right)
  if (op === 'flipV') return reflectWorldPoint(world, pivot, axes.up)
  return rotateWorldPoint(world, pivot, axes.forward, -Math.PI / 2)
}

function flipFacesTouchingVertices(obj: SceneObject, vertexIndices: Set<number>): number[][] {
  return obj.faces.map((face) =>
    face.some((vi) => vertexIndices.has(vi)) ? [...face].reverse() : [...face]
  )
}

function pivotForVertices(
  obj: SceneObject,
  vertexIndices: Set<number>,
  selection: MeshComponentSelection | null
): Vec3 {
  if (
    selection &&
    selection.objectId === obj.id &&
    vertexIndices.size > 0 &&
    vertexIndices.size < obj.positions.length
  ) {
    return meshSelectionWorldCenter(obj, selection)
  }
  return { ...ensureTransform(obj).position }
}

export function applySelectionPlaneTransform(
  obj: SceneObject,
  vertexIndices: Set<number>,
  op: SelectionPlaneTransformOp,
  axes: ViewScreenAxes,
  selection: MeshComponentSelection | null = null
): SceneObject {
  if (vertexIndices.size === 0) return obj

  const pivot = pivotForVertices(obj, vertexIndices, selection)
  const positions = obj.positions.map((p, i) => {
    if (!vertexIndices.has(i)) return { ...p }
    const world = worldPointFromObject(obj, p)
    const next = transformWorldPoint(world, pivot, op, axes)
    return localPointFromWorld(obj, next)
  })

  const faces =
    op === 'rotate90' ? obj.faces.map((f) => [...f]) : flipFacesTouchingVertices(obj, vertexIndices)

  return { ...obj, positions, faces }
}

export function allVertexIndices(obj: SceneObject): Set<number> {
  return new Set(obj.positions.map((_, i) => i))
}
