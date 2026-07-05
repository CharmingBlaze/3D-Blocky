import * as THREE from 'three'
import { offsetMeshInPlane, projectMeshToView } from '../stroke/worldProjection'
import {
  prepareSketchStroke,
  snapSketchStrokeClosed,
} from '../stroke/sketchDoodle'
import { extrudeSilhouette } from '../mesh/silhouetteExtrude'
import type { ViewType } from '../store/appStore'
import type { Vec2 } from '../utils/math'

export function buildExtrudePreviewGeometry(
  points: Vec2[],
  view: ViewType,
  defaultDepth: number,
  extrudeAmount: number,
  _brushDensity: number,
  closeThreshold: number,
  closed?: boolean
): THREE.BufferGeometry | null {
  if (points.length < 2 || view === 'perspective') return null

  const snapped = snapSketchStrokeClosed(points, closeThreshold)
  const prepared = prepareSketchStroke(snapped, closeThreshold, 12)
  if (!prepared) return null

  const isClosed = closed ?? prepared.isClosed
  if (!isClosed || prepared.relative.length < 3) return null

  const mesh = extrudeSilhouette(prepared.relative, {
    depth: Math.max(4, extrudeAmount),
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
