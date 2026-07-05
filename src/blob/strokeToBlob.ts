import { HalfEdgeMesh, type SceneObject } from '../mesh/HalfEdgeMesh'
import { IDENTITY_TRANSFORM } from '../mesh/objectTransform'
import { generateId, type Vec2 } from '../utils/math'
import { offsetMeshInPlane, projectMeshToView } from '../stroke/worldProjection'
import { rdpSimplify, curvatureSampleClosedLoop } from '../stroke/rdp'
import { resampleUniform } from '../stroke/strokeCapture'
import { classifyStroke, detectRadialSymmetry } from '../stroke/strokeClassifier'
import { fitEllipse } from '../stroke/strokeCapture'
import { isCircleOrOval } from '../stroke/strokeInterpreter'
import { isConcavePolygon } from '../mesh/concaveTriangulate'
import { remeshOrganic } from '../mesh/organicRemesh'
import { generateSilhouetteLoft } from '../mesh/silhouetteLoft'
import {
  extrudeSilhouette,
  generateConcaveSilhouette,
} from '../mesh/silhouetteExtrude'
import { detectLobes } from '../stroke/lobeDetection'
import type { PolylineInput } from '../stroke/polylineToMesh'
import { polylineToMesh } from '../stroke/polylineToMesh'
import { createIcosphere } from './primitives'
import { facetMesh } from './faceting'
import { extrudeStrokeToTube } from './doodleExtrude'
import { DEFAULT_DOODLE } from './blobSystem'
import { meshDataToHalfEdgeMesh, transformMeshData } from './adapters'
import { icosphereSubdivisionsForBudget } from '../mesh/meshPolyBudget'
import type { StrokePoint, Vec3 } from './types'

function icosphereSubdivisions(polyBudget: number): number {
  return icosphereSubdivisionsForBudget(polyBudget)
}

function centroid(points: Vec2[]): Vec2 {
  return {
    x: points.reduce((s, p) => s + p.x, 0) / points.length,
    y: points.reduce((s, p) => s + p.y, 0) / points.length,
  }
}

function relativePoints(points: Vec2[], center: Vec2): Vec2[] {
  return points.map((p) => ({ x: p.x - center.x, y: p.y - center.y }))
}

function toStrokePoints(relative: Vec2[]): StrokePoint[] {
  const normal: Vec3 = [0, 0, 1]
  return relative.map((p, i) => ({
    position: [p.x, p.y, 0],
    normal,
    pressure: 0.85,
    timestamp: i,
  }))
}

function doodleSettingsFromInput(
  brushDensity: number,
  polyBudget: number,
  closed: boolean,
  relative: Vec2[]
) {
  const segments = Math.max(
    5,
    Math.min(8, Math.floor(Math.sqrt(polyBudget) * 0.9))
  )
  let radius = Math.max(2.5, brushDensity * 0.65)
  if (closed) {
    let maxR = 0
    for (const p of relative) maxR = Math.max(maxR, Math.hypot(p.x, p.y))
    radius = Math.max(radius, maxR * 0.32)
  }
  return {
    ...DEFAULT_DOODLE,
    radius,
    segments,
    smoothing: closed ? 0.45 : 0.3,
    roundCaps: !closed,
  }
}

function isClosedBlobSphere(points: Vec2[]): boolean {
  if (points.length < 5 || isConcavePolygon(points)) return false
  if (isCircleOrOval(points)) return true

  const ellipse = fitEllipse(points)
  if (ellipse.circularity > 0.82 && ellipse.aspectRatio > 0.6) return true

  return detectRadialSymmetry(points, 0.68)
}

function buildClosedFillBlob(
  relative: Vec2[],
  brushDensity: number,
  polyBudget: number
): HalfEdgeMesh {
  const boundary = curvatureSampleClosedLoop(
    relative,
    12,
    Math.max(12, Math.min(32, Math.floor(polyBudget * 0.4)))
  )
  const { lobes, isMultiLobe } = detectLobes(boundary)
  const activeLobes = isMultiLobe && lobes.length > 1 ? lobes : undefined

  let mesh = generateSilhouetteLoft(boundary, {
    depthScale: Math.max(8, brushDensity * 1.2),
    roundness: 0.9,
    radialSegments: Math.max(4, Math.min(8, Math.floor(Math.sqrt(polyBudget)))),
    maxRings: Math.max(4, Math.min(8, Math.floor(polyBudget / 10))),
    minAngleDeg: 12,
    maxBoundaryVerts: Math.max(12, Math.min(32, Math.floor(polyBudget * 0.4))),
    color: 0,
  })

  if (mesh.vertexCount() < 8) {
    const depth = Math.max(8, brushDensity * 1.2)
    mesh =
      activeLobes && activeLobes.length > 1
        ? generateConcaveSilhouette(activeLobes, depth, 0)
        : extrudeSilhouette(boundary, { depth, color: 0 })
  }

  if (mesh.vertexCount() > polyBudget) {
    mesh = remeshOrganic(mesh, polyBudget)
  }
  return mesh
}

