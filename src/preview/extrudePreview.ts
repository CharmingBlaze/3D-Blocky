import * as THREE from 'three'
import { ensureCCW } from '../mesh/concaveTriangulate'
import { generateCapsulePillow } from '../mesh/capsulePillow'
import { generateCapsuleSweep } from '../mesh/extrusion'
import { curvatureSampleClosedLoop } from '../stroke/rdp'
import { offsetMeshInPlane, projectMeshToView } from '../stroke/worldProjection'
import {
  prepareSketchStroke,
  snapSketchStrokeClosed,
} from '../stroke/sketchDoodle'
import type { ViewType } from '../store/appStore'
import type { Vec2 } from '../utils/math'
import {
  VECTOR_PEN_MAX_BOUNDARY_VERTS,
  VECTOR_PEN_MIN_ANGLE_DEG,
  VECTOR_PEN_RADIAL_SEGMENTS,
} from '../vector/vectorPenLimits'

export function buildExtrudePreviewGeometry(
  points: Vec2[],
  view: ViewType,
  defaultDepth: number,
  extrudeAmount: number,
  brushDensity: number,
  closeThreshold: number,
  closed?: boolean
): THREE.BufferGeometry | null {
  if (points.length < 2 || view === 'perspective') return null

  const snapped = snapSketchStrokeClosed(points, closeThreshold)
  const prepared = prepareSketchStroke(snapped, closeThreshold, brushDensity)
  if (!prepared) return null

  const isClosed = closed ?? prepared.isClosed
  const depth = Math.max(1.6, Math.abs(extrudeAmount ?? Math.max(4, brushDensity)))

  const mesh = isClosed
    ? generateCapsulePillow(
        curvatureSampleClosedLoop(
          ensureCCW(prepared.relative),
          VECTOR_PEN_MIN_ANGLE_DEG,
          VECTOR_PEN_MAX_BOUNDARY_VERTS
        ),
        {
          depth,
          minAngleDeg: VECTOR_PEN_MIN_ANGLE_DEG,
          maxBoundaryVerts: VECTOR_PEN_MAX_BOUNDARY_VERTS,
          color: 0x6ecbf5,
        }
      )
    : generateCapsuleSweep(prepared.relative, {
        radius: Math.max(2, depth),
        radialSegments: VECTOR_PEN_RADIAL_SEGMENTS,
        minAngleDeg: VECTOR_PEN_MIN_ANGLE_DEG,
        closed: false,
        color: 0x6ecbf5,
      })

  if (mesh.vertexCount() === 0) return null

  offsetMeshInPlane(mesh, prepared.center.x, prepared.center.y)
  projectMeshToView(mesh, view, defaultDepth)

  const data = mesh.toMeshData(true, 0)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3))
  geo.setIndex(new THREE.BufferAttribute(data.indices, 1))
  geo.computeVertexNormals()
  return geo
}
