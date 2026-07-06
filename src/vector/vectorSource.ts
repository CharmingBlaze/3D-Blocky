import type { SceneObject } from '../mesh/HalfEdgeMesh'
import { IDENTITY_TRANSFORM } from '../mesh/objectTransform'
import type { StrokeMode } from '../store/appStore'
import { cloneAnchors } from './autoConnect'
import type { VectorPath } from './types'
import { vectorPathToMesh } from './vectorPathToMesh'
import { VECTOR_PEN_POLY_BUDGET } from './vectorPenLimits'

/** Parametric data to rebuild a vector pen doodle mesh. */
export interface VectorSource {
  path: VectorPath
  strokeMode: StrokeMode
  extrudeMode: boolean
  brushDensity: number
  rdpTolerance: number
  closeThreshold: number
  defaultDepth: number
  stylize: number
  extrudeDepth: number
}

export function isVectorDoodleObject(
  obj: SceneObject | undefined | null
): obj is SceneObject & { vectorSource: VectorSource } {
  return !!obj?.vectorSource
}

function clonePath(path: VectorPath): VectorPath {
  return {
    ...path,
    anchors: cloneAnchors(path),
    shapeParams: path.shapeParams ? { ...path.shapeParams } : undefined,
  }
}

export function attachVectorSource(
  obj: SceneObject,
  source: Omit<VectorSource, 'path'> & { path: VectorPath }
): SceneObject {
  return {
    ...obj,
    vectorSource: {
      ...source,
      path: clonePath(source.path),
    },
  }
}

/** Rebuild a vector pen doodle with a new extrusion depth, preserving id and transform. */
export function regenerateVectorObject(
  obj: SceneObject,
  extrudeDepth: number
): SceneObject | null {
  const source = obj.vectorSource
  if (!source) return null

  const path = clonePath(source.path)

  const rebuilt = vectorPathToMesh(path, {
    view: path.view,
    polyBudget: VECTOR_PEN_POLY_BUDGET,
    brushDensity: source.brushDensity,
    strokeMode: source.strokeMode,
    rdpTolerance: source.rdpTolerance,
    closeThreshold: source.closeThreshold,
    defaultDepth: source.defaultDepth,
    color: path.color,
    stylize: source.stylize,
    extrudeMode: source.extrudeMode,
    extrudeAmount: extrudeDepth,
  })
  if (!rebuilt) return null

  return {
    ...rebuilt,
    id: obj.id,
    name: obj.name,
    transform: obj.transform ?? {
      position: { ...IDENTITY_TRANSFORM.position },
      rotation: { ...IDENTITY_TRANSFORM.rotation },
      scale: { ...IDENTITY_TRANSFORM.scale },
    },
    smoothShading: obj.smoothShading ?? false,
    material: obj.material,
    faceMaterials: obj.faceMaterials,
    uvMappingMode: obj.uvMappingMode,
    vectorSource: {
      ...source,
      path: { ...path, objectId: obj.id },
      extrudeDepth,
    },
  }
}
