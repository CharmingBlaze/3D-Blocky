import { generateBeadFromEllipse, generateBeadFromSilhouette } from '../mesh/bead'
import { generateCapsuleSweep } from '../mesh/extrusion'
import { generateCapsulePillow } from '../mesh/capsulePillow'
import { generateVerticalShapedCapsule } from '../mesh/verticalCapsule'
import { generateLathe } from '../mesh/lathe'
import { HalfEdgeMesh, type SceneObject } from '../mesh/HalfEdgeMesh'
import { reconstructOrganicMesh } from '../mesh/organicVolumeReconstruct'
import { remeshOrganic } from '../mesh/organicRemesh'
import { simplifyMesh } from '../mesh/simplification'
import { LOW_POLY_CAPSULE_HEMI_RINGS } from '../primitives/capsuleMesh'
import {
  extrudeSilhouette,
  generateConcaveSilhouette,
  mergeMeshes,
  strokeToFlatOutline,
} from '../mesh/silhouetteExtrude'
import {
  generateSharpSilhouette,
  generateSilhouetteLoft,
} from '../mesh/silhouetteLoft'
import { generateId, type Vec2 } from '../utils/math'
import { rdpSimplify, curvatureSampleProfile, curvatureSampleClosedLoop } from './rdp'
import { resampleUniform } from './strokeCapture'
import {
  allocateTessellation,
  interpretStroke,
  type StrokeIntent,
} from './strokeInterpreter'
import { classifyStroke, extractLatheProfile } from './strokeClassifier'
import { isLatheViewSupported, strokeToLatheProfile } from './latheProfile'
import { detectLobes } from './lobeDetection'
import { offsetMeshInPlane, planePathToWorld, projectMeshToView, type StrokePlaneFrame } from './worldProjection'
import { orientTubeFacesOutward } from '../mesh/extrusion'
import { ensureClosedMeshOutward, orientLatheMeshOutward } from '../mesh/meshWinding'
import type { ViewType, StrokeMode } from '../store/appStore'
import type { HairTipStyle } from '../mesh/hairRibbon'
import type { SweepCapStyle } from '../mesh/extrusion'
import { IDENTITY_TRANSFORM } from '../mesh/objectTransform'
import { blobStrokeToObject } from '../blob/strokeToBlob'
import { preparePathCenterline } from './sketchSource'
import type { PathDistributionMode, PathOutput, PathProfile } from '../mesh/pathOutputs'
import { ensureObjectUVs } from '../uv/uvObject'

function capSpineToSampleCount(spine: Vec2[], maxSamples: number): Vec2[] {
  if (maxSamples < 2 || spine.length <= maxSamples) return spine
  const out: Vec2[] = []
  for (let i = 0; i < maxSamples; i++) {
    out.push(
      spine[Math.min(spine.length - 1, Math.round((i / (maxSamples - 1)) * (spine.length - 1)))]!
    )
  }
  return out
}

export interface PolylineInput {
  points: { x: number; y: number }[]
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
  /** Thickness of flat silhouette extrusion along the view axis. */
  extrudeAmount?: number
  /** Fullness for newly drawn Blob shoulders, 0–1. */
  blobInflation?: number
  name?: string
  /** Explicit closed flag from vector pen (overrides endpoint distance check). */
  pathClosed?: boolean
  /** Vector pen commit: skip sketch RDP, force doodle intent, low-poly capsule sampling. */
  preserveDetail?: boolean
  /** Hair tip shape: pointed (tapered) or square (blunt). Default pointed. */
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
  pathSourceObject?: SceneObject | null
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
  pathSourceObjectId?: string | null
  /** Locked camera-facing plane for perspective strokes (required for correct world placement). */
  planeFrame?: StrokePlaneFrame | null
}

function dedupeConsecutivePoints(points: Vec2[], epsilon = 0.01): Vec2[] {
  if (points.length === 0) return []
  const out: Vec2[] = [points[0]!]
  for (let i = 1; i < points.length; i++) {
    const p = points[i]!
    const prev = out[out.length - 1]!
    if (Math.hypot(p.x - prev.x, p.y - prev.y) > epsilon) out.push(p)
  }
  return out
}

function centroidRelative(points: Vec2[], cx: number, cy: number): Vec2[] {
  return points.map((p) => ({ x: p.x - cx, y: p.y - cy }))
}

