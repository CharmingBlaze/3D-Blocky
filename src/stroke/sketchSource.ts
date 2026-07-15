import { HalfEdgeMesh, type SceneObject } from '../mesh/HalfEdgeMesh'
import { IDENTITY_TRANSFORM } from '../mesh/objectTransform'
import { generateCapsuleSweep, generateTaperedPointedTube } from '../mesh/extrusion'
import { ensureCCW } from '../mesh/concaveTriangulate'
import { generateSoftInflateDome } from '../mesh/softInflate'
import { extrudeSilhouette, strokeToFlatOutline } from '../mesh/silhouetteExtrude'
import {
  generateHairRibbon,
  hairHalfWidthFromBrush,
  resolveHairDepth,
  resolveRoundedHairRadius,
  type HairTipStyle,
} from '../mesh/hairRibbon'
import type { ViewType } from '../store/appStore'
import type { Vec2 } from '../utils/math'
import { offsetMeshInPlane, planePathToWorld, projectMeshToView, type StrokePlaneFrame } from './worldProjection'
import { orientTubeFacesOutward } from '../mesh/extrusion'
import { ensureClosedMeshOutward } from '../mesh/meshWinding'
import {
  VECTOR_PEN_MIN_ANGLE_DEG,
  VECTOR_PEN_RADIAL_SEGMENTS,
} from '../vector/vectorPenLimits'
import { LOW_POLY_CAPSULE_HEMI_RINGS } from '../primitives/capsuleMesh'
import { primitiveSegmentsForBudget } from '../mesh/meshPolyBudget'

export type SketchDoodleKind =
  | 'soft'
  | 'sharp'
  | 'path'
  | 'outline'
  | 'ribbon'
  | 'tapered-tube'
  | 'hair-path'
  | 'hair-strip'
  | 'hair-round'

/** Parametric data to rebuild a sketch doodle mesh. */
export interface SketchSource {
  relative: Vec2[]
  center: Vec2
  view: ViewType
  brushDensity: number
  polyBudget: number
  closeThreshold: number
  defaultDepth: number
  isClosed: boolean
  kind: SketchDoodleKind
  extrudeDepth: number
  /** Fullness of closed soft Blob shoulders, 0–1. */
  inflation?: number
  /** Hair tip shape; only used for hair-* kinds. Defaults to pointed when missing. */
  tipStyle?: HairTipStyle
  /** Locked perspective draw plane so regenerates stay in world space. */
  planeFrame?: StrokePlaneFrame | null
}

export function isSketchDoodleObject(obj: SceneObject | undefined | null): obj is SceneObject & {
  sketchSource: SketchSource
} {
  return !!obj?.sketchSource
}

function capBoundaryPoints(relative: Vec2[], maxPoints: number): Vec2[] {
  if (relative.length <= maxPoints) return relative
  const out: Vec2[] = []
  const step = relative.length / maxPoints
  for (let i = 0; i < maxPoints; i++) {
    out.push(relative[Math.min(relative.length - 1, Math.round(i * step))]!)
  }
  return out
}

/** Hard ceiling only — Outline silhouettes may keep hundreds of boundary verts. */
export const OUTLINE_BOUNDARY_HARD_CAP = 512

/** Longitudinal ring ceiling for Path tubes (radial stays low-mid poly separately). */
export const PATH_SPINE_HARD_CAP = 56

/** Dense ribbon samples for Hair Paths (smooth anime strand). */
export const HAIR_PATH_SPINE_HARD_CAP = 48

/** Coarse card samples for Hair Strips (low-poly hair cards). */
export const HAIR_STRIP_SPINE_HARD_CAP = 14

/** Slightly denser than Outline cleanup so short dense strokes don't over-ring. */
export const PATH_CLEANUP_MIN_DISTANCE = 0.9

/**
 * Soft poly budget for flat outline extrude — prefer stroke fidelity.
 * Poly budget no longer forces ~polyBudget/2 decimation of the silhouette.
 */
export function outlineBoundaryBudget(
  polyBudget: number,
  pointCount: number,
  closed: boolean
): number {
  const fromBudget = Math.max(closed ? 64 : 32, Math.floor(polyBudget * 2))
  return Math.max(
    closed ? 8 : 4,
    Math.min(pointCount, fromBudget, OUTLINE_BOUNDARY_HARD_CAP)
  )
}

/**
 * Soft longitudinal budget for Path tubes.
 * Default 128 → ~56 rings (lower-mid poly; not budget/radial ≈ 16 blocky, not ~96 dense).
 * Radial sides stay 6–10; budget is a soft cap, not a centerline crusher.
 */
