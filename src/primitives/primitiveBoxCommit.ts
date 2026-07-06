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
import type { WorldBox } from './primitiveBoxMath'
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
  roundedParams?: RoundedBoxParams
): SceneObject | null {
  if (type === 'roundedBox') {
    const params = roundedParams ?? { roundness: 0.25, subdivisions: 1 }
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
    })
  }

  const data = createPrimitiveInBox(
    type,
    box,
    heightAxis,
    primitiveSegmentsForBudget(polyBudget)
  )
  if (data.indices.length === 0) return null

  const mesh = meshDataToHalfEdgeMesh(data, color)
  if (mesh.vertexCount() === 0) return null
  ensurePositiveVolume(mesh)

  if (import.meta.env?.DEV && (type === 'icosphere' || type === 'sphere')) {
    console.log('[CAD trace] primitiveBoxToSceneObject after adapter', {
      type,
      positions: mesh.positions.length,
      faces: mesh.faces.length,
    })
  }

  const obj = mesh.toObject(generateId(), PRIMITIVE_NAMES[type], {
    polyBudget,
    color,
    polyBudgetMode: 'strict',
  })

  return finalizeCadPrimitive(obj)
}

export function primitiveBoxPreviewMesh(
  type: PrimitiveBoxType,
  box: WorldBox,
  heightAxis: Axis,
  color: number,
  polyBudget: number,
  roundedParams?: RoundedBoxParams
): HalfEdgeMesh | null {
  if (type === 'roundedBox') {
    const params = roundedParams ?? { roundness: 0.25, subdivisions: 1 }
    return roundedBoxHalfEdgeFromWorldBox(box, color, params, polyBudget)
  }
  const data = createPrimitiveInBox(
    type,
    box,
    heightAxis,
    primitiveSegmentsForBudget(polyBudget)
  )
  if (data.indices.length === 0) return null
  return meshDataToHalfEdgeMesh(data, color)
}
