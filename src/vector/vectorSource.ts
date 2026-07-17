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
  /** Shared with Sketch: revolve profile instead of extruding. */
  latheMode?: boolean
  latheCaps?: boolean
  latheRadialSegments?: number
  latheProfileRings?: number
  latheSmoothing?: number
  brushDensity: number
  /** Stored so regen uses the same Stroke Shapes poly budget as Sketch. */
  polyBudget?: number
  rdpTolerance: number
  closeThreshold: number
  defaultDepth: number
  stylize: number
  extrudeDepth: number
  blobInflation?: number
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

export type EditableVectorSourcePatch = Partial<
  Pick<
    VectorSource,
    | 'brushDensity'
    | 'polyBudget'
    | 'extrudeDepth'
    | 'blobInflation'
    | 'strokeMode'
    | 'extrudeMode'
    | 'latheMode'
    | 'latheCaps'
    | 'latheRadialSegments'
    | 'latheProfileRings'
    | 'latheSmoothing'
    | 'hairTipStyle'
    | 'pathStartCap'
    | 'pathEndCap'
    | 'pathRadialSegments'
    | 'pathRadiusScale'
    | 'ribbonStartTip'
    | 'ribbonEndTip'
    | 'ribbonTaper'
    | 'ribbonWidthScale'
    | 'ribbonFlat'
    | 'pathOutput'
    | 'pathStartScale'
    | 'pathEndScale'
    | 'pathTwist'
    | 'pathSpacing'
    | 'pathOffset'
    | 'pathProfile'
    | 'pathProfileWidth'
    | 'pathProfileHeight'
    | 'pathChainAlternating'
    | 'pathCardCrossed'
    | 'pathDistributionMode'
    | 'pathCount'
    | 'pathStartPadding'
    | 'pathEndPadding'
    | 'pathRandomScale'
    | 'pathRotation'
    | 'pathRandomRotation'
    | 'pathAlternateRotation'
    | 'pathMirrorAlternate'
    | 'pathSeed'
    | 'pathKeepInstances'
  >
>