function applyColor(mesh: HalfEdgeMesh, color: number): void {
  for (let i = 0; i < mesh.faceColors.length; i++) {
    mesh.faceColors[i] = color
  }
}

function finalizeMesh(
  mesh: HalfEdgeMesh,
  interpretation: ReturnType<typeof interpretStroke>,
  view: ViewType,
  depth: number,
  color: number,
  polyBudget: number,
  intent: StrokeIntent,
  customName?: string,
  tubePathPlane?: Vec2[],
  preserveDetail = false,
  latheObject = false,
  planeFrame?: StrokePlaneFrame | null
): SceneObject {
  const planeOffsetX =
    intent === 'profile-lathe' && interpretation.latheAxisH != null
      ? interpretation.latheAxisH
      : interpretation.centroid.x
  const planeOffsetY = intent === 'profile-lathe' ? 0 : interpretation.centroid.y
  offsetMeshInPlane(mesh, planeOffsetX, planeOffsetY)
  projectMeshToView(mesh, view, depth, planeFrame)
  applyColor(mesh, color)

  if (
    (intent === 'path-tube' || intent === 'path-capsule') &&
    tubePathPlane &&
    tubePathPlane.length >= 2
  ) {
    orientTubeFacesOutward(
      mesh,
      planePathToWorld(tubePathPlane, view, depth, planeFrame),
      interpretation.isClosed
    )
  } else if (intent === 'profile-lathe' && interpretation.latheAxisH != null) {
    orientLatheMeshOutward(mesh, view, interpretation.latheAxisH, depth)
  } else {
    ensureClosedMeshOutward(mesh)
  }

  let result = mesh
  if (intent === 'organic-volume') {
    result = remeshOrganic(result, polyBudget)
    applyColor(result, color)
  } else if (
    !preserveDetail &&
    intent !== 'vertical-capsule' &&
    intent !== 'silhouette-extrude' &&
    intent !== 'path-tube' &&
    (intent === 'soft-silhouette' ||
      intent === 'sharp-silhouette' ||
      intent === 'capsule-pillow')
  ) {
    if (result.vertexCount() > polyBudget) {
      result = simplifyMesh(result, polyBudget)
      applyColor(result, color)
    }
  } else if (
    !preserveDetail &&
    !latheObject &&
    intent !== 'vertical-capsule' &&
    intent !== 'silhouette-extrude' &&
    intent !== 'path-tube' &&
    result.vertexCount() > polyBudget
  ) {
    result = simplifyMesh(result, polyBudget)
    applyColor(result, color)
  }

  const hasCylindricalUvs =
    intent === 'vertical-capsule' &&
    result.uvs.length > 0 &&
    result.faceUvIndices.length === result.faces.length

  const object = result.toObject(generateId(), customName ?? interpretation.name, {
    polyBudget: latheObject ? result.vertexCount() : preserveDetail ? result.vertexCount() : polyBudget,
    color,
    polyBudgetMode: latheObject || preserveDetail ? 'adaptive' : 'strict',
    smoothShading: latheObject ? true : undefined,
    uvAutoPacked: hasCylindricalUvs ? true : undefined,
    uvMappingMode: hasCylindricalUvs ? 'box' : undefined,
    transform: {
      position: { ...IDENTITY_TRANSFORM.position },
      rotation: { ...IDENTITY_TRANSFORM.rotation },
      scale: { ...IDENTITY_TRANSFORM.scale },
    },
  })
  return latheObject ? ensureObjectUVs(object) : object
}

