import * as THREE from 'three'
import type { SceneObject } from './HalfEdgeMesh'
import {
  edgeKey,
  parseEdgeKey,
  getAffectedVertices,
  type MeshComponentSelection,
} from './meshSelection'
import type { SelectionMode } from '../store/appStore'
import {
  add3,
  faceNormal,
  normalize3,
  scale3,
  type Vec3,
} from '../utils/math'
import { transformMeshSelectionWithGizmo } from './meshSelection'

import { cloneObjectUVs } from '../uv/uvObject'

export function cloneSceneObject(obj: SceneObject): SceneObject {
  const { uvs, faceUvIndices } = cloneObjectUVs(obj)
  return {
    ...obj,
    positions: obj.positions.map((p) => ({ ...p })),
    faces: obj.faces.map((f) => [...f]),
    faceColors: [...obj.faceColors],
    faceGroups: obj.faceGroups?.map((g) => [...g]),
    uvs: uvs.length > 0 ? uvs : obj.uvs,
    faceUvIndices: faceUvIndices.length > 0 ? faceUvIndices : obj.faceUvIndices,
    pivot: obj.pivot ? { ...obj.pivot } : undefined,
    transform: obj.transform
      ? {
          position: { ...obj.transform.position },
          rotation: { ...obj.transform.rotation },
          scale: { ...obj.transform.scale },
        }
      : undefined,
    primitiveSource: obj.primitiveSource
      ? {
          ...obj.primitiveSource,
          box: {
            min: { ...obj.primitiveSource.box.min },
            max: { ...obj.primitiveSource.box.max },
          },
          roundedParams: obj.primitiveSource.roundedParams
            ? { ...obj.primitiveSource.roundedParams }
            : undefined,
        }
      : undefined,
    sketchSource: obj.sketchSource
      ? {
          ...obj.sketchSource,
          relative: obj.sketchSource.relative.map((point) => ({ ...point })),
          center: { ...obj.sketchSource.center },
        }
      : undefined,
  }
}

function collectExtrudeFaces(
  obj: SceneObject,
  selection: MeshComponentSelection,
  mode: SelectionMode
): Set<number> {
  const faces = new Set<number>()
  if (mode === 'face') {
    for (const fi of selection.faces) faces.add(fi)
    return faces
  }
  if (mode === 'edge') {
    for (const key of selection.edges) {
      const [a, b] = parseEdgeKey(key)
      for (let fi = 0; fi < obj.faces.length; fi++) {
        const face = obj.faces[fi]
        for (let i = 0; i < face.length; i++) {
          const va = face[i]
          const vb = face[(i + 1) % face.length]
          if ((va === a && vb === b) || (va === b && vb === a)) faces.add(fi)
        }
      }
    }
    return faces
  }
  if (mode === 'vertex') {
    const verts = new Set(selection.vertices)
    for (let fi = 0; fi < obj.faces.length; fi++) {
      if (obj.faces[fi].some((vi) => verts.has(vi))) faces.add(fi)
    }
  }
  return faces
}

function collectBevelEdges(
  obj: SceneObject,
  selection: MeshComponentSelection,
  mode: SelectionMode
): string[] {
  if (mode === 'edge') return [...selection.edges]
  if (mode === 'face') {
    const faceSet = new Set(selection.faces)
    const edgeCount = new Map<string, number>()
    for (const fi of faceSet) {
      const face = obj.faces[fi]
      for (let i = 0; i < face.length; i++) {
        const key = edgeKey(face[i], face[(i + 1) % face.length])
        edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1)
      }
    }
    return [...edgeCount.entries()].filter(([, c]) => c === 1).map(([k]) => k)
  }
  if (mode === 'vertex') {
    const verts = new Set(selection.vertices)
    const keys = new Set<string>()
    for (const face of obj.faces) {
      for (let i = 0; i < face.length; i++) {
        const a = face[i]
        const b = face[(i + 1) % face.length]
        if (verts.has(a) && verts.has(b)) keys.add(edgeKey(a, b))
      }
    }
    return [...keys]
  }
  return []
}

