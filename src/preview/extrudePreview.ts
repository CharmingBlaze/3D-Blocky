import * as THREE from 'three'
import { ensureCCW } from '../mesh/concaveTriangulate'
import { generateCapsuleSweep, generateTaperedPointedTube, type SweepCapStyle } from '../mesh/extrusion'
import {
  generateHairRibbon,
  hairHalfWidthFromBrush,
  resolveHairDepth,
  resolveRoundedHairRadius,
  type HairRibbonStyle,
  type HairTipStyle,
} from '../mesh/hairRibbon'
import { extrudeSilhouette, strokeToFlatOutline } from '../mesh/silhouetteExtrude'
import { offsetMeshInPlane, projectMeshToView, type StrokePlaneFrame } from '../stroke/worldProjection'
import {
  prepareSketchStroke,
  snapSketchStrokeClosed,
} from '../stroke/sketchDoodle'
import {
  outlineHalfWidthFromBrush,
  prepareHairPathCenterline,
  prepareHairStripCenterline,
  prepareOutlineBoundary,
  preparePathCenterline,
  resolveSilhouetteDepth,
  capsuleProfileRingsForBudget,
  capsuleRadialSegments,
} from '../stroke/sketchSource'
import type { StrokeMode, ViewType } from '../store/appStore'
import type { Vec2 } from '../utils/math'
import {
  VECTOR_PEN_MIN_ANGLE_DEG,
  VECTOR_PEN_RADIAL_SEGMENTS,
} from '../vector/vectorPenLimits'
import { LOW_POLY_CAPSULE_HEMI_RINGS } from '../primitives/capsuleMesh'
import { primitiveSegmentsForBudget } from '../mesh/meshPolyBudget'
import { generateVerticalShapedCapsule } from '../mesh/verticalCapsule'
import { generatePathOutput, type PathDistributionMode, type PathOutput, type PathProfile } from '../mesh/pathOutputs'
import { generateLathe } from '../mesh/lathe'
import { strokeToLatheProfile } from '../stroke/latheProfile'

export interface ExtrudePreviewOptions {
  strokeMode?: StrokeMode
  polyBudget?: number
  hairTipStyle?: HairTipStyle
  planeFrame?: StrokePlaneFrame | null
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
  latheMode?: boolean
  latheCaps?: boolean
  latheRadialSegments?: number
  latheProfileRings?: number
  latheSmoothing?: number
}

function hairStyleFromStrokeMode(strokeMode: StrokeMode | undefined): HairRibbonStyle | null {
  if (strokeMode === 'hair-paths') return 'path'
  if (strokeMode === 'hair-strips') return 'strip'
  if (strokeMode === 'ribbon') return 'path'
  return null
}

