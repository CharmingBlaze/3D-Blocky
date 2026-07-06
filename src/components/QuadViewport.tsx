import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { useRef, useCallback, useState, useLayoutEffect, useEffect } from 'react'
import { MOUSE, Vector3 } from 'three'
import type * as THREE from 'three'
import { subscribeViewportInteraction, popViewportInteraction, pushViewportInteraction } from '../rendering/viewportFrameLoop'

const _viewMoveRight = new Vector3()
const _viewMoveUp = new Vector3()
const _viewMoveForward = new Vector3()
import { useShallow } from 'zustand/react/shallow'
import { ObjectNode } from './ObjectNode'
import { MeshSelectionGizmo } from './MeshSelectionGizmo'
import { PrimitiveBoxCanvas } from './PrimitiveBoxCanvas'
import { PolyDrawVisuals } from './PolyDrawVisuals'
import { KnifeVisuals } from './KnifeVisuals'
import { LoopCutVisuals } from './LoopCutVisuals'
import { DrawVertexOverlay } from './DrawVertexOverlay'
import { StrokeCanvas } from './StrokeCanvas'
import { VectorCanvas } from './VectorCanvas'
import { MarqueeOverlay } from './MarqueeOverlay'
import { SymmetryPlaneOverlay } from './SymmetryPlaneOverlay'
import { SymmetryPlaneVisual } from './SymmetryPlaneVisual'
import { ReferenceImageOverlay } from './ReferenceImageOverlay'
import { BillboardImages } from './BillboardImages'
import { ViewportRenderContext, requestViewportFrame, useViewportRender } from './ViewportRenderContext'
import { ViewportDomContext } from './ViewportDomContext'
import { ViewportPointerPolicy } from './ViewportPointerPolicy'
import { ViewportGrid } from './ViewportGrid'
import { ViewportLighting } from './ViewportLighting'
import { WebGLContextHandler } from './WebGLContextHandler'
import { useAppStore, type ViewType, type ActiveTool, type SelectionMode } from '../store/appStore'
import { getViewportBackground } from '../theme/themes'
import {
  buildCameraDragPlane,
  clientToCameraPlane,
  clientToGroundPlane,
  clientToPlane,
  getCameraViewForward,
  planeToWorld3D,
} from '../utils/screenToWorld'
import { pickObjectAt, objectsInScreenRect } from '../select/objectPick'
import { meshComponentsInScreenRect, pickMeshComponent, pickKnifeHit, resolveMarqueeMeshObjectId, type MeshPickHit } from '../select/meshPick'
import { constrainKnifeEndWorld } from '../mesh/knifeUtils'
import {
  constrainPixelShape,
  estimateTexelScreenSize,
  interpolateScreenPaintSamples,
  pickMeshSurfaceUv,
  uvToPixelCoords,
  type PixelShapeTool,
} from '../pixel/uvPaint'
import { resolveEffectiveMaterial } from '../material/materials'
import { edgeKey, getAffectedVertices, meshSelectionWorldCenter, selectionHasComponents, type MeshComponentSelection } from '../mesh/meshSelection'
import { expandFaceToPlanarRegion } from '../mesh/faceGroups'
import type { SceneObject } from '../mesh/HalfEdgeMesh'
import type { Vec3 } from '../utils/math'
import type { SculptTool } from '../sculpt/sculptTools'
import { cloneTransform, ensureTransform, selectionWorldCenter } from '../mesh/objectTransform'
import type { ObjectTransform } from '../mesh/HalfEdgeMesh'
import { findPolyDrawSnapTarget, snapHighlightFromTarget } from '../polyDraw/polyDrawSnap'
import { resolveFreeClickWorld, workPlaneDepthForView } from '../polyDraw/polyDrawPlacement'
import {
  normalizedViewportPoint,
  worldPointFromViewDrop,
} from '../images/imageDropPlacement'
import type { PolyDrawPointSnap } from '../store/appStore'
import type { ViewportSlotIndex } from '../scene/viewTypes'
import type { SelectableViewType } from '../scene/viewTypes'
import { getCameraSetup } from '../scene/viewTypes'
import { ViewportViewPicker } from './ViewportViewPicker'

const DRAW_TOOLS: ActiveTool[] = ['draw', 'boolean-hole']
const VECTOR_TOOLS: ActiveTool[] = ['vector-pen', 'vector-shape', 'primitive-box', 'poly-draw']
const SCULPT_TOOLS: ActiveTool[] = ['push', 'pull', 'inflate', 'deflate', 'relax', 'pinch']
const TRANSFORM_GIZMO_TOOLS: ActiveTool[] = ['move', 'rotate', 'scale']
const MESH_SELECT_TOOLS: ActiveTool[] = ['select-vertex', 'select-edge', 'select-face']
const MESH_EDIT_TOOLS: ActiveTool[] = ['knife', 'loop-cut']

