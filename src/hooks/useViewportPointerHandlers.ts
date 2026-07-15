import { useCallback, useEffect, useRef, useState } from 'react'
import { Vector3 } from 'three'
import type { Camera } from 'three'
import { useShallow } from 'zustand/react/shallow'
import { pushViewportSharedInteraction, popViewportSharedInteraction } from '../rendering/viewportFrameLoop'
import type { ViewportSlotIndex } from '../scene/viewTypes'

import { useAppStore } from '../store/appStore'
import type { ViewType } from '../scene/viewTypes'
import type { PolyDrawPointSnap } from '../store/appStore'
import type { PixelShapeTool } from '../pixel/uvPaint'
import {
  buildCameraDragPlane,
  buildPerspectiveStrokeFrame,
  clientToCameraPlane,
  clientToGroundPlane,
  clientToPerspectiveStrokePlane,
  clientToPlane,
  getCameraViewForward,
  planeToWorld3D,
  type StrokePlaneFrame,
} from '../utils/screenToWorld'
import { pickObjectAt, objectsInScreenRect } from '../select/objectPick'
import {
  meshComponentsInScreenRect,
  pickMeshComponent,
  pickKnifeHit,
  resolveMarqueeMeshObjectId,
} from '../select/meshPick'
import {
  constrainPixelShape,
  estimateTexelScreenSize,
  interpolateScreenPaintSamples,
  pickMeshSurfaceUv,
  pickObjectSurfaceUv,
  uvToPixelCoords,
  type MeshPickHint,
} from '../pixel/uvPaint'
import { resolveEffectiveMaterial } from '../material/materials'
import {
  edgeKey,
  getAffectedVertices,
  meshSelectionWorldCenter,
  parseEdgeKey,
  selectionHasComponents,
  type MeshComponentSelection,
} from '../mesh/meshSelection'
import type { SceneObject } from '../mesh/HalfEdgeMesh'
import type { ObjectTransform } from '../mesh/HalfEdgeMesh'
import type { Vec3 } from '../utils/math'
import type { SculptTool } from '../sculpt/sculptTools'
import { clearSculptSession } from '../sculpt/sculptSessionCache'
import {
  cloneTransform,
  ensureTransform,
  localPointFromWorld,
  selectionWorldCenter,
  worldPointFromObject,
} from '../mesh/objectTransform'
import { constrainKnifeEndWorld } from '../mesh/knifeUtils'
import { findPolyDrawSnapTarget, snapHighlightFromTarget } from '../polyDraw/polyDrawSnap'
import { resolveFreeClickWorld, workPlaneDepthForView } from '../polyDraw/polyDrawPlacement'
import {
  normalizedViewportPoint,
  worldPointFromViewDrop,
} from '../images/imageDropPlacement'
import { PERSPECTIVE_PRIMITIVE_HEIGHT_DRAG_SCALE } from '../primitives/primitiveBoxMath'
import type { ActiveTool } from '../store/appStore'
import {
  DRAW_TOOLS,
  DEFORM_TOOLS,
  MESH_EDIT_TOOLS,
  SCULPT_TOOLS,
  TRANSFORM_GIZMO_TOOLS,
  beginCameraPlaneDrag,
  canDragComponentSelection,
  canPickComponentSelection,
  dragDeltaFromPointer,
  isBoxSelectInteraction,
  isComponentSelectionMode,
  isHitInMeshSelection,
  pickPixelOnTexturedMesh,
  type ComponentDragState,
  type ObjectDragState,
} from '../viewport/viewportInteractionUtils'

export interface UseViewportPointerHandlersParams {
  view: ViewType
  onActivate: () => void
  layoutVisible: boolean
  slotIndex: ViewportSlotIndex
  containerRef: React.RefObject<HTMLDivElement | null>
  cameraRef: React.RefObject<Camera | null>
}

