import { generateBeadFromEllipse, generateBeadFromSilhouette } from '../mesh/bead'
import { generateTube } from '../mesh/extrusion'
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
import { extractLatheProfile, classifyStroke } from './strokeClassifier'
import { detectLobes } from './lobeDetection'
import { offsetMeshInPlane, planePathToWorld, projectMeshToView } from './worldProjection'
import { orientTubeFacesOutward } from '../mesh/extrusion'
import { ensureClosedMeshOutward } from '../mesh/meshWinding'
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
  /** Thickness of flat silhouette extrusion along the view axis. */
  extrudeAmount?: number
  name?: string
  /** Explicit closed flag from vector pen (overrides endpoint distance check). */
  pathClosed?: boolean
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
  tubePathPlane?: Vec2[]
): SceneObject {
  offsetMeshInPlane(mesh, interpretation.centroid.x, interpretation.centroid.y)
  projectMeshToView(mesh, view, depth)
  applyColor(mesh, color)

  if (intent === 'path-tube' && tubePathPlane && tubePathPlane.length >= 2) {
    orientTubeFacesOutward(mesh, planePathToWorld(tubePathPlane, view, depth))
  } else {
    ensureClosedMeshOutward(mesh)
  }

  let result = mesh
  if (intent === 'organic-volume') {
    result = remeshOrganic(result, polyBudget)
    applyColor(result, color)
  } else if (
    intent === 'soft-silhouette' ||
    intent === 'sharp-silhouette' ||
    intent === 'silhouette-extrude'
  ) {
    if (result.vertexCount() > polyBudget) {
      result = simplifyMesh(result, polyBudget)
      applyColor(result, color)
    }
  } else if (result.vertexCount() > polyBudget) {
    result = simplifyMesh(result, polyBudget)
    applyColor(result, color)
  }

  return result.toObject(generateId(), customName ?? interpretation.name, {
    polyBudget,
    color,
    polyBudgetMode: 'strict',
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
  polyBudget: number
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
      return generateTube(relative, {
        radius: Math.max(2.5, Math.min(14, brushDensity * 0.55)),
        radialSegments: tess.radialSegments,
        minAngleDeg: tess.minAngleDeg,
        capped: true,
      })

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
    extrudeAmount,
    name,
  } = input

  if (points.length < 2 || view === 'perspective') return null

  if (strokeMode === 'blob' && !extrudeMode) {
    return blobStrokeToObject(input)
  }

  const outlineSketch = strokeMode === 'outline' && !extrudeMode
  const spacing = Math.max(rdpTolerance * (outlineSketch ? 0.22 : 0.35), outlineSketch ? 0.5 : 0.8)
  const resampled = resampleUniform(points, spacing)
  const simplified = rdpSimplify(
    resampled,
    outlineSketch ? rdpTolerance * 0.72 : rdpTolerance
  )

  if (simplified.length < 2) return null

  const effectiveCloseThreshold = extrudeMode ? closeThreshold * 2.5 : closeThreshold

  let closedPoints = simplified
  if (classifyStroke(simplified, effectiveCloseThreshold) === 'closed') {
    const first = simplified[0]
    const last = simplified[simplified.length - 1]
    if (Math.hypot(first.x - last.x, first.y - last.y) > 0.01) {
      closedPoints = [...simplified, first]
    }
  }

  const interpretation = interpretStroke(
    closedPoints,
    effectiveCloseThreshold,
    strokeMode,
    extrudeMode
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
    profileSource
  )

  const effectiveTess =
    extrudeMode && extrudeAmount != null
      ? { ...tess, extrudeDepth: extrudeAmount }
      : tess

  const mesh = generateForIntent(
    interpretation.intent,
    closedPoints,
    effectiveTess,
    interpretation,
    color,
    brushDensity,
    stylize,
    polyBudget
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
    interpretation.intent === 'path-tube' ? closedPoints : undefined
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