export function buildExtrudePreviewGeometry(
  points: Vec2[],
  view: ViewType,
  defaultDepth: number,
  extrudeAmount: number,
  brushDensity: number,
  closeThreshold: number,
  closed?: boolean,
  options?: ExtrudePreviewOptions
): THREE.BufferGeometry | null {
  if (points.length < 2) return null
  if (view === 'perspective' && !options?.planeFrame) return null

  const snapped = snapSketchStrokeClosed(points, closeThreshold)
  const hairStyle = hairStyleFromStrokeMode(options?.strokeMode)
  const roundedHair = options?.strokeMode === 'hair-round'
  const outlineMode = options?.strokeMode === 'outline'
  const prepared = prepareSketchStroke(snapped, closeThreshold, brushDensity, {
    highFidelity: hairStyle === 'path' || roundedHair || options?.strokeMode === 'capsule',
    forceOpen: hairStyle != null || roundedHair,
  })
  if (!prepared) return null

  const polyBudget = options?.polyBudget ?? 128

  const mesh = (() => {
    if (options?.latheMode) {
      const lathe = strokeToLatheProfile(prepared.relative, {
        maxProfileRings: options.latheProfileRings,
        smoothing: options.latheSmoothing,
      })
      if (!lathe) return null
      const result = generateLathe(lathe.profile, {
        radialSegments: Math.max(8, Math.min(64, Math.round(options.latheRadialSegments ?? 16))),
        preserveProfile: true,
        capBottom: options.latheCaps,
        capTop: options.latheCaps,
      })
      offsetMeshInPlane(result, lathe.axisH, 0)
      return result
    }
    const tipStyle: HairTipStyle =
      options?.hairTipStyle === 'square' ? 'square' : 'pointed'
    if (roundedHair) {
      const spine = prepareHairPathCenterline(prepared.relative, polyBudget)
      if (!spine) return null
      return generateTaperedPointedTube(spine, {
        radius: resolveRoundedHairRadius(extrudeAmount, brushDensity),
        radialSegments: Math.max(6, Math.min(8, primitiveSegmentsForBudget(polyBudget, 7))),
        preserveSpine: true,
        color: 0x6ecbf5,
        tipStyle,
      })
    }

    if (hairStyle) {
      const spine =
        hairStyle === 'strip'
          ? prepareHairStripCenterline(prepared.relative, polyBudget)
          : prepareHairPathCenterline(prepared.relative, polyBudget)
      if (!spine) return null
      return generateHairRibbon(spine, {
        halfWidth: hairHalfWidthFromBrush(brushDensity, hairStyle) * (options?.ribbonWidthScale ?? 1),
        depth: resolveHairDepth(extrudeAmount, brushDensity, hairStyle),
        color: 0x6ecbf5,
        flat: options?.strokeMode === 'ribbon' ? (options.ribbonFlat ?? false) : hairStyle === 'strip',
        tipStyle,
        startTipStyle: options?.strokeMode === 'ribbon' ? (options.ribbonStartTip ?? 'square') : tipStyle,
        endTipStyle: options?.strokeMode === 'ribbon' ? (options.ribbonEndTip ?? 'square') : tipStyle,
        taperFraction: options?.ribbonTaper ?? 0.35,
      })
    }

    if (options?.strokeMode === 'capsule') {
      const radius = Math.max(2, Math.abs(extrudeAmount || brushDensity))
      if (prepared.isClosed) {
        const boundary = prepareOutlineBoundary(prepared.relative, polyBudget, true)
        if (!boundary || boundary.length < 3) return null
        return generateVerticalShapedCapsule(boundary, {
          radialSegments: capsuleRadialSegments(options.pathRadialSegments),
          profileRings: capsuleProfileRingsForBudget(polyBudget),
          preserveBoundary: true,
          color: 0x6ecbf5,
        })
      }
      const spine = preparePathCenterline(prepared.relative, polyBudget)
      if (!spine) return null
      return generateCapsuleSweep(spine, {
        radius,
        radialSegments: capsuleRadialSegments(options.pathRadialSegments),
        preserveSpine: true,
        hemiRings: LOW_POLY_CAPSULE_HEMI_RINGS,
        startCap: 'round',
        endCap: 'round',
        color: 0x6ecbf5,
      })
    }

    if (options?.strokeMode === 'centerline') {
      const spine = preparePathCenterline(prepared.relative, polyBudget)
      if (!spine) return null
      return generatePathOutput(spine, {
        output: options.pathOutput ?? 'tube', radius: Math.max(2.5, Math.min(14, brushDensity * 0.55)) * (options.pathRadiusScale ?? 1), radialSegments: options.pathRadialSegments ?? 8,
        startCap: options.pathStartCap ?? 'flat', endCap: options.pathEndCap ?? 'flat', startScale: options.pathStartScale ?? 1, endScale: options.pathEndScale ?? 1,
        twist: options.pathTwist ?? 360, spacing: options.pathSpacing ?? 16, offset: options.pathOffset ?? 0,
        ribbonStartTip: options.ribbonStartTip ?? 'square', ribbonEndTip: options.ribbonEndTip ?? 'square', ribbonTaper: options.ribbonTaper ?? .35, ribbonFlat: options.ribbonFlat ?? false,
        profile: options.pathProfile ?? 'round', profileWidth: options.pathProfileWidth ?? 1, profileHeight: options.pathProfileHeight ?? 1,
        chainAlternating: options.pathChainAlternating ?? true, cardCrossed: options.pathCardCrossed ?? false,
        distributionMode: options.pathDistributionMode, count: options.pathCount, startPadding: options.pathStartPadding, endPadding: options.pathEndPadding,
        randomScale: options.pathRandomScale, rotation: options.pathRotation, randomRotation: options.pathRandomRotation,
        alternateRotation: options.pathAlternateRotation, mirrorAlternate: options.pathMirrorAlternate, seed: options.pathSeed,
      }, 0x6ecbf5)
    }

    const isClosed = closed ?? prepared.isClosed
    const depth = resolveSilhouetteDepth(
      extrudeAmount ?? Math.max(4, brushDensity),
      outlineMode ? 4 : 1.6
    )

    if (outlineMode) {
      if (isClosed) {
        const boundary = prepareOutlineBoundary(prepared.relative, polyBudget, true)
        if (!boundary || boundary.length < 3) return null
        return extrudeSilhouette(ensureCCW(boundary), {
          depth,
          color: 0x6ecbf5,
        })
      }
      const path = prepareOutlineBoundary(prepared.relative, polyBudget, false)
      if (!path || path.length < 2) return null
      const ribbon = strokeToFlatOutline(path, outlineHalfWidthFromBrush(brushDensity))
      if (!ribbon || ribbon.length < 3) return null
      return extrudeSilhouette(ribbon, { depth, color: 0x6ecbf5 })
    }

    if (isClosed) {
      const boundary = prepareOutlineBoundary(prepared.relative, polyBudget, true)
      if (!boundary || boundary.length < 3) return null
      return extrudeSilhouette(ensureCCW(boundary), {
        depth,
        color: 0x6ecbf5,
      })
    }

    return generateCapsuleSweep(prepared.relative, {
      radius: Math.max(2, Math.abs(depth)),
      radialSegments: VECTOR_PEN_RADIAL_SEGMENTS,
      minAngleDeg: VECTOR_PEN_MIN_ANGLE_DEG,
      closed: false,
      hemiRings: LOW_POLY_CAPSULE_HEMI_RINGS,
      color: 0x6ecbf5,
    })
  })()

  if (!mesh || mesh.vertexCount() === 0) return null

  offsetMeshInPlane(mesh, prepared.center.x, prepared.center.y)
  projectMeshToView(mesh, view, defaultDepth, options?.planeFrame)

  const data = mesh.toMeshData(true, 0)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3))
  geo.setIndex(new THREE.BufferAttribute(data.indices, 1))
  geo.computeVertexNormals()
  return geo
}
