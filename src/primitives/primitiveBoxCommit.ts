import { meshDataToHalfEdgeMesh } from '../blob/adapters'
import { HalfEdgeMesh, type SceneObject } from '../mesh/HalfEdgeMesh'
import { ensurePositiveVolume } from '../mesh/meshWinding'
import {
  roundedBoxFromWorldBox,
  roundedBoxHalfEdgeFromWorldBox,
  type RoundedBoxParams,
} from '../mesh/roundedBox'
import { prepareSceneObject } from '../mesh/objectTransform'
import { weldSceneObjectCoincidentVertices } from '../mesh/subdivisionSurface'
import { primitiveSegmentsForBudget } from '../mesh/meshPolyBudget'
import { generateId } from '../utils/math'
import { boxCenterSize, type WorldBox } from './primitiveBoxMath'
import type { ViewType } from '../scene/viewTypes'
import {
  createPrimitiveInBox,
  type PrimitiveBoxType,
} from './primitivesBox'
import type { Axis } from './viewAxes'

const PRIMITIVE_NAMES: Record<PrimitiveBoxType, string> = {
  box: 'Box',
  roundedBox: 'Rounded Box',
  icosphere: 'Icosphere',
  sphere: 'Sphere',
  cone: 'Cone',
  cylinder: 'Cylinder',
  capsule: 'Capsule',
  pyramid: 'Pyramid',
  doughnut: 'Doughnut',
  ring: 'Ring',
  stairs: 'Stairs',
  star: 'Star',
  dome: 'Dome',
  halfCircle: 'Half Circle',
}

export interface PrimitiveSource {
  type: PrimitiveBoxType
  box: WorldBox
  heightAxis: Axis
  polyBudget: number
  roundedParams?: RoundedBoxParams
  baseView?: ViewType | null
}

export type EditablePrimitiveSourcePatch = {
  size?: Partial<{ x: number; y: number; z: number }>
  polyBudget?: number
  roundness?: number
  subdivisions?: number
}

function clonePrimitiveSource(source: PrimitiveSource): PrimitiveSource {
  return {
    ...source,
    box: { min: { ...source.box.min }, max: { ...source.box.max } },
    roundedParams: source.roundedParams ? { ...source.roundedParams } : undefined,
  }
}

/** Weld position-coincident corners so face/edge/vertex edits stay connected. */
function finalizeCadPrimitive(obj: SceneObject): SceneObject {
  return weldSceneObjectCoincidentVertices(prepareSceneObject(obj))
}

export function primitiveBoxToSceneObject(
  type: PrimitiveBoxType,
  box: WorldBox,
  heightAxis: Axis,
  color: number,
  polyBudget: number,
  roundedParams?: RoundedBoxParams,
  baseView?: ViewType | null
): SceneObject | null {
  const primitiveSource: PrimitiveSource = {
    type,
    box: { min: { ...box.min }, max: { ...box.max } },
    heightAxis,
    polyBudget,
    roundedParams: roundedParams ? { ...roundedParams } : undefined,
    baseView,
  }
  if (type === 'roundedBox') {
    const params = roundedParams ?? { roundness: 0.25, subdivisions: 2 }
    const obj = roundedBoxFromWorldBox(box, color, params, polyBudget)
    if (obj.positions.length === 0) return null
    const mesh = HalfEdgeMesh.fromObject(obj)
    ensurePositiveVolume(mesh)
    return finalizeCadPrimitive({
      ...mesh.toObject(generateId(), PRIMITIVE_NAMES.roundedBox, {
        polyBudget,
        color,
        polyBudgetMode: 'strict',
      }),
      primitiveSource,
    })
  }

  const data = createPrimitiveInBox(
    type,
    box,
    heightAxis,
    primitiveSegmentsForBudget(polyBudget),
    { baseView }
  )
  if (data.indices.length === 0) return null

  const mesh = meshDataToHalfEdgeMesh(data, color)
  if (mesh.vertexCount() === 0) return null
  ensurePositiveVolume(mesh)

  const obj = mesh.toObject(generateId(), PRIMITIVE_NAMES[type], {
    polyBudget,
    color,
    polyBudgetMode: 'strict',
  })

  return finalizeCadPrimitive({ ...obj, primitiveSource })
}

/** Regenerate a retained CAD primitive without changing its scene identity or transform. */
export function regeneratePrimitiveObject(
  object: SceneObject,
  changes: EditablePrimitiveSourcePatch
): SceneObject | null {
  const current = object.primitiveSource
  if (!current) return null
  const source = clonePrimitiveSource(current)
  const { center, size } = boxCenterSize(source.box)
  const nextSize = {
    x: Math.max(0.5, changes.size?.x ?? size.x),
    y: Math.max(0.5, changes.size?.y ?? size.y),
    z: Math.max(0.5, changes.size?.z ?? size.z),
  }
  source.box = {
    min: {
      x: center.x - nextSize.x / 2,
      y: center.y - nextSize.y / 2,
      z: center.z - nextSize.z / 2,
    },
    max: {
      x: center.x + nextSize.x / 2,
      y: center.y + nextSize.y / 2,
      z: center.z + nextSize.z / 2,
    },
  }
  source.polyBudget = Math.max(24, Math.min(512, changes.polyBudget ?? source.polyBudget))
  if (source.type === 'roundedBox') {
    source.roundedParams = {
      roundness: Math.max(0, Math.min(1, changes.roundness ?? source.roundedParams?.roundness ?? 0.25)),
      subdivisions: Math.max(0, Math.min(4, Math.round(changes.subdivisions ?? source.roundedParams?.subdivisions ?? 2))),
    }
  }

  const regenerated = primitiveBoxToSceneObject(
    source.type,
    source.box,
    source.heightAxis,
    object.color,
    source.polyBudget,
    source.roundedParams,
    source.baseView
  )
  if (!regenerated) return null
  return {
    ...regenerated,
    id: object.id,
    name: object.name,
    material: object.material,
    transform: object.transform,
    pivot: object.pivot,
    smoothShading: object.smoothShading,
    facetExaggeration: object.facetExaggeration,
    primitiveSource: source,
  }
}

export function primitiveBoxPreviewMesh(
  type: PrimitiveBoxType,
  box: WorldBox,
  heightAxis: Axis,
  color: number,
  polyBudget: number,
  roundedParams?: RoundedBoxParams,
  baseView?: ViewType | null
): HalfEdgeMesh | null {
  if (type === 'roundedBox') {
    const params = roundedParams ?? { roundness: 0.25, subdivisions: 2 }
    return roundedBoxHalfEdgeFromWorldBox(box, color, params, polyBudget)
  }
  const data = createPrimitiveInBox(
    type,
    box,
    heightAxis,
    primitiveSegmentsForBudget(polyBudget),
    { baseView }
  )
  if (data.indices.length === 0) return null
  return meshDataToHalfEdgeMesh(data, color)
}
