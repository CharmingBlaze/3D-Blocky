import { perpendicularDistance, type Vec2 } from '../utils/math'
import { curvatureSampleProfile } from './rdp'
import { fitEllipse, totalCurvature } from './strokeCapture'
import { classifyStroke, type StrokeType } from './strokeClassifier'
import { isConcavePolygon, concavityScore, countReflexVertices } from '../mesh/concaveTriangulate'
import type { StrokeMode } from '../store/appStore'
import {
  VECTOR_PEN_MAX_BOUNDARY_VERTS,
  VECTOR_PEN_MAX_PATH_SAMPLES,
  VECTOR_PEN_MIN_ANGLE_DEG,
  VECTOR_PEN_RADIAL_SEGMENTS,
} from '../vector/vectorPenLimits'

import { detectRadialSymmetry } from './strokeClassifier'
import {
  LATHE_MAX_PROFILE_RINGS,
  LATHE_MIN_ANGLE_DEG,
  LATHE_RADIAL_SEGMENTS,
  latheAxisHFromPoints,
} from './latheProfile'
import { pathSpineBudget } from './sketchSource'

export type StrokeIntent =
  | 'bead'
  | 'soft-silhouette'
  | 'sharp-silhouette'
  | 'organic-volume'
  | 'silhouette-lathe'
  | 'silhouette-extrude'
  | 'path-tube'
  | 'path-capsule'
  | 'capsule-pillow'
  | 'vertical-capsule'
  | 'profile-lathe'
  | 'hole-line'

export interface StrokeInterpretation {
  intent: StrokeIntent
  strokeType: StrokeType
  isClosed: boolean
  isConcave: boolean
  lobeCount: number
  ellipse: ReturnType<typeof fitEllipse> | null
  centroid: Vec2
  pathLength: number
  totalTurn: number
  name: string
  /** Plane X of lathe revolution axis (matches leftmost drawn point). */
  latheAxisH?: number
}

function pathLength(points: Vec2[]): number {
  let len = 0
  for (let i = 1; i < points.length; i++) {
    len += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
  }
  return len
}

export function isStraightLine(points: Vec2[], ratioThreshold = 0.06): boolean {
  if (points.length < 2) return false
  const start = points[0]
  const end = points[points.length - 1]
  const chord = Math.hypot(end.x - start.x, end.y - start.y)
  if (chord < 3) return false

  let maxDev = 0
  for (const p of points) {
    maxDev = Math.max(maxDev, perpendicularDistance(p, start, end))
  }
  return maxDev / chord <= ratioThreshold
}

/** Strict circle only — ovals, heads, and blobs never pass */
export function isCircleOrOval(points: Vec2[]): boolean {
  if (points.length < 8 || isConcavePolygon(points)) return false
  const ellipse = fitEllipse(points)
  return (
    ellipse.circularity > 0.9 &&
    ellipse.aspectRatio > 0.75 &&
    concavityScore(points) < 0.04
  )
}

export function estimateLobeCount(points: Vec2[]): number {
  return Math.max(1, Math.floor(countReflexVertices(points) / 2))
}

export interface InterpretStrokeOptions {
  preserveDetail?: boolean
  pathClosed?: boolean
  latheMode?: boolean
}

