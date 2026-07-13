import * as THREE from 'three'
import { ensureCCW } from '../mesh/concaveTriangulate'
import { generateCapsuleSweep, generateTaperedPointedTube } from '../mesh/extrusion'
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
  resolveSilhouetteDepth,
} from '../stroke/sketchSource'
import type { StrokeMode, ViewType } from '../store/appStore'
import type { Vec2 } from '../utils/math'
import {
  VECTOR_PEN_MIN_ANGLE_DEG,
  VECTOR_PEN_RADIAL_SEGMENTS,
} from '../vector/vectorPenLimits'
import { LOW_POLY_CAPSULE_HEMI_RINGS } from '../primitives/capsuleMesh'
import { primitiveSegmentsForBudget } from '../mesh/meshPolyBudget'

export interface ExtrudePreviewOptions {
  strokeMode?: StrokeMode
  polyBudget?: number
  hairTipStyle?: HairTipStyle
  planeFrame?: StrokePlaneFrame | null
}

function hairStyleFromStrokeMode(strokeMode: StrokeMode | undefined): HairRibbonStyle | null {
  if (strokeMode === 'hair-paths') return 'path'
  if (strokeMode === 'hair-strips') return 'strip'
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
    highFidelity: hairStyle === 'path' || roundedHair,
    forceOpen: hairStyle != null || roundedHair,
  })
  if (!prepared) return null

  const polyBudget = options?.polyBudget ?? 128

  const mesh = (() => {
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
        halfWidth: hairHalfWidthFromBrush(brushDensity, hairStyle),
        depth: resolveHairDepth(extrudeAmount, brushDensity, hairStyle),
        color: 0x6ecbf5,
        flat: hairStyle === 'strip',
        tipStyle,
      })
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
