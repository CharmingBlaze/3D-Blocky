import { HalfEdgeMesh, type SceneObject } from '../mesh/HalfEdgeMesh'
import { IDENTITY_TRANSFORM } from '../mesh/objectTransform'
import { generateSoftInflateDome } from '../mesh/softInflate'
import { generateCapsuleSweep, generateTaperedPointedTube } from '../mesh/extrusion'
import { extrudeSilhouette, strokeToFlatOutline } from '../mesh/silhouetteExtrude'
import {
  generateHairRibbon,
  hairHalfWidthFromBrush,
  resolveHairDepth,
  resolveRoundedHairRadius,
  type HairRibbonStyle,
  type HairTipStyle,
} from '../mesh/hairRibbon'
import { generateId, type Vec2 } from '../utils/math'
import { offsetMeshInPlane, planePathToWorld, projectMeshToView } from './worldProjection'
import { orientTubeFacesOutward } from '../mesh/extrusion'
import { ensureClosedMeshOutward } from '../mesh/meshWinding'
import { resampleUniform, resampleUniformClosed } from './strokeCapture'
import { classifyStroke } from './strokeClassifier'
import type { PolylineInput } from './polylineToMesh'
import {
  outlineHalfWidthFromBrush,
  prepareHairPathCenterline,
  prepareHairStripCenterline,
  prepareOutlineBoundary,
  preparePathCenterline,
  resolveSilhouetteDepth,
  type SketchDoodleKind,
  type SketchSource,
} from './sketchSource'
import { primitiveSegmentsForBudget } from '../mesh/meshPolyBudget'

export interface PreparedSketch {
  points: Vec2[]
  relative: Vec2[]
  center: Vec2
  isClosed: boolean
}

/** Bounding box of stroke points in plane space. */
function strokeBounds(points: Vec2[]): {
  minX: number
  maxX: number
  minY: number
  maxY: number
  width: number
  height: number
  diagonal: number
  shortSide: number
  longSide: number
} {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const p of points) {
    minX = Math.min(minX, p.x)
    maxX = Math.max(maxX, p.x)
    minY = Math.min(minY, p.y)
    maxY = Math.max(maxY, p.y)
  }
  const width = maxX - minX
  const height = maxY - minY
  return {
    minX,
    maxX,
    minY,
    maxY,
    width,
    height,
    diagonal: Math.hypot(width, height),
    shortSide: Math.min(width, height),
    longSide: Math.max(width, height),
  }
}

function strokePathLength(points: Vec2[]): number {
  let len = 0
  for (let i = 1; i < points.length; i++) {
    len += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
  }
  return len
}

/** Paint 3D-style snap radius — scales with stroke size so loops close reliably. */
export function effectiveCloseThreshold(points: Vec2[], baseThreshold: number): number {
  if (points.length < 2) return baseThreshold

  const { diagonal, shortSide } = strokeBounds(points)
  // Tie to the shorter bbox side so wide U/C strokes don't snap across the opening too early.
  return Math.max(baseThreshold, shortSide * 0.12, diagonal * 0.07, 8)
}

/** Snap the stroke endpoint to the start when the loop is nearly closed. */
export function snapSketchStrokeClosed(points: Vec2[], baseThreshold: number): Vec2[] {
  if (points.length < 3) return points

  const first = points[0]
  const last = points[points.length - 1]
  const gap = Math.hypot(first.x - last.x, first.y - last.y)
  const threshold = effectiveCloseThreshold(points, baseThreshold) * 1.25
  const { shortSide, longSide } = strokeBounds(points)
  const pathLen = strokePathLength(points)
  const loopLike =
    pathLen >= Math.max(shortSide * 2, longSide * 0.75) &&
    gap <= Math.max(threshold, effectiveCloseThreshold(points, baseThreshold) * 1.8)

  if (gap <= threshold || loopLike) {
    return [...points.slice(0, -1), { ...first }]
  }
  return points
}