/** Region extrude — duplicates selected-region verts and adds side faces. */
export function extrudeMeshSelection(
  obj: SceneObject,
  selection: MeshComponentSelection,
  mode: SelectionMode,
  distance: number
): SceneObject {
  const faceSet = collectExtrudeFaces(obj, selection, mode)
  if (faceSet.size === 0 || Math.abs(distance) < 1e-8) return cloneSceneObject(obj)

  const positions = obj.positions.map((p) => ({ ...p }))
  const faces = obj.faces.map((f) => [...f])
  const faceColors = [...obj.faceColors]

  const selectedVerts = new Set<number>()
  for (const fi of faceSet) {
    for (const vi of faces[fi]) selectedVerts.add(vi)
  }

  const edgeInSelected = new Map<string, number>()
  for (const fi of faceSet) {
    const face = faces[fi]
    for (let i = 0; i < face.length; i++) {
      const key = edgeKey(face[i], face[(i + 1) % face.length])
      edgeInSelected.set(key, (edgeInSelected.get(key) ?? 0) + 1)
    }
  }

  const vertAccum = new Map<number, { sum: Vec3; count: number }>()
  for (const fi of faceSet) {
    const face = faces[fi]
    const n = faceNormal(
      positions[face[0]],
      positions[face[1]],
      positions[face[2] ?? face[0]]
    )
    for (const vi of face) {
      const entry = vertAccum.get(vi) ?? { sum: { x: 0, y: 0, z: 0 }, count: 0 }
      entry.sum = add3(entry.sum, n)
      entry.count++
      vertAccum.set(vi, entry)
    }
  }

  const vertNormal = new Map<number, Vec3>()
  for (const [vi, entry] of vertAccum) {
    vertNormal.set(vi, normalize3(scale3(entry.sum, 1 / entry.count)))
  }

  const oldToNew = new Map<number, number>()
  for (const vi of selectedVerts) {
    const n = vertNormal.get(vi) ?? { x: 0, y: 1, z: 0 }
    const p = positions[vi]
    oldToNew.set(vi, positions.length)
    positions.push({
      x: p.x + n.x * distance,
      y: p.y + n.y * distance,
      z: p.z + n.z * distance,
    })
  }

  for (const fi of faceSet) {
    const topFace = faces[fi].map((vi) => oldToNew.get(vi)!)
    faces.push(topFace)
    faceColors.push(faceColors[fi] ?? obj.color)
  }

  const sideColor = faceColors[[...faceSet][0]] ?? obj.color
  for (const [key, count] of edgeInSelected) {
    if (count !== 1) continue
    const [a, b] = parseEdgeKey(key)
    const na = oldToNew.get(a)!
    const nb = oldToNew.get(b)!
    faces.push([a, b, nb, na])
    faceColors.push(sideColor)
  }

  return { ...obj, positions, faces, faceColors }
}

export function bevelMeshSelection(
  obj: SceneObject,
  selection: MeshComponentSelection,
  mode: SelectionMode,
  width: number
): SceneObject {
  const edgeKeys = collectBevelEdges(obj, selection, mode)
  if (edgeKeys.length === 0 || width <= 1e-8) return cloneSceneObject(obj)

  const positions = obj.positions.map((p) => ({ ...p }))
  let faces = obj.faces.map((f) => [...f])
  const faceColors = [...obj.faceColors]

  for (const key of edgeKeys) {
    const [a, b] = parseEdgeKey(key)
    if (a >= positions.length || b >= positions.length) continue

    const pa = positions[a]
    const pb = positions[b]
    const adjacentNormals: Vec3[] = []

    for (let fi = 0; fi < faces.length; fi++) {
      const face = faces[fi]
      for (let i = 0; i < face.length; i++) {
        const va = face[i]
        const vb = face[(i + 1) % face.length]
        if ((va === a && vb === b) || (va === b && vb === a)) {
          adjacentNormals.push(
            faceNormal(
              positions[face[0]],
              positions[face[1]],
              positions[face[2] ?? face[0]]
            )
          )
        }
      }
    }

    let bevelDir = { x: 0, y: 1, z: 0 }
    if (adjacentNormals.length > 0) {
      bevelDir = normalize3(
        adjacentNormals.reduce((acc, n) => add3(acc, n), { x: 0, y: 0, z: 0 })
      )
    }

    const mid = positions.length
    positions.push({
      x: (pa.x + pb.x) / 2 + bevelDir.x * width,
      y: (pa.y + pb.y) / 2 + bevelDir.y * width,
      z: (pa.z + pb.z) / 2 + bevelDir.z * width,
    })

    const newFaces: number[][] = []
    for (let fi = 0; fi < faces.length; fi++) {
      const face = faces[fi]
      let replaced = false
      for (let i = 0; i < face.length; i++) {
        const va = face[i]
        const vb = face[(i + 1) % face.length]
        if (va === a && vb === b) {
          newFaces.push([...face.slice(0, i + 1), mid, ...face.slice(i + 1)])
          replaced = true
          break
        }
        if (va === b && vb === a) {
          newFaces.push([...face.slice(0, i + 1), mid, ...face.slice(i + 1)])
          replaced = true
          break
        }
      }
      if (!replaced) newFaces.push(face)
    }
    faces = newFaces
  }

  return { ...obj, positions, faces, faceColors }
}

