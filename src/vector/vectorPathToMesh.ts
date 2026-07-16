import type { SceneObject } from '../mesh/HalfEdgeMesh'
import type { ViewType, StrokeMode } from '../store/appStore'
import { blobStrokeToObject } from '../blob/strokeToBlob'
import {
  outlineSketchDoodleToObject,
  pathSketchDoodleToObject,
  hairSketchDoodleToObject,
  roundedHairSketchDoodleToObject,
} from '../stroke/sketchDoodle'
import { polylineToMesh, type PolylineInput } from '../stroke/polylineToMesh'
import type { HairTipStyle } from '../mesh/hairRibbon'
import type { SweepCapStyle } from '../mesh/extrusion'
import type { PathDistributionMode, PathOutput, PathProfile } from '../mesh/pathOutputs'
import { flattenVectorPath } from './bezier'
import type { VectorPath } from './types'
import {
  VECTOR_PEN_FLATTEN_ERROR,
  VECTOR_PEN_LATHE_FLATTEN_ERROR,
  VECTOR_PEN_POLY_BUDGET,
} from './vectorPenLimits'
import { LATHE_POLY_BUDGET } from '../stroke/latheProfile'

export { VECTOR_PEN_POLY_BUDGET } from './vectorPenLimits'

export interface VectorPathMeshOptions {
  view: ViewType
  polyBudget: number
  brushDensity: number
  strokeMode: StrokeMode
  rdpTolerance: number
  closeThreshold: number
  defaultDepth: number
  color: number
  stylize?: number
  extrudeMode?: boolean
  latheMode?: boolean
  latheCaps?: boolean
  latheRadialSegments?: number
  latheProfileRings?: number
  latheSmoothing?: number
  extrudeAmount?: number
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

function meshPointsFromPath(path: VectorPath, latheMode = false): { x: number; y: number }[] {
  const points = flattenVectorPath(
    path,
    latheMode ? VECTOR_PEN_LATHE_FLATTEN_ERROR : VECTOR_PEN_FLATTEN_ERROR
  )
  if (points.length < 2) return points
  if (!path.closed) return points

  const first = points[0]!
  const last = points[points.length - 1]!
  if (Math.hypot(first.x - last.x, first.y - last.y) <= 0.5) {
    return points.slice(0, -1)
  }
  return points
}

export function vectorPathMeshName(
  strokeMode: StrokeMode,
  extrudeMode: boolean,
  latheMode: boolean,
  closed: boolean
): string {
  if (latheMode) return 'Lathe'
  if (extrudeMode) return closed ? 'Extrude' : 'Capsule'
  if (strokeMode === 'blob') return 'Blob'
  if (strokeMode === 'centerline') return 'Path'
  if (strokeMode === 'capsule') return 'Capsule'
  if (strokeMode === 'hair-paths') return 'Hair Paths'
  if (strokeMode === 'hair-strips') return 'Hair Strips'
  if (strokeMode === 'hair-round') return 'Rounded Hair'
  if (strokeMode === 'outline') return closed ? 'Outline' : 'Outline Path'
  return closed ? 'Doodle' : 'Path'
}

/** Build a 3D mesh from a finished vector pen path using the active fill mode. */
export function vectorPathToMesh(
  path: VectorPath,
  options: VectorPathMeshOptions
): SceneObject | null {
  const points = meshPointsFromPath(path, !!options.latheMode)
  if (points.length < 2) return null

  const name = vectorPathMeshName(
    options.strokeMode,
    !!options.extrudeMode,
    !!options.latheMode,
    path.closed
  )

  const base: PolylineInput = {
    points,
    view: path.view,
    polyBudget:
      options.latheMode
        ? LATHE_POLY_BUDGET
        : options.strokeMode === 'hair-paths' ||
            options.strokeMode === 'hair-strips' ||
            options.strokeMode === 'hair-round' ||
            options.strokeMode === 'outline'
          ? options.polyBudget
          : VECTOR_PEN_POLY_BUDGET,
    brushDensity: options.brushDensity,
    strokeMode: options.strokeMode,
    rdpTolerance: options.rdpTolerance,
    closeThreshold: options.closeThreshold,
    defaultDepth: options.defaultDepth,
    color: path.color,
    stylize: options.stylize,
    extrudeMode: options.extrudeMode,
    latheMode: options.latheMode,
    latheCaps: options.latheCaps,
    latheRadialSegments: options.latheRadialSegments,
    latheProfileRings: options.latheProfileRings,
    latheSmoothing: options.latheSmoothing,
    extrudeAmount: options.extrudeAmount,
    name,
    pathClosed: path.closed,
    preserveDetail: true,
    hairTipStyle: options.hairTipStyle,
    pathStartCap: options.pathStartCap,
    pathEndCap: options.pathEndCap,
    pathRadialSegments: options.pathRadialSegments,
    pathRadiusScale: options.pathRadiusScale,
    ribbonStartTip: options.ribbonStartTip,
    ribbonEndTip: options.ribbonEndTip,
    ribbonTaper: options.ribbonTaper,
    ribbonWidthScale: options.ribbonWidthScale,
    ribbonFlat: options.ribbonFlat,
    pathOutput: options.pathOutput,
    pathStartScale: options.pathStartScale,
    pathEndScale: options.pathEndScale,
    pathTwist: options.pathTwist,
    pathSpacing: options.pathSpacing,
    pathOffset: options.pathOffset,
    pathProfile: options.pathProfile,
    pathProfileWidth: options.pathProfileWidth,
    pathProfileHeight: options.pathProfileHeight,
    pathChainAlternating: options.pathChainAlternating,
    pathCardCrossed: options.pathCardCrossed,
    pathDistributionMode: options.pathDistributionMode, pathCount: options.pathCount, pathStartPadding: options.pathStartPadding, pathEndPadding: options.pathEndPadding,
    pathRandomScale: options.pathRandomScale, pathRotation: options.pathRotation, pathRandomRotation: options.pathRandomRotation,
    pathAlternateRotation: options.pathAlternateRotation, pathMirrorAlternate: options.pathMirrorAlternate, pathSeed: options.pathSeed, pathKeepInstances: options.pathKeepInstances,
  }

  if (options.latheMode) {
    return polylineToMesh({
      ...base,
      strokeMode: 'outline',
      extrudeMode: false,
      latheMode: true,
    })
  }

  if (options.extrudeMode) {
    if (options.strokeMode === 'hair-paths') {
      return hairSketchDoodleToObject(base, 'path')
    }
    if (options.strokeMode === 'hair-strips') {
      return hairSketchDoodleToObject(base, 'strip')
    }
    if (options.strokeMode === 'hair-round') {
      return roundedHairSketchDoodleToObject(base)
    }
    return polylineToMesh({
      ...base,
      strokeMode: 'outline',
      extrudeMode: true,
    })
  }

  if (options.strokeMode === 'blob') {
    return blobStrokeToObject(base)
  }

  if (options.strokeMode === 'centerline') {
    return pathSketchDoodleToObject({ ...base, strokeMode: 'centerline' })
  }

  if (options.strokeMode === 'capsule') {
    return polylineToMesh({ ...base, strokeMode: 'capsule' })
  }

  if (options.strokeMode === 'outline') {
    return outlineSketchDoodleToObject(base)
  }

  if (options.strokeMode === 'hair-paths') {
    return hairSketchDoodleToObject(base, 'path')
  }

  if (options.strokeMode === 'hair-strips') {
    return hairSketchDoodleToObject(base, 'strip')
  }

  if (options.strokeMode === 'hair-round') {
    return roundedHairSketchDoodleToObject(base)
  }

  return polylineToMesh(base)
}