export function pathSpineBudget(polyBudget: number, pointCount: number): number {
  const fromBudget = Math.max(16, Math.floor(polyBudget * 0.45))
  return Math.max(4, Math.min(pointCount, fromBudget, PATH_SPINE_HARD_CAP))
}

/**
 * Extrude depth for flat silhouette / outline prisms.
 * Preserves sign (negative flips local Z) and enforces a minimum magnitude.
 */
export function resolveSilhouetteDepth(extrudeDepth: number, minMag = 4): number {
  const mag = Math.max(minMag, Math.abs(extrudeDepth))
  return (Math.sign(extrudeDepth) || 1) * mag
}

/** Sketch thickness → open Outline ribbon half-width. */
export function outlineHalfWidthFromBrush(brushDensity: number): number {
  return Math.max(2.5, brushDensity * 0.4)
}

function stripClosedDuplicate(points: Vec2[], eps = 0.01): Vec2[] {
  if (points.length < 2) return points.map((p) => ({ ...p }))
  const first = points[0]!
  const last = points[points.length - 1]!
  if (Math.hypot(first.x - last.x, first.y - last.y) <= eps) {
    return points.slice(0, -1).map((p) => ({ ...p }))
  }
  return points.map((p) => ({ ...p }))
}

/** Drop near-duplicates only — safe on dense freehand (no adjacent collinear eat). */
export function lightCleanupBoundary(
  points: Vec2[],
  closed: boolean,
  minDistance = 0.5
): Vec2[] {
  if (points.length < 2) return points.map((p) => ({ ...p }))

  let working = closed ? stripClosedDuplicate(points, minDistance) : points.map((p) => ({ ...p }))

  const deduped: Vec2[] = [{ ...working[0]! }]
  for (let i = 1; i < working.length; i++) {
    const p = working[i]!
    const prev = deduped[deduped.length - 1]!
    if (Math.hypot(p.x - prev.x, p.y - prev.y) >= minDistance) {
      deduped.push({ ...p })
    } else if (!closed && i === working.length - 1) {
      deduped[deduped.length - 1] = { ...p }
    }
  }
  if (!closed && working.length >= 2) {
    deduped[deduped.length - 1] = { ...working[working.length - 1]! }
  }
  return deduped
}

/**
 * Preserve the drawn outline polyline.
 * Light near-duplicate cleanup only — no angle/RDP sampling that turns smooth
 * freehand into a coarse polygon. Soft-cap only at a high hard limit.
 */
export function prepareOutlineBoundary(
  relative: Vec2[],
  polyBudget: number,
  closed: boolean
): Vec2[] | null {
  const deduped = lightCleanupBoundary(relative, closed)
  if (closed) {
    if (deduped.length < 3) return null
    const shaped = ensureCCW(deduped)
    const maxBoundary = outlineBoundaryBudget(polyBudget, shaped.length, true)
    if (shaped.length <= maxBoundary) return shaped
    return capBoundaryPoints(shaped, maxBoundary)
  }
  if (deduped.length < 2) return null
  const maxPath = outlineBoundaryBudget(polyBudget, deduped.length, false)
  return deduped.length <= maxPath ? deduped : capBoundaryPoints(deduped, maxPath)
}

/**
 * Preserve the drawn Path centerline for tube rings.
 * Same light cleanup as Outline — no 12–14° angle sampling that collapses
 * gentle curves into a few sharp corners (blocky miters).
 */
export function preparePathCenterline(
  relative: Vec2[],
  polyBudget: number
): Vec2[] | null {
  const deduped = lightCleanupBoundary(relative, false, PATH_CLEANUP_MIN_DISTANCE)
  if (deduped.length < 2) return null
  const maxSpine = pathSpineBudget(polyBudget, deduped.length)
  return deduped.length <= maxSpine ? deduped : capBoundaryPoints(deduped, maxSpine)
}

/** Hair Paths — denser centerline for a smooth ribbon. */
export function prepareHairPathCenterline(
  relative: Vec2[],
  polyBudget: number
): Vec2[] | null {
  const deduped = lightCleanupBoundary(relative, false, PATH_CLEANUP_MIN_DISTANCE)
  if (deduped.length < 2) return null
  const fromBudget = Math.max(12, Math.floor(polyBudget * 0.4))
  const maxSpine = Math.max(4, Math.min(deduped.length, fromBudget, HAIR_PATH_SPINE_HARD_CAP))
  return deduped.length <= maxSpine ? deduped : capBoundaryPoints(deduped, maxSpine)
}