function isComponentSelectionMode(mode: SelectionMode): boolean {
  return mode === 'vertex' || mode === 'edge' || mode === 'face'
}

function isBoxSelectInteraction(mode: SelectionMode, tool: ActiveTool): boolean {
  if (mode === 'object') {
    return tool === 'select-object' || TRANSFORM_GIZMO_TOOLS.includes(tool)
  }
  return (
    isComponentSelectionMode(mode) &&
    (MESH_SELECT_TOOLS.includes(tool) || tool === 'move')
  )
}

function canDragComponentSelection(tool: ActiveTool): boolean {
  return MESH_SELECT_TOOLS.includes(tool) || tool === 'move'
}

function isHitInMeshSelection(
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

type DragPlaneState = {
  view: ViewType
  startPlane?: { x: number; y: number }
  startWorld?: Vec3
  dragPlane?: THREE.Plane
}

type ObjectDragState = DragPlaneState & {
  baseTransforms: Record<string, ObjectTransform>
  moved: boolean
}

type ComponentDragState = DragPlaneState & {
  basePositions: Record<number, Vec3>
  moved: boolean
}

function dragDeltaFromPointer(
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

function beginCameraPlaneDrag(
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

function ViewMoveBasisSync({ enabled }: { enabled: boolean }) {
  const setViewMoveBasis = useAppStore((s) => s.setViewMoveBasis)
  const lastBasisRef = useRef<{ right: { x: number; y: number; z: number }; up: { x: number; y: number; z: number } } | null>(null)

  useFrame(({ camera }) => {
    if (!enabled) return
    camera.matrixWorld.extractBasis(_viewMoveRight, _viewMoveUp, _viewMoveForward)

    const prev = lastBasisRef.current
    const next = {
      right: { x: _viewMoveRight.x, y: _viewMoveRight.y, z: _viewMoveRight.z },
      up: { x: _viewMoveUp.x, y: _viewMoveUp.y, z: _viewMoveUp.z },
    }
    if (
      prev &&
      Math.abs(prev.right.x - next.right.x) < 1e-4 &&
      Math.abs(prev.right.y - next.right.y) < 1e-4 &&
      Math.abs(prev.right.z - next.right.z) < 1e-4 &&
      Math.abs(prev.up.x - next.up.x) < 1e-4 &&
      Math.abs(prev.up.y - next.up.y) < 1e-4 &&
      Math.abs(prev.up.z - next.up.z) < 1e-4
    ) {
      return
    }
    lastBasisRef.current = next
    setViewMoveBasis(next)
  })

  useEffect(() => {
    if (!enabled) {
      lastBasisRef.current = null
      setViewMoveBasis(null)
    }
  }, [enabled, setViewMoveBasis])

  return null
}

interface QuadViewportProps {
  view: ViewType
  slotIndex: ViewportSlotIndex
  isActive: boolean
  onActivate: () => void
  /** False when hidden during maximize; canvas stays mounted either way. */
  layoutVisible: boolean
}

/** Request a draw when a dormant viewport becomes visible again. */
function ViewportDemandSync() {
  const { layoutVisible, continuousFrames } = useViewportRender()
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    requestViewportFrame(invalidate, layoutVisible, continuousFrames)
  }, [layoutVisible, continuousFrames, invalidate])
  return null
}

/** Keep demand-mode peer viewports in sync during store-driven edits. */
function ViewportSceneInvalidator({
  objects,
  themeId,
  meshSelection,
  viewportDisplayMode,
  facetExaggeration,
  showDensityHeatmap,
  pixelTextureRevision,
}: {
  objects: unknown
  themeId: unknown
  meshSelection: unknown
  viewportDisplayMode: unknown
  facetExaggeration: unknown
  showDensityHeatmap: unknown
  pixelTextureRevision: unknown
}) {
  const { layoutVisible, continuousFrames } = useViewportRender()
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    requestViewportFrame(invalidate, layoutVisible, continuousFrames)
  }, [
    objects,
    themeId,
    meshSelection,
    viewportDisplayMode,
    facetExaggeration,
    showDensityHeatmap,
    pixelTextureRevision,
    layoutVisible,
    continuousFrames,
    invalidate,
  ])
  return null
}

function applyOrthoCamera(view: ViewType, camera: THREE.Camera): void {
  if (view === 'perspective') return
  const setup = getCameraSetup(view)
  camera.up.set(setup.up[0], setup.up[1], setup.up[2])
  camera.lookAt(0, 0, 0)
  if ('updateProjectionMatrix' in camera && typeof camera.updateProjectionMatrix === 'function') {
    camera.updateProjectionMatrix()
  }
}