export function isSketchNearClose(
  points: Vec2[],
  preview: Vec2 | null,
  baseThreshold: number
): boolean {
  if (points.length < 3 || !preview) return false

  const start = points[0]
  const path = [...points, preview]
  const threshold = effectiveCloseThreshold(path, baseThreshold)
  const closeDist = Math.hypot(start.x - preview.x, start.y - preview.y)
  if (closeDist > threshold) return false

  const { shortSide, longSide } = strokeBounds(path)
  const pathLen = strokePathLength(path)
  const minPathLen = Math.max(threshold * 4, shortSide * 1.5, longSide * 0.4)
  if (pathLen < minPathLen) return false

  const distToStart = (p: Vec2) => Math.hypot(p.x - start.x, p.y - start.y)

  // Require the stroke to leave the start area and return — not just pass nearby in 2D.
  let maxDist = 0
  for (let i = 1; i < points.length - 1; i++) {
    maxDist = Math.max(maxDist, distToStart(points[i]!))
  }
  if (maxDist < threshold * 1.25) return false
  if (maxDist < closeDist * 2.2) return false

  const last = points[points.length - 1]!
  const lastDist = distToStart(last)
  if (closeDist >= lastDist * 0.98) return false

  return true
}

function strokeCentroid(points: Vec2[]): Vec2 {
  return {
    x: points.reduce((s, p) => s + p.x, 0) / points.length,
    y: points.reduce((s, p) => s + p.y, 0) / points.length,
  }
}

function relativePoints(points: Vec2[], center: Vec2): Vec2[] {
  return points.map((p) => ({ x: p.x - center.x, y: p.y - center.y }))
}

function resampleSpacing(points: Vec2[], brushDensity: number): number {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const p of points) {
    minX = Math.min(minX, p.x)
    maxX = Math.max(maxX, p.x)
    minY = Math.min(minY, p.y)
    maxY = Math.max(maxY, p.y)
  }
  const diagonal = Math.hypot(maxX - minX, maxY - minY)
  // Slightly coarser than before so outline doodles stay lower-poly.
  return Math.max(1.25, Math.min(3.8, diagonal / 48, brushDensity * 0.32))
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

function cleanupDrawnPoints(points: Vec2[], minDistance = 2.0): Vec2[] {
  if (points.length < 2) return points
  const result: Vec2[] = [points[0]!]
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]!
    const last = result[result.length - 1]!
    if (Math.hypot(p.x - last.x, p.y - last.y) >= minDistance) {
      result.push(p)
    }
  }
  const lastRaw = points[points.length - 1]!
  const lastResult = result[result.length - 1]!
  if (Math.hypot(lastRaw.x - lastResult.x, lastRaw.y - lastResult.y) >= 0.5) {
    result.push(lastRaw)
  } else {
    result[result.length - 1] = lastRaw
  }
  return result
}

export interface PrepareSketchStrokeOptions {
  preserveDetail?: boolean
  pathClosed?: boolean
  /** Denser resample / lighter cleanup so Outline tracks the stroke. */
  highFidelity?: boolean
  /** Never treat the stroke as a closed fill loop (Sketch Path centerline). */
  forceOpen?: boolean
}

/**
 * Light stroke prep — preserves the drawn path, only snaps closed loops and
 * (non-outline) resamples to even spacing. Outline/highFidelity keeps the
 * captured polyline so the mesh boundary matches Smooth draw.
 */