function generateForIntent(
  intent: StrokeIntent,
  points: Vec2[],
  tess: ReturnType<typeof allocateTessellation>,
  interpretation: ReturnType<typeof interpretStroke>,
  color: number,
  brushDensity: number,
  stylize: number,
  polyBudget: number,
  latheCaps = false,
  latheRadialSegments?: number,
  latheProfileRings?: number,
  latheSmoothing?: number
): HalfEdgeMesh | null {
  const relative = centroidRelative(points, interpretation.centroid.x, interpretation.centroid.y)

  switch (intent) {
    case 'bead': {
      if (interpretation.ellipse) {
        return generateBeadFromEllipse(
          { ...interpretation.ellipse, cx: 0, cy: 0 },
          {
            radialSegments: tess.radialSegments,
            profileRings: tess.profileRings,
            minAngleDeg: tess.minAngleDeg,
          }
        )
      }
      return generateBeadFromSilhouette(relative, tess.radialSegments, tess.minAngleDeg)
    }

    case 'silhouette-lathe': {
      const profile = extractLatheProfile(relative)
      const sampled = curvatureSampleProfile(profile, tess.minAngleDeg, tess.profileRings)
      return generateLathe(sampled, {
        radialSegments: tess.radialSegments,
        minAngleDeg: tess.minAngleDeg,
        depth: 0,
      })
    }

    case 'silhouette-extrude': {
      let boundary: Vec2[]
      if (interpretation.isClosed) {
        // Keep the drawn loop — strip only a duplicate close vertex.
        // Do not curvature-sample; that turns smooth freehand into jagged polygons.
        const first = relative[0]!
        const last = relative[relative.length - 1]!
        boundary =
          Math.hypot(first.x - last.x, first.y - last.y) <= 0.01
            ? relative.slice(0, -1)
            : relative
        if (boundary.length > tess.boundaryVerts) {
          // Soft even downsample only when past the hard tessellation cap.
          const out: Vec2[] = []
          const step = boundary.length / tess.boundaryVerts
          for (let i = 0; i < tess.boundaryVerts; i++) {
            out.push(boundary[Math.min(boundary.length - 1, Math.round(i * step))]!)
          }
          boundary = out
        }
      } else {
        const halfWidth = Math.max(2.5, brushDensity * 0.4)
        const outline = strokeToFlatOutline(relative, halfWidth)
        if (!outline || outline.length < 3) return null
        boundary = outline
      }
      const { lobes, isMultiLobe } = detectLobes(boundary)
      if (isMultiLobe && lobes.length > 1) {
        return generateConcaveSilhouette(lobes, tess.extrudeDepth, color)
      }
      return extrudeSilhouette(boundary, { depth: tess.extrudeDepth, color })
    }

    case 'soft-silhouette': {
      const boundary = curvatureSampleClosedLoop(
        relative,
        tess.minAngleDeg,
        tess.boundaryVerts
      )
      const { lobes, isMultiLobe } = detectLobes(boundary)
      if (isMultiLobe && lobes.length > 1) {
        const parts = lobes.map((lobe) =>
          generateSilhouetteLoft(lobe, {
            depthScale: tess.extrudeDepth,
            roundness: 0.82 + Math.min(0.12, brushDensity * 0.005),
            radialSegments: tess.radialSegments,
            maxRings: tess.profileRings,
            minAngleDeg: tess.minAngleDeg,
            maxBoundaryVerts: tess.boundaryVerts,
            color,
          })
        )
        return parts.length === 1 ? parts[0] : mergeMeshes(parts, color)
      }
      return generateSilhouetteLoft(boundary, {
        depthScale: tess.extrudeDepth,
        roundness: 0.82 + Math.min(0.12, brushDensity * 0.005),
        radialSegments: tess.radialSegments,
        maxRings: tess.profileRings,
        minAngleDeg: tess.minAngleDeg,
        maxBoundaryVerts: tess.boundaryVerts,
        color,
      })
    }

    case 'sharp-silhouette': {
      const boundary = curvatureSampleClosedLoop(
        relative,
        tess.minAngleDeg,
        tess.boundaryVerts
      )
      const { lobes, isMultiLobe } = detectLobes(boundary)
      if (isMultiLobe && lobes.length > 1) {
        return generateConcaveSilhouette(lobes, tess.extrudeDepth, color)
      }
      return generateSharpSilhouette(boundary, {
        depthScale: tess.extrudeDepth,
        minAngleDeg: tess.minAngleDeg,
        maxBoundaryVerts: tess.boundaryVerts,
        color,
      })
    }

    case 'organic-volume': {
      const boundary = curvatureSampleClosedLoop(
        relative,
        tess.minAngleDeg,
        tess.boundaryVerts
      )
      const { lobes, isMultiLobe } = detectLobes(boundary)
      const activeLobes = isMultiLobe && lobes.length > 1 ? lobes : undefined
      return reconstructOrganicMesh(
        boundary,
        {
          depthScale: tess.extrudeDepth,
          roundness: brushDensity,
          polyBudget,
          stylize,
          color,
        },
        activeLobes
      )
    }

    case 'path-tube': {
      const spine = preparePathCenterline(relative, Math.max(polyBudget, tess.pathSamples * 4))
      if (!spine || spine.length < 2) return null
      const ringSpine = capSpineToSampleCount(spine, tess.pathSamples)
      return generateCapsuleSweep(ringSpine, {
        radius: Math.max(2.5, Math.min(14, brushDensity * 0.55)),
        radialSegments: tess.radialSegments,
        closed: false,
        hemiRings: 0,
        preserveSpine: true,
        color,
      })
    }

    case 'path-capsule': {
      const spine = preparePathCenterline(relative, Math.max(polyBudget, tess.pathSamples * 4))
      if (!spine || spine.length < 2) return null
      const ringSpine = capSpineToSampleCount(spine, tess.pathSamples)
      return generateCapsuleSweep(ringSpine, {
        radius: Math.max(2, tess.extrudeDepth),
        radialSegments: tess.radialSegments,
        closed: false,
        hemiRings: LOW_POLY_CAPSULE_HEMI_RINGS,
        preserveSpine: true,
        color,
      })
    }

    case 'capsule-pillow': {
      // Sample once here; pillow must not resample again (keeps depth edges aligned).
      const boundary = curvatureSampleClosedLoop(
        relative,
        tess.minAngleDeg,
        tess.boundaryVerts
      )
      const { lobes, isMultiLobe } = detectLobes(boundary)
      if (isMultiLobe && lobes.length > 1) {
        const parts = lobes.map((lobe) =>
          generateCapsulePillow(lobe, {
            depth: tess.extrudeDepth,
            minAngleDeg: tess.minAngleDeg,
            maxBoundaryVerts: tess.boundaryVerts,
            preserveBoundary: true,
            color,
          })
        )
        return parts.length === 1 ? parts[0]! : mergeMeshes(parts, color)
      }
      return generateCapsulePillow(boundary, {
        depth: tess.extrudeDepth,
        minAngleDeg: tess.minAngleDeg,
        maxBoundaryVerts: tess.boundaryVerts,
        preserveBoundary: true,
        color,
      })
    }

    case 'vertical-capsule': {
      const boundary = curvatureSampleClosedLoop(
        relative,
        tess.minAngleDeg,
        tess.boundaryVerts
      )
      return generateVerticalShapedCapsule(boundary, {
        radialSegments: tess.radialSegments,
        profileRings: tess.profileRings,
        minAngleDeg: tess.minAngleDeg,
        maxBoundaryVerts: tess.boundaryVerts,
        preserveBoundary: true,
        color,
      })
    }

    case 'profile-lathe': {
      const lathe = strokeToLatheProfile(points, {
        maxProfileRings: latheProfileRings,
        smoothing: latheSmoothing,
      })
      if (!lathe || lathe.profile.length < 2) return null
      return generateLathe(lathe.profile, {
        radialSegments: Math.max(8, Math.min(64, Math.round(latheRadialSegments ?? 16))),
        preserveProfile: true,
        capBottom: latheCaps,
        capTop: latheCaps,
        depth: 0,
        axis: 'y',
      })
    }

    case 'hole-line':
      return null
  }
}

