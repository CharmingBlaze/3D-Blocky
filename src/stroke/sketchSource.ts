import { HalfEdgeMesh, type SceneObject } from '../mesh/HalfEdgeMesh'
import { IDENTITY_TRANSFORM } from '../mesh/objectTransform'
import { generateSoftInflateDome } from '../mesh/softInflate'
import { extrudeSilhouette } from '../mesh/silhouetteExtrude'
import { generateTube } from '../mesh/extrusion'
import type { ViewType } from '../store/appStore'
import type { Vec2 } from '../utils/math'
import { offsetMeshInPlane, planePathToWorld, projectMeshToView } from './worldProjection'
import { orientTubeFacesOutward } from '../mesh/extrusion'
import { ensureClosedMeshOutward } from '../mesh/meshWinding'

export type SketchDoodleKind = 'soft' | 'sharp' | 'path'

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

function buildMeshFromSource(source: SketchSource, extrudeDepth: number, color: number): HalfEdgeMesh | null {
  const { relative, brushDensity, polyBudget, isClosed, kind } = source
  const depth = Math.max(4, extrudeDepth)

  if (!isClosed) {
    return generateTube(relative, {
      radius: Math.max(2.5, Math.min(14, brushDensity * 0.55)),
      radialSegments: 8,
      minAngleDeg: 14,
      capped: true,
    })
  }

  const maxBoundary = Math.max(8, Math.min(20, Math.floor(polyBudget / 4)))
  const boundary = capBoundaryPoints(relative, maxBoundary)
  const rings = Math.max(3, Math.min(5, Math.floor(polyBudget / (maxBoundary + 4))))

  if (kind === 'sharp') {
    return extrudeSilhouette(boundary, { depth, color })
  }

  return generateSoftInflateDome(boundary, { depth, rings, color: 0 })
}

/** Rebuild a sketch doodle with a new extrusion depth, preserving id and transform. */
export function regenerateSketchObject(obj: SceneObject, extrudeDepth: number): SceneObject | null {
  const source = obj.sketchSource
  if (!source) return null

  const mesh = buildMeshFromSource(source, extrudeDepth, obj.color)
  if (!mesh || mesh.vertexCount() === 0 || mesh.faces.length === 0) return null

  for (let i = 0; i < mesh.faceColors.length; i++) mesh.faceColors[i] = obj.color
  offsetMeshInPlane(mesh, source.center.x, source.center.y)
  projectMeshToView(mesh, source.view, source.defaultDepth)

  if (!source.isClosed) {
    const planePath = source.relative.map((p) => ({
      x: p.x + source.center.x,
      y: p.y + source.center.y,
    }))
    orientTubeFacesOutward(
      mesh,
      planePathToWorld(planePath, source.view, source.defaultDepth)
    )
  } else {
    ensureClosedMeshOutward(mesh)
  }

  const nextSource: SketchSource = { ...source, extrudeDepth }

  return mesh.toObject(obj.id, obj.name, {
    ...obj,
    sketchSource: nextSource,
    polyBudget: Math.max(mesh.vertexCount(), source.polyBudget),
    color: obj.color,
    smoothShading: obj.smoothShading ?? false,
    transform: obj.transform ?? {
      position: { ...IDENTITY_TRANSFORM.position },
      rotation: { ...IDENTITY_TRANSFORM.rotation },
      scale: { ...IDENTITY_TRANSFORM.scale },
    },
  })
}
