import { generateLathe } from '../mesh/lathe'
import type { SceneObject } from '../mesh/HalfEdgeMesh'
import type { ViewType } from '../scene/viewTypes'
import type { Vec2 } from '../utils/math'
import { ensureObjectUVs } from '../uv/uvObject'
import { orientLatheMeshOutward } from '../mesh/meshWinding'
import { offsetMeshInPlane, projectMeshToView } from './worldProjection'
import { strokeToLatheProfile } from './latheProfile'

export interface LatheSource {
  points: Vec2[]
  view: ViewType
  defaultDepth: number
  caps: boolean
  radialSegments: number
  profileRings: number
  smoothing: number
}

export function isLatheObject(object: SceneObject | null | undefined): object is SceneObject & { latheSource: LatheSource } {
  return !!object?.latheSource
}

export function regenerateLatheObject(
  object: SceneObject,
  changes: Partial<Pick<LatheSource, 'caps' | 'radialSegments' | 'profileRings' | 'smoothing'>>
): SceneObject | null {
  if (!object.latheSource) return null
  const source: LatheSource = {
    ...object.latheSource,
    caps: changes.caps ?? object.latheSource.caps,
    radialSegments: Math.max(8, Math.min(64, Math.round(changes.radialSegments ?? object.latheSource.radialSegments))),
    profileRings: Math.max(4, Math.min(128, Math.round(changes.profileRings ?? object.latheSource.profileRings))),
    smoothing: Math.max(0, Math.min(1, changes.smoothing ?? object.latheSource.smoothing)),
  }
  const lathe = strokeToLatheProfile(source.points, {
    maxProfileRings: source.profileRings,
    smoothing: source.smoothing,
  })
  if (!lathe) return null
  const mesh = generateLathe(lathe.profile, {
    radialSegments: source.radialSegments,
    preserveProfile: true,
    capBottom: source.caps,
    capTop: source.caps,
  })
  offsetMeshInPlane(mesh, lathe.axisH, 0)
  projectMeshToView(mesh, source.view, source.defaultDepth)
  orientLatheMeshOutward(mesh, source.view, lathe.axisH, source.defaultDepth)
  for (let i = 0; i < mesh.faceColors.length; i++) mesh.faceColors[i] = object.color
  const rebuilt = mesh.toObject(object.id, object.name, {
    ...object,
    uvs: undefined,
    faceUvIndices: undefined,
    latheSource: source,
    polyBudget: mesh.vertexCount(),
    polyBudgetMode: 'adaptive',
    smoothShading: true,
  })
  return ensureObjectUVs(rebuilt)
}
