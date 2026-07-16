import { Vector3 } from 'three'
import type * as THREE from 'three'
import type { SceneObject } from '../mesh/HalfEdgeMesh'
import type { ObjectTransform } from '../mesh/HalfEdgeMesh'
import type { MeshComponentSelection } from '../mesh/meshSelection'
import { expandFaceToPlanarRegion } from '../mesh/faceGroups'
import { edgeKey } from '../mesh/meshSelection'
import type { MeshPickHit } from '../select/meshPick'
import { resolveEffectiveMaterial } from '../material/materials'
import { pickMeshSurfaceUv, uvToPixelCoords } from '../pixel/uvPaint'
import {
  buildCameraDragPlane,
  clientToCameraPlane,
  clientToPlane,
  planeToWorld3D,
} from '../utils/screenToWorld'
import type { Vec3 } from '../utils/math'
import type { ViewType } from '../scene/viewTypes'
import type { ActiveTool, SelectionMode } from '../store/appStore'

export const DRAW_TOOLS: ActiveTool[] = ['draw', 'boolean-hole']
export const VECTOR_TOOLS: ActiveTool[] = ['vector-pen', 'vector-shape', 'primitive-box', 'poly-draw']
export const SCULPT_TOOLS: ActiveTool[] = ['push', 'pull', 'inflate', 'deflate', 'relax', 'pinch']
export const TRANSFORM_GIZMO_TOOLS: ActiveTool[] = ['move', 'rotate', 'scale']
export const DEFORM_TOOLS: ActiveTool[] = ['bend']
export const MESH_SELECT_TOOLS: ActiveTool[] = ['select-vertex', 'select-edge', 'select-face']
export const MESH_EDIT_TOOLS: ActiveTool[] = ['knife', 'mirror-knife', 'loop-cut']

export function isComponentSelectionMode(mode: SelectionMode): boolean {
  return mode === 'vertex' || mode === 'edge' || mode === 'face'
}

export function isBoxSelectInteraction(mode: SelectionMode, tool: ActiveTool): boolean {
  if (mode === 'object') {
    return tool === 'select-object' || tool === 'smart' || TRANSFORM_GIZMO_TOOLS.includes(tool)
  }
  return (
    isComponentSelectionMode(mode) &&
    (MESH_SELECT_TOOLS.includes(tool) || tool === 'smart' || tool === 'extrude' || TRANSFORM_GIZMO_TOOLS.includes(tool))
  )
}

/** Click-pick / multiselect while a component select or transform gizmo tool is active. */
export function canPickComponentSelection(tool: ActiveTool): boolean {
  return MESH_SELECT_TOOLS.includes(tool) || tool === 'smart' || tool === 'extrude' || TRANSFORM_GIZMO_TOOLS.includes(tool)
}

/** Free-drag the current component selection without using the gizmo (select tools + move). */
export function canDragComponentSelection(tool: ActiveTool): boolean {
  return MESH_SELECT_TOOLS.includes(tool) || tool === 'smart' || tool === 'move'
}

export function isHitInMeshSelection(
  hit: MeshPickHit,
  selection: MeshComponentSelection,
  mode: SelectionMode,
  object: SceneObject
): boolean {
  if (hit.objectId !== selection.objectId) return false
  if (mode === 'vertex' && hit.vertex !== undefined) {
    return selection.vertices.includes(hit.vertex)
  }
  if (mode === 'edge' && hit.edge) {
    return selection.edges.includes(edgeKey(hit.edge[0], hit.edge[1]))
  }
  if (mode === 'face' && hit.face !== undefined) {
    if (selection.faces.includes(hit.face)) return true
    const regionFaces = expandFaceToPlanarRegion(object, hit.face)
    return regionFaces.some((fi) => selection.faces.includes(fi))
  }
  return false
}

export type DragPlaneState = {
  view: ViewType
  startPlane?: { x: number; y: number }
  startWorld?: Vec3
  dragPlane?: THREE.Plane
}

export type ObjectDragState = DragPlaneState & {
  baseTransforms: Record<string, ObjectTransform>
  moved: boolean
}

export type ComponentDragState = DragPlaneState & {
  basePositions: Record<number, Vec3>
  moved: boolean
}

export function dragDeltaFromPointer(
  e: React.PointerEvent,
  drag: DragPlaneState,
  defaultDepth: number,
  getPlanePoint: (e: React.PointerEvent) => { x: number; y: number } | null,
  containerRef: React.RefObject<HTMLDivElement | null>,
  cameraRef: React.RefObject<THREE.Camera | null>
): Vec3 | null {
  const rect = containerRef.current?.getBoundingClientRect()
  const camera = cameraRef.current
  if (!rect || !camera) return null

  if (drag.startWorld && drag.dragPlane) {
    const w1 = clientToCameraPlane(e.clientX, e.clientY, rect, camera, drag.dragPlane)
    if (!w1) return null
    return {
      x: w1.x - drag.startWorld.x,
      y: w1.y - drag.startWorld.y,
      z: w1.z - drag.startWorld.z,
    }
  }

  if (!drag.startPlane) return null
  const pt = getPlanePoint(e)
  if (!pt) return null
  const w0 = planeToWorld3D(drag.startPlane.x, drag.startPlane.y, drag.view, defaultDepth)
  const w1 = planeToWorld3D(pt.x, pt.y, drag.view, defaultDepth)
  return { x: w1.x - w0.x, y: w1.y - w0.y, z: w1.z - w0.z }
}

export function beginCameraPlaneDrag(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  camera: THREE.Camera,
  throughPoint: Vec3
): { startWorld: Vec3; dragPlane: THREE.Plane } | null {
  const anchor = new Vector3(throughPoint.x, throughPoint.y, throughPoint.z)
  let plane = buildCameraDragPlane(camera, anchor)
  const hit = clientToCameraPlane(clientX, clientY, rect, camera, plane)
  if (!hit) return null
  plane = buildCameraDragPlane(camera, hit)
  return {
    startWorld: { x: hit.x, y: hit.y, z: hit.z },
    dragPlane: plane,
  }
}

export function pickPixelOnTexturedMesh(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  camera: THREE.Camera,
  objects: SceneObject[],
  objectId: string,
  docId: string,
  docW: number,
  docH: number
): { x: number; y: number } | null {
  const hit = pickMeshSurfaceUv(clientX, clientY, rect, camera, objects, objectId)
  if (!hit) return null
  const hitObj = objects.find((o) => o.id === hit.objectId)
  const mat = hitObj ? resolveEffectiveMaterial(hitObj) : null
  const effectiveDocId = mat?.textureId ?? hitObj?.id
  if (effectiveDocId !== docId) return null
  return uvToPixelCoords(hit.uv, docW, docH)
}

export function updateCameraMatrices(camera: THREE.Camera): void {
  camera.updateMatrixWorld()
  if ('updateProjectionMatrix' in camera && typeof camera.updateProjectionMatrix === 'function') {
    camera.updateProjectionMatrix()
  }
}

export function getViewPlanePoint(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  camera: THREE.Camera,
  view: ViewType,
  defaultDepth: number
): { x: number; y: number } | null {
  updateCameraMatrices(camera)
  return clientToPlane(clientX, clientY, rect, camera, view, defaultDepth)
}