function ViewportControls({
  rootRef,
  view,
  enableZoom = true,
  disableMiddlePan = false,
}: {
  rootRef: React.RefObject<HTMLDivElement | null>
  view: ViewType
  enableZoom?: boolean
  disableMiddlePan?: boolean
}) {
  const { layoutVisible, continuousFrames } = useViewportRender()
  const invalidate = useThree((s) => s.invalidate)
  const [domElement, setDomElement] = useState<HTMLElement | null>(null)
  const isPerspective = view === 'perspective'

  useLayoutEffect(() => {
    if (rootRef.current) setDomElement(rootRef.current)
  }, [rootRef])

  useEffect(() => {
    return () => setDomElement(null)
  }, [])

  const handleControlsChange = useCallback(() => {
    requestViewportFrame(invalidate, layoutVisible, continuousFrames)
  }, [invalidate, layoutVisible, continuousFrames])

  const handleControlsStart = useCallback(() => {
    pushViewportInteraction()
  }, [])

  const handleControlsEnd = useCallback(() => {
    popViewportInteraction()
  }, [])

  if (!domElement) return null

  return (
    <OrbitControls
      domElement={domElement}
      makeDefault
      enableDamping={false}
      enableRotate={isPerspective}
      enablePan
      enableZoom={enableZoom}
      onChange={handleControlsChange}
      onStart={handleControlsStart}
      onEnd={handleControlsEnd}
      mouseButtons={{
        LEFT: undefined,
        MIDDLE: disableMiddlePan ? undefined : MOUSE.PAN,
        RIGHT: isPerspective ? MOUSE.ROTATE : undefined,
      }}
    />
  )
}

function pickPixelOnTexturedMesh(
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
  if (mat?.textureId !== docId) return null
  return uvToPixelCoords(hit.uv, docW, docH)
}