const _pivot = new THREE.Vector3()
const _axis = new THREE.Vector3()

export function rotateMeshSelection(
  obj: SceneObject,
  selection: MeshComponentSelection,
  angleRad: number,
  pivotWorld: Vec3,
  axis: Vec3 = { x: 0, y: 1, z: 0 }
): SceneObject {
  const verts = getAffectedVertices(selection, obj)
  if (verts.size === 0 || Math.abs(angleRad) < 1e-8) return cloneSceneObject(obj)

  const basePositions: Record<number, Vec3> = {}
  for (const vi of verts) basePositions[vi] = { ...obj.positions[vi] }

  _pivot.set(pivotWorld.x, pivotWorld.y, pivotWorld.z)
  _axis.set(axis.x, axis.y, axis.z).normalize()
  const q = new THREE.Quaternion().setFromAxisAngle(_axis, angleRad)

  const positions = transformMeshSelectionWithGizmo(
    obj,
    verts,
    basePositions,
    pivotWorld,
    _pivot.clone(),
    new THREE.Quaternion(),
    new THREE.Vector3(1, 1, 1),
    _pivot.clone(),
    q,
    new THREE.Vector3(1, 1, 1)
  )

  return { ...obj, positions }
}

export function scaleMeshSelection(
  obj: SceneObject,
  selection: MeshComponentSelection,
  factor: number | Vec3,
  pivotWorld: Vec3
): SceneObject {
  const verts = getAffectedVertices(selection, obj)
  const isUniform = typeof factor === 'number'
  const maxFactor = isUniform ? Math.abs((factor as number) - 1) : Math.max(Math.abs((factor as Vec3).x - 1), Math.abs((factor as Vec3).y - 1), Math.abs((factor as Vec3).z - 1))
  if (verts.size === 0 || maxFactor < 1e-8) return cloneSceneObject(obj)

  const basePositions: Record<number, Vec3> = {}
  for (const vi of verts) basePositions[vi] = { ...obj.positions[vi] }

  _pivot.set(pivotWorld.x, pivotWorld.y, pivotWorld.z)
  
  let scaleVec = new THREE.Vector3(1, 1, 1)
  if (isUniform) {
    const s = Math.max(factor as number, 0.001)
    scaleVec.set(s, s, s)
  } else {
    const v = factor as Vec3
    scaleVec.set(Math.max(v.x, 0.001), Math.max(v.y, 0.001), Math.max(v.z, 0.001))
  }

  const positions = transformMeshSelectionWithGizmo(
    obj,
    verts,
    basePositions,
    pivotWorld,
    _pivot.clone(),
    new THREE.Quaternion(),
    new THREE.Vector3(1, 1, 1),
    _pivot.clone(),
    new THREE.Quaternion(),
    scaleVec
  )

  return { ...obj, positions }
}

export type MeshModalOpKind = 'extrude' | 'rotate' | 'scale' | 'bevel' | 'move'

export function moveMeshSelection(
  obj: SceneObject,
  selection: MeshComponentSelection,
  _value: number,
  deltaWorldX: number,
  deltaWorldY: number,
  axisLock: 'x' | 'y' | 'z' | null | undefined,
  view: string = 'perspective'
): SceneObject {
  const verts = getAffectedVertices(selection, obj)
  if (verts.size === 0) return cloneSceneObject(obj)

  const positions = obj.positions.map((p) => ({ ...p }))
  let dx = 0, dy = 0, dz = 0

  if (axisLock === 'x') {
    dx = deltaWorldX + deltaWorldY
  } else if (axisLock === 'y') {
    dy = deltaWorldX + deltaWorldY
  } else if (axisLock === 'z') {
    dz = deltaWorldX + deltaWorldY
  } else {
    // Smart view defaults
    if (view === 'front') {
      dx = deltaWorldX
      dy = deltaWorldY
    } else if (view === 'top') {
      dx = deltaWorldX
      dz = deltaWorldY
    } else if (view === 'right') {
      dz = deltaWorldX
      dy = deltaWorldY
    } else {
      dx = deltaWorldX
      dy = deltaWorldY
    }
  }

  for (const vi of verts) {
    positions[vi].x += dx
    positions[vi].y += dy
    positions[vi].z += dz
  }

  return { ...obj, positions }
}