export function interpretStroke(
  points: Vec2[],
  closeThreshold: number,
  strokeMode: StrokeMode,
  extrudeMode = false,
  options: InterpretStrokeOptions = {}
): StrokeInterpretation {
  const strokeType =
    options.pathClosed === true ? 'closed' : classifyStroke(points, closeThreshold)
  const isClosed = options.pathClosed === true || strokeType === 'closed'
  const concave = isClosed && isConcavePolygon(points)
  const lobes = isClosed ? estimateLobeCount(points) : 1
  const ellipse = isClosed ? fitEllipse(points) : null
  const centroid = {
    x: points.reduce((s, p) => s + p.x, 0) / points.length,
    y: points.reduce((s, p) => s + p.y, 0) / points.length,
  }
  const len = pathLength(points)
  const turn = totalCurvature(points)

  const base = {
    strokeType,
    isClosed,
    isConcave: concave,
    lobeCount: lobes,
    ellipse,
    centroid,
    pathLength: len,
    totalTurn: turn,
  }

  // Lathe — open profile revolved around the active ortho view's screen-vertical axis.
  if (options.latheMode && points.length >= 2) {
    return {
      ...base,
      intent: 'profile-lathe',
      name: 'Lathe',
      latheAxisH: latheAxisHFromPoints(points),
    }
  }

  // Extrude — closed outline becomes a flat prism (CAD-style faces); open stroke sweeps a capsule.
  if (extrudeMode && points.length >= 2) {
    return {
      ...base,
      intent: isClosed ? 'silhouette-extrude' : 'path-capsule',
      name: isClosed ? 'Extrude' : 'Capsule',
    }
  }

  if (strokeMode === 'centerline') {
    return {
      ...base,
      intent: isStraightLine(points) ? 'hole-line' : 'path-tube',
      name: isStraightLine(points) ? 'Hole' : 'Path',
    }
  }

  if (strokeMode === 'blob') {
    if (!isClosed) {
      return {
        ...base,
        intent: isStraightLine(points) ? 'hole-line' : 'path-tube',
        name: isStraightLine(points) ? 'Hole' : 'Blob Path',
      }
    }
    return {
      ...base,
      intent: 'soft-silhouette',
      name: lobes > 1 ? `Blob (${lobes} lobes)` : 'Blob',
    }
  }

  if (strokeMode === 'capsule') {
    if (!isClosed) {
      return {
        ...base,
        intent: isStraightLine(points) ? 'hole-line' : 'path-capsule',
        name: isStraightLine(points) ? 'Hole' : 'Capsule',
      }
    }
    return {
      ...base,
      intent: 'vertical-capsule',
      name: 'Capsule',
    }
  }

  // Hair modes are routed via sketch doodle builders (not polyline intents).
  // Keep a path-tube fallback if they ever reach the classifier path.
  if (strokeMode === 'ribbon' || strokeMode === 'tapered-tube' || strokeMode === 'hair-paths' || strokeMode === 'hair-strips' || strokeMode === 'hair-round') {
    return {
      ...base,
      intent: 'path-tube',
      name:
        strokeMode === 'ribbon'
          ? 'Ribbon'
          : strokeMode === 'tapered-tube'
            ? 'Tapered Tube'
        : strokeMode === 'hair-strips'
          ? 'Hair Strips'
          : strokeMode === 'hair-round'
            ? 'Rounded Hair'
            : 'Hair Paths',
    }
  }

  // Outline / default closed fill via polyline — capsule pillow (Sketch Outline uses flat extrude)
  if (!isClosed) {
    if (isStraightLine(points)) {
      return { ...base, intent: 'hole-line', name: 'Hole' }
    }
    return { ...base, intent: 'path-tube', name: 'Path' }
  }

  if (!options.preserveDetail && isCircleOrOval(points)) {
    return { ...base, intent: 'bead', name: 'Bead' }
  }

  if (!options.preserveDetail && detectRadialSymmetry(points, 0.72)) {
    return { ...base, intent: 'silhouette-lathe', name: 'Bead' }
  }

  if (concave && lobes > 1) {
    return {
      ...base,
      intent: 'capsule-pillow',
      name: `Doodle (${lobes} lobes)`,
    }
  }

  return {
    ...base,
    intent: 'capsule-pillow',
    name: 'Doodle',
  }
}

export interface TessellationBudget {
  radialSegments: number
  profileRings: number
  pathSamples: number
  boundaryVerts: number
  extrudeDepth: number
  minAngleDeg: number
}

