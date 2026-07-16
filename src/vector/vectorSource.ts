import type { SceneObject } from '../mesh/HalfEdgeMesh'
import { IDENTITY_TRANSFORM } from '../mesh/objectTransform'
import type { StrokeMode } from '../store/appStore'
import type { HairTipStyle } from '../mesh/hairRibbon'
import type { SweepCapStyle } from '../mesh/extrusion'
import type { PathDistributionMode, PathOutput, PathProfile } from '../mesh/pathOutputs'
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
  /** Hair tip shape for hair stroke modes. Defaults to pointed when missing. */
  hairTipStyle?: HairTipStyle
  pathStartCap?: SweepCapStyle
  pathEndCap?: SweepCapStyle
  pathRadialSegments?: number
  pathRadiusScale?: number
  ribbonStartTip?: HairTipStyle
  ribbonEndTip?: HairTipStyle
  ribbonTaper?: number
  ribbonWidthScale?: number
  ribbonFlat?: boolean
  pathOutput?: PathOutput
  pathStartScale?: number
  pathEndScale?: number
  pathTwist?: number
  pathSpacing?: number
  pathOffset?: number
  pathProfile?: PathProfile
  pathProfileWidth?: number
  pathProfileHeight?: number
  pathChainAlternating?: boolean
  pathCardCrossed?: boolean
  pathDistributionMode?: PathDistributionMode
  pathCount?: number
  pathStartPadding?: number
  pathEndPadding?: number
  pathRandomScale?: number
  pathRotation?: number
  pathRandomRotation?: number
  pathAlternateRotation?: boolean
  pathMirrorAlternate?: boolean
  pathSeed?: number
  pathKeepInstances?: boolean
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
    hairTipStyle: source.hairTipStyle,
    pathStartCap: source.pathStartCap,
    pathEndCap: source.pathEndCap,
    pathRadialSegments: source.pathRadialSegments,
    pathRadiusScale: source.pathRadiusScale,
    ribbonStartTip: source.ribbonStartTip,
    ribbonEndTip: source.ribbonEndTip,
    ribbonTaper: source.ribbonTaper,
    ribbonWidthScale: source.ribbonWidthScale,
    ribbonFlat: source.ribbonFlat,
    pathOutput: source.pathOutput,
    pathStartScale: source.pathStartScale,
    pathEndScale: source.pathEndScale,
    pathTwist: source.pathTwist,
    pathSpacing: source.pathSpacing,
    pathOffset: source.pathOffset,
    pathProfile: source.pathProfile,
    pathProfileWidth: source.pathProfileWidth,
    pathProfileHeight: source.pathProfileHeight,
    pathChainAlternating: source.pathChainAlternating,
    pathCardCrossed: source.pathCardCrossed,
    pathDistributionMode: source.pathDistributionMode, pathCount: source.pathCount, pathStartPadding: source.pathStartPadding, pathEndPadding: source.pathEndPadding,
    pathRandomScale: source.pathRandomScale, pathRotation: source.pathRotation, pathRandomRotation: source.pathRandomRotation,
    pathAlternateRotation: source.pathAlternateRotation, pathMirrorAlternate: source.pathMirrorAlternate, pathSeed: source.pathSeed, pathKeepInstances: source.pathKeepInstances,
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