/** Rebuild a vector doodle from editable source parameters, preserving identity and transforms. */
export function regenerateVectorObjectFromSource(
  obj: SceneObject,
  changes: EditableVectorSourcePatch
): SceneObject | null {
  const source = obj.vectorSource
  if (!source) return null

  const nextSource: VectorSource = {
    ...source,
    brushDensity: Math.max(2, Math.min(48, changes.brushDensity ?? source.brushDensity)),
    polyBudget: Math.max(16, Math.min(512, changes.polyBudget ?? source.polyBudget ?? VECTOR_PEN_POLY_BUDGET)),
    extrudeDepth: changes.extrudeDepth ?? source.extrudeDepth,
    blobInflation: Math.max(0, Math.min(1, changes.blobInflation ?? source.blobInflation ?? 0.65)),
    strokeMode: changes.strokeMode ?? source.strokeMode,
    extrudeMode: changes.extrudeMode ?? source.extrudeMode,
    latheMode: changes.latheMode ?? source.latheMode,
    latheCaps: changes.latheCaps ?? source.latheCaps,
    latheRadialSegments: changes.latheRadialSegments ?? source.latheRadialSegments,
    latheProfileRings: changes.latheProfileRings ?? source.latheProfileRings,
    latheSmoothing: changes.latheSmoothing ?? source.latheSmoothing,
    hairTipStyle: changes.hairTipStyle ?? source.hairTipStyle,
    pathStartCap: changes.pathStartCap ?? source.pathStartCap,
    pathEndCap: changes.pathEndCap ?? source.pathEndCap,
    pathRadialSegments: Math.max(3, Math.min(24, changes.pathRadialSegments ?? source.pathRadialSegments ?? 8)),
    pathRadiusScale: Math.max(0.1, Math.min(4, changes.pathRadiusScale ?? source.pathRadiusScale ?? 1)),
    ribbonStartTip: changes.ribbonStartTip ?? source.ribbonStartTip,
    ribbonEndTip: changes.ribbonEndTip ?? source.ribbonEndTip,
    ribbonTaper: Math.max(0.05, Math.min(0.49, changes.ribbonTaper ?? source.ribbonTaper ?? 0.35)),
    ribbonWidthScale: Math.max(0.1, Math.min(4, changes.ribbonWidthScale ?? source.ribbonWidthScale ?? 1)),
    ribbonFlat: changes.ribbonFlat ?? source.ribbonFlat,
    pathOutput: changes.pathOutput ?? source.pathOutput,
    pathStartScale: Math.max(0.05, Math.min(5, changes.pathStartScale ?? source.pathStartScale ?? 1)),
    pathEndScale: Math.max(0.05, Math.min(5, changes.pathEndScale ?? source.pathEndScale ?? 1)),
    pathTwist: Math.max(-3600, Math.min(3600, changes.pathTwist ?? source.pathTwist ?? 360)),
    pathSpacing: Math.max(1, Math.min(512, changes.pathSpacing ?? source.pathSpacing ?? 16)),
    pathOffset: Math.max(-256, Math.min(256, changes.pathOffset ?? source.pathOffset ?? 0)),
    pathProfile: changes.pathProfile ?? source.pathProfile,
    pathProfileWidth: Math.max(0.1, Math.min(8, changes.pathProfileWidth ?? source.pathProfileWidth ?? 1)),
    pathProfileHeight: Math.max(0.1, Math.min(8, changes.pathProfileHeight ?? source.pathProfileHeight ?? 1)),
    pathChainAlternating: changes.pathChainAlternating ?? source.pathChainAlternating,
    pathCardCrossed: changes.pathCardCrossed ?? source.pathCardCrossed,
    pathDistributionMode: changes.pathDistributionMode ?? source.pathDistributionMode,
    pathCount: Math.max(1, Math.min(1000, changes.pathCount ?? source.pathCount ?? 8)),
    pathStartPadding: Math.max(0, changes.pathStartPadding ?? source.pathStartPadding ?? 0),
    pathEndPadding: Math.max(0, changes.pathEndPadding ?? source.pathEndPadding ?? 0),
    pathRandomScale: Math.max(0, Math.min(1, changes.pathRandomScale ?? source.pathRandomScale ?? 0)),
    pathRotation: changes.pathRotation ?? source.pathRotation ?? 0,
    pathRandomRotation: Math.max(0, Math.min(360, changes.pathRandomRotation ?? source.pathRandomRotation ?? 0)),
    pathAlternateRotation: changes.pathAlternateRotation ?? source.pathAlternateRotation,
    pathMirrorAlternate: changes.pathMirrorAlternate ?? source.pathMirrorAlternate,
    pathSeed: Math.floor(changes.pathSeed ?? source.pathSeed ?? 1),
    pathKeepInstances: changes.pathKeepInstances ?? source.pathKeepInstances,
  }

  const path = clonePath(nextSource.path)
  const rebuilt = vectorPathToMesh(path, {
    view: path.view,
    polyBudget: nextSource.polyBudget ?? VECTOR_PEN_POLY_BUDGET,
    brushDensity: nextSource.brushDensity,
    strokeMode: nextSource.strokeMode,
    rdpTolerance: nextSource.rdpTolerance,
    closeThreshold: nextSource.closeThreshold,
    defaultDepth: nextSource.defaultDepth,
    color: path.color,
    stylize: nextSource.stylize,
    extrudeMode: nextSource.latheMode ? false : nextSource.extrudeMode,
    latheMode: nextSource.latheMode,
    latheCaps: nextSource.latheCaps,
    latheRadialSegments: nextSource.latheRadialSegments,
    latheProfileRings: nextSource.latheProfileRings,
    latheSmoothing: nextSource.latheSmoothing,
    extrudeAmount: nextSource.extrudeDepth,
    blobInflation: nextSource.blobInflation,
    hairTipStyle: nextSource.hairTipStyle,
    pathStartCap: nextSource.pathStartCap,
    pathEndCap: nextSource.pathEndCap,
    pathRadialSegments: nextSource.pathRadialSegments,
    pathRadiusScale: nextSource.pathRadiusScale,
    ribbonStartTip: nextSource.ribbonStartTip,
    ribbonEndTip: nextSource.ribbonEndTip,
    ribbonTaper: nextSource.ribbonTaper,
    ribbonWidthScale: nextSource.ribbonWidthScale,
    ribbonFlat: nextSource.ribbonFlat,
    pathOutput: nextSource.pathOutput,
    pathStartScale: nextSource.pathStartScale,
    pathEndScale: nextSource.pathEndScale,
    pathTwist: nextSource.pathTwist,
    pathSpacing: nextSource.pathSpacing,
    pathOffset: nextSource.pathOffset,
    pathProfile: nextSource.pathProfile,
    pathProfileWidth: nextSource.pathProfileWidth,
    pathProfileHeight: nextSource.pathProfileHeight,
    pathChainAlternating: nextSource.pathChainAlternating,
    pathCardCrossed: nextSource.pathCardCrossed,
    pathDistributionMode: nextSource.pathDistributionMode,
    pathCount: nextSource.pathCount,
    pathStartPadding: nextSource.pathStartPadding,
    pathEndPadding: nextSource.pathEndPadding,
    pathRandomScale: nextSource.pathRandomScale,
    pathRotation: nextSource.pathRotation,
    pathRandomRotation: nextSource.pathRandomRotation,
    pathAlternateRotation: nextSource.pathAlternateRotation,
    pathMirrorAlternate: nextSource.pathMirrorAlternate,
    pathSeed: nextSource.pathSeed,
    pathKeepInstances: nextSource.pathKeepInstances,
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
    visible: obj.visible,
    vectorSource: {
      ...nextSource,
      path: { ...path, objectId: obj.id },
    },
  }
}

/** Rebuild a vector pen doodle with a new extrusion depth, preserving id and transform. */
export function regenerateVectorObject(
  obj: SceneObject,
  extrudeDepth: number
): SceneObject | null {
  return regenerateVectorObjectFromSource(obj, { extrudeDepth })
}
