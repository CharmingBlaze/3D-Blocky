import type { SceneObject } from './HalfEdgeMesh'
import type { Vec3 } from '../utils/math'
import { generateId } from '../utils/math'
import { localPointFromWorld, worldPointFromObject } from './objectTransform'
import { triangulatePolygon, triangulateQuad } from './geometry2d'
import { identityFaceGroups } from './faceGroups'

export type CornerRef =
  | { kind: 'existing'; objectId: string; vertexIndex: number; world: Vec3 }
  | { kind: 'new'; world: Vec3 }

export interface MergeResult {
  object: SceneObject
  /** old objectId -> old vertex index -> new vertex index */
  indexMap: Map<string, Map<number, number>>
  mergedIds: string[]
}

function cloneObjectShell(obj: SceneObject): SceneObject {
  return {
    ...obj,
    positions: obj.positions.map((p) => ({ ...p })),
    faces: obj.faces.map((f) => [...f]),
    faceColors: [...obj.faceColors],
    faceGroups: obj.faceGroups?.map((g) => [...g]),
    uvs: obj.uvs?.map((u) => ({ ...u })),
    faceUvIndices: obj.faceUvIndices?.map((f) => [...f]),
    cornerColors: obj.cornerColors?.map((c) => [...c] as [number, number, number, number]),
    faceColorIndices: obj.faceColorIndices?.map((f) => [...f]),
    material: obj.material
      ? {
          ...obj.material,
          solidColor: obj.material.solidColor ? ([...obj.material.solidColor] as [number, number, number, number]) : undefined,
        }
      : undefined,
    faceMaterials: obj.faceMaterials?.map((m) =>
      m ? { ...m, solidColor: m.solidColor ? ([...m.solidColor] as [number, number, number, number]) : undefined } : null
    ),
    transform: obj.transform
      ? {
          position: { ...obj.transform.position },
          rotation: { ...obj.transform.rotation },
          scale: { ...obj.transform.scale },
        }
      : undefined,
    pivot: obj.pivot ? { ...obj.pivot } : undefined,
  }
}

/** Merge scene objects into one mesh in the primary object's local space. */
export function mergeSceneObjects(objects: SceneObject[], primaryId: string): MergeResult {
  const primary = objects.find((o) => o.id === primaryId) ?? objects[0]
  const merged = cloneObjectShell(primary)
  if (!merged.faceGroups?.length && merged.faces.length > 0) {
    merged.faceGroups = identityFaceGroups(merged.faces.length)
  }
  const indexMap = new Map<string, Map<number, number>>()

  const primaryMap = new Map<number, number>()
  for (let i = 0; i < primary.positions.length; i++) primaryMap.set(i, i)
  indexMap.set(primary.id, primaryMap)

  for (const obj of objects) {
    if (obj.id === primary.id) continue

    const objMap = new Map<number, number>()
    const base = merged.positions.length

    for (let vi = 0; vi < obj.positions.length; vi++) {
      const world = worldPointFromObject(obj, obj.positions[vi])
      const local = localPointFromWorld(primary, world)
      merged.positions.push(local)
      objMap.set(vi, base + vi)
    }

    const faceOffset = merged.faces.length

    for (let fi = 0; fi < obj.faces.length; fi++) {
      merged.faces.push(obj.faces[fi].map((idx) => idx + base))
      merged.faceColors.push(obj.faceColors[fi] ?? obj.color)
      if (obj.faceUvIndices?.[fi]) {
        if (!merged.faceUvIndices) merged.faceUvIndices = []
        merged.faceUvIndices.push([...obj.faceUvIndices[fi]])
      }
    }

    if (obj.faceGroups?.length) {
      if (!merged.faceGroups) merged.faceGroups = []
      for (const group of obj.faceGroups) {
        merged.faceGroups.push(group.map((fi) => fi + faceOffset))
      }
    } else {
      if (!merged.faceGroups) merged.faceGroups = []
      for (let fi = 0; fi < obj.faces.length; fi++) {
        merged.faceGroups.push([faceOffset + fi])
      }
    }

    indexMap.set(obj.id, objMap)
  }

  return {
    object: merged,
    indexMap,
    mergedIds: objects.map((o) => o.id).filter((id) => id !== primary.id),
  }
}

