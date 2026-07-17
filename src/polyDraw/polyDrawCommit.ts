import type { SceneObject } from '../mesh/HalfEdgeMesh'
import type { PolyDrawDraftPoint, PolyDrawMode } from '../store/appStore'
import { triangulatePolygon, triangulateQuad } from '../mesh/geometry2d'
import { prepareSceneObject, localPointFromWorld } from '../mesh/objectTransform'
import { generateId } from '../utils/math'
import { mergeSceneObjects } from '../mesh/meshEdit'
import { normalizeViewType, type ViewType } from '../scene/viewTypes'
import type { Vec3 } from '../utils/math'

export interface PolyDrawCommitResult {
  objects: SceneObject[]
  removedIds: string[]
  primaryId: string
  newFaceStartIndex: number
  newFaceCount: number
}

function polygonNormal(points: readonly Vec3[]): Vec3 {
  let x = 0
  let y = 0
  let z = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!
    const b = points[(i + 1) % points.length]!
    x += (a.y - b.y) * (a.z + b.z)
    y += (a.z - b.z) * (a.x + b.x)
    z += (a.x - b.x) * (a.y + b.y)
  }
  return { x, y, z }
}

/** Normal pointing from the drawing plane toward its orthographic camera. */
export function polyDrawViewFacingNormal(view: ViewType): Vec3 | null {
  switch (normalizeViewType(view)) {
    case 'front': return { x: 0, y: 0, z: 1 }
    case 'back': return { x: 0, y: 0, z: -1 }
    case 'right': return { x: 1, y: 0, z: 0 }
    case 'left': return { x: -1, y: 0, z: 0 }
    case 'top': return { x: 0, y: 1, z: 0 }
    case 'bottom': return { x: 0, y: -1, z: 0 }
    case 'perspective': return null
  }
}

export function shouldFlipPolyDrawFaceTowardView(
  points: readonly Vec3[],
  view: ViewType
): boolean {
  const facing = polyDrawViewFacingNormal(view)
  if (!facing || points.length < 3) return false
  const normal = polygonNormal(points)
  return normal.x * facing.x + normal.y * facing.y + normal.z * facing.z < 0
}

function collectSnapObjectIds(points: PolyDrawDraftPoint[]): string[] {
  const ids = new Set<string>()
  for (const pt of points) {
    if (pt.snap?.kind === 'mesh' || pt.snap?.kind === 'edge') ids.add(pt.snap.objectId)
  }
  return [...ids]
}

function resolveVertexIndices(
  points: PolyDrawDraftPoint[],
  object: SceneObject,
  indexMap: Map<string, Map<number, number>>
): number[] {
  const indices: number[] = []
  const positions = object.positions.map((p) => ({ ...p }))

  for (let i = 0; i < points.length; i++) {
    const pt = points[i]
    if (pt.snap?.kind === 'mesh') {
      const mapped = indexMap.get(pt.snap.objectId)?.get(pt.snap.vertexIndex)
      indices.push(mapped ?? pt.snap.vertexIndex)
    } else if (pt.snap?.kind === 'draft') {
      indices.push(indices[pt.snap.draftIndex])
    } else {
      const local = localPointFromWorld(object, pt.world)
      indices.push(positions.length)
      positions.push(local)
    }
  }

  object.positions = positions
  return indices
}

function appendTrianglesToObject(
  object: SceneObject,
  cornerIndices: number[],
  worldCorners: { x: number; y: number; z: number }[],
  color: number,
  flipNormal?: boolean,
  facingNormal?: Vec3 | null
): { object: SceneObject; faceStart: number; faceCount: number } {
  const faces = object.faces.map((f) => [...f])
  const faceColors = [...object.faceColors]
  const faceGroups = (object.faceGroups ?? []).map((g) => [...g])
  const faceStart = faces.length

  let triangles: [number, number, number][] = []
  if (cornerIndices.length === 3) {
    triangles = [[cornerIndices[0], cornerIndices[1], cornerIndices[2]]]
  } else if (cornerIndices.length === 4) {
    triangles = triangulateQuad(cornerIndices as [number, number, number, number])
  } else {
    triangles = triangulatePolygon(worldCorners).map(([a, b, c]) => [
      cornerIndices[a],
      cornerIndices[b],
      cornerIndices[c],
    ])
  }

  let facesAwayFromTarget = false
  if (facingNormal) {
    const worldByVertex = new Map<number, Vec3>()
    cornerIndices.forEach((vertexIndex, cornerIndex) => {
      worldByVertex.set(vertexIndex, worldCorners[cornerIndex]!)
    })
    for (const [a, b, c] of triangles) {
      const pa = worldByVertex.get(a)
      const pb = worldByVertex.get(b)
      const pc = worldByVertex.get(c)
      if (!pa || !pb || !pc) continue
      const ab = { x: pb.x - pa.x, y: pb.y - pa.y, z: pb.z - pa.z }
      const ac = { x: pc.x - pa.x, y: pc.y - pa.y, z: pc.z - pa.z }
      const normal = {
        x: ab.y * ac.z - ab.z * ac.y,
        y: ab.z * ac.x - ab.x * ac.z,
        z: ab.x * ac.y - ab.y * ac.x,
      }
      const dot = normal.x * facingNormal.x + normal.y * facingNormal.y + normal.z * facingNormal.z
      if (Math.abs(dot) > 1e-10) {
        facesAwayFromTarget = dot < 0
        break
      }
    }
  }

  if (facesAwayFromTarget !== Boolean(flipNormal)) {
    triangles = triangles.map(([a, b, c]) => [a, c, b] as [number, number, number])
  }

  for (const tri of triangles) {
    faces.push([...tri])
    faceColors.push(color)
  }

  const newFaceIndices = Array.from({ length: triangles.length }, (_, i) => faceStart + i)
  faceGroups.push(newFaceIndices)

  return {
    object: { ...object, faces, faceColors, faceGroups },
    faceStart,
    faceCount: triangles.length,
  }
}