export function prepareSketchStroke(
  points: Vec2[],
  closeThreshold: number,
  brushDensity: number,
  options: PrepareSketchStrokeOptions = {}
): PreparedSketch | null {
  if (points.length < 2) return null

  const highFidelity = !!options.highFidelity
  const forceOpen = !!options.forceOpen
  const minCleanDist = options.preserveDetail || highFidelity ? 0.8 : 2.0
  const cleaned = cleanupDrawnPoints(points, minCleanDist)
  if (cleaned.length < 2) return null

  if (options.preserveDetail || highFidelity) {
    let work = dedupeConsecutivePoints(cleaned)
    if (!options.preserveDetail && !forceOpen) {
      work = snapSketchStrokeClosed(work, closeThreshold)
    }
    const threshold =
      (options.preserveDetail
        ? closeThreshold * 2.5
        : effectiveCloseThreshold(work, closeThreshold) * 2.5)
    let isClosed =
      !forceOpen &&
      (options.pathClosed === true || classifyStroke(work, threshold) === 'closed')
    if (isClosed && work.length >= 3) {
      const first = work[0]!
      const last = work[work.length - 1]!
      if (Math.hypot(first.x - last.x, first.y - last.y) <= (options.preserveDetail ? 0.01 : threshold)) {
        work = work.slice(0, -1)
      }
    }
    if (work.length < 2) return null
    const center = strokeCentroid(work)
    return {
      points: work,
      relative: relativePoints(work, center),
      center,
      isClosed: isClosed && work.length >= 3,
    }
  }

  const snapped = snapSketchStrokeClosed(cleaned, closeThreshold)
  const threshold = effectiveCloseThreshold(snapped, closeThreshold) * 2.5
  let isClosed = classifyStroke(snapped, threshold) === 'closed'

  let work = [...snapped]
  if (isClosed && work.length >= 3) {
    const first = work[0]
    const last = work[work.length - 1]
    if (Math.hypot(first.x - last.x, first.y - last.y) <= threshold) {
      work = work.slice(0, -1)
    }
  }

  const spacing = resampleSpacing(work, brushDensity)
  let resampled =
    isClosed && work.length >= 3
      ? resampleUniformClosed(work, spacing)
      : resampleUniform(work, spacing)
  if (resampled.length < 2) return null

  if (!isClosed) {
    isClosed = classifyStroke(resampled, threshold) === 'closed'
    if (isClosed && work.length >= 3) {
      resampled = resampleUniformClosed(work, spacing)
    }
  }

  const loopPoints = isClosed && resampled.length >= 3 ? resampled : resampled
  const center = strokeCentroid(loopPoints)

  return {
    points: resampled,
    relative: relativePoints(loopPoints, center),
    center,
    isClosed: isClosed && loopPoints.length >= 3,
  }
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

function resolveExtrudeDepth(input: PolylineInput, brushDensity: number): number {
  if (input.extrudeAmount != null) return input.extrudeAmount
  return Math.max(8, brushDensity * 1.2)
}

function buildClosedSoftBlob(
  relative: Vec2[],
  polyBudget: number,
  extrudeDepth: number,
  preserveDetail = false
): HalfEdgeMesh {
  const maxBoundary = preserveDetail
    ? relative.length
    : Math.max(10, Math.min(relative.length, Math.floor(polyBudget / 4), 28))
  const boundary =
    relative.length <= maxBoundary ? relative : capBoundaryPoints(relative, maxBoundary)
  const rings = Math.max(3, Math.min(5, Math.floor(polyBudget / (boundary.length + 4))))
  return generateSoftInflateDome(boundary, {
    depth: Math.max(4, extrudeDepth),
    rings,
    color: 0,
  })
}

function buildClosedSharpExtrusion(
  relative: Vec2[],
  extrudeDepth: number,
  color: number
): HalfEdgeMesh {
  return extrudeSilhouette(relative, {
    depth: resolveSilhouetteDepth(extrudeDepth),
    color,
  })
}

function buildOpenSoftTube(
  relative: Vec2[],
  brushDensity: number,
  polyBudget: number
): HalfEdgeMesh | null {
  const spine = preparePathCenterline(relative, polyBudget)
  if (!spine) return null
  return generateCapsuleSweep(spine, {
    radius: Math.max(2.5, Math.min(14, brushDensity * 0.55)),
    radialSegments: primitiveSegmentsForBudget(polyBudget, 8),
    closed: false,
    hemiRings: 0,
    preserveSpine: true,
  })
}

/** Filled flat silhouette from a closed outline, or a filled ribbon from an open stroke. */
function buildFilledOutline(
  relative: Vec2[],
  brushDensity: number,
  extrudeDepth: number,
  closed: boolean,
  color: number,
  polyBudget: number
): HalfEdgeMesh | null {
  const depth = resolveSilhouetteDepth(extrudeDepth)
  if (closed) {
    const boundary = prepareOutlineBoundary(relative, polyBudget, true)
    if (!boundary || boundary.length < 3) return null
    return extrudeSilhouette(boundary, { depth, color })
  }
  const path = prepareOutlineBoundary(relative, polyBudget, false)
  if (!path || path.length < 2) return null
  const halfWidth = outlineHalfWidthFromBrush(brushDensity)
  const ribbon = strokeToFlatOutline(path, halfWidth)
  if (!ribbon || ribbon.length < 3) return null
  return extrudeSilhouette(ribbon, { depth, color })
}

function finalizeSketchMesh(
  mesh: HalfEdgeMesh,
  center: Vec2,
  view: PolylineInput['view'],
  depth: number,
  color: number,
  polyBudget: number,
  name: string,
  sketchSource: SketchSource,
  smoothShading = false,
  tubePathPlane?: Vec2[],
  uvFlags?: { uvAutoPacked?: boolean; uvMappingMode?: 'box' | 'perFace' }
): SceneObject {
  for (let i = 0; i < mesh.faceColors.length; i++) mesh.faceColors[i] = color
  offsetMeshInPlane(mesh, center.x, center.y)
  projectMeshToView(mesh, view, depth, sketchSource.planeFrame)

  if (tubePathPlane && tubePathPlane.length >= 2) {
    orientTubeFacesOutward(
      mesh,
      planePathToWorld(tubePathPlane, view, depth, sketchSource.planeFrame)
    )
  } else {
    ensureClosedMeshOutward(mesh)
  }

  return mesh.toObject(generateId(), name, {
    polyBudget: Math.max(mesh.vertexCount(), polyBudget),
    color,
    polyBudgetMode: 'strict',
    smoothShading,
    sketchSource,
    uvAutoPacked: uvFlags?.uvAutoPacked,
    uvMappingMode: uvFlags?.uvMappingMode,
    transform: {
      position: { ...IDENTITY_TRANSFORM.position },
      rotation: { ...IDENTITY_TRANSFORM.rotation },
      scale: { ...IDENTITY_TRANSFORM.scale },
    },
  })
}

function makeSketchSource(
  prepared: PreparedSketch,
  input: PolylineInput,
  kind: SketchDoodleKind,
  extrudeDepth: number
): SketchSource {
  const hairKind =
    kind === 'hair-path' || kind === 'hair-strip' || kind === 'hair-round'
  const tipStyle: HairTipStyle =
    input.hairTipStyle === 'square' ? 'square' : 'pointed'
  return {
    relative: prepared.relative.map((p) => ({ ...p })),
    center: { ...prepared.center },
    view: input.view,
    brushDensity: input.brushDensity,
    polyBudget: input.polyBudget,
    closeThreshold: input.closeThreshold,
    defaultDepth: input.defaultDepth,
    isClosed: prepared.isClosed,
    kind,
    extrudeDepth,
    planeFrame: input.planeFrame ?? null,
    ...(hairKind ? { tipStyle } : {}),
  }
}

/** Paint 3D soft-edge doodle — closed loops inflate, open strokes become capped tubes. */
export function softSketchDoodleToObject(input: PolylineInput): SceneObject | null {
  const {
    points,
    view,
    polyBudget,
    brushDensity,
    closeThreshold,
    defaultDepth,
    color,
    name,
  } = input

  if (points.length < 2) return null
  if (view === 'perspective' && !input.planeFrame) return null

  const prepared = prepareSketchStroke(points, closeThreshold, brushDensity, {
    preserveDetail: input.preserveDetail,
    pathClosed: input.pathClosed,
  })
  if (!prepared) return null

  const { relative, center, isClosed } = prepared
  const extrudeDepth = resolveExtrudeDepth(input, brushDensity)
  const kind: SketchDoodleKind = isClosed ? 'soft' : 'path'

  const mesh = isClosed
    ? buildClosedSoftBlob(relative, polyBudget, extrudeDepth, !!input.preserveDetail)
    : buildOpenSoftTube(relative, brushDensity, polyBudget)

  if (!mesh || mesh.vertexCount() === 0 || mesh.faces.length === 0) return null

  const doodleName = name ?? (isClosed ? 'Doodle' : 'Doodle Path')
  const source = makeSketchSource(prepared, input, kind, extrudeDepth)
  return finalizeSketchMesh(
    mesh,
    center,
    view,
    defaultDepth,
    color,
    polyBudget,
    doodleName,
    source,
    false,
    isClosed ? undefined : prepared.points
  )
}

/** Filled silhouette from the drawn outline — flat sides, not a soft blob or path tube. */
export function outlineSketchDoodleToObject(input: PolylineInput): SceneObject | null {
  const {
    points,
    view,
    polyBudget,
    brushDensity,
    closeThreshold,
    defaultDepth,
    color,
    name,
  } = input

  if (points.length < 2) return null
  if (view === 'perspective' && !input.planeFrame) return null

  const prepared = prepareSketchStroke(points, closeThreshold, brushDensity, {
    preserveDetail: input.preserveDetail,
    pathClosed: input.pathClosed,
    highFidelity: true,
  })
  if (!prepared) return null

  const { relative, center, isClosed } = prepared
  const extrudeDepth = resolveSilhouetteDepth(resolveExtrudeDepth(input, brushDensity))
  const mesh = buildFilledOutline(relative, brushDensity, extrudeDepth, isClosed, color, polyBudget)

  if (!mesh || mesh.vertexCount() === 0 || mesh.faces.length === 0) return null

  const doodleName = name ?? (isClosed ? 'Outline' : 'Outline Path')
  const source = makeSketchSource(prepared, input, 'outline', extrudeDepth)
  return finalizeSketchMesh(
    mesh,
    center,
    view,
    defaultDepth,
    color,
    polyBudget,
    doodleName,
    source,
    false
  )
}

/**
 * Sketch Path — circular tube swept along the stroke with quad side walls
 * and flat n-gon end caps (not a triangulated needle capsule).
 */
export function pathSketchDoodleToObject(input: PolylineInput): SceneObject | null {
  const {
    points,
    view,
    polyBudget,
    brushDensity,
    closeThreshold,
    defaultDepth,
    color,
    name,
  } = input

  if (points.length < 2) return null
  if (view === 'perspective' && !input.planeFrame) return null

  const prepared = prepareSketchStroke(points, closeThreshold, brushDensity, {
    preserveDetail: input.preserveDetail,
    forceOpen: true,
    highFidelity: true,
  })
  if (!prepared) return null

  const { relative, center } = prepared
  const extrudeDepth = resolveExtrudeDepth(input, brushDensity)
  const radius = Math.max(2.5, Math.min(14, brushDensity * 0.55))
  const spine = preparePathCenterline(relative, polyBudget)
  if (!spine) return null

  const mesh = generateCapsuleSweep(spine, {
    radius,
    radialSegments: primitiveSegmentsForBudget(polyBudget, 8),
    closed: false,
    hemiRings: 0,
    preserveSpine: true,
    color,
  })

  if (mesh.vertexCount() === 0 || mesh.faces.length === 0) return null

  const source = makeSketchSource(
    { ...prepared, isClosed: false },
    input,
    'path',
    extrudeDepth
  )
  return finalizeSketchMesh(
    mesh,
    center,
    view,
    defaultDepth,
    color,
    polyBudget,
    name ?? 'Path',
    source,
    false,
    prepared.points
  )
}

/** Paint 3D sharp-edge doodle — closed silhouette extruded with flat sides. */
export function sharpSketchDoodleToObject(input: PolylineInput): SceneObject | null {
  const {
    points,
    view,
    polyBudget,
    brushDensity,
    closeThreshold,
    defaultDepth,
    color,
    extrudeAmount,
    name,
  } = input

  if (points.length < 2) return null
  if (view === 'perspective' && !input.planeFrame) return null

  const prepared = prepareSketchStroke(points, closeThreshold, brushDensity, {
    preserveDetail: input.preserveDetail,
    pathClosed: input.pathClosed,
    // Same fidelity as Outline — Extrude must track the drawn loop.
    highFidelity: true,
  })
  if (!prepared) return null

  const { relative, center, isClosed } = prepared
  const extrudeDepth = resolveSilhouetteDepth(
    extrudeAmount ?? resolveExtrudeDepth(input, brushDensity)
  )

  // Open Extrude/Outline strokes are flat ribbons (not tubes) so line drawings
  // keep a silhouette underside with outward normals under single-sided shading.
  if (!isClosed) {
    const mesh = buildFilledOutline(
      relative,
      brushDensity,
      extrudeDepth,
      false,
      color,
      polyBudget
    )
    if (!mesh || mesh.vertexCount() === 0 || mesh.faces.length === 0) return null
    const doodleName = name ?? 'Outline Path'
    const source = makeSketchSource(prepared, input, 'outline', extrudeDepth)
    return finalizeSketchMesh(
      mesh,
      center,
      view,
      defaultDepth,
      color,
      polyBudget,
      doodleName,
      source,
      false
    )
  }

  const kind: SketchDoodleKind = 'sharp'

  const boundary = prepareOutlineBoundary(relative, polyBudget, true)
  if (!boundary || boundary.length < 3) return null
  const mesh = buildClosedSharpExtrusion(boundary, extrudeDepth, color)

  if (mesh.vertexCount() === 0 || mesh.faces.length === 0) return null

  const doodleName = name ?? 'Extrude'
  const source = makeSketchSource(prepared, input, kind, extrudeDepth)
  return finalizeSketchMesh(
    mesh,
    center,
    view,
    defaultDepth,
    color,
    polyBudget,
    doodleName,
    source,
    false
  )
}

/**
 * Stylized hair card — tapered ribbon along the stroke.
 * Hair Paths = thin prism ribbon; Hair Strips = flat double-sided low-poly cards.
 * (Rounded Hair is a separate doodle — see roundedHairSketchDoodleToObject.)
 */
export function hairSketchDoodleToObject(
  input: PolylineInput,
  style: HairRibbonStyle
): SceneObject | null {
  const {
    points,
    view,
    polyBudget,
    brushDensity,
    closeThreshold,
    defaultDepth,
    color,
    name,
  } = input

  if (points.length < 2) return null
  if (view === 'perspective' && !input.planeFrame) return null

  const prepared = prepareSketchStroke(points, closeThreshold, brushDensity, {
    preserveDetail: input.preserveDetail,
    forceOpen: true,
    highFidelity: style === 'path',
  })
  if (!prepared) return null

  const { relative, center } = prepared
  const spine =
    style === 'strip'
      ? prepareHairStripCenterline(relative, polyBudget)
      : prepareHairPathCenterline(relative, polyBudget)
  if (!spine) return null

  const extrudeDepth = resolveHairDepth(input.extrudeAmount, brushDensity, style)
  const tipStyle: HairTipStyle = input.hairTipStyle === 'square' ? 'square' : 'pointed'
  const mesh = generateHairRibbon(spine, {
    halfWidth: hairHalfWidthFromBrush(brushDensity, style),
    depth: extrudeDepth,
    color,
    flat: style === 'strip',
    tipStyle,
  })

  if (mesh.vertexCount() === 0 || mesh.faces.length === 0) return null

  const kind: SketchDoodleKind = style === 'strip' ? 'hair-strip' : 'hair-path'
  const doodleName = name ?? (style === 'strip' ? 'Hair Strips' : 'Hair Paths')
  const source = makeSketchSource(
    { ...prepared, isClosed: false },
    input,
    kind,
    extrudeDepth
  )

  return finalizeSketchMesh(
    mesh,
    center,
    view,
    defaultDepth,
    color,
    polyBudget,
    doodleName,
    source,
    false,
    undefined,
    { uvAutoPacked: true, uvMappingMode: 'box' }
  )
}

/**
 * Rounded Hair — low-mid poly tapered tube with needle tips (not a flat ribbon).
 * Separate from Hair Paths / Hair Strips.
 */
export function roundedHairSketchDoodleToObject(input: PolylineInput): SceneObject | null {
  const {
    points,
    view,
    polyBudget,
    brushDensity,
    closeThreshold,
    defaultDepth,
    color,
    name,
  } = input

  if (points.length < 2) return null
  if (view === 'perspective' && !input.planeFrame) return null

  const prepared = prepareSketchStroke(points, closeThreshold, brushDensity, {
    preserveDetail: input.preserveDetail,
    forceOpen: true,
    highFidelity: true,
  })
  if (!prepared) return null

  const { relative, center } = prepared
  const spine = prepareHairPathCenterline(relative, polyBudget)
  if (!spine) return null

  const extrudeDepth =
    input.extrudeAmount != null && Number.isFinite(input.extrudeAmount)
      ? input.extrudeAmount
      : 12
  const mesh = generateTaperedPointedTube(spine, {
    radius: resolveRoundedHairRadius(input.extrudeAmount, brushDensity),
    radialSegments: Math.max(6, Math.min(8, primitiveSegmentsForBudget(polyBudget, 7))),
    preserveSpine: true,
    color,
    tipStyle: input.hairTipStyle === 'square' ? 'square' : 'pointed',
  })

  if (mesh.vertexCount() === 0 || mesh.faces.length === 0) return null

  const source = makeSketchSource(
    { ...prepared, isClosed: false },
    input,
    'hair-round',
    extrudeDepth
  )

  return finalizeSketchMesh(
    mesh,
    center,
    view,
    defaultDepth,
    color,
    polyBudget,
    name ?? 'Rounded Hair',
    source,
    false,
    undefined,
    { uvAutoPacked: true, uvMappingMode: 'box' }
  )
}

/** Regular sketch tool entry — soft by default, sharp when extrude mode is on. */
export function sketchDoodleToObject(input: PolylineInput): SceneObject | null {
  if (input.extrudeMode) {
    return sharpSketchDoodleToObject(input)
  }
  return softSketchDoodleToObject(input)
}

export { regenerateSketchObject, isSketchDoodleObject } from './sketchSource'
