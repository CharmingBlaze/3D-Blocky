import { HalfEdgeMesh, type SceneObject } from '../mesh/HalfEdgeMesh'
import { IDENTITY_TRANSFORM } from '../mesh/objectTransform'
import { generateCapsulePillow } from '../mesh/capsulePillow'
import { generateCapsuleSweep } from '../mesh/extrusion'
import { ensureCCW } from '../mesh/concaveTriangulate'
import { generateSoftInflateDome } from '../mesh/softInflate'
import { extrudeSilhouette, strokeToFlatOutline } from '../mesh/silhouetteExtrude'
import type { ViewType } from '../store/appStore'
import type { Vec2 } from '../utils/math'
import { curvatureSampleClosedLoop } from './rdp'
import { offsetMeshInPlane, planePathToWorld, projectMeshToView } from './worldProjection'
import { orientTubeFacesOutward } from '../mesh/extrusion'
import { ensureClosedMeshOutward } from '../mesh/meshWinding'
import {
  VECTOR_PEN_MAX_BOUNDARY_VERTS,
  VECTOR_PEN_MIN_ANGLE_DEG,
  VECTOR_PEN_RADIAL_SEGMENTS,
} from '../vector/vectorPenLimits'

export type SketchDoodleKind = 'soft' | 'sharp' | 'path' | 'outline'

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
  const depth = Math.max(1.6, Math.abs(extrudeDepth))

  if (kind === 'sharp') {
    if (!isClosed) {
      return generateCapsuleSweep(relative, {
        radius: Math.max(2, depth),
        radialSegments: VECTOR_PEN_RADIAL_SEGMENTS,
        minAngleDeg: VECTOR_PEN_MIN_ANGLE_DEG,
        closed: false,
        color,
      })
    }
    const boundary = curvatureSampleClosedLoop(
      ensureCCW(relative),
      VECTOR_PEN_MIN_ANGLE_DEG,
      VECTOR_PEN_MAX_BOUNDARY_VERTS
    )
    return generateCapsulePillow(boundary, {
      depth,
      minAngleDeg: VECTOR_PEN_MIN_ANGLE_DEG,
      maxBoundaryVerts: VECTOR_PEN_MAX_BOUNDARY_VERTS,
      color,
    })
  }

  if (kind === 'outline') {
    const depth = Math.max(4, Math.abs(extrudeDepth))
    const hardCap = isClosed ? 20 : 14
    const fromBudget = Math.floor(polyBudget / (isClosed ? 6 : 8))
    const maxBoundary = Math.max(isClosed ? 8 : 4, Math.min(relative.length, fromBudget, hardCap))
    if (isClosed) {
      if (relative.length < 3) return null
      const boundary = curvatureSampleClosedLoop(ensureCCW(relative), 18, maxBoundary)
      if (boundary.length < 3) return null
      return extrudeSilhouette(boundary, { depth, color })
    }
    const path =
      relative.length <= maxBoundary
        ? relative
        : (() => {
            const out: Vec2[] = []
            const step = relative.length / maxBoundary
            for (let i = 0; i < maxBoundary; i++) {
              out.push(relative[Math.min(relative.length - 1, Math.round(i * step))]!)
            }
            return out
          })()
    const halfWidth = Math.max(2.5, brushDensity * 0.4)
    const ribbon = strokeToFlatOutline(path, halfWidth)
    if (!ribbon || ribbon.length < 3) return null
    return extrudeSilhouette(ribbon, { depth, color })
  }

  if (!isClosed) {
    return generateCapsuleSweep(relative, {
      radius: Math.max(2.5, Math.min(14, brushDensity * 0.55)),
      radialSegments: VECTOR_PEN_RADIAL_SEGMENTS,
      minAngleDeg: VECTOR_PEN_MIN_ANGLE_DEG,
      closed: false,
      color,
    })
  }

  const maxBoundary = Math.max(8, Math.min(18, Math.floor(polyBudget / 4)))
  const boundary = capBoundaryPoints(relative, maxBoundary)
  const rings = Math.max(3, Math.min(5, Math.floor(polyBudget / (maxBoundary + 4))))

  return generateSoftInflateDome(boundary, { depth, rings, color: 0 })
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
  extrudeDepth: number
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
  }
}

export type EditableSketchSourcePatch = Partial<
  Pick<SketchSource, 'brushDensity' | 'polyBudget' | 'extrudeDepth'>
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
  }

  const mesh = buildMeshFromSource(nextSource, nextSource.extrudeDepth, obj.color)
  if (!mesh || mesh.vertexCount() === 0 || mesh.faces.length === 0) return null

  for (let i = 0; i < mesh.faceColors.length; i++) mesh.faceColors[i] = obj.color
  offsetMeshInPlane(mesh, nextSource.center.x, nextSource.center.y)
  projectMeshToView(mesh, nextSource.view, nextSource.defaultDepth)

  if (nextSource.kind === 'outline' || (nextSource.isClosed && nextSource.kind !== 'path')) {
    ensureClosedMeshOutward(mesh)
  } else {
    const planePath = nextSource.relative.map((p) => ({
      x: p.x + nextSource.center.x,
      y: p.y + nextSource.center.y,
    }))
    orientTubeFacesOutward(
      mesh,
      planePathToWorld(planePath, nextSource.view, nextSource.defaultDepth)
    )
  }

  return mesh.toObject(obj.id, obj.name, {
    ...obj,
    sketchSource: nextSource,
    polyBudget: Math.max(mesh.vertexCount(), nextSource.polyBudget),
    color: obj.color,
    smoothShading: obj.smoothShading ?? false,
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