export function useViewportPointerHandlers({
  view,
  onActivate,
  layoutVisible,
  slotIndex,
  containerRef,
  cameraRef,
}: UseViewportPointerHandlersParams) {
  const pointerInteractionRef = useRef(false)

  const beginPointerInteraction = useCallback(() => {
    if (!layoutVisible || pointerInteractionRef.current) return
    pointerInteractionRef.current = true
    pushViewportSharedInteraction(slotIndex)
  }, [layoutVisible, slotIndex])

  const endPointerInteraction = useCallback(() => {
    if (!pointerInteractionRef.current) return
    pointerInteractionRef.current = false
    popViewportSharedInteraction(slotIndex)
  }, [slotIndex])

  const lastSculptRef = useRef(0)
  const marqueeStartRef = useRef<{ x: number; y: number; additive: boolean } | null>(null)
  const boxSelectPendingRef = useRef<{ x: number; y: number; additive: boolean } | null>(null)
  const pixelPaintRef = useRef<{
    docId: string
    objectId: string
    lastX: number
    lastY: number
    hint: MeshPickHint | null
  } | null>(null)
  const pixelShapeRef = useRef<{
    docId: string
    objectId: string
    tool: PixelShapeTool
    x0: number
    y0: number
    x1: number
    y1: number
  } | null>(null)
  const vectorGestureViewRef = useRef<ViewType | null>(null)
  const strokeGestureViewRef = useRef<ViewType | null>(null)
  const primitiveGestureViewRef = useRef<ViewType | null>(null)
  const perspectiveHeightDragRef = useRef<{ startY: number; startHeight: number } | null>(null)
  const perspectiveHeightClickRef = useRef({ t: 0, x: 0, y: 0 })
  const bendClickRef = useRef({ t: 0, x: 0, y: 0 })
  const knifeClickRef = useRef({ t: 0, x: 0, y: 0 })
  const selectDragRef = useRef<ObjectDragState | null>(null)
  const componentDragRef = useRef<ComponentDragState | null>(null)
  const hoverPickRafRef = useRef<number | null>(null)
  const pendingHoverRef = useRef<{ x: number; y: number } | null>(null)
  const [marqueeRect, setMarqueeRect] = useState<{
    x0: number
    y0: number
    x1: number
    y1: number
  } | null>(null)
  const [imageDragOver, setImageDragOver] = useState(false)

  const {
    objects,
    selectedObjectId,
    selectionObjectIds,
    activeTool,
    selectionMode,
    viewportXRay,
    defaultDepth,
    startStroke,
    continueStroke,
    endStroke,
    setStrokePreview,
    beginExtrudeDrag,
    updateExtrudeFromPointer,
    applySculptAt,
    selectObject,
    setSelection,
    addToObjectSelection,
    commitHistory,
    translateSelectionByDelta,
    applyMeshPick,
    applyMeshMarqueePick,
    setMeshHover,
    clearMeshSelection,
    translateMeshSelection,
    flipFaceNormal,
    viewportDisplayMode,
    startVectorStroke,
    continueVectorStroke,
    endVectorStroke,
    penPointerDown,
    penPointerMove,
    penPointerUp,
    penFinishPath,
    primitiveBoxPointerDown,
    primitiveBoxPointerMove,
    primitiveBoxPointerUp,
    adjustPrimitiveBoxWheel,
    setPrimitiveBoxScrollHeight,
    commitPrimitiveBox,
    primitiveBoxDraft,
    activePrimitiveKind,
    activeShapeKind,
    vectorIsDrawing,
    polyDrawClick,
    polyDrawPointerMove,
    polyDrawFinish,
    polyDrawSnapAllScene,
    clearPolyDrawHover,
    loopCutBegin,
    loopCutCommit,
    loopCutAdjustWheel,
    knifeHover,
    knifeClearHover,
    knifeAddPoint,
    knifeApply,
    bendBegin,
    bendPointerMove,
    bendPointerUp,
    bendStartAngleDrag,
    bendCommit,
    imageDropMode,
    dropImageInView,
    loadObjectTexture,
    selectReferenceImage,
    selectBillboardImage,
  } = useAppStore(
    useShallow((s) => ({
      objects: s.objects,
      selectedObjectId: s.selectedObjectId,
      selectionObjectIds: s.selectionObjectIds,
      activeTool: s.activeTool,
      selectionMode: s.selectionMode,
      viewportXRay: s.viewportXRay,
      defaultDepth: s.defaultDepth,
      startStroke: s.startStroke,
      continueStroke: s.continueStroke,
      endStroke: s.endStroke,
      setStrokePreview: s.setStrokePreview,
      beginExtrudeDrag: s.beginExtrudeDrag,
      updateExtrudeFromPointer: s.updateExtrudeFromPointer,
      applySculptAt: s.applySculptAt,
      selectObject: s.selectObject,
      setSelection: s.setSelection,
      addToObjectSelection: s.addToObjectSelection,
      commitHistory: s.commitHistory,
      translateSelectionByDelta: s.translateSelectionByDelta,
      applyMeshPick: s.applyMeshPick,
      applyMeshMarqueePick: s.applyMeshMarqueePick,
      setMeshHover: s.setMeshHover,
      clearMeshSelection: s.clearMeshSelection,
      translateMeshSelection: s.translateMeshSelection,
      flipFaceNormal: s.flipFaceNormal,
      viewportDisplayMode: s.viewportDisplayMode,
      startVectorStroke: s.startVectorStroke,
      continueVectorStroke: s.continueVectorStroke,
      endVectorStroke: s.endVectorStroke,
      penPointerDown: s.penPointerDown,
      penPointerMove: s.penPointerMove,
      penPointerUp: s.penPointerUp,
      penFinishPath: s.penFinishPath,
      vectorPenDraft: s.vectorPenDraft,
      primitiveBoxPointerDown: s.primitiveBoxPointerDown,
      primitiveBoxPointerMove: s.primitiveBoxPointerMove,
      primitiveBoxPointerUp: s.primitiveBoxPointerUp,
      adjustPrimitiveBoxWheel: s.adjustPrimitiveBoxWheel,
      setPrimitiveBoxScrollHeight: s.setPrimitiveBoxScrollHeight,
      commitPrimitiveBox: s.commitPrimitiveBox,
      primitiveBoxDraft: s.primitiveBoxDraft,
      activePrimitiveKind: s.activePrimitiveKind,
      activeShapeKind: s.activeShapeKind,
      vectorIsDrawing: s.vectorIsDrawing,
      polyDrawClick: s.polyDrawClick,
      polyDrawPointerMove: s.polyDrawPointerMove,
      polyDrawFinish: s.polyDrawFinish,
      polyDrawSnapAllScene: s.polyDrawSnapAllScene,
      clearPolyDrawHover: s.clearPolyDrawHover,
      loopCutBegin: s.loopCutBegin,
      loopCutCommit: s.loopCutCommit,
      loopCutAdjustWheel: s.loopCutAdjustWheel,
      knifeHover: s.knifeHover,
      knifeClearHover: s.knifeClearHover,
      knifeAddPoint: s.knifeAddPoint,
      knifeApply: s.knifeApply,
      bendBegin: s.bendBegin,
      bendPointerMove: s.bendPointerMove,
      bendPointerUp: s.bendPointerUp,
      bendStartAngleDrag: s.bendStartAngleDrag,
      bendCommit: s.bendCommit,
      imageDropMode: s.imageDropMode,
      dropImageInView: s.dropImageInView,
      loadObjectTexture: s.loadObjectTexture,
      selectReferenceImage: s.selectReferenceImage,
      selectBillboardImage: s.selectBillboardImage,
    }))
  )

  const scheduleMeshHoverPick = useCallback(
    (clientX: number, clientY: number) => {
      pendingHoverRef.current = { x: clientX, y: clientY }
      if (hoverPickRafRef.current != null) return

      hoverPickRafRef.current = requestAnimationFrame(() => {
        hoverPickRafRef.current = null
        const pending = pendingHoverRef.current
        if (!pending) return

        const store = useAppStore.getState()
        const meshEditHover =
          store.activeTool === 'loop-cut' ||
          store.activeTool === 'knife' ||
          store.activeTool === 'mirror-knife' ||
          store.activeTool === 'bend'
        if (!isComponentSelectionMode(store.selectionMode) && !meshEditHover) {
          store.setMeshHover(null)
          return
        }

        const rect = containerRef.current?.getBoundingClientRect()
        const camera = cameraRef.current
        if (!rect || !camera) return

        camera.updateMatrixWorld()
        if (
          'updateProjectionMatrix' in camera &&
          typeof camera.updateProjectionMatrix === 'function'
        ) {
          camera.updateProjectionMatrix()
        }

        const pickMode =
          store.activeTool === 'loop-cut' ? 'edge' : store.selectionMode

        const hit = pickMeshComponent(
          pickMode,
          pending.x,
          pending.y,
          rect,
          camera,
          store.objects,
          store.meshSelection?.objectId ?? store.selectedObjectId,
          { cullBackVertices: !store.viewportXRay }
        )

        const hasComponent =
          hit &&
          (hit.vertex !== undefined || hit.edge !== undefined || hit.face !== undefined)

        store.setMeshHover(
          hasComponent && hit ? { ...hit, viewportSlot: slotIndex } : null
        )
      })
    },
    [slotIndex]
  )

  useEffect(
    () => () => {
      if (hoverPickRafRef.current != null) {
        cancelAnimationFrame(hoverPickRafRef.current)
      }
    },
    []
  )

  const getPlanePoint = useCallback(
    (e: React.PointerEvent) => {
      const rect = containerRef.current?.getBoundingClientRect()
      const camera = cameraRef.current
      if (!rect || !camera) return null
      camera.updateMatrixWorld()
      if ('updateProjectionMatrix' in camera && typeof camera.updateProjectionMatrix === 'function') {
        camera.updateProjectionMatrix()
      }
      return clientToPlane(e.clientX, e.clientY, rect, camera, view, defaultDepth)
    },
    [view]
  )

  const getGroundPoint = useCallback(
    (clientX: number, clientY: number, groundY = defaultDepth): Vec3 | null => {
      const rect = containerRef.current?.getBoundingClientRect()
      const camera = cameraRef.current
      if (!rect || !camera) return null
      camera.updateMatrixWorld()
      if ('updateProjectionMatrix' in camera && typeof camera.updateProjectionMatrix === 'function') {
        camera.updateProjectionMatrix()
      }
      return clientToGroundPlane(clientX, clientY, rect, camera, groundY)
    },
    [defaultDepth]
  )

  /** Focus for perspective sketch plane: selection center, else world origin at defaultDepth. */
  const resolvePerspectiveStrokeFocus = useCallback((): Vec3 => {
    const store = useAppStore.getState()
    const ids =
      store.selectionObjectIds.length > 0
        ? store.selectionObjectIds
        : store.selectedObjectId
          ? [store.selectedObjectId]
          : []
    if (ids.length > 0) {
      return selectionWorldCenter(store.objects, ids)
    }
    return { x: 0, y: defaultDepth, z: 0 }
  }, [defaultDepth])

  const beginPerspectiveStrokeFrame = useCallback((): StrokePlaneFrame | null => {
    const camera = cameraRef.current
    if (!camera) return null
    camera.updateMatrixWorld()
    if ('updateProjectionMatrix' in camera && typeof camera.updateProjectionMatrix === 'function') {
      camera.updateProjectionMatrix()
    }
    return buildPerspectiveStrokeFrame(camera, resolvePerspectiveStrokeFocus())
  }, [resolvePerspectiveStrokeFocus])

  const getDrawPlanePoint = useCallback(
    (e: React.PointerEvent, frame?: StrokePlaneFrame | null) => {
      const rect = containerRef.current?.getBoundingClientRect()
      const camera = cameraRef.current
      if (!rect || !camera) return null
      camera.updateMatrixWorld()
      if ('updateProjectionMatrix' in camera && typeof camera.updateProjectionMatrix === 'function') {
        camera.updateProjectionMatrix()
      }
      if (view === 'perspective') {
        const locked =
          frame ??
          useAppStore.getState().currentStrokePlane ??
          beginPerspectiveStrokeFrame()
        if (!locked) return null
        return clientToPerspectiveStrokePlane(e.clientX, e.clientY, rect, camera, locked)
      }
      return clientToPlane(e.clientX, e.clientY, rect, camera, view, defaultDepth)
    },
    [view, defaultDepth, beginPerspectiveStrokeFrame]
  )

  const perspectivePrimitiveScrollHeight =
    view === 'perspective' &&
    activeTool === 'primitive-box' &&
    primitiveBoxDraft?.phase === 'scrollHeight' &&
    primitiveBoxDraft.baseView === 'perspective'

  const roundedBoxParamWheel =
    (activeTool === 'primitive-box' &&
      activePrimitiveKind === 'roundedBox' &&
      primitiveBoxDraft != null) ||
    (activeTool === 'vector-shape' && activeShapeKind === 'roundedBox' && vectorIsDrawing)

  const resolvePolyDrawAt = useCallback(
    (clientX: number, clientY: number, allowCloseLoop: boolean) => {
      const rect = containerRef.current?.getBoundingClientRect()
      const camera = cameraRef.current
      if (!rect || !camera) return null

      camera.updateMatrixWorld()
      if (
        'updateProjectionMatrix' in camera &&
        typeof camera.updateProjectionMatrix === 'function'
      ) {
        camera.updateProjectionMatrix()
      }

      const store = useAppStore.getState()
      const draftPoints = store.polyDrawDraft?.points ?? []
      const snap = findPolyDrawSnapTarget(clientX, clientY, rect, camera, store.objects, {
        includeAllScene: polyDrawSnapAllScene,
        selectionObjectIds: store.selectionObjectIds,
        draftPoints,
        allowCloseLoop,
      })

      if (snap) {
        return { world: snap.world, snap: snap.snap, highlight: snapHighlightFromTarget(snap) }
      }

      const existingWorlds = draftPoints.map((p) => p.world)
      const depth = workPlaneDepthForView(view, existingWorlds, defaultDepth)
      const world = resolveFreeClickWorld(
        clientX,
        clientY,
        rect,
        camera,
        view,
        depth,
        existingWorlds,
        store.objects
      )
      return { world, snap: null as PolyDrawPointSnap | null, highlight: null }
    },
    [view, defaultDepth, polyDrawSnapAllScene]
  )

  const resolveKnifeHit = useCallback(
    (
      clientX: number,
      clientY: number,
      preferredId: string | null,
      shiftKey = false,
      ctrlKey = false
    ) => {
      const rect = containerRef.current?.getBoundingClientRect()
      const camera = cameraRef.current
      if (!rect || !camera) return null

      const store = useAppStore.getState()
      const hit = pickKnifeHit(clientX, clientY, rect, camera, store.objects, preferredId, {
        shiftKey,
        ctrlKey,
      })
      if (!hit) return null

      // A knife path belongs to the mesh where its first point was placed.
      // Do not silently discard it when another object passes under the cursor.
      const lockedObjectId = store.knifeDraft?.points.length
        ? store.knifeDraft.objectId
        : null
      if (lockedObjectId && hit.objectId !== lockedObjectId) return null

      // Reuse existing path points when the pointer comes back to one. This makes
      // closed cuts and branching paths deliberate instead of creating near-duplicates.
      if (store.knifeDraft?.objectId === hit.objectId) {
        for (const point of store.knifeDraft.points) {
          const screen = new Vector3(point.world.x, point.world.y, point.world.z).project(camera)
          const sx = rect.left + (screen.x * 0.5 + 0.5) * rect.width
          const sy = rect.top + (-screen.y * 0.5 + 0.5) * rect.height
          if (Math.hypot(clientX - sx, clientY - sy) <= 10) {
            return {
              objectId: hit.objectId,
              world: { ...point.world },
              local: { ...point.local },
              snap: 'path' as const,
              vertexIndex: point.vertexIndex ?? null,
              edge: point.edge ?? null,
              faceIndex: point.faceIndex ?? hit.faceIndex,
            }
          }
        }
      }

      return {
        objectId: hit.objectId,
        world: hit.world,
        local: hit.local,
        snap: hit.snap,
        vertexIndex: hit.vertexIndex,
        edge: hit.edge,
        faceIndex: hit.faceIndex,
      }
    },
    []
  )

  /** @deprecated Prefer resolveKnifeHit — kept for bend tool reuse of mesh picking. */
  const resolveKnifeWorld = useCallback(
    (clientX: number, clientY: number, preferredId: string | null, shiftKey = false) => {
      const hit = resolveKnifeHit(clientX, clientY, preferredId, shiftKey)
      if (hit) return { objectId: hit.objectId, world: hit.world }

      // Bend still allows off-mesh axis placement via camera plane.
      const rect = containerRef.current?.getBoundingClientRect()
      const camera = cameraRef.current
      if (!rect || !camera) return null

      const store = useAppStore.getState()
      const targetId =
        preferredId ??
        store.selectedObjectId ??
        (store.selectionObjectIds.length === 1 ? store.selectionObjectIds[0] : null)
      if (!targetId) return null

      const obj = store.objects.find((o) => o.id === targetId)
      const tr = obj ? ensureTransform(obj).position : { x: 0, y: defaultDepth, z: 0 }
      const through = new Vector3(tr.x, tr.y, tr.z)
      const plane = buildCameraDragPlane(camera, through)
      const planeHit = clientToCameraPlane(clientX, clientY, rect, camera, plane)
      if (!planeHit) return null
      return { objectId: targetId, world: { x: planeHit.x, y: planeHit.y, z: planeHit.z } }
    },
    [defaultDepth, resolveKnifeHit]
  )

  const getObjectDragDelta = useCallback(
    (e: React.PointerEvent, drag: ObjectDragState): Vec3 | null =>
      dragDeltaFromPointer(
        e,
        drag,
        defaultDepth,
        getPlanePoint,
        containerRef,
        cameraRef
      ),
    [defaultDepth, getPlanePoint]
  )

  const getComponentDragDelta = useCallback(
    (e: React.PointerEvent, drag: ComponentDragState): Vec3 | null =>
      dragDeltaFromPointer(
        e,
        drag,
        defaultDepth,
        getPlanePoint,
        containerRef,
        cameraRef
      ),
    [defaultDepth, getPlanePoint]
  )

  const beginComponentDrag = useCallback(
    (
      e: React.PointerEvent,
      basePositions: Record<number, Vec3>,
      throughPoint: Vec3
    ): boolean => {
      const rect = containerRef.current?.getBoundingClientRect()
      const camera = cameraRef.current
      if (!rect || !camera) return false

      if (view === 'perspective') {
        const camDrag = beginCameraPlaneDrag(
          e.clientX,
          e.clientY,
          rect,
          camera,
          throughPoint
        )
        if (!camDrag) return false
        componentDragRef.current = {
          view,
          basePositions,
          startWorld: camDrag.startWorld,
          dragPlane: camDrag.dragPlane,
          moved: false,
        }
        return true
      }

      const pt = getPlanePoint(e)
      if (!pt) return false
      componentDragRef.current = { view, basePositions, startPlane: pt, moved: false }
      return true
    },
    [view, getPlanePoint]
  )

  const tryBeginMeshSelectionDrag = useCallback(
    (
      e: React.PointerEvent,
      meshSelection: MeshComponentSelection,
      obj: SceneObject
    ): boolean => {
      if (obj.topologyLocked) return false

      const verts = getAffectedVertices(meshSelection, obj)
      const basePositions: Record<number, Vec3> = {}
      for (const vi of verts) {
        basePositions[vi] = { ...obj.positions[vi] }
      }
      const through = meshSelectionWorldCenter(obj, meshSelection)
      return beginComponentDrag(e, basePositions, through)
    },
    [beginComponentDrag]
  )

  const beginObjectDrag = useCallback(
    (
      e: React.PointerEvent,
      baseTransforms: Record<string, ObjectTransform>,
      throughPoint: Vec3
    ): boolean => {
      const rect = containerRef.current?.getBoundingClientRect()
      const camera = cameraRef.current
      if (!rect || !camera) return false

      if (view === 'perspective') {
        const camDrag = beginCameraPlaneDrag(
          e.clientX,
          e.clientY,
          rect,
          camera,
          throughPoint
        )
        if (!camDrag) return false
        selectDragRef.current = {
          view,
          baseTransforms,
          startWorld: camDrag.startWorld,
          dragPlane: camDrag.dragPlane,
          moved: false,
        }
        return true
      }

      const pt = getPlanePoint(e)
      if (!pt) return false
      selectDragRef.current = { view, baseTransforms, startPlane: pt, moved: false }
      return true
    },
    [view, getPlanePoint]
  )

  const tryBeginSelectionObjectDrag = useCallback(
    (e: React.PointerEvent): boolean => {
      const store = useAppStore.getState()
      if (store.selectionObjectIds.length === 0) return false
      const baseTransforms: Record<string, ObjectTransform> = {}
      for (const id of store.selectionObjectIds) {
        const obj = store.objects.find((o) => o.id === id)
        if (obj) baseTransforms[id] = cloneTransform(ensureTransform(obj))
      }
      const center = selectionWorldCenter(store.objects, store.selectionObjectIds)
      return beginObjectDrag(e, baseTransforms, center)
    },
    [beginObjectDrag]
  )

  const resolveObjectClickSelection = useCallback(
    (picked: string, shiftKey: boolean): boolean => {
      if (shiftKey) {
        selectObject(picked, { additive: true })
        return false
      }
      const store = useAppStore.getState()
      if (!store.selectionObjectIds.includes(picked)) {
        selectObject(picked, { additive: false })
      }
      return true
    },
    [selectObject]
  )

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      const store = useAppStore.getState()
      if (store.meshModal || store.objectTransformModal) return

      if ((store.activeTool === 'knife' || store.activeTool === 'mirror-knife') && e.button === 2) {
        e.preventDefault()
        e.stopPropagation()
        if (store.knifeDraft?.points.length || store.knifeDraft?.completedPaths?.length) {
          store.knifeCancel()
        } else {
          store.activateSelectTool()
        }
        return
      }

      if (store.activeTool === 'loop-cut' && e.button === 2) {
        if (store.loopCutDraft) {
          e.preventDefault()
          e.stopPropagation()
          if (store.loopCutDraft.locked) {
            store.loopCutSetT(0.5)
            store.loopCutBegin(store.loopCutDraft.objectId, store.loopCutDraft.seedEdge, false)
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
              e.currentTarget.releasePointerCapture(e.pointerId)
            }
          } else {
            store.loopCutCancel()
            store.activateSelectTool()
          }
          return
        }
      }

      if (e.button === 0) beginPointerInteraction()
      if (
        e.button === 1 &&
        store.activeTool === 'primitive-box' &&
        view === 'perspective' &&
        store.primitiveBoxDraft?.phase === 'scrollHeight' &&
        store.primitiveBoxDraft.baseView === 'perspective'
      ) {
        e.preventDefault()
        e.stopPropagation()
        commitPrimitiveBox()
        return
      }

      if (e.button === 1) return
      if (view === 'perspective' && e.button === 2) return
      onActivate()

      const rect = containerRef.current?.getBoundingClientRect()
      const camera = cameraRef.current

      if (
        e.button === 0 &&
        store.pixelEditorOpen &&
        store.pixelEditorPaintOnModel &&
        rect &&
        camera
      ) {
        const selectedPaintObject = selectedObjectId
          ? objects.find((object) => object.id === selectedObjectId)
          : null
        let hit = selectedPaintObject
          ? pickObjectSurfaceUv(e.clientX, e.clientY, rect, camera, selectedPaintObject)
          : pickMeshSurfaceUv(e.clientX, e.clientY, rect, camera, objects, null)
        if (hit) {
          const hitObj = objects.find((o) => o.id === hit.objectId)
          const mat = hitObj ? resolveEffectiveMaterial(hitObj) : null
          const docId = mat?.textureId ?? hitObj?.id
          const doc = docId ? store.pixelDocuments[docId] : undefined
          if (mat?.mode === 'texture' && docId && doc) {
            // Clicking a different textured selected object makes its texture the
            // active document instead of silently ignoring the stroke.
            if (store.pixelEditorDocId !== docId) {
              store.openPixelEditor({ linkObjectId: hit.objectId, paintOnModel: true })
            }
            e.currentTarget.setPointerCapture(e.pointerId)
            e.preventDefault()
            e.stopPropagation()
            const px = uvToPixelCoords(hit.uv, doc.width, doc.height)
            const pixelTool = store.pixelEditorTool

            if (pixelTool === 'eyedropper') {
              store.paintOnModelEyedropper(docId, px.x, px.y)
              return
            }
            if (pixelTool === 'bucket') {
              store.paintOnModelBucket(docId, px.x, px.y, e.altKey)
              return
            }
            if (pixelTool === 'line' || pixelTool === 'rectangle' || pixelTool === 'ellipse') {
              store.beginPixelEdit()
              pixelShapeRef.current = {
                docId,
                objectId: hit.objectId,
                tool: pixelTool,
                x0: px.x,
                y0: px.y,
                x1: px.x,
                y1: px.y,
              }
              return
            }
            if (pixelTool !== 'pencil' && pixelTool !== 'paintBrush' && pixelTool !== 'eraser') return

            store.beginPixelEdit()
            store.paintOnModelPixel(docId, px.x, px.y)
            pixelPaintRef.current = {
              docId,
              objectId: hit.objectId,
              lastX: e.clientX,
              lastY: e.clientY,
              hint: {
                objectId: hit.objectId,
                faceIndex: hit.faceIndex,
                triIndex: hit.triIndex,
              },
            }
            return
          }
        }
      }

      if (
        e.button === 0 &&
        e.ctrlKey &&
        !e.altKey &&
        rect &&
        camera &&
        isBoxSelectInteraction(selectionMode, activeTool)
      ) {
        e.currentTarget.setPointerCapture(e.pointerId)
        marqueeStartRef.current = {
          x: e.clientX,
          y: e.clientY,
          additive: e.shiftKey,
        }
        setMarqueeRect({
          x0: e.clientX,
          y0: e.clientY,
          x1: e.clientX,
          y1: e.clientY,
        })
        return
      }

      if (e.altKey && e.button === 0 && rect && camera) {
        const picked = pickObjectAt(e.clientX, e.clientY, rect, camera, slotIndex)
        if (picked) {
          selectObject(picked, { additive: e.shiftKey })
          return
        }
      }

      if (
        selectionMode === 'object' &&
        TRANSFORM_GIZMO_TOOLS.includes(activeTool) &&
        e.button === 0 &&
        rect &&
        camera
      ) {
        const picked = pickObjectAt(e.clientX, e.clientY, rect, camera, slotIndex)
        if (picked) {
          const canDrag = resolveObjectClickSelection(picked, e.shiftKey)
          if (canDrag && activeTool === 'move' && !e.shiftKey) {
            if (tryBeginSelectionObjectDrag(e)) {
              e.currentTarget.setPointerCapture(e.pointerId)
            }
          }
        } else if (!e.shiftKey) {
          selectObject(null)
          selectBillboardImage(null)
          selectReferenceImage(null)
        }
        return
      }

      if (isComponentSelectionMode(selectionMode) && e.button === 0 && rect && camera) {
        const store = useAppStore.getState()

        if (canPickComponentSelection(activeTool)) {
          camera.updateMatrixWorld()
          if (
            'updateProjectionMatrix' in camera &&
            typeof camera.updateProjectionMatrix === 'function'
          ) {
            camera.updateProjectionMatrix()
          }

          const hit = pickMeshComponent(
            selectionMode,
            e.clientX,
            e.clientY,
            rect,
            camera,
            objects,
            store.meshSelection?.objectId ?? selectedObjectId,
            { cullBackVertices: !viewportXRay }
          )

          const hasComponent =
            hit &&
            (hit.vertex !== undefined || hit.edge !== undefined || hit.face !== undefined)

          if (hasComponent && hit) {
            const obj = store.objects.find((o) => o.id === hit.objectId)
            const sel = store.meshSelection
            const hitSelected =
              obj &&
              sel &&
              selectionHasComponents(sel) &&
              isHitInMeshSelection(hit, sel, selectionMode, obj)

            if (
              canDragComponentSelection(activeTool) &&
              hitSelected &&
              !e.shiftKey &&
              obj &&
              tryBeginMeshSelectionDrag(e, sel, obj)
            ) {
              e.currentTarget.setPointerCapture(e.pointerId)
              return
            }

            applyMeshPick(hit, e.shiftKey)

            if (
              viewportDisplayMode === 'normals' &&
              e.altKey &&
              !e.shiftKey &&
              selectionMode === 'face' &&
              hit.face !== undefined
            ) {
              flipFaceNormal(hit.objectId, hit.face)
              return
            }

            // Free-drag after pick only for select/move; rotate/scale use the gizmo.
            if (!e.shiftKey && obj && canDragComponentSelection(activeTool)) {
              const selAfter = useAppStore.getState().meshSelection
              if (
                selAfter &&
                selectionHasComponents(selAfter) &&
                tryBeginMeshSelectionDrag(e, selAfter, obj)
              ) {
                e.currentTarget.setPointerCapture(e.pointerId)
              }
            }
          } else {
            const sel = store.meshSelection
            const pickedObjectId = pickObjectAt(e.clientX, e.clientY, rect, camera, slotIndex)
            const obj =
              sel && selectionHasComponents(sel)
                ? store.objects.find((o) => o.id === sel.objectId)
                : null

            if (
              !e.shiftKey &&
              canDragComponentSelection(activeTool) &&
              sel &&
              obj &&
              pickedObjectId === sel.objectId &&
              tryBeginMeshSelectionDrag(e, sel, obj)
            ) {
              e.currentTarget.setPointerCapture(e.pointerId)
              return
            }

            boxSelectPendingRef.current = {
              x: e.clientX,
              y: e.clientY,
              additive: e.shiftKey,
            }
            e.currentTarget.setPointerCapture(e.pointerId)
          }
          return
        }
      }

      e.currentTarget.setPointerCapture(e.pointerId)

      if (
        selectionMode === 'object' &&
        activeTool === 'select-object' &&
        e.button === 0 &&
        rect &&
        camera
      ) {
        const picked = pickObjectAt(e.clientX, e.clientY, rect, camera, slotIndex)

        if (picked) {
          if (e.shiftKey) {
            selectObject(picked, { additive: true })
            return
          }
          const store = useAppStore.getState()
          if (!store.selectionObjectIds.includes(picked)) {
            selectObject(picked, { additive: false })
          }
          tryBeginSelectionObjectDrag(e)
          return
        }

        boxSelectPendingRef.current = {
          x: e.clientX,
          y: e.clientY,
          additive: e.shiftKey,
        }
        return
      }

      if (activeTool === 'loop-cut' && e.button === 0 && rect && camera) {
        const store = useAppStore.getState()
        if (store.loopCutDraft) {
          if (!store.loopCutDraft.locked) {
            loopCutBegin(store.loopCutDraft.objectId, store.loopCutDraft.seedEdge, true)
            e.currentTarget.setPointerCapture(e.pointerId)
          } else {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
              e.currentTarget.releasePointerCapture(e.pointerId)
            }
            loopCutCommit()
          }
          return
        }
        camera.updateMatrixWorld()
        const hit = pickMeshComponent(
          'edge',
          e.clientX,
          e.clientY,
          rect,
          camera,
          store.objects,
          store.selectedObjectId
        )
        if (hit?.edge) {
          loopCutBegin(hit.objectId, edgeKey(hit.edge[0], hit.edge[1]), true)
          selectObject(hit.objectId)
          e.currentTarget.setPointerCapture(e.pointerId)
        }
        return
      }

      if ((activeTool === 'knife' || activeTool === 'mirror-knife') && e.button === 0 && rect && camera) {
        const store = useAppStore.getState()
        const preferred =
          store.knifeDraft?.objectId ??
          store.selectedObjectId ??
          (store.selectionObjectIds.length === 1 ? store.selectionObjectIds[0] : null)
        const hit = resolveKnifeHit(e.clientX, e.clientY, preferred, e.shiftKey, e.ctrlKey || e.metaKey)
        if (!hit) return
        e.currentTarget.setPointerCapture(e.pointerId)
        selectObject(hit.objectId)
        const now = performance.now()
        const previousClick = knifeClickRef.current
        const isDoubleClick =
          store.knifeDraft?.objectId === hit.objectId &&
          store.knifeDraft.points.length >= 1 &&
          now - previousClick.t < 350 &&
          Math.hypot(e.clientX - previousClick.x, e.clientY - previousClick.y) < 10

        let targetHit = { ...hit }
        const draft = store.knifeDraft
        const lastPt = draft?.points && draft.points.length > 0 ? draft.points[draft.points.length - 1] : null

        if (draft?.angleConstrained && lastPt && camera && rect) {
          const project = (w: Vec3) => {
            const temp = new Vector3(w.x, w.y, w.z).project(camera)
            const x = rect.left + (temp.x * 0.5 + 0.5) * rect.width
            const y = rect.top + (-temp.y * 0.5 + 0.5) * rect.height
            return { x, y }
          }
          const unproject = (sx: number, sy: number) => {
            const obj = store.objects.find((o) => o.id === draft.objectId)
            const tr = obj ? ensureTransform(obj).position : { x: 0, y: 0, z: 0 }
            const through = new Vector3(tr.x, tr.y, tr.z)
            const plane = buildCameraDragPlane(camera, through)
            const pt = clientToCameraPlane(sx, sy, rect, camera, plane)
            return pt ? { x: pt.x, y: pt.y, z: pt.z } : null
          }

          const constrainedWorld = constrainKnifeEndWorld(
            lastPt.world,
            targetHit.world,
            project,
            unproject,
            true
          )

          const obj = store.objects.find((o) => o.id === draft.objectId)
          const constrainedLocal = obj ? localPointFromWorld(obj, constrainedWorld) : { ...constrainedWorld }
          targetHit.world = constrainedWorld
          targetHit.local = constrainedLocal
        }

        knifeAddPoint(
          targetHit.objectId,
          {
            world: targetHit.world,
            local: targetHit.local,
            snap: targetHit.snap,
            vertexIndex: targetHit.vertexIndex,
            edge: targetHit.edge,
            faceIndex: targetHit.faceIndex,
          },
          view,
          getCameraViewForward(camera),
          { x: camera.position.x, y: camera.position.y, z: camera.position.z }
        )
        if (isDoubleClick) {
          knifeClickRef.current = { t: 0, x: 0, y: 0 }
          knifeApply(getCameraViewForward(camera))
        } else {
          knifeClickRef.current = { t: now, x: e.clientX, y: e.clientY }
        }
        return
      }

      if (activeTool === 'bend' && e.button === 0 && rect && camera) {
        const store = useAppStore.getState()
        const draft = store.bendDraft

        if (draft?.axisLocked) {
          const now = performance.now()
          const last = bendClickRef.current
          if (
            now - last.t < 350 &&
            Math.hypot(e.clientX - last.x, e.clientY - last.y) < 10
          ) {
            bendClickRef.current = { t: 0, x: 0, y: 0 }
            e.preventDefault()
            e.stopPropagation()
            bendCommit()
            return
          }
          bendClickRef.current = { t: now, x: e.clientX, y: e.clientY }
          e.currentTarget.setPointerCapture(e.pointerId)
          bendStartAngleDrag(e.clientX, e.clientY)
          return
        }

        const preferred =
          draft?.objectId ??
          store.selectedObjectId ??
          (store.selectionObjectIds.length === 1 ? store.selectionObjectIds[0] : null)
        const resolved = resolveKnifeWorld(e.clientX, e.clientY, preferred)
        if (!resolved) return
        e.currentTarget.setPointerCapture(e.pointerId)
        selectObject(resolved.objectId)
        if (!draft) {
          bendBegin(resolved.objectId, resolved.world, view, e.clientX, e.clientY)
        }
        bendPointerMove(resolved.world, e.clientX, e.clientY)
        return
      }

      if (activeTool === 'poly-draw' && e.button === 0) {
        const store = useAppStore.getState()
        const draftLen = store.polyDrawDraft?.points.length ?? 0
        const allowClose = store.polyDrawMode === 'poly' && draftLen >= 3
        const resolved = resolvePolyDrawAt(e.clientX, e.clientY, allowClose)
        if (!resolved) return

        const draft = store.polyDrawDraft
        if (store.polyDrawMode === 'poly' && draft && draft.points.length >= 3) {
          const now = performance.now()
          const snapToLast =
            resolved.snap?.kind === 'draft' &&
            resolved.snap.draftIndex === draft.points.length - 1
          if (snapToLast && now - store.lastPolyDrawClickAt < 320) {
            polyDrawFinish()
            return
          }
        }

        polyDrawClick(resolved.world, resolved.snap, view)
        return
      }

      if (activeTool === 'primitive-box' && view === 'perspective') {
        const draft = useAppStore.getState().primitiveBoxDraft
        const groundY = draft?.groundY ?? defaultDepth

        if (draft?.phase === 'scrollHeight' && draft.baseView === 'perspective') {
          const now = performance.now()
          const last = perspectiveHeightClickRef.current
          if (
            now - last.t < 350 &&
            Math.hypot(e.clientX - last.x, e.clientY - last.y) < 10
          ) {
            perspectiveHeightClickRef.current = { t: 0, x: 0, y: 0 }
            e.preventDefault()
            e.stopPropagation()
            commitPrimitiveBox()
            return
          }
          perspectiveHeightClickRef.current = { t: now, x: e.clientX, y: e.clientY }

          e.currentTarget.setPointerCapture(e.pointerId)
          e.preventDefault()
          e.stopPropagation()
          beginPointerInteraction()
          perspectiveHeightDragRef.current = {
            startY: e.clientY,
            startHeight: draft.scrollHeight ?? 4,
          }
          return
        }

        const ground = getGroundPoint(e.clientX, e.clientY, groundY)
        if (!ground) return
        e.currentTarget.setPointerCapture(e.pointerId)
        primitiveGestureViewRef.current = view
        primitiveBoxPointerDown({ x: 0, y: 0 }, view, e.shiftKey, ground)
        return
      }

      const pt = getPlanePoint(e)
      if (!pt) return

      if (activeTool === 'vector-pen' && view !== 'perspective') {
        // Double-click finalizes like Enter (Illustrator-style).
        if (e.detail >= 2) {
          const draft = useAppStore.getState().vectorPenDraft
          if (
            draft &&
            draft.view === view &&
            draft.pendingAnchorIndex === null &&
            draft.anchors.length >= (draft.closed ? 3 : 2)
          ) {
            e.preventDefault()
            e.stopPropagation()
            penFinishPath()
            return
          }
        }
        vectorGestureViewRef.current = view
        penPointerDown(pt, view)
        return
      }

      if (activeTool === 'primitive-box' && view !== 'perspective') {
        e.currentTarget.setPointerCapture(e.pointerId)
        primitiveGestureViewRef.current = view
        primitiveBoxPointerDown(pt, view, e.shiftKey)
        return
      }

      if (activeTool === 'vector-shape' && view !== 'perspective') {
        vectorGestureViewRef.current = view
        startVectorStroke(pt, view)
        return
      }

      if (DRAW_TOOLS.includes(activeTool)) {
        if (view === 'perspective') {
          const frame = beginPerspectiveStrokeFrame()
          if (!frame) return
          const pt = getDrawPlanePoint(e, frame)
          if (!pt) return
          strokeGestureViewRef.current = view
          startStroke(pt, view, frame)
        } else {
          const pt = getPlanePoint(e)
          if (!pt) return
          strokeGestureViewRef.current = view
          startStroke(pt, view)
        }
        if (useAppStore.getState().sketchExtrudeMode) {
          beginExtrudeDrag(e.clientX, e.clientY)
        }
        return
      }

      const sculptTool: SculptTool | null = e.shiftKey
        ? 'relax'
        : SCULPT_TOOLS.includes(activeTool)
          ? (activeTool as SculptTool)
          : null

      if (sculptTool) {
        applySculptAt(planeToWorld3D(pt.x, pt.y, view, defaultDepth), sculptTool, {
          saveHistory: true,
        })
      }
    },
    [
      onActivate,
      activeTool,
      selectionMode,
      view,
      defaultDepth,
      objects,
      selectedObjectId,
      startStroke,
      beginExtrudeDrag,
      applySculptAt,
      commitPrimitiveBox,
      getPlanePoint,
      getDrawPlanePoint,
      getGroundPoint,
      beginPerspectiveStrokeFrame,
      selectObject,
      selectBillboardImage,
      selectReferenceImage,
      applyMeshPick,
      clearMeshSelection,
      flipFaceNormal,
      viewportDisplayMode,
      startVectorStroke,
      penPointerDown,
      penFinishPath,
      primitiveBoxPointerDown,
      getGroundPoint,
      resolvePolyDrawAt,
      polyDrawClick,
      polyDrawFinish,
      beginObjectDrag,
      tryBeginMeshSelectionDrag,
      commitHistory,
      beginPointerInteraction,
      resolveKnifeHit,
      knifeAddPoint,
      knifeApply,
    ]
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (useAppStore.getState().meshModal || useAppStore.getState().objectTransformModal) return
      if (e.buttons === 4) return

      if (pixelShapeRef.current && (e.buttons & 1) === 1) {
        const rect = containerRef.current?.getBoundingClientRect()
        const camera = cameraRef.current
        const shape = pixelShapeRef.current
        if (rect && camera) {
          const store = useAppStore.getState()
          const doc = store.pixelDocuments[shape.docId]
          if (doc) {
            const px = pickPixelOnTexturedMesh(
              e.clientX,
              e.clientY,
              rect,
              camera,
              objects,
              shape.objectId,
              shape.docId,
              doc.width,
              doc.height
            )
            if (px) {
              pixelShapeRef.current = { ...shape, x1: px.x, y1: px.y }
            }
          }
        }
        return
      }

      if (pixelPaintRef.current) {
        const rect = containerRef.current?.getBoundingClientRect()
        const camera = cameraRef.current
        const paint = pixelPaintRef.current
        if (rect && camera) {
          const store = useAppStore.getState()
          const doc = store.pixelDocuments[paint.docId]
          const obj = objects.find((o) => o.id === paint.objectId)
          if (doc && obj) {
            const pixelTool = store.pixelEditorTool
            if (pixelTool !== 'pencil' && pixelTool !== 'paintBrush' && pixelTool !== 'eraser') return

            const brushSize = Math.max(1, store.pixelEditorBrushSize)
            const anchor = pickObjectSurfaceUv(
              paint.lastX,
              paint.lastY,
              rect,
              camera,
              obj,
              paint.hint
            )
            const texelStep = anchor
              ? estimateTexelScreenSize(anchor, obj, camera, rect, doc.width, doc.height)
              : 4
            // Step by at least ~brush spacing so we do not raycast every screen pixel.
            const step = Math.max(texelStep, brushSize * 0.35, 2)
            const samples = interpolateScreenPaintSamples(
              paint.lastX,
              paint.lastY,
              e.clientX,
              e.clientY,
              step
            )
            const points: { x: number; y: number }[] = []
            let hint = paint.hint
            if (anchor) {
              points.push(uvToPixelCoords(anchor.uv, doc.width, doc.height))
              hint = {
                objectId: anchor.objectId,
                faceIndex: anchor.faceIndex,
                triIndex: anchor.triIndex,
              }
            }
            // Skip sample 0 — already covered by the warm-started anchor pick.
            for (let si = anchor ? 1 : 0; si < samples.length; si++) {
              const s = samples[si]!
              const h = pickObjectSurfaceUv(s.x, s.y, rect, camera, obj, hint)
              if (!h || h.objectId !== paint.objectId) continue
              points.push(uvToPixelCoords(h.uv, doc.width, doc.height))
              hint = {
                objectId: h.objectId,
                faceIndex: h.faceIndex,
                triIndex: h.triIndex,
              }
            }
            if (points.length > 0) {
              // Commit texels immediately so both the Pixel Editor canvas and the
              // shared texture buffer change during this pointer event. GPU work
              // remains safely coalesced by pixelPreview.
              if (points.length >= 2) {
                store.paintDocumentStroke(paint.docId, points, { syncGpu: true })
              } else {
                store.paintDocumentStroke(paint.docId, points, {
                  syncGpu: true,
                  restart: true,
                })
              }
            }
            pixelPaintRef.current = {
              ...paint,
              lastX: e.clientX,
              lastY: e.clientY,
              hint,
            }
          }
        }
        return
      }

      if (componentDragRef.current && (e.buttons & 1) === 1 && !marqueeStartRef.current && !boxSelectPendingRef.current) {
        const drag = componentDragRef.current
        const delta = getComponentDragDelta(e, drag)
        if (delta) {
          drag.moved = true
          translateMeshSelection(delta, drag.basePositions)
        }
        return
      }

      if (selectDragRef.current && selectionMode === 'object' && (e.buttons & 1) === 1 && !marqueeStartRef.current && !boxSelectPendingRef.current) {
        const drag = selectDragRef.current
        const delta = getObjectDragDelta(e, drag)
        if (delta) {
          drag.moved = true
          translateSelectionByDelta(delta, drag.baseTransforms)
        }
        return
      }

      if (boxSelectPendingRef.current && (e.buttons & 1) === 1 && !marqueeStartRef.current) {
        const pending = boxSelectPendingRef.current
        const dx = Math.abs(e.clientX - pending.x)
        const dy = Math.abs(e.clientY - pending.y)
        if (dx > 4 || dy > 4) {
          boxSelectPendingRef.current = null
          marqueeStartRef.current = {
            x: pending.x,
            y: pending.y,
            additive: pending.additive,
          }
          setMarqueeRect({
            x0: pending.x,
            y0: pending.y,
            x1: e.clientX,
            y1: e.clientY,
          })
        }
        return
      }

      if (marqueeStartRef.current && (e.buttons & 1) === 1) {
        setMarqueeRect({
          x0: marqueeStartRef.current.x,
          y0: marqueeStartRef.current.y,
          x1: e.clientX,
          y1: e.clientY,
        })
        return
      }

      if (
        (e.buttons & 1) === 0 &&
        !componentDragRef.current &&
        !marqueeStartRef.current &&
        ((isComponentSelectionMode(selectionMode) && canPickComponentSelection(activeTool)) ||
          MESH_EDIT_TOOLS.includes(activeTool) ||
          DEFORM_TOOLS.includes(activeTool))
      ) {
        scheduleMeshHoverPick(e.clientX, e.clientY)
      }

      const store = useAppStore.getState()
      const rect = containerRef.current?.getBoundingClientRect()
      const camera = cameraRef.current

      if (store.activeTool === 'loop-cut' && rect && camera) {
        const draft = store.loopCutDraft
        if (!draft || !draft.locked) {
          const preferred = draft?.objectId ?? store.selectedObjectId
          const hit = pickMeshComponent(
            'edge',
            e.clientX,
            e.clientY,
            rect,
            camera,
            store.objects,
            preferred
          )
          if (hit?.edge) {
            loopCutBegin(hit.objectId, edgeKey(hit.edge[0], hit.edge[1]), false)
          } else {
            if (draft) {
              store.loopCutCancel()
            }
          }
        } else {
          const obj = store.objects.find((o) => o.id === draft.objectId)
          if (obj) {
            const [vA, vB] = parseEdgeKey(draft.seedEdge)
            if (vA < obj.positions.length && vB < obj.positions.length) {
              const worldA = worldPointFromObject(obj, obj.positions[vA]!)
              const worldB = worldPointFromObject(obj, obj.positions[vB]!)

              const project = (w: Vec3) => {
                const temp = new Vector3(w.x, w.y, w.z).project(camera)
                const x = rect.left + (temp.x * 0.5 + 0.5) * rect.width
                const y = rect.top + (-temp.y * 0.5 + 0.5) * rect.height
                return { x, y }
              }

              const projA = project(worldA)
              const projB = project(worldB)

              const AB = { x: projB.x - projA.x, y: projB.y - projA.y }
              const AM = { x: e.clientX - projA.x, y: e.clientY - projA.y }
              const dot = AM.x * AB.x + AM.y * AB.y
              const lenSq = AB.x * AB.x + AB.y * AB.y
              let t = lenSq > 1 ? dot / lenSq : 0.5
              t = Math.max(0.01, Math.min(0.99, t))
              store.loopCutSetT(t)
            }
          }
        }
        return
      }

      if (store.activeTool === 'knife' || store.activeTool === 'mirror-knife') {
        const preferred =
          store.knifeDraft?.objectId ??
          store.selectedObjectId ??
          (store.selectionObjectIds.length === 1 ? store.selectionObjectIds[0] : null)
        const hit = resolveKnifeHit(e.clientX, e.clientY, preferred, e.shiftKey, e.ctrlKey || e.metaKey)
        if (hit) {
          let targetHit = { ...hit }
          const draft = store.knifeDraft
          const lastPt = draft?.points && draft.points.length > 0 ? draft.points[draft.points.length - 1] : null

          if (draft?.angleConstrained && lastPt && cameraRef.current && rect) {
            const project = (w: Vec3) => {
              const temp = new Vector3(w.x, w.y, w.z).project(cameraRef.current!)
              const x = rect.left + (temp.x * 0.5 + 0.5) * rect.width
              const y = rect.top + (-temp.y * 0.5 + 0.5) * rect.height
              return { x, y }
            }
            const unproject = (sx: number, sy: number) => {
              const obj = store.objects.find((o) => o.id === draft.objectId)
              const tr = obj ? ensureTransform(obj).position : { x: 0, y: 0, z: 0 }
              const through = new Vector3(tr.x, tr.y, tr.z)
              const plane = buildCameraDragPlane(cameraRef.current!, through)
              const pt = clientToCameraPlane(sx, sy, rect, cameraRef.current!, plane)
              return pt ? { x: pt.x, y: pt.y, z: pt.z } : null
            }

            const constrainedWorld = constrainKnifeEndWorld(
              lastPt.world,
              targetHit.world,
              project,
              unproject,
              true
            )

            const obj = store.objects.find((o) => o.id === draft.objectId)
            const constrainedLocal = obj ? localPointFromWorld(obj, constrainedWorld) : { ...constrainedWorld }
            targetHit.world = constrainedWorld
            targetHit.local = constrainedLocal
          }

          knifeHover(
            targetHit.objectId,
            {
              world: targetHit.world,
              local: targetHit.local,
              snap: targetHit.snap,
              vertexIndex: targetHit.vertexIndex,
              edge: targetHit.edge,
              faceIndex: targetHit.faceIndex,
            },
            view,
            cameraRef.current
              ? getCameraViewForward(cameraRef.current)
              : { x: 0, y: 0, z: -1 },
            cameraRef.current
              ? { x: cameraRef.current.position.x, y: cameraRef.current.position.y, z: cameraRef.current.position.z }
              : undefined
          )
        } else {
          knifeClearHover()
        }
        return
      }

      if (store.activeTool === 'bend' && store.bendDraft && (e.buttons & 1) === 1) {
        const preferred = store.bendDraft.objectId ?? store.selectedObjectId
        const resolved = store.bendDraft.axisLocked
          ? null
          : resolveKnifeWorld(e.clientX, e.clientY, preferred, e.shiftKey)
        bendPointerMove(resolved?.world ?? null, e.clientX, e.clientY)
        return
      }

      if (perspectiveHeightDragRef.current && (e.buttons & 1) === 1) {
        const drag = perspectiveHeightDragRef.current
        const deltaPx = drag.startY - e.clientY
        setPrimitiveBoxScrollHeight(
          drag.startHeight + deltaPx * PERSPECTIVE_PRIMITIVE_HEIGHT_DRAG_SCALE
        )
        return
      }

      if (store.activeTool === 'poly-draw' && (e.buttons & 1) === 0) {
        const draftLen = store.polyDrawDraft?.points.length ?? 0
        const allowClose = store.polyDrawMode === 'poly' && draftLen >= 3
        const resolved = resolvePolyDrawAt(e.clientX, e.clientY, allowClose)
        if (resolved) {
          polyDrawPointerMove(resolved.world, resolved.highlight, resolved.snap)
        }
        return
      }

      if (
        store.activeTool === 'primitive-box' &&
        view === 'perspective' &&
        (e.buttons & 1) === 1 &&
        primitiveGestureViewRef.current === view &&
        store.primitiveBoxDraft?.phase === 'drawingBase'
      ) {
        const groundY = store.primitiveBoxDraft?.groundY ?? defaultDepth
        const ground = getGroundPoint(e.clientX, e.clientY, groundY)
        if (ground) {
          primitiveBoxPointerMove({ x: 0, y: 0 }, view, e.shiftKey, ground)
        }
        return
      }

      if (
        store.activeTool === 'primitive-box' &&
        view !== 'perspective' &&
        (e.buttons & 1) === 1 &&
        primitiveGestureViewRef.current === view
      ) {
        const pt = getPlanePoint(e)
        if (pt) primitiveBoxPointerMove(pt, view, e.shiftKey)
        return
      }

      const draftView = store.vectorDraftView ?? vectorGestureViewRef.current
      const strokeView = store.currentStrokeView ?? strokeGestureViewRef.current

      if (
        store.activeTool === 'vector-pen' &&
        view !== 'perspective' &&
        store.vectorPenDraft?.view === view
      ) {
        const pt = getPlanePoint(e)
        if (pt) penPointerMove(pt, { altKey: e.altKey })
        return
      }

      if (
        store.activeTool === 'vector-shape' &&
        view !== 'perspective' &&
        draftView === view &&
        store.vectorIsDrawing
      ) {
        const pt = getPlanePoint(e)
        if (pt) continueVectorStroke(pt)
        return
      }

      const pt = getPlanePoint(e)
      if (!pt) return

      const tool: SculptTool | ActiveTool = e.shiftKey ? 'relax' : activeTool
      if (
        (SCULPT_TOOLS.includes(tool as ActiveTool) || e.shiftKey) &&
        e.buttons === 1
      ) {
        const now = performance.now()
        if (now - lastSculptRef.current < 16) return
        lastSculptRef.current = now
        applySculptAt(
          planeToWorld3D(pt.x, pt.y, view, defaultDepth),
          (e.shiftKey ? 'relax' : tool) as SculptTool,
          { saveHistory: false }
        )
        return
      }

      if (
        DRAW_TOOLS.includes(store.activeTool) &&
        strokeView === view &&
        store.isDrawing
      ) {
        const drawPt = getDrawPlanePoint(e)
        if (!drawPt) return
        if (store.sketchExtrudeMode && store.extrudeDragAnchor) {
          updateExtrudeFromPointer(e.clientX, e.clientY)
        }
        if ((e.buttons & 1) === 1) {
          continueStroke(drawPt)
        } else {
          setStrokePreview(drawPt)
        }
        return
      }
    },
    [view, defaultDepth, activeTool, selectionMode, objects, selectedObjectId, continueStroke, continueVectorStroke, applySculptAt, getPlanePoint, getDrawPlanePoint, getGroundPoint, resolvePolyDrawAt, getObjectDragDelta, getComponentDragDelta, translateSelectionByDelta, translateMeshSelection, penPointerMove, scheduleMeshHoverPick, primitiveBoxPointerMove, polyDrawPointerMove, setStrokePreview, updateExtrudeFromPointer, resolveKnifeWorld, resolveKnifeHit, knifeHover, knifeClearHover, setPrimitiveBoxScrollHeight]
  )

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      try {
      if (useAppStore.getState().meshModal || useAppStore.getState().objectTransformModal) return
      if (e.button === 1) return

      const store = useAppStore.getState()
      if (pixelShapeRef.current) {
        const shape = pixelShapeRef.current
        const { x0, y0, x1, y1 } = constrainPixelShape(
          shape.tool,
          shape.x0,
          shape.y0,
          shape.x1,
          shape.y1,
          e.shiftKey
        )
        store.paintOnModelShape(shape.docId, shape.tool, x0, y0, x1, y1)
        store.commitPixelEdit()
        pixelShapeRef.current = null
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId)
        }
        return
      }
      if (pixelPaintRef.current) {
        store.commitPixelEdit()
        pixelPaintRef.current = null
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId)
        }
        return
      }
      if ((store.activeTool === 'knife' || store.activeTool === 'mirror-knife') && store.knifeDraft) {
        // Blockbench-style: clicks place points; Enter confirms. Pointer-up only releases capture.
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId)
        }
        return
      }

      if (store.activeTool === 'bend' && store.bendDraft) {
        if (!store.bendDraft.axisLocked) {
          bendPointerUp()
        }
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId)
        }
        endPointerInteraction()
        return
      }

      if (perspectiveHeightDragRef.current && e.button === 0) {
        perspectiveHeightDragRef.current = null
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId)
        }
        endPointerInteraction()
        return
      }

      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId)
      }

      const rect = containerRef.current?.getBoundingClientRect()
      const camera = cameraRef.current

      if (marqueeStartRef.current && rect && camera) {
        const start = marqueeStartRef.current
        const additive = start.additive
        const screenRect = {
          x0: start.x,
          y0: start.y,
          x1: e.clientX,
          y1: e.clientY,
        }
        const dx = Math.abs(e.clientX - start.x)
        const dy = Math.abs(e.clientY - start.y)

        if (dx > 4 || dy > 4) {
          if (selectionMode === 'object') {
            const ids = objectsInScreenRect(objects, screenRect, camera, rect)
            if (additive) addToObjectSelection(ids)
            else setSelection(ids)
          } else if (isComponentSelectionMode(selectionMode)) {
            const storeAtMarquee = useAppStore.getState()
            const targetId = resolveMarqueeMeshObjectId(
              objects,
              selectionMode,
              screenRect,
              camera,
              rect,
              {
                meshSelectionObjectId: storeAtMarquee.meshSelection?.objectId,
                selectedObjectId: storeAtMarquee.selectedObjectId,
                selectionObjectIds: storeAtMarquee.selectionObjectIds,
                startX: start.x,
                startY: start.y,
                endX: e.clientX,
                endY: e.clientY,
                slotIndex,
              },
              !viewportXRay
            )

            if (targetId) {
              const obj = objects.find((o) => o.id === targetId)
              if (obj) {
                const components = meshComponentsInScreenRect(
                  selectionMode,
                  obj,
                  screenRect,
                  camera,
                  rect,
                  !viewportXRay
                )
                applyMeshMarqueePick(targetId, components, additive)
              }
            }
          }
        } else if (selectionMode === 'object') {
          const picked = pickObjectAt(e.clientX, e.clientY, rect, camera, slotIndex)
          if (picked) {
            if (additive) addToObjectSelection([picked])
            else selectObject(picked)
          } else if (!additive) {
            selectObject(null)
          }
        } else if (isComponentSelectionMode(selectionMode)) {
          const hit = pickMeshComponent(
            selectionMode,
            e.clientX,
            e.clientY,
            rect,
            camera,
            objects,
            useAppStore.getState().meshSelection?.objectId ?? selectedObjectId,
            { cullBackVertices: !viewportXRay }
          )
          const hasComponent =
            hit &&
            (hit.vertex !== undefined ||
              hit.edge !== undefined ||
              hit.face !== undefined)
          if (hasComponent && hit) {
            applyMeshPick(hit, additive)
          } else if (!additive) {
            clearMeshSelection()
          }
        }

        marqueeStartRef.current = null
        setMarqueeRect(null)
        return
      }

      if (boxSelectPendingRef.current) {
        const pending = boxSelectPendingRef.current
        boxSelectPendingRef.current = null
        if (!pending.additive) {
          if (selectionMode === 'object') {
            selectObject(null)
            selectBillboardImage(null)
            selectReferenceImage(null)
          } else if (isComponentSelectionMode(selectionMode) && rect && camera) {
            clearMeshSelection()
            const pickedObjectId = pickObjectAt(e.clientX, e.clientY, rect, camera, slotIndex)
            if (pickedObjectId) selectObject(pickedObjectId)
          }
        }
        return
      }

      const storeAtUp = useAppStore.getState()
      const draftView = storeAtUp.vectorDraftView ?? vectorGestureViewRef.current
      const strokeView = storeAtUp.currentStrokeView ?? strokeGestureViewRef.current

      if (
        storeAtUp.activeTool === 'vector-pen' &&
        e.button === 0 &&
        storeAtUp.vectorPenDraft?.view === view
      ) {
        const pt = getPlanePoint(e)
        if (pt) penPointerUp(pt, { altKey: e.altKey })
      } else if (
        storeAtUp.activeTool === 'primitive-box' &&
        e.button === 0 &&
        primitiveGestureViewRef.current === view
      ) {
        if (view === 'perspective') {
          const groundY = storeAtUp.primitiveBoxDraft?.groundY ?? defaultDepth
          const ground = getGroundPoint(e.clientX, e.clientY, groundY)
          primitiveBoxPointerUp({ x: 0, y: 0 }, view, e.shiftKey, ground ?? undefined)
        } else {
          const pt = getPlanePoint(e)
          if (pt) primitiveBoxPointerUp(pt, view, e.shiftKey)
        }
        primitiveGestureViewRef.current = null
      } else if (
        storeAtUp.activeTool === 'vector-shape' &&
        e.button === 0 &&
        draftView === view &&
        storeAtUp.vectorIsDrawing
      ) {
        endVectorStroke(view)
      }
      if (
        DRAW_TOOLS.includes(storeAtUp.activeTool) &&
        e.button === 0 &&
        strokeView === view &&
        storeAtUp.isDrawing
      ) {
        endStroke(view)
      }

      if (e.button === 0) {
        if (selectDragRef.current?.moved) {
          commitHistory('Move selection')
        }
        if (componentDragRef.current?.moved) {
          commitHistory('Move components')
        }
        if (SCULPT_TOOLS.includes(storeAtUp.activeTool)) {
          clearSculptSession(storeAtUp.selectedObjectId ?? undefined)
        }
        selectDragRef.current = null
        componentDragRef.current = null
        vectorGestureViewRef.current = null
        strokeGestureViewRef.current = null
        primitiveGestureViewRef.current = null
      }
      } finally {
        if (e.button === 0) endPointerInteraction()
      }
    },
    [
      view,
      defaultDepth,
      endStroke,
      endVectorStroke,
      penPointerUp,
      primitiveBoxPointerUp,
      getPlanePoint,
      getGroundPoint,
      objects,
      selectionObjectIds,
      selectedObjectId,
      selectionMode,
      selectObject,
      setSelection,
      addToObjectSelection,
      applyMeshPick,
      applyMeshMarqueePick,
      clearMeshSelection,
      commitHistory,
      viewportXRay,
      endPointerInteraction,
    ]
  )

  const handlePointerLeave = useCallback(
    (e: React.PointerEvent) => {
      // A captured paint gesture continues to receive pointer events outside the
      // pane. Do not turn a normal boundary crossing into an early stroke end.
      if (
        (pixelPaintRef.current || pixelShapeRef.current) &&
        e.currentTarget.hasPointerCapture(e.pointerId)
      ) {
        return
      }
      if (perspectiveHeightDragRef.current) {
        perspectiveHeightDragRef.current = null
        endPointerInteraction()
      }
      handlePointerUp(e)
      setMeshHover(null)
      if (useAppStore.getState().activeTool === 'poly-draw') {
        clearPolyDrawHover()
      }
    },
    [handlePointerUp, setMeshHover, clearPolyDrawHover, endPointerInteraction]
  )

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      const store = useAppStore.getState()
      if (store.loopCutDraft && store.activeTool === 'loop-cut') {
        e.preventDefault()
        e.stopPropagation()
        if (store.loopCutDraft.locked) {
          loopCutAdjustWheel(e.deltaY)
        } else {
          const delta = e.deltaY > 0 ? -1 : 1
          store.loopCutAdjustCount(delta)
        }
        return
      }
      if (store.adjustRoundedBoxWheel(e.deltaY, e.shiftKey)) {
        e.preventDefault()
        e.stopPropagation()
        return
      }
      if (!perspectivePrimitiveScrollHeight) return
      e.preventDefault()
      e.stopPropagation()
      adjustPrimitiveBoxWheel(e.deltaY)
    },
    [
      perspectivePrimitiveScrollHeight,
      adjustPrimitiveBoxWheel,
      loopCutAdjustWheel,
    ]
  )

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      const store = useAppStore.getState()
      if (store.loopCutDraft && store.activeTool === 'loop-cut') {
        handleWheel(e)
      } else if (perspectivePrimitiveScrollHeight || roundedBoxParamWheel) {
        handleWheel(e)
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false, capture: true })
    return () => el.removeEventListener('wheel', onWheel, { capture: true })
  }, [perspectivePrimitiveScrollHeight, roundedBoxParamWheel, handleWheel])

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if ([...e.dataTransfer.types].includes('Files')) {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        setImageDragOver(true)
      }
    },
    []
  )

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      setImageDragOver(false)
      e.preventDefault()
      e.stopPropagation()
      const file = [...e.dataTransfer.files].find((f) => f.type.startsWith('image/'))
      if (!file) return

      const rect = containerRef.current?.getBoundingClientRect()
      const camera = cameraRef.current
      if (!rect || !camera) return

      // Object drops texture that mesh. Empty-space drops create a new editable
      // image plane (default), or a reference/billboard when that mode is selected.
      const objectId = pickObjectAt(e.clientX, e.clientY, rect, camera, slotIndex)
      if (objectId) {
        try {
          await loadObjectTexture(objectId, file)
          useAppStore.getState().selectObject(objectId)
          useAppStore.getState().setUvEditorOpen(true)
        } catch (err) {
          console.error(err)
        }
        return
      }

      if (imageDropMode === 'off') return

      const world = worldPointFromViewDrop({
        view,
        clientX: e.clientX,
        clientY: e.clientY,
        rect,
        camera,
        defaultDepth,
      })
      const referenceNorm = normalizedViewportPoint(e.clientX, e.clientY, rect)
      try {
        await dropImageInView(view, file, world, referenceNorm)
      } catch (err) {
        console.error(err)
      }
    },
    [imageDropMode, view, defaultDepth, dropImageInView, loadObjectTexture, slotIndex]
  )

  return {
    marqueeRect,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerLeave,
    handleWheel,
    handleDragOver,
    handleDragLeave: (e: React.DragEvent) => {
      if (e.currentTarget === e.target) setImageDragOver(false)
    },
    handleDrop,
    imageDragOver,
    perspectivePrimitiveScrollHeight,
    roundedBoxParamWheel,
  }
}