export interface AppendFaceResult {
  object: SceneObject
  newFaceStartIndex: number
  newFaceCount: number
}

/**
 * Append one face (triangle, quad, or n-gon) to a scene object.
 * Corner refs with `existing` must reference vertices already in `object`.
 */
export function appendFace(
  object: SceneObject,
  corners: CornerRef[],
  options: { color: number; flipNormal?: boolean }
): AppendFaceResult {
  const positions = object.positions.map((p) => ({ ...p }))
  const faces = object.faces.map((f) => [...f])
  const faceColors = [...object.faceColors]
  const faceGroups = (object.faceGroups ?? []).map((g) => [...g])
  const faceStart = faces.length

  const cornerIndices: number[] = []
  for (const corner of corners) {
    if (corner.kind === 'existing') {
      cornerIndices.push(corner.vertexIndex)
    } else {
      const local = localPointFromWorld(object, corner.world)
      cornerIndices.push(positions.length)
      positions.push(local)
    }
  }

  let triangles: [number, number, number][] = []
  if (cornerIndices.length === 3) {
    triangles = [[cornerIndices[0], cornerIndices[1], cornerIndices[2]]]
  } else if (cornerIndices.length === 4) {
    triangles = triangulateQuad(cornerIndices as [number, number, number, number])
  } else {
    const worldCorners = corners.map((c) => ({ ...c.world }))
    triangles = triangulatePolygon(worldCorners).map(([a, b, c]) => [
      cornerIndices[a],
      cornerIndices[b],
      cornerIndices[c],
    ])
  }

  if (options.flipNormal) {
    triangles = triangles.map(([a, b, c]) => [a, c, b] as [number, number, number])
  }

  for (const tri of triangles) {
    faces.push([...tri])
    faceColors.push(options.color)
  }

  faceGroups.push(Array.from({ length: triangles.length }, (_, i) => faceStart + i))

  return {
    object: { ...object, positions, faces, faceColors, faceGroups },
    newFaceStartIndex: faceStart,
    newFaceCount: triangles.length,
  }
}

/** Create a new scene object containing only the given face. */
export function sceneObjectFromFace(
  corners: CornerRef[],
  options: { name: string; color: number; flipNormal?: boolean }
): AppendFaceResult {
  const empty: SceneObject = {
    id: generateId(),
    name: options.name,
    positions: [],
    faces: [],
    faceColors: [],
    topologyLocked: false,
    polyBudget: 128,
    polyBudgetMode: 'strict',
    smoothShading: false,
    facetExaggeration: 0,
    color: options.color,
  }
  return appendFace(empty, corners, options)
}

/** Create a triangle or quad face from existing vertex indices (selection order = winding). */
export function appendFaceFromVertexIndices(
  object: SceneObject,
  vertexIndices: number[],
  color: number
): AppendFaceResult | null {
  if (vertexIndices.length !== 3 && vertexIndices.length !== 4) return null
  if (new Set(vertexIndices).size !== vertexIndices.length) return null

  const corners: CornerRef[] = []
  for (const vi of vertexIndices) {
    if (vi < 0 || vi >= object.positions.length) return null
    corners.push({
      kind: 'existing',
      objectId: object.id,
      vertexIndex: vi,
      world: worldPointFromObject(object, object.positions[vi]),
    })
  }

  return appendFace(object, corners, { color })
}

function ensureFaceColors(obj: SceneObject): number[] {
  if (obj.faceColors.length >= obj.faces.length) return [...obj.faceColors]
  return [
    ...obj.faceColors,
    ...Array(obj.faces.length - obj.faceColors.length).fill(obj.color),
  ]
}

/** Set per-face colors on an object (indices must be valid face indices). */
export function recolorFacesOnObject(
  obj: SceneObject,
  faceIndices: number[],
  color: number
): SceneObject {
  const faceColors = ensureFaceColors(obj)
  for (const fi of new Set(faceIndices)) {
    if (fi >= 0 && fi < faceColors.length) faceColors[fi] = color
  }
  return { ...obj, faceColors }
}