/** Hair Strips — few lengthwise divisions for low-poly cards. */
export function prepareHairStripCenterline(
  relative: Vec2[],
  polyBudget: number
): Vec2[] | null {
  const deduped = lightCleanupBoundary(relative, false, Math.max(PATH_CLEANUP_MIN_DISTANCE, 1.4))
  if (deduped.length < 2) return null
  const fromBudget = Math.max(6, Math.floor(polyBudget * 0.12))
  const maxSpine = Math.max(3, Math.min(deduped.length, fromBudget, HAIR_STRIP_SPINE_HARD_CAP))
  return deduped.length <= maxSpine ? deduped : capBoundaryPoints(deduped, maxSpine)
}

function buildMeshFromSource(source: SketchSource, extrudeDepth: number, color: number): HalfEdgeMesh | null {
  const { relative, brushDensity, polyBudget, isClosed, kind } = source
  const depth = Math.max(1.6, Math.abs(extrudeDepth))

  if (kind === 'ribbon' || kind === 'tapered-tube' || kind === 'hair-path' || kind === 'hair-strip' || kind === 'hair-round') {
    const spine =
      kind === 'hair-strip'
        ? prepareHairStripCenterline(relative, polyBudget)
        : prepareHairPathCenterline(relative, polyBudget)
    if (!spine) return null
    const tipStyle: HairTipStyle = source.tipStyle === 'square' ? 'square' : 'pointed'
    if (kind === 'hair-round' || kind === 'tapered-tube') {
      return generateTaperedPointedTube(spine, {
        radius: resolveRoundedHairRadius(extrudeDepth, brushDensity),
        radialSegments: Math.max(6, Math.min(8, primitiveSegmentsForBudget(polyBudget, 7))),
        preserveSpine: true,
        color,
        tipStyle: kind === 'tapered-tube' ? 'pointed' : tipStyle,
      })
    }
    const style = kind === 'hair-strip' ? 'strip' : 'path'
    return generateHairRibbon(spine, {
      halfWidth: hairHalfWidthFromBrush(brushDensity, style),
      depth: resolveHairDepth(extrudeDepth, brushDensity, style),
      color,
      flat: style === 'strip',
      tipStyle: kind === 'ribbon' ? 'square' : tipStyle,
    })
  }

  if (kind === 'sharp') {
    if (!isClosed) {
      return generateCapsuleSweep(relative, {
        radius: Math.max(2, depth),
        radialSegments: VECTOR_PEN_RADIAL_SEGMENTS,
        minAngleDeg: VECTOR_PEN_MIN_ANGLE_DEG,
        closed: false,
        hemiRings: LOW_POLY_CAPSULE_HEMI_RINGS,
        color,
      })
    }
    // Flat prism — same CAD-style n-gon caps / quad walls as commit-time extrude.
    const boundary = prepareOutlineBoundary(relative, polyBudget, true)
    if (!boundary || boundary.length < 3) return null
    return extrudeSilhouette(boundary, {
      depth: resolveSilhouetteDepth(extrudeDepth),
      color,
    })
  }

  if (kind === 'outline') {
    const silhouetteDepth = resolveSilhouetteDepth(extrudeDepth)
    if (isClosed) {
      const budgetRings = polyBudget < 64 ? 2 : polyBudget < 128 ? 3 : polyBudget < 224 ? 4 : 5
      const maxBoundary = Math.max(8, Math.min(28, Math.floor(polyBudget / (budgetRings + 1))))
      const prepared = prepareOutlineBoundary(relative, polyBudget, true)
      const boundary = prepared && prepared.length > maxBoundary ? capBoundaryPoints(prepared, maxBoundary) : prepared
      if (!boundary || boundary.length < 3) return null
      return generateSoftInflateDome(boundary, {
        depth: Math.abs(silhouetteDepth),
        rings: budgetRings,
        inflation: 0,
        color,
      })
    }
    const path = prepareOutlineBoundary(relative, polyBudget, false)
    if (!path || path.length < 2) return null
    const halfWidth = outlineHalfWidthFromBrush(brushDensity)
    const ribbon = strokeToFlatOutline(path, halfWidth)
    if (!ribbon || ribbon.length < 3) return null
    return extrudeSilhouette(ribbon, { depth: silhouetteDepth, color })
  }

  if (!isClosed) {
    // Path / soft open stroke: fidelity centerline → tube with flat n-gon caps + quad rings.
    const spine = preparePathCenterline(relative, polyBudget)
    if (!spine) return null
    return generateCapsuleSweep(spine, {
      radius: Math.max(2.5, Math.min(14, brushDensity * 0.55)),
      radialSegments: primitiveSegmentsForBudget(polyBudget, VECTOR_PEN_RADIAL_SEGMENTS),
      closed: false,
      hemiRings: 0,
      preserveSpine: true,
      color,
    })
  }

  const budgetRings = polyBudget < 64 ? 2 : polyBudget < 128 ? 3 : polyBudget < 224 ? 4 : 5
  const rings = budgetRings + 2
  const maxBoundary = Math.max(8, Math.min(28, Math.floor(polyBudget / (budgetRings + 1))))
  const boundary = capBoundaryPoints(relative, maxBoundary)

  return generateSoftInflateDome(boundary, { depth, rings, inflation: source.inflation ?? 0.65, color: 0 })
}