function buildIcosphereBlob(relative: Vec2[], polyBudget: number): HalfEdgeMesh {
  const subdivisions = icosphereSubdivisions(polyBudget)
  let rx = 8
  let ry = 8
  let rz = 8

  const ellipse = fitEllipse(relative)
  if (ellipse && isClosedBlobSphere(relative)) {
    rx = Math.max(ellipse.rx, 0.5)
    ry = Math.max(ellipse.ry, 0.5)
    rz = Math.sqrt(rx * ry)
  } else {
    let maxR = 0.5
    for (const p of relative) {
      maxR = Math.max(maxR, Math.hypot(p.x, p.y))
    }
    rx = ry = rz = Math.max(maxR, 0.5)
  }

  const welded = createIcosphere(1, subdivisions)
  transformMeshData(welded, [rx, ry, rz], [0, 0, 0])
  const faceted = facetMesh(welded)
  return meshDataToHalfEdgeMesh(faceted, 0)
}

function buildDoodleBlob(
  relative: Vec2[],
  brushDensity: number,
  polyBudget: number
): HalfEdgeMesh {
  const strokePoints = toStrokePoints(relative)
  if (strokePoints.length < 2) {
    return buildIcosphereBlob(relative, polyBudget)
  }

  const settings = doodleSettingsFromInput(brushDensity, polyBudget, false, relative)
  const welded = extrudeStrokeToTube(strokePoints, settings)
  const faceted = facetMesh(welded)
  return meshDataToHalfEdgeMesh(faceted, 0)
}

function finalizeBlobMesh(
  mesh: HalfEdgeMesh,
  center: Vec2,
  view: PolylineInput['view'],
  depth: number,
  color: number,
  polyBudget: number,
  name: string
): SceneObject {
  for (let i = 0; i < mesh.faceColors.length; i++) mesh.faceColors[i] = color
  offsetMeshInPlane(mesh, center.x, center.y)
  projectMeshToView(mesh, view, depth)

  return mesh.toObject(generateId(), name, {
    polyBudget,
    color,
    polyBudgetMode: 'strict',
    smoothShading: false,
    transform: {
      position: { ...IDENTITY_TRANSFORM.position },
      rotation: { ...IDENTITY_TRANSFORM.rotation },
      scale: { ...IDENTITY_TRANSFORM.scale },
    },
  })
}

/** Blob-mode stroke → low-poly faceted mesh via the blob3d pipeline. */
export function blobStrokeToObject(input: PolylineInput): SceneObject | null {
  if (input.extrudeMode) {
    return polylineToMesh({
      ...input,
      strokeMode: 'outline',
      extrudeMode: true,
      name: input.name ?? 'Extrude',
    })
  }

  const {
    points,
    view,
    polyBudget,
    brushDensity,
    rdpTolerance,
    closeThreshold,
    defaultDepth,
    color,
    name,
    pathClosed,
  } = input

  if (points.length < 2 || view === 'perspective') return null

  const spacing = Math.max(rdpTolerance * 0.5, 1)
  const resampled = resampleUniform(points, spacing)
  const simplified = rdpSimplify(resampled, rdpTolerance)
  if (simplified.length < 2) return null

  const blobCloseThreshold = closeThreshold * 2.5
  const endpointClosed = classifyStroke(simplified, blobCloseThreshold) === 'closed'
  const isClosed = !!pathClosed || endpointClosed

  let closedPoints = simplified
  if (isClosed) {
    const first = simplified[0]
    const last = simplified[simplified.length - 1]
    if (Math.hypot(first.x - last.x, first.y - last.y) > 0.01) {
      closedPoints = [...simplified, first]
    }
  }

  const center = centroid(closedPoints)
  const relative = relativePoints(closedPoints, center)

  const useIcosphere = isClosed && isClosedBlobSphere(closedPoints)

  const mesh = useIcosphere
    ? buildIcosphereBlob(relative, polyBudget)
    : isClosed
      ? buildClosedFillBlob(relative, brushDensity, polyBudget)
      : buildDoodleBlob(relative, brushDensity, polyBudget)

  if (mesh.vertexCount() === 0) return null

  const blobName = name ?? (isClosed ? 'Blob' : 'Blob Doodle')

  return finalizeBlobMesh(mesh, center, view, defaultDepth, color, polyBudget, blobName)
}