export function QuadViewport({ view, slotIndex, isActive, onActivate, layoutVisible }: QuadViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const cameraRef = useRef<THREE.Camera | null>(null)
  const lastSculptRef = useRef(0)
  const marqueeStartRef = useRef<{ x: number; y: number; additive: boolean } | null>(null)
  const boxSelectPendingRef = useRef<{ x: number; y: number; additive: boolean } | null>(null)
  const pixelPaintRef = useRef<{
    docId: string
    objectId: string
    lastX: number
    lastY: number
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
  const [interactionDom, setInteractionDom] = useState<HTMLElement | null>(null)

  const bindContainerRef = useCallback((node: HTMLDivElement | null) => {
    containerRef.current = node
    setInteractionDom(node)
  }, [])

  const {
    objects,
    selectedObjectId,
    selectionObjectIds,
    activeView,
    activeTool,
    selectionMode,
    meshSelection,
    facetExaggeration,
    showDensityHeatmap,
    viewportDisplayMode,
    viewportXRay,
    themeId,
    showGrid,
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
    startVectorStroke,
    continueVectorStroke,
    endVectorStroke,
    penPointerDown,
    penPointerMove,
    penPointerUp,
    primitiveBoxPointerDown,
    primitiveBoxPointerMove,
    primitiveBoxPointerUp,
    adjustPrimitiveBoxWheel,
    commitPrimitiveBox,
    primitiveBoxDraft,
    activePrimitiveKind,
    activeShapeKind,
    vectorIsDrawing,
    roundedBoxRoundness,
    roundedBoxSubdivisions,
    polyDrawClick,
    polyDrawPointerMove,
    polyDrawFinish,
    polyDrawSnapAllScene,
    clearPolyDrawHover,
    loopCutBegin,
    loopCutCommit,
    loopCutAdjustWheel,
    knifePointerDown,
    knifePointerMove,
    knifeCommit,
    imageDropMode,
    dropImageInView,
    selectedBillboardImageId,
    billboardImages,
    selectReferenceImage,
    selectBillboardImage,
    setActiveView,
    setViewportSlotView,
    pixelTextureRevision,
  } = useAppStore(
    useShallow((s) => ({
      objects: s.objects,
      selectedObjectId: s.selectedObjectId,
      selectionObjectIds: s.selectionObjectIds,
      activeView: s.activeView,
      activeTool: s.activeTool,
      selectionMode: s.selectionMode,
      meshSelection: s.meshSelection,
      facetExaggeration: s.facetExaggeration,
      showDensityHeatmap: s.showDensityHeatmap,
      viewportDisplayMode: s.viewportDisplayMode,
      viewportXRay: s.viewportXRay,
      themeId: s.themeId,
      showGrid: s.showGrid,
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
      startVectorStroke: s.startVectorStroke,
      continueVectorStroke: s.continueVectorStroke,
      endVectorStroke: s.endVectorStroke,
      penPointerDown: s.penPointerDown,
      penPointerMove: s.penPointerMove,
      penPointerUp: s.penPointerUp,
      primitiveBoxPointerDown: s.primitiveBoxPointerDown,
      primitiveBoxPointerMove: s.primitiveBoxPointerMove,
      primitiveBoxPointerUp: s.primitiveBoxPointerUp,
      adjustPrimitiveBoxWheel: s.adjustPrimitiveBoxWheel,
      commitPrimitiveBox: s.commitPrimitiveBox,
      primitiveBoxDraft: s.primitiveBoxDraft,
      activePrimitiveKind: s.activePrimitiveKind,
      activeShapeKind: s.activeShapeKind,
      vectorIsDrawing: s.vectorIsDrawing,
      roundedBoxRoundness: s.roundedBoxRoundness,
      roundedBoxSubdivisions: s.roundedBoxSubdivisions,
      polyDrawClick: s.polyDrawClick,
      polyDrawPointerMove: s.polyDrawPointerMove,
      polyDrawFinish: s.polyDrawFinish,
      polyDrawSnapAllScene: s.polyDrawSnapAllScene,
      clearPolyDrawHover: s.clearPolyDrawHover,
      loopCutBegin: s.loopCutBegin,
      loopCutCommit: s.loopCutCommit,
      loopCutAdjustWheel: s.loopCutAdjustWheel,
      knifePointerDown: s.knifePointerDown,
      knifePointerMove: s.knifePointerMove,
      knifeCommit: s.knifeCommit,
      imageDropMode: s.imageDropMode,
      dropImageInView: s.dropImageInView,
      selectedBillboardImageId: s.selectedBillboardImageId,
      billboardImages: s.billboardImages,
      selectReferenceImage: s.selectReferenceImage,
      selectBillboardImage: s.selectBillboardImage,
      setActiveView: s.setActiveView,
      setViewportSlotView: s.setViewportSlotView,
      pixelTextureRevision: s.pixelTextureRevision,
    }))
  )

  const [interactionActive, setInteractionActive] = useState(false)
  const pointerInteractionRef = useRef(false)

  useEffect(() => subscribeViewportInteraction(setInteractionActive), [])

  const continuousFrames = layoutVisible && (isActive || interactionActive)

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

  const handleSelectView = useCallback(
    (nextView: SelectableViewType) => {
      setViewportSlotView(slotIndex, nextView)
      if (isActive) setActiveView(nextView)
    },
    [slotIndex, isActive, setViewportSlotView, setActiveView]
  )

  const setup = getCameraSetup(view)
  const isOrtho = setup.orthographic
  const isActiveViewport = isActive && activeView === view
  const viewportBg = getViewportBackground(themeId, viewportDisplayMode)

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
          store.activeTool === 'loop-cut' || store.activeTool === 'knife'
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
          store.selectedObjectId,
          { cullBackVertices: !store.viewportXRay }
        )

        const hasComponent =
          hit &&
          (hit.vertex !== undefined || hit.edge !== undefined || hit.face !== undefined)

        store.setMeshHover(hasComponent ? hit : null)
      })
    },
    []
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

  const resolveKnifeWorld = useCallback(
    (clientX: number, clientY: number, preferredId: string | null, shiftKey = false) => {
      const rect = containerRef.current?.getBoundingClientRect()
      const camera = cameraRef.current
      if (!rect || !camera) return null

      const store = useAppStore.getState()
      const hit = pickKnifeHit(clientX, clientY, rect, camera, store.objects, preferredId)
      if (!hit) {
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
        const world = { x: planeHit.x, y: planeHit.y, z: planeHit.z }
        const draft = store.knifeDraft
        if (shiftKey && draft?.start) {
          const constrained = constrainKnifeEndWorld(
            draft.start,
            world,
            (w) => {
              const p = new Vector3(w.x, w.y, w.z).project(camera)
              return {
                x: rect.left + (p.x * 0.5 + 0.5) * rect.width,
                y: rect.top + (-p.y * 0.5 + 0.5) * rect.height,
              }
            },
            (sx, sy) => {
              const ndcX = ((sx - rect.left) / rect.width) * 2 - 1
              const ndcY = -((sy - rect.top) / rect.height) * 2 + 1
              const vec = new Vector3(ndcX, ndcY, 0.5).unproject(camera)
              return { x: vec.x, y: vec.y, z: vec.z }
            },
            true
          )
          return { objectId: targetId, world: constrained }
        }
        return { objectId: targetId, world }
      }

      let world = hit.world
      const draft = store.knifeDraft
      if (shiftKey && draft?.start) {
        world = constrainKnifeEndWorld(
          draft.start,
          world,
          (w) => {
            const p = new Vector3(w.x, w.y, w.z).project(camera)
            return {
              x: rect.left + (p.x * 0.5 + 0.5) * rect.width,
              y: rect.top + (-p.y * 0.5 + 0.5) * rect.height,
            }
          },
          (sx, sy) => {
            const ndcX = ((sx - rect.left) / rect.width) * 2 - 1
            const ndcY = -((sy - rect.top) / rect.height) * 2 + 1
            const vec = new Vector3(ndcX, ndcY, 0.5).unproject(camera)
            return { x: vec.x, y: vec.y, z: vec.z }
          },
          true
        )
      }

      return { objectId: hit.objectId, world }
    },
    [defaultDepth]
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

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (useAppStore.getState().meshModal || useAppStore.getState().objectTransformModal) return

      if (e.button === 0) beginPointerInteraction()

      const store = useAppStore.getState()
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
        let hit = pickMeshSurfaceUv(e.clientX, e.clientY, rect, camera, objects, selectedObjectId)
        if (!hit && selectedObjectId) {
          hit = pickMeshSurfaceUv(e.clientX, e.clientY, rect, camera, objects, null)
        }
        if (hit) {
          const hitObj = objects.find((o) => o.id === hit.objectId)
          const mat = hitObj ? resolveEffectiveMaterial(hitObj) : null
          const docId = mat?.textureId
          const doc = docId ? store.pixelDocuments[docId] : undefined
          if (mat?.mode === 'texture' && docId && doc && store.pixelEditorDocId && docId === store.pixelEditorDocId) {
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
            if (pixelTool !== 'pencil' && pixelTool !== 'eraser') return

            store.beginPixelEdit()
            store.paintOnModelPixel(docId, px.x, px.y)
            pixelPaintRef.current = {
              docId,
              objectId: hit.objectId,
              lastX: e.clientX,
              lastY: e.clientY,
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
        const picked = pickObjectAt(e.clientX, e.clientY, rect, camera)
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
        const picked = pickObjectAt(e.clientX, e.clientY, rect, camera)
        if (picked) {
          selectObject(picked, { additive: e.shiftKey })
        } else if (!e.shiftKey) {
          selectObject(null)
          selectBillboardImage(null)
          selectReferenceImage(null)
        }
        return
      }

      if (isComponentSelectionMode(selectionMode) && e.button === 0 && rect && camera) {
        const store = useAppStore.getState()

        if (
          activeTool === 'move' &&
          selectionHasComponents(store.meshSelection)
        ) {
          const obj = store.objects.find((o) => o.id === store.meshSelection!.objectId)
          if (obj && tryBeginMeshSelectionDrag(e, store.meshSelection!, obj)) {
            e.currentTarget.setPointerCapture(e.pointerId)
          }
          return
        }

        if (canDragComponentSelection(activeTool)) {
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
            selectedObjectId,
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
              MESH_SELECT_TOOLS.includes(activeTool) &&
              hitSelected &&
              !e.shiftKey &&
              obj &&
              tryBeginMeshSelectionDrag(e, sel, obj)
            ) {
              e.currentTarget.setPointerCapture(e.pointerId)
              return
            }

            applyMeshPick(hit, e.shiftKey)

            if (!e.shiftKey && obj) {
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
            const pickedObjectId = pickObjectAt(e.clientX, e.clientY, rect, camera)
            const obj =
              sel && selectionHasComponents(sel)
                ? store.objects.find((o) => o.id === sel.objectId)
                : null

            if (
              !e.shiftKey &&
              MESH_SELECT_TOOLS.includes(activeTool) &&
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
        const picked = pickObjectAt(e.clientX, e.clientY, rect, camera)

        if (picked) {
          selectObject(picked, { additive: e.shiftKey })
          if (!e.shiftKey) {
            const store = useAppStore.getState()
            const baseTransforms: Record<string, ObjectTransform> = {}
            for (const id of store.selectionObjectIds) {
              const obj = store.objects.find((o) => o.id === id)
              if (obj) baseTransforms[id] = cloneTransform(ensureTransform(obj))
            }
            const center = selectionWorldCenter(store.objects, store.selectionObjectIds)
            beginObjectDrag(e, baseTransforms, center)
          }
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
          loopCutCommit()
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
          loopCutBegin(hit.objectId, edgeKey(hit.edge[0], hit.edge[1]))
          selectObject(hit.objectId)
        }
        return
      }

      if (activeTool === 'knife' && e.button === 0 && rect && camera) {
        const store = useAppStore.getState()
        const preferred =
          store.knifeDraft?.objectId ??
          store.selectedObjectId ??
          (store.selectionObjectIds.length === 1 ? store.selectionObjectIds[0] : null)
        const resolved = resolveKnifeWorld(e.clientX, e.clientY, preferred)
        if (!resolved) return
        e.currentTarget.setPointerCapture(e.pointerId)
        selectObject(resolved.objectId)
        knifePointerDown(resolved.objectId, resolved.world, view)
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

      if (DRAW_TOOLS.includes(activeTool) && view !== 'perspective') {
        strokeGestureViewRef.current = view
        startStroke(pt, view)
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
      selectObject,
      selectBillboardImage,
      selectReferenceImage,
      applyMeshPick,
      clearMeshSelection,
      startVectorStroke,
      penPointerDown,
      primitiveBoxPointerDown,
      getGroundPoint,
      resolvePolyDrawAt,
      polyDrawClick,
      polyDrawFinish,
      beginObjectDrag,
      tryBeginMeshSelectionDrag,
      commitHistory,
      beginPointerInteraction,
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

      if (pixelPaintRef.current && (e.buttons & 1) === 1) {
        const rect = containerRef.current?.getBoundingClientRect()
        const camera = cameraRef.current
        const paint = pixelPaintRef.current
        if (rect && camera) {
          const store = useAppStore.getState()
          const doc = store.pixelDocuments[paint.docId]
          const obj = objects.find((o) => o.id === paint.objectId)
          if (doc && obj) {
            const pixelTool = store.pixelEditorTool
            if (pixelTool !== 'pencil' && pixelTool !== 'eraser') return

            const anchor = pickMeshSurfaceUv(paint.lastX, paint.lastY, rect, camera, objects, paint.objectId)
            const step = anchor
              ? estimateTexelScreenSize(anchor, obj, camera, rect, doc.width, doc.height)
              : 4
            const samples = interpolateScreenPaintSamples(
              paint.lastX,
              paint.lastY,
              e.clientX,
              e.clientY,
              step
            )
            const points: { x: number; y: number }[] = []
            for (const s of samples) {
              const h = pickMeshSurfaceUv(s.x, s.y, rect, camera, objects, paint.objectId)
              if (!h) continue
              const hitObj = objects.find((o) => o.id === h.objectId)
              const mat = hitObj ? resolveEffectiveMaterial(hitObj) : null
              if (mat?.textureId !== paint.docId) continue
              points.push(uvToPixelCoords(h.uv, doc.width, doc.height))
            }
            if (points.length >= 2) store.paintOnModelStroke(paint.docId, points)
            else if (points.length === 1) store.paintOnModelPixel(paint.docId, points[0].x, points[0].y)
            pixelPaintRef.current = { ...paint, lastX: e.clientX, lastY: e.clientY }
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
        ((isComponentSelectionMode(selectionMode) &&
          (MESH_SELECT_TOOLS.includes(activeTool) || activeTool === 'move')) ||
          MESH_EDIT_TOOLS.includes(activeTool))
      ) {
        scheduleMeshHoverPick(e.clientX, e.clientY)
      }

      const store = useAppStore.getState()

      if (store.activeTool === 'knife' && (e.buttons & 1) === 1 && store.knifeDraft?.start) {
        const preferred = store.knifeDraft.objectId ?? store.selectedObjectId
        const resolved = resolveKnifeWorld(e.clientX, e.clientY, preferred, e.shiftKey)
        if (resolved) {
          knifePointerMove(resolved.world)
        }
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
        primitiveGestureViewRef.current === view
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
        if (pt) penPointerMove(pt)
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
        view !== 'perspective' &&
        strokeView === view &&
        store.isDrawing
      ) {
        if (store.sketchExtrudeMode && store.extrudeDragAnchor) {
          updateExtrudeFromPointer(e.clientX, e.clientY)
        }
        if ((e.buttons & 1) === 1) {
          continueStroke(pt)
        } else {
          setStrokePreview(pt)
        }
        return
      }
    },
    [view, defaultDepth, activeTool, selectionMode, objects, selectedObjectId, continueStroke, continueVectorStroke, applySculptAt, getPlanePoint, getGroundPoint, resolvePolyDrawAt, getObjectDragDelta, getComponentDragDelta, translateSelectionByDelta, translateMeshSelection, penPointerMove, scheduleMeshHoverPick, primitiveBoxPointerMove, polyDrawPointerMove, setStrokePreview, updateExtrudeFromPointer, resolveKnifeWorld, knifePointerMove]
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
      if (store.activeTool === 'knife' && store.knifeDraft?.start) {
        const camera = cameraRef.current
        if (camera && store.knifeDraft.end) {
          knifeCommit(getCameraViewForward(camera))
        } else {
          useAppStore.getState().knifeCancel()
        }
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId)
        }
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
          const picked = pickObjectAt(e.clientX, e.clientY, rect, camera)
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
            selectedObjectId,
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
            const pickedObjectId = pickObjectAt(e.clientX, e.clientY, rect, camera)
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
      knifeCommit,
      commitHistory,
      viewportXRay,
      endPointerInteraction,
    ]
  )

  const handlePointerLeave = useCallback(
    (e: React.PointerEvent) => {
      handlePointerUp(e)
      setMeshHover(null)
      if (useAppStore.getState().activeTool === 'poly-draw') {
        clearPolyDrawHover()
      }
    },
    [handlePointerUp, setMeshHover, clearPolyDrawHover]
  )

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      const store = useAppStore.getState()
      if (store.loopCutDraft && store.activeTool === 'loop-cut') {
        e.preventDefault()
        e.stopPropagation()
        loopCutAdjustWheel(e.deltaY)
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

  const selectedObj = objects.find((o) => o.id === selectedObjectId)
  const vertCount = objects.reduce((s, o) => s + o.positions.length, 0)
  const gizmoTargetId = isActiveViewport
    ? selectionHasComponents(meshSelection) && isComponentSelectionMode(selectionMode)
      ? meshSelection!.objectId
      : selectionObjectIds.length === 1
        ? selectionObjectIds[0]
        : null
    : null

  const componentGizmoObject =
    meshSelection && selectionHasComponents(meshSelection)
      ? objects.find((o) => o.id === meshSelection.objectId)
      : null

  const objectGizmoActive =
    isActiveViewport &&
    selectionMode === 'object' &&
    selectionObjectIds.length === 1 &&
    TRANSFORM_GIZMO_TOOLS.includes(activeTool) &&
    !selectionHasComponents(meshSelection)

  const componentGizmoActive =
    isActiveViewport &&
    isComponentSelectionMode(selectionMode) &&
    componentGizmoObject != null &&
    !componentGizmoObject.topologyLocked &&
    TRANSFORM_GIZMO_TOOLS.includes(activeTool)

  const transformGizmoActive = objectGizmoActive || componentGizmoActive

  const billboardGizmoActive =
    isActiveViewport &&
    !!selectedBillboardImageId &&
    TRANSFORM_GIZMO_TOOLS.includes(activeTool)

  const billboardPickActive =
    isActiveViewport &&
    billboardImages.length > 0 &&
    selectionMode === 'object' &&
    (activeTool === 'select-object' || TRANSFORM_GIZMO_TOOLS.includes(activeTool))

  const viewportGizmoActive = transformGizmoActive || billboardGizmoActive

  const canvasPointerEvents = viewportGizmoActive || billboardPickActive

  const cursorClass =
    selectionMode === 'object' && activeTool === 'select-object'
      ? 'cursor-select'
      : isComponentSelectionMode(selectionMode) &&
          (MESH_SELECT_TOOLS.includes(activeTool) || activeTool === 'move')
        ? 'cursor-select'
        : TRANSFORM_GIZMO_TOOLS.includes(activeTool)
          ? 'cursor-transform'
          : VECTOR_TOOLS.includes(activeTool)
            ? 'cursor-crosshair'
            : MESH_EDIT_TOOLS.includes(activeTool)
              ? 'cursor-crosshair'
              : SCULPT_TOOLS.includes(activeTool)
              ? 'cursor-sculpt'
              : ''

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (imageDropMode === 'off') return
      if ([...e.dataTransfer.types].includes('Files')) {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }
    },
    [imageDropMode]
  )

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      if (imageDropMode === 'off') return
      e.preventDefault()
      e.stopPropagation()
      const file = [...e.dataTransfer.files].find((f) => f.type.startsWith('image/'))
      if (!file) return

      const rect = containerRef.current?.getBoundingClientRect()
      const camera = cameraRef.current
      if (!rect || !camera) return

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
    [imageDropMode, view, defaultDepth, dropImageInView]
  )

  return (
    <div
      ref={bindContainerRef}
      className={`viewport-panel ${isActive ? 'active' : ''} tool-${activeTool} ${cursorClass}${imageDropMode !== 'off' ? ' image-drop-active' : ''}`}
      onClick={viewportGizmoActive ? undefined : onActivate}
      onPointerDown={viewportGizmoActive ? undefined : handlePointerDown}
      onPointerMove={viewportGizmoActive ? undefined : handlePointerMove}
      onPointerUp={viewportGizmoActive ? undefined : handlePointerUp}
      onPointerLeave={viewportGizmoActive ? undefined : handlePointerLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onContextMenu={view === 'perspective' ? (e) => e.preventDefault() : undefined}
    >
      <ViewportViewPicker view={view} onSelect={handleSelectView} />
      <span className="viewport-stats">
        {perspectivePrimitiveScrollHeight
          ? activePrimitiveKind === 'roundedBox'
            ? `Scroll height (${(primitiveBoxDraft?.scrollHeight ?? 4).toFixed(1)}) · Shift+scroll roundness · middle-click to place`
            : `Scroll to set height (${(primitiveBoxDraft?.scrollHeight ?? 4).toFixed(1)}) · middle-click to place`
          : roundedBoxParamWheel
            ? `Rounded box · sub ${roundedBoxSubdivisions} · round ${Math.round(roundedBoxRoundness * 100)}% · scroll / Shift+scroll`
            : selectedObj
              ? `${selectedObj.name} · ${selectedObj.positions.length}v`
              : `${vertCount}v total`}
        {!perspectivePrimitiveScrollHeight &&
          !roundedBoxParamWheel &&
          selectionObjectIds.length > 1 &&
          ` · ${selectionObjectIds.length} selected`}
      </span>

      {marqueeRect && <MarqueeOverlay rect={marqueeRect} />}

      <ReferenceImageOverlay view={view} containerRef={containerRef} />

      <SymmetryPlaneOverlay view={view} containerRef={containerRef} cameraRef={cameraRef} />

      <ViewportRenderContext.Provider value={{ layoutVisible, continuousFrames }}>
      <ViewportDomContext.Provider value={interactionDom}>
      <Canvas
        className="viewport-canvas-root"
        frameloop={continuousFrames ? 'always' : 'demand'}
        orthographic={isOrtho}
        eventSource={containerRef as React.RefObject<HTMLElement>}
        camera={{
          position: setup.position,
          zoom: setup.zoom,
          near: 0.1,
          far: 2000,
          up: setup.up,
        }}
        gl={{ antialias: true, alpha: false }}
        style={{
          background: viewportBg,
          pointerEvents: canvasPointerEvents ? 'auto' : 'none',
          touchAction: canvasPointerEvents ? 'none' : undefined,
        }}
        onCreated={({ camera, gl }) => {
          gl.outputColorSpace = 'srgb'
          cameraRef.current = camera
          applyOrthoCamera(view, camera)
        }}
      >
        <ViewportDemandSync />
        <ViewportSceneInvalidator
          objects={objects}
          themeId={themeId}
          meshSelection={meshSelection}
          viewportDisplayMode={viewportDisplayMode}
          facetExaggeration={facetExaggeration}
          showDensityHeatmap={showDensityHeatmap}
          pixelTextureRevision={pixelTextureRevision}
        />
        <WebGLContextHandler />
        <ViewportPointerPolicy gizmoActive={canvasPointerEvents} />

        <ViewMoveBasisSync enabled={isActiveViewport && view === 'perspective'} />

        <color attach="background" args={[viewportBg]} />
        <ViewportLighting />

        <ViewportControls
          rootRef={containerRef}
          view={view}
          enableZoom={!perspectivePrimitiveScrollHeight}
          disableMiddlePan={perspectivePrimitiveScrollHeight}
        />

        {showGrid && <ViewportGrid view={view} depth={defaultDepth} />}

        <SymmetryPlaneVisual view={view} />

        {objects.map((obj) => (
          <ObjectNode
            key={obj.id}
            object={obj}
            isSelected={selectionObjectIds.includes(obj.id)}
            isPrimary={obj.id === selectedObjectId}
            isGizmoTarget={obj.id === gizmoTargetId}
            facetExaggeration={facetExaggeration}
            showDensityHeatmap={showDensityHeatmap}
            selectionMode={selectionMode}
            viewportDisplayMode={viewportDisplayMode}
          />
        ))}

        {componentGizmoActive && meshSelection && componentGizmoObject && (
          <MeshSelectionGizmo
            object={componentGizmoObject}
            meshSelection={meshSelection}
            activeTool={activeTool}
          />
        )}

        <PrimitiveBoxCanvas />
        <PolyDrawVisuals />
        <KnifeVisuals />
        <LoopCutVisuals />
        <DrawVertexOverlay />
        <BillboardImages />

        {view !== 'perspective' && (
          <>
            <StrokeCanvas view={view} />
            <VectorCanvas view={view} />
          </>
        )}
      </Canvas>
      </ViewportDomContext.Provider>
      </ViewportRenderContext.Provider>
    </div>
  )
}
