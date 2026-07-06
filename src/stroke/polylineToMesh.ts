import { generateBeadFromEllipse, generateBeadFromSilhouette } from '../mesh/bead'
import { generateCapsuleSweep } from '../mesh/extrusion'
import { generateCapsulePillow } from '../mesh/capsulePillow'
import { generateLathe } from '../mesh/lathe'
import { HalfEdgeMesh, type SceneObject } from '../mesh/HalfEdgeMesh'
import { reconstructOrganicMesh } from '../mesh/organicVolumeReconstruct'
import { remeshOrganic } from '../mesh/organicRemesh'
import { simplifyMesh } from '../mesh/simplification'
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
import { offsetMeshInPlane, planePathToWorld, projectMeshToView } from './worldProjection'
import { orientTubeFacesOutward } from '../mesh/extrusion'
import { ensureClosedMeshOutward, orientLatheMeshOutward } from '../mesh/meshWinding'
import type { ViewType, StrokeMode } from '../store/appStore'
import { IDENTITY_TRANSFORM } from '../mesh/objectTransform'
import { blobStrokeToObject } from '../blob/strokeToBlob'

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
  /** Thickness of flat silhouette extrusion along the view axis. */
  extrudeAmount?: number
  name?: string
  /** Explicit closed flag from vector pen (overrides endpoint distance check). */
  pathClosed?: boolean
  /** Vector pen commit: skip sketch RDP, force doodle intent, low-poly capsule sampling. */
  preserveDetail?: boolean
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
  latheObject = false
): SceneObject {
  const planeOffsetX =
    intent === 'profile-lathe' && interpretation.latheAxisH != null
      ? interpretation.latheAxisH
      : interpretation.centroid.x
  const planeOffsetY = intent === 'profile-lathe' ? 0 : interpretation.centroid.y
  offsetMeshInPlane(mesh, planeOffsetX, planeOffsetY)
  projectMeshToView(mesh, view, depth)
  applyColor(mesh, color)

  if (
    (intent === 'path-tube' || intent === 'path-capsule') &&
    tubePathPlane &&
    tubePathPlane.length >= 2
  ) {
    orientTubeFacesOutward(
      mesh,
      planePathToWorld(tubePathPlane, view, depth),
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
    (intent === 'soft-silhouette' ||
      intent === 'sharp-silhouette' ||
      intent === 'silhouette-extrude' ||
      intent === 'capsule-pillow')
  ) {
    if (result.vertexCount() > polyBudget) {
      result = simplifyMesh(result, polyBudget)
      applyColor(result, color)
    }
  } else if (!preserveDetail && !latheObject && result.vertexCount() > polyBudget) {
    result = simplifyMesh(result, polyBudget)
    applyColor(result, color)
  }

  return result.toObject(generateId(), customName ?? interpretation.name, {
    polyBudget: latheObject ? result.vertexCount() : preserveDetail ? result.vertexCount() : polyBudget,
    color,
    polyBudgetMode: latheObject || preserveDetail ? 'adaptive' : 'strict',
    smoothShading: latheObject ? false : undefined,
    transform: {
      position: { ...IDENTITY_TRANSFORM.position },
      rotation: { ...IDENTITY_TRANSFORM.rotation },
      scale: { ...IDENTITY_TRANSFORM.scale },
    },
  })
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
  latheCaps = false
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
        boundary = curvatureSampleClosedLoop(
          relative,
          tess.minAngleDeg,
          tess.boundaryVerts
        )
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

    case 'path-tube':
      return generateCapsuleSweep(relative, {
        radius: Math.max(2.5, Math.min(14, brushDensity * 0.55)),
        radialSegments: tess.radialSegments,
        minAngleDeg: tess.minAngleDeg,
        closed: false,
        color,
      })

    case 'path-capsule':
      return generateCapsuleSweep(relative, {
        radius: Math.max(2, tess.extrudeDepth),
        radialSegments: tess.radialSegments,
        minAngleDeg: tess.minAngleDeg,
        closed: false,
        color,
      })

    case 'capsule-pillow': {
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
            color,
          })
        )
        return parts.length === 1 ? parts[0]! : mergeMeshes(parts, color)
      }
      return generateCapsulePillow(boundary, {
        depth: tess.extrudeDepth,
        minAngleDeg: tess.minAngleDeg,
        maxBoundaryVerts: tess.boundaryVerts,
        color,
      })
    }

    case 'profile-lathe': {
      const lathe = strokeToLatheProfile(points)
      if (!lathe || lathe.profile.length < 2) return null
      return generateLathe(lathe.profile, {
        radialSegments: tess.radialSegments,
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
    extrudeAmount,
    name,
    pathClosed,
    preserveDetail = false,
  } = input

  if (points.length < 2 || view === 'perspective') return null
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
  } else {
    const outlineSketch = strokeMode === 'outline' && !extrudeMode
    const spacing = Math.max(rdpTolerance * (outlineSketch ? 0.22 : 0.35), outlineSketch ? 0.5 : 0.8)
    const resampled = resampleUniform(points, spacing)
    const simplified = rdpSimplify(
      resampled,
      outlineSketch ? rdpTolerance * 0.72 : rdpTolerance
    )

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
    extrudeAmount != null && (extrudeMode || preserveDetail)
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
    latheCaps
  )
  if (!mesh || mesh.vertexCount() === 0) return null

  return finalizeMesh(
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
    interpretation.intent === 'profile-lathe'
  )
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
