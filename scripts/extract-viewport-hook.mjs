import fs from 'fs'

const lines = fs.readFileSync('src/components/QuadViewport.tsx', 'utf8').split(/\r?\n/)
const refLines = lines.slice(370, 401).join('\n')
const body = lines.slice(613, 2014).join('\n')
const header = `import { useCallback, useEffect, useRef, useState } from 'react'
import { Vector3 } from 'three'
import type * as THREE from 'three'
import { pushViewportInteraction, popViewportInteraction } from '../rendering/viewportFrameLoop'
import { useAppStore } from '../store/appStore'
import type { ViewType } from '../scene/viewTypes'
import type { PolyDrawPointSnap } from '../store/appStore'
import type { PixelShapeTool } from '../pixel/uvPaint'
import {
  buildCameraDragPlane,
  clientToCameraPlane,
  clientToGroundPlane,
  getCameraViewForward,
  planeToWorld3D,
} from '../utils/screenToWorld'
import { pickObjectAt, objectsInScreenRect } from '../select/objectPick'
import {
  meshComponentsInScreenRect,
  pickMeshComponent,
  pickKnifeHit,
  resolveMarqueeMeshObjectId,
} from '../select/meshPick'
import { constrainKnifeEndWorld } from '../mesh/knifeUtils'
import {
  constrainPixelShape,
  estimateTexelScreenSize,
  interpolateScreenPaintSamples,
  pickMeshSurfaceUv,
  uvToPixelCoords,
} from '../pixel/uvPaint'
import { resolveEffectiveMaterial } from '../material/materials'
import {
  edgeKey,
  getAffectedVertices,
  meshSelectionWorldCenter,
  selectionHasComponents,
  type MeshComponentSelection,
} from '../mesh/meshSelection'
import type { SceneObject } from '../mesh/HalfEdgeMesh'
import type { ObjectTransform } from '../mesh/HalfEdgeMesh'
import type { Vec3 } from '../utils/math'
import type { SculptTool } from '../sculpt/sculptTools'
import { cloneTransform, ensureTransform, selectionWorldCenter } from '../mesh/objectTransform'
import { findPolyDrawSnapTarget, snapHighlightFromTarget } from '../polyDraw/polyDrawSnap'
import { resolveFreeClickWorld, workPlaneDepthForView } from '../polyDraw/polyDrawPlacement'
import {
  normalizedViewportPoint,
  worldPointFromViewDrop,
} from '../images/imageDropPlacement'
import type { ActiveTool } from '../store/appStore'
import {
  DRAW_TOOLS,
  MESH_EDIT_TOOLS,
  MESH_SELECT_TOOLS,
  SCULPT_TOOLS,
  TRANSFORM_GIZMO_TOOLS,
  beginCameraPlaneDrag,
  canDragComponentSelection,
  dragDeltaFromPointer,
  isBoxSelectInteraction,
  isComponentSelectionMode,
  isHitInMeshSelection,
  pickPixelOnTexturedMesh,
  updateCameraMatrices,
  type ComponentDragState,
  type ObjectDragState,
} from '../viewport/viewportInteractionUtils'

export interface UseViewportPointerHandlersParams {
  view: ViewType
  onActivate: () => void
  layoutVisible: boolean
  containerRef: React.RefObject<HTMLDivElement | null>
  cameraRef: React.RefObject<THREE.Camera | null>
}

export function useViewportPointerHandlers({
  view,
  onActivate,
  layoutVisible,
  containerRef,
  cameraRef,
}: UseViewportPointerHandlersParams) {
  const pointerInteractionRef = useRef(false)

  const beginPointerInteraction = useCallback(() => {
    if (!layoutVisible || pointerInteractionRef.current) return
    pointerInteractionRef.current = true
    pushViewportInteraction()
  }, [layoutVisible])

  const endPointerInteraction = useCallback(() => {
    if (!pointerInteractionRef.current) return
    pointerInteractionRef.current = false
    popViewportInteraction()
  }, [])

${refLines.replace('  const containerRef = useRef<HTMLDivElement>(null)\n', '').replace('  const cameraRef = useRef<THREE.Camera | null>(null)\n', '')}

`
const footer = `
  return {
    marqueeRect,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerLeave,
    handleWheel,
    handleDragOver,
    handleDrop,
    perspectivePrimitiveScrollHeight,
    roundedBoxParamWheel,
  }
}
`

fs.mkdirSync('src/hooks', { recursive: true })
fs.writeFileSync('src/hooks/useViewportPointerHandlers.ts', header + body + footer)
console.log('Wrote hook with', (header + body + footer).split('\n').length, 'lines')