export function allocateTessellation(
  polyBudget: number,
  brushDensity: number,
  intent: StrokeIntent,
  profilePoints: Vec2[],
  minAngleDeg = 15,
  preserveDetail = false
): TessellationBudget {
  const sampled = curvatureSampleProfile(profilePoints, minAngleDeg)
  const curvatureRings = Math.max(3, Math.min(sampled.length, preserveDetail ? 128 : 16))
  const cappedDensity = preserveDetail
    ? Math.max(6, Math.min(brushDensity, 32))
    : Math.max(4, Math.min(brushDensity, 24))
  const budget = Math.max(12, polyBudget)

  switch (intent) {
    case 'bead': {
      const profileRings = Math.max(4, Math.min(curvatureRings, 8))
      const radialSegments = Math.max(
        4,
        Math.min(cappedDensity, Math.floor((budget - 2) / profileRings))
      )
      return {
        radialSegments,
        profileRings,
        pathSamples: 0,
        boundaryVerts: 0,
        extrudeDepth: cappedDensity * 0.8,
        minAngleDeg: 18,
      }
    }
    case 'silhouette-lathe': {
      const profileRings = Math.max(3, Math.min(curvatureRings, 12))
      const radialSegments = Math.max(
        4,
        Math.min(cappedDensity, Math.floor(budget / profileRings))
      )
      return {
        radialSegments,
        profileRings,
        pathSamples: 0,
        boundaryVerts: 0,
        extrudeDepth: cappedDensity * 0.8,
        minAngleDeg,
      }
    }
    case 'soft-silhouette': {
      const radialSegments = Math.max(
        6,
        Math.min(cappedDensity, Math.floor(Math.sqrt(budget * 1.1)))
      )
      const maxRings = Math.max(
        5,
        Math.min(14, Math.floor((budget * 0.9) / Math.max(12, radialSegments * 2)))
      )
      return {
        radialSegments,
        profileRings: maxRings,
        pathSamples: 0,
        boundaryVerts: Math.max(14, Math.min(Math.floor(budget * 0.75), 56)),
        extrudeDepth: Math.max(6, cappedDensity * 1.1),
        minAngleDeg: Math.max(10, minAngleDeg - 2),
      }
    }
    case 'sharp-silhouette': {
      const maxBoundary = Math.max(8, Math.min(Math.floor(budget * 0.5), 28))
      return {
        radialSegments: 0,
        profileRings: 0,
        pathSamples: 0,
        boundaryVerts: maxBoundary,
        extrudeDepth: Math.max(6, cappedDensity),
        minAngleDeg,
      }
    }
    case 'organic-volume': {
      const maxBoundary = Math.max(12, Math.min(Math.floor(budget * 0.65), 40))
      const gridRes = Math.max(8, Math.min(16, Math.floor(Math.sqrt(budget) * 1.1)))
      return {
        radialSegments: gridRes,
        profileRings: 0,
        pathSamples: 0,
        boundaryVerts: maxBoundary,
        extrudeDepth: Math.max(6, cappedDensity * 1.2),
        minAngleDeg: Math.max(8, minAngleDeg - 4),
      }
    }
    case 'silhouette-extrude': {
      // Flat extrude: 2 verts per boundary point — keep the drawn silhouette.
      // Cap high so dense freehand Outline/Extrude is not crushed by poly budget.
      const maxBoundary = Math.max(64, Math.min(Math.max(Math.floor(budget * 2), 256), 512))
      return {
        radialSegments: 0,
        profileRings: 0,
        pathSamples: 0,
        boundaryVerts: maxBoundary,
        extrudeDepth: Math.max(8, cappedDensity),
        minAngleDeg: Math.min(minAngleDeg, 6),
      }
    }
    case 'path-tube':
    case 'path-capsule': {
      // Prefer centerline fidelity: soft longitudinal budget (not budget/density crush).
      // Radial stays low-mid poly (6–10). Default 128 → ~56 rings (lower-mid).
      const radialSegments = Math.max(
        6,
        Math.min(
          10,
          preserveDetail
            ? VECTOR_PEN_RADIAL_SEGMENTS
            : Math.min(cappedDensity, Math.floor(Math.sqrt(budget * 0.5)) || 8)
        )
      )
      const pathSamples = preserveDetail
        ? Math.min(
            VECTOR_PEN_MAX_PATH_SAMPLES,
            Math.max(3, Math.min(curvatureRings, profilePoints.length))
          )
        : pathSpineBudget(budget, profilePoints.length)
      return {
        radialSegments,
        profileRings: 0,
        pathSamples,
        boundaryVerts: 0,
        extrudeDepth: Math.max(4, cappedDensity),
        // Unused when preserveSpine; kept low as a safe fallback.
        minAngleDeg: preserveDetail ? VECTOR_PEN_MIN_ANGLE_DEG : 4,
      }
    }
    case 'capsule-pillow': {
      return {
        radialSegments: 0,
        profileRings: 0,
        pathSamples: 0,
        boundaryVerts: preserveDetail
          ? VECTOR_PEN_MAX_BOUNDARY_VERTS
          : Math.max(16, Math.min(Math.floor(budget * 0.85), 64)),
        extrudeDepth: Math.max(4, cappedDensity * 1.1),
        minAngleDeg: preserveDetail ? VECTOR_PEN_MIN_ANGLE_DEG : Math.max(8, minAngleDeg - 4),
      }
    }
    case 'vertical-capsule': {
      const profileRings = Math.max(
        6,
        Math.min(14, Math.floor(budget / Math.max(8, cappedDensity)))
      )
      const radialSegments = Math.max(
        6,
        Math.min(10, Math.floor(budget / Math.max(6, profileRings)))
      )
      return {
        radialSegments,
        profileRings,
        pathSamples: 0,
        boundaryVerts: Math.max(12, Math.min(Math.floor(budget * 0.5), 36)),
        extrudeDepth: Math.max(4, cappedDensity),
        minAngleDeg: preserveDetail ? VECTOR_PEN_MIN_ANGLE_DEG : minAngleDeg,
      }
    }
    case 'profile-lathe': {
      const profileRings = Math.min(LATHE_MAX_PROFILE_RINGS, Math.max(2, profilePoints.length))
      return {
        radialSegments: LATHE_RADIAL_SEGMENTS,
        profileRings,
        pathSamples: 0,
        boundaryVerts: 0,
        extrudeDepth: 0,
        minAngleDeg: LATHE_MIN_ANGLE_DEG,
      }
    }
    case 'hole-line':
      return {
        radialSegments: 0,
        profileRings: 0,
        pathSamples: 2,
        boundaryVerts: 0,
        extrudeDepth: 0,
        minAngleDeg,
      }
  }
}