export function applyMeshModalOp(
  baseObject: SceneObject,
  selection: MeshComponentSelection,
  selectionMode: SelectionMode,
  op: MeshModalOpKind,
  value: number,
  pivotWorld: Vec3,
  deltaWorldX: number = 0,
  deltaWorldY: number = 0,
  axisLock?: 'x' | 'y' | 'z' | null,
  view: string = 'perspective'
): SceneObject {
  switch (op) {
    case 'extrude':
      return extrudeMeshSelection(baseObject, selection, selectionMode, value)
    case 'bevel':
      return bevelMeshSelection(baseObject, selection, selectionMode, value)
    case 'rotate': {
      let ax: Vec3 = { x: 0, y: 1, z: 0 }
      if (axisLock === 'x') ax = { x: 1, y: 0, z: 0 }
      else if (axisLock === 'y') ax = { x: 0, y: 1, z: 0 }
      else if (axisLock === 'z') ax = { x: 0, y: 0, z: 1 }
      else {
        if (view === 'front') ax = { x: 0, y: 0, z: 1 }
        else if (view === 'right') ax = { x: 1, y: 0, z: 0 }
        else if (view === 'top') ax = { x: 0, y: 1, z: 0 }
      }
      return rotateMeshSelection(baseObject, selection, value, pivotWorld, ax)
    }
    case 'scale': {
      let scaleVec: Vec3 | number = value
      if (axisLock) {
        scaleVec = {
          x: axisLock === 'y' || axisLock === 'z' ? 1 : value,
          y: axisLock === 'x' || axisLock === 'z' ? 1 : value,
          z: axisLock === 'x' || axisLock === 'y' ? 1 : value,
        }
      } else {
        if (view === 'front') scaleVec = { x: value, y: value, z: 1 }
        else if (view === 'top') scaleVec = { x: value, y: 1, z: value }
        else if (view === 'right') scaleVec = { x: 1, y: value, z: value }
      }
      return scaleMeshSelection(baseObject, selection, scaleVec, pivotWorld)
    }
    case 'move':
      return moveMeshSelection(baseObject, selection, value, deltaWorldX, deltaWorldY, axisLock, view)
  }
}

export function extrudeValueFromScreenDelta(
  dx: number,
  dyUp: number,
  sensitivity = 0.04
): number {
  return (dyUp + dx) * sensitivity
}

export function modalValueFromMouseDelta(
  op: MeshModalOpKind,
  dx: number,
  dy: number,
  shiftKey = false
): number {
  const sensitivityScale = shiftKey ? 0.15 : 1.0
  switch (op) {
    case 'extrude':
      return extrudeValueFromScreenDelta(dx, dy, 0.15 * sensitivityScale)
    case 'bevel':
      return dy * 0.04 * sensitivityScale
    case 'rotate':
      return dx * 0.02 * sensitivityScale
    case 'scale':
      const dyScaled = dy * 0.015 * sensitivityScale
      return Math.max(0.01, 1 + dyScaled)
    case 'move':
      return 0
  }
}

export function modalValueFromWheel(
  op: MeshModalOpKind,
  current: number,
  deltaY: number
): number {
  const step = deltaY > 0 ? -1 : 1
  switch (op) {
    case 'extrude':
      return current + step * 0.4
    case 'bevel':
      return current + step * 0.2
    case 'rotate':
      return current + step * 0.08
    case 'scale':
      return Math.max(0.01, current + step * 0.05)
    case 'move':
      return current + step * 0.1
  }
}

export function formatModalValue(op: MeshModalOpKind, value: number): string {
  switch (op) {
    case 'extrude':
      return value.toFixed(2)
    case 'bevel':
      return value.toFixed(3)
    case 'rotate':
      return `${((value * 180) / Math.PI).toFixed(1)}°`
    case 'scale':
      return value.toFixed(3)
    case 'move':
      return value.toFixed(3)
  }
}