export function commitPolyDrawFace(
  points: PolyDrawDraftPoint[],
  objects: SceneObject[],
  options: {
    mode: PolyDrawMode
    color: number
    flipNormal?: boolean
    view?: ViewType
    facingNormal?: Vec3
    objectNamePrefix?: string
  }
): PolyDrawCommitResult | null {
  const minPoints = options.mode === 'triangle' ? 3 : options.mode === 'quad' ? 4 : 3
  if (points.length < minPoints) return null

  const worldCorners = points.map((p) => p.world)
  const facingNormal = options.facingNormal ?? (
    options.view ? polyDrawViewFacingNormal(options.view) : null
  )
  const snapIds = collectSnapObjectIds(points)

  if (snapIds.length === 0) {
    const empty: SceneObject = {
      id: generateId(),
      name: `${options.objectNamePrefix ?? 'Poly'} ${objects.length + 1}`,
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
    const indices = resolveVertexIndices(points, empty, new Map())
    const appended = appendTrianglesToObject(
      empty,
      indices,
      worldCorners,
      options.color,
      options.flipNormal,
      facingNormal
    )
    return {
      objects: [...objects, prepareSceneObject(appended.object)],
      removedIds: [],
      primaryId: appended.object.id,
      newFaceStartIndex: appended.faceStart,
      newFaceCount: appended.faceCount,
    }
  }

  const involvedObjects = objects.filter((o) => snapIds.includes(o.id))
  if (involvedObjects.length === 0) return null

  const primaryId = snapIds[0]
  let mergedObj: SceneObject
  let indexMap: Map<string, Map<number, number>>
  let removedIds: string[] = []

  if (involvedObjects.length === 1) {
    mergedObj = {
      ...involvedObjects[0],
      positions: involvedObjects[0].positions.map((p) => ({ ...p })),
      faces: involvedObjects[0].faces.map((f) => [...f]),
      faceColors: [...involvedObjects[0].faceColors],
    }
    const singleMap = new Map<number, number>()
    for (let i = 0; i < mergedObj.positions.length; i++) singleMap.set(i, i)
    indexMap = new Map([[primaryId, singleMap]])
  } else {
    const mergeResult = mergeSceneObjects(involvedObjects, primaryId)
    mergedObj = mergeResult.object
    indexMap = mergeResult.indexMap
    removedIds = mergeResult.mergedIds
  }

  const indices = resolveVertexIndices(points, mergedObj, indexMap)
  const appended = appendTrianglesToObject(
    mergedObj,
    indices,
    worldCorners,
    options.color,
    options.flipNormal,
    facingNormal
  )

  const nextObjects = objects
    .filter((o) => !removedIds.includes(o.id) && o.id !== primaryId)
    .concat([prepareSceneObject(appended.object)])

  return {
    objects: nextObjects,
    removedIds,
    primaryId: appended.object.id,
    newFaceStartIndex: appended.faceStart,
    newFaceCount: appended.faceCount,
  }
}

export function flipFacesWinding(obj: SceneObject, faceStart: number, faceCount: number): SceneObject {
  const faces = obj.faces.map((f, fi) => {
    if (fi >= faceStart && fi < faceStart + faceCount) {
      return [...f].reverse()
    }
    return [...f]
  })
  return { ...obj, faces }
}

export function autoFinalizeCount(mode: PolyDrawMode): number | null {
  if (mode === 'triangle') return 3
  if (mode === 'quad') return 4
  if (mode === 'rectangle' || mode === 'ngon') return 2
  return null
}