export function createSketchSource(
  relative: Vec2[],
  center: Vec2,
  view: ViewType,
  brushDensity: number,
  polyBudget: number,
  closeThreshold: number,
  defaultDepth: number,
  isClosed: boolean,
  kind: SketchDoodleKind,
  extrudeDepth: number,
  extras?: { tipStyle?: HairTipStyle; planeFrame?: StrokePlaneFrame | null }
): SketchSource {
  return {
    relative: relative.map((p) => ({ ...p })),
    center: { ...center },
    view,
    brushDensity,
    polyBudget,
    closeThreshold,
    defaultDepth,
    isClosed,
    kind,
    extrudeDepth,
    inflation: kind === 'soft' ? 0.65 : undefined,
    tipStyle: extras?.tipStyle,
    planeFrame: extras?.planeFrame ?? null,
  }
}

export type EditableSketchSourcePatch = Partial<
  Pick<SketchSource, 'brushDensity' | 'polyBudget' | 'extrudeDepth' | 'inflation'>
>

/** Rebuild a sketch doodle from editable source parameters, preserving identity and transforms. */
export function regenerateSketchObjectFromSource(
  obj: SceneObject,
  changes: EditableSketchSourcePatch
): SceneObject | null {
  const source = obj.sketchSource
  if (!source) return null

  const nextSource: SketchSource = {
    ...source,
    brushDensity: Math.max(2, Math.min(48, changes.brushDensity ?? source.brushDensity)),
    polyBudget: Math.max(16, Math.min(512, changes.polyBudget ?? source.polyBudget)),
    extrudeDepth: changes.extrudeDepth ?? source.extrudeDepth,
    inflation: Math.max(0, Math.min(1, changes.inflation ?? source.inflation ?? 0.65)),
  }

  const mesh = buildMeshFromSource(nextSource, nextSource.extrudeDepth, obj.color)
  if (!mesh || mesh.vertexCount() === 0 || mesh.faces.length === 0) return null

  for (let i = 0; i < mesh.faceColors.length; i++) mesh.faceColors[i] = obj.color
  offsetMeshInPlane(mesh, nextSource.center.x, nextSource.center.y)
  projectMeshToView(mesh, nextSource.view, nextSource.defaultDepth, nextSource.planeFrame)

  if (
    nextSource.kind === 'outline' ||
    nextSource.kind === 'ribbon' ||
    nextSource.kind === 'tapered-tube' ||
    nextSource.kind === 'hair-path' ||
    nextSource.kind === 'hair-strip' ||
    nextSource.kind === 'hair-round' ||
    (nextSource.isClosed && nextSource.kind !== 'path')
  ) {
    ensureClosedMeshOutward(mesh)
  } else {
    const planePath = nextSource.relative.map((p) => ({
      x: p.x + nextSource.center.x,
      y: p.y + nextSource.center.y,
    }))
    orientTubeFacesOutward(
      mesh,
      planePathToWorld(planePath, nextSource.view, nextSource.defaultDepth, nextSource.planeFrame)
    )
  }

  const hairUvs =
    (nextSource.kind === 'ribbon' ||
      nextSource.kind === 'tapered-tube' ||
      nextSource.kind === 'hair-path' ||
      nextSource.kind === 'hair-strip' ||
      nextSource.kind === 'hair-round') &&
    mesh.uvs.length > 0 &&
    mesh.faceUvIndices.length === mesh.faces.length

  return mesh.toObject(obj.id, obj.name, {
    ...obj,
    sketchSource: nextSource,
    polyBudget: Math.max(mesh.vertexCount(), nextSource.polyBudget),
    color: obj.color,
    smoothShading: obj.smoothShading ?? false,
    uvAutoPacked: hairUvs ? true : obj.uvAutoPacked,
    uvMappingMode: hairUvs ? 'box' : obj.uvMappingMode,
    transform: obj.transform ?? {
      position: { ...IDENTITY_TRANSFORM.position },
      rotation: { ...IDENTITY_TRANSFORM.rotation },
      scale: { ...IDENTITY_TRANSFORM.scale },
    },
  })
}

/** Rebuild a sketch doodle with a new extrusion depth, preserving id and transform. */
export function regenerateSketchObject(obj: SceneObject, extrudeDepth: number): SceneObject | null {
  return regenerateSketchObjectFromSource(obj, { extrudeDepth })
}