export function polylineToMesh(input: PolylineInput): SceneObject | null {
  const {
    points,
    view,
    polyBudget,
    brushDensity,
    strokeMode,
    rdpTolerance,
    closeThreshold,
    defaultDepth,
    color,
    stylize = 0,
    extrudeMode = false,
    latheMode = false,
    latheCaps = false,
    latheRadialSegments = 16,
    latheProfileRings = 32,
    latheSmoothing = 0.15,
    extrudeAmount,
    name,
    pathClosed,
    preserveDetail = false,
    planeFrame = null,
  } = input

  if (points.length < 2) return null
  if (view === 'perspective' && !planeFrame) return null
  if (latheMode && !isLatheViewSupported(view)) return null

  if (strokeMode === 'blob' && !extrudeMode && !latheMode) {
    return blobStrokeToObject(input)
  }

  let closedPoints: Vec2[]
  if (preserveDetail || latheMode) {
    closedPoints = dedupeConsecutivePoints(points)
    if (!latheMode && pathClosed && closedPoints.length >= 3) {
      const first = closedPoints[0]!
      const last = closedPoints[closedPoints.length - 1]!
      if (Math.hypot(first.x - last.x, first.y - last.y) <= 0.01) {
        closedPoints = closedPoints.slice(0, -1)
      }
    }
  } else if (strokeMode === 'outline' || (extrudeMode && strokeMode !== 'centerline')) {
    // Outline / Extrude silhouette: keep stroke points (light dedupe only).
    closedPoints = dedupeConsecutivePoints(points)
    const effectiveCloseThreshold = extrudeMode ? closeThreshold * 2.5 : closeThreshold
    if (classifyStroke(closedPoints, effectiveCloseThreshold) === 'closed') {
      const first = closedPoints[0]!
      const last = closedPoints[closedPoints.length - 1]!
      if (Math.hypot(first.x - last.x, first.y - last.y) > 0.01) {
        closedPoints = [...closedPoints, first]
      }
    }
  } else {
    const spacing = Math.max(rdpTolerance * 0.35, 0.8)
    const resampled = resampleUniform(points, spacing)
    const simplified = rdpSimplify(resampled, rdpTolerance)

    if (simplified.length < 2) return null

    const effectiveCloseThreshold = extrudeMode ? closeThreshold * 2.5 : closeThreshold

    closedPoints = simplified
    if (classifyStroke(simplified, effectiveCloseThreshold) === 'closed') {
      const first = simplified[0]!
      const last = simplified[simplified.length - 1]!
      if (Math.hypot(first.x - last.x, first.y - last.y) > 0.01) {
        closedPoints = [...simplified, first]
      }
    }
  }

  if (closedPoints.length < 2) return null

  const effectiveCloseThreshold = extrudeMode ? closeThreshold * 2.5 : closeThreshold

  const interpretation = interpretStroke(
    closedPoints,
    effectiveCloseThreshold,
    strokeMode,
    extrudeMode,
    { preserveDetail, pathClosed, latheMode }
  )

  if (interpretation.intent === 'hole-line') return null

  const profileSource =
    interpretation.intent === 'bead' && interpretation.ellipse
      ? (() => {
          const { rx, ry } = interpretation.ellipse!
          const prof: Vec2[] = []
          for (let i = 0; i <= 8; i++) {
            const t = i / 8
            const v = -ry + t * 2 * ry
            const nv = ry > 0 ? v / ry : 0
            prof.push({ x: rx * Math.sqrt(Math.max(0, 1 - nv * nv)), y: v })
          }
          return prof
        })()
      : closedPoints

  const tess = allocateTessellation(
    polyBudget,
    brushDensity,
    interpretation.intent,
    profileSource,
    15,
    preserveDetail
  )

  const effectiveTess =
    extrudeAmount != null && (extrudeMode || preserveDetail || strokeMode === 'capsule')
      ? { ...tess, extrudeDepth: Math.max(1.6, Math.abs(extrudeAmount)) }
      : tess

  const mesh = generateForIntent(
    interpretation.intent,
    closedPoints,
    effectiveTess,
    interpretation,
    color,
    brushDensity,
    stylize,
    polyBudget,
    latheCaps,
    latheRadialSegments,
    latheProfileRings,
    latheSmoothing
  )
  if (!mesh || mesh.vertexCount() === 0) return null

  const object = finalizeMesh(
    mesh,
    interpretation,
    view,
    defaultDepth,
    color,
    polyBudget,
    interpretation.intent,
    name,
    interpretation.intent === 'path-tube' || interpretation.intent === 'path-capsule'
      ? closedPoints
      : undefined,
    preserveDetail,
    interpretation.intent === 'profile-lathe',
    planeFrame
  )
  if (interpretation.intent === 'profile-lathe') {
    object.latheSource = {
      points: closedPoints.map((point) => ({ ...point })),
      view,
      defaultDepth,
      caps: latheCaps,
      radialSegments: latheRadialSegments,
      profileRings: latheProfileRings,
      smoothing: latheSmoothing,
    }
  }
  return object
}

export function isHoleLinePolyline(input: PolylineInput): boolean {
  if (input.points.length < 2) return false
  const spacing = Math.max(input.rdpTolerance * 0.5, 1)
  const resampled = resampleUniform(input.points, spacing)
  const simplified = rdpSimplify(resampled, input.rdpTolerance)
  const interpretation = interpretStroke(
    simplified,
    input.closeThreshold,
    input.strokeMode,
    input.extrudeMode
  )
  return interpretation.intent === 'hole-line'
}
