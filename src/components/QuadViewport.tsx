import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { useRef, useCallback, useState, useLayoutEffect, useEffect } from 'react'
import { MOUSE, Vector3 } from 'three'
import type * as THREE from 'three'
import { popViewportInteraction, pushViewportInteraction, useViewportInteractionActive } from '../rendering/viewportFrameLoop'

const _viewMoveRight = new Vector3()
const _viewMoveUp = new Vector3()
const _viewMoveForward = new Vector3()
import { useShallow } from 'zustand/react/shallow'
import { ObjectNode } from './ObjectNode'
import { MeshSelectionGizmo } from './MeshSelectionGizmo'
import { ObjectSelectionGizmo } from './ObjectSelectionGizmo'
import { PrimitiveBoxCanvas } from './PrimitiveBoxCanvas'
import { PolyDrawVisuals } from './PolyDrawVisuals'
import { KnifeVisuals } from './KnifeVisuals'
import { BendVisuals } from './BendVisuals'
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
import { useAppStore, type ViewType } from '../store/appStore'
import { getViewportBackground } from '../theme/themes'
import { selectionHasComponents } from '../mesh/meshSelection'
import type { ViewportSlotIndex } from '../scene/viewTypes'
import type { SelectableViewType } from '../scene/viewTypes'
import { getCameraSetup } from '../scene/viewTypes'
import { ViewportViewPicker } from './ViewportViewPicker'
import { useViewportPointerHandlers } from '../hooks/useViewportPointerHandlers'
import {
  DEFORM_TOOLS,
  MESH_EDIT_TOOLS,
  MESH_SELECT_TOOLS,
  SCULPT_TOOLS,
  TRANSFORM_GIZMO_TOOLS,
  VECTOR_TOOLS,
  isComponentSelectionMode,
} from '../viewport/viewportInteractionUtils'

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
  isHovered: boolean
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
  cadPreviewSignal,
}: {
  objects: unknown
  themeId: unknown
  meshSelection: unknown
  viewportDisplayMode: unknown
  facetExaggeration: unknown
  showDensityHeatmap: unknown
  pixelTextureRevision: unknown
  cadPreviewSignal: unknown
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
    cadPreviewSignal,
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
  const [primaryOrbitModifier, setPrimaryOrbitModifier] = useState(false)
  const interactionHeldRef = useRef(false)
  const releaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isPerspective = view === 'perspective'

  useLayoutEffect(() => {
    if (rootRef.current) setDomElement(rootRef.current)
  }, [rootRef])

  useEffect(() => {
    return () => {
      if (releaseTimerRef.current !== null) clearTimeout(releaseTimerRef.current)
      if (interactionHeldRef.current) popViewportInteraction()
      setDomElement(null)
    }
  }, [])

  useEffect(() => {
    if (!isPerspective) {
      setPrimaryOrbitModifier(false)
      return
    }
    const setOrbitOnKey = (event: KeyboardEvent) => {
      if (event.key === 'Shift' || event.key === 'Alt') {
        setPrimaryOrbitModifier(event.shiftKey || event.altKey)
      }
    }
    const clearOrbit = () => setPrimaryOrbitModifier(false)
    window.addEventListener('keydown', setOrbitOnKey)
    window.addEventListener('keyup', setOrbitOnKey)
    window.addEventListener('blur', clearOrbit)
    return () => {
      window.removeEventListener('keydown', setOrbitOnKey)
      window.removeEventListener('keyup', setOrbitOnKey)
      window.removeEventListener('blur', clearOrbit)
    }
  }, [isPerspective])

  const handleControlsChange = useCallback(() => {
    requestViewportFrame(invalidate, layoutVisible, continuousFrames)
  }, [invalidate, layoutVisible, continuousFrames])

  const handleControlsStart = useCallback(() => {
    if (releaseTimerRef.current !== null) {
      clearTimeout(releaseTimerRef.current)
      releaseTimerRef.current = null
    }
    if (!interactionHeldRef.current) {
      interactionHeldRef.current = true
      pushViewportInteraction()
    }
  }, [])

  const handleControlsEnd = useCallback(() => {
    if (releaseTimerRef.current !== null) clearTimeout(releaseTimerRef.current)
    // Keep a few frames alive after the gesture so damping can settle naturally.
    releaseTimerRef.current = setTimeout(() => {
      releaseTimerRef.current = null
      if (!interactionHeldRef.current) return
      interactionHeldRef.current = false
      popViewportInteraction()
    }, 260)
  }, [])

  if (!domElement) return null

  return (
    <OrbitControls
      domElement={domElement}
      makeDefault
      enableDamping
      dampingFactor={0.12}
      enableRotate={isPerspective}
      enablePan
      enableZoom={enableZoom}
      zoomSpeed={0.75}
      panSpeed={0.9}
      rotateSpeed={0.75}
      onChange={handleControlsChange}
      onStart={handleControlsStart}
      onEnd={handleControlsEnd}
      mouseButtons={{
        // Laptop-friendly orbit: hold Shift or Alt while dragging with the primary button.
        LEFT: primaryOrbitModifier && isPerspective ? MOUSE.ROTATE : undefined,
        MIDDLE: disableMiddlePan ? undefined : MOUSE.PAN,
        RIGHT: isPerspective ? MOUSE.ROTATE : undefined,
      }}
    />
  )
}

export function QuadViewport({ view, slotIndex, isActive, isHovered, onActivate, layoutVisible }: QuadViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const cameraRef = useRef<THREE.Camera | null>(null)
  const shiftOrbitGestureRef = useRef(false)
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
    themeId,
    showGrid,
    defaultDepth,
    primitiveBoxDraft,
    roundedBoxRoundness,
    roundedBoxSubdivisions,
    imageDropMode,
    selectedBillboardImageId,
    billboardImages,
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
      themeId: s.themeId,
      showGrid: s.showGrid,
      defaultDepth: s.defaultDepth,
      primitiveBoxDraft: s.primitiveBoxDraft,
      roundedBoxRoundness: s.roundedBoxRoundness,
      roundedBoxSubdivisions: s.roundedBoxSubdivisions,
      imageDropMode: s.imageDropMode,
      selectedBillboardImageId: s.selectedBillboardImageId,
      billboardImages: s.billboardImages,
      setActiveView: s.setActiveView,
      setViewportSlotView: s.setViewportSlotView,
      pixelTextureRevision: s.pixelTextureRevision,
    }))
  )

  const interactionActive = useViewportInteractionActive()

  const cadPreview = useAppStore(
    useShallow((s) => ({
      primitiveBoxDraft: s.primitiveBoxDraft,
      polyDrawDraft: s.polyDrawDraft,
      polyDrawHover: s.polyDrawHover,
      vectorPenDraft: s.vectorPenDraft,
      vectorIsDrawing: s.vectorIsDrawing,
      vectorDraftLength: s.vectorDraft.length,
      isDrawing: s.isDrawing,
      currentStrokePreview: s.currentStrokePreview,
      knifeDraft: s.knifeDraft,
      bendDraft: s.bendDraft,
      loopCutDraft: s.loopCutDraft,
      extrudeDragAnchor: s.extrudeDragAnchor,
      meshModal: s.meshModal,
      objectTransformModal: s.objectTransformModal,
    }))
  )

  const cadPreviewActive =
    cadPreview.primitiveBoxDraft != null ||
    cadPreview.polyDrawDraft != null ||
    cadPreview.polyDrawHover != null ||
    cadPreview.vectorPenDraft != null ||
    (cadPreview.vectorIsDrawing && cadPreview.vectorDraftLength > 0) ||
    cadPreview.isDrawing ||
    cadPreview.currentStrokePreview != null ||
    cadPreview.knifeDraft != null ||
    cadPreview.bendDraft != null ||
    cadPreview.loopCutDraft != null ||
    cadPreview.extrudeDragAnchor != null ||
    cadPreview.meshModal != null ||
    cadPreview.objectTransformModal != null

  const continuousFrames =
    layoutVisible && (isActive || interactionActive || cadPreviewActive)

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

  const {
    marqueeRect,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerLeave,
    handleDragOver,
    handleDrop,
    perspectivePrimitiveScrollHeight,
    roundedBoxParamWheel,
  } = useViewportPointerHandlers({
    view,
    onActivate,
    layoutVisible,
    containerRef,
    cameraRef,
  })

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

  const multiObjectGizmoActive =
    isActiveViewport &&
    selectionMode === 'object' &&
    selectionObjectIds.length > 1 &&
    TRANSFORM_GIZMO_TOOLS.includes(activeTool) &&
    !selectionHasComponents(meshSelection)

  const componentGizmoActive =
    isActiveViewport &&
    isComponentSelectionMode(selectionMode) &&
    componentGizmoObject != null &&
    !componentGizmoObject.topologyLocked &&
    TRANSFORM_GIZMO_TOOLS.includes(activeTool)

  const transformGizmoActive = objectGizmoActive || multiObjectGizmoActive || componentGizmoActive

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
            : MESH_EDIT_TOOLS.includes(activeTool) || DEFORM_TOOLS.includes(activeTool)
              ? 'cursor-crosshair'
              : SCULPT_TOOLS.includes(activeTool)
              ? 'cursor-sculpt'
              : ''

  const isOrbitModifierGesture = (e: React.PointerEvent) =>
    view === 'perspective' && (e.shiftKey || e.altKey) && e.button === 0

  const handleViewportPointerDown = (e: React.PointerEvent) => {
    if (isOrbitModifierGesture(e)) {
      shiftOrbitGestureRef.current = true
      return
    }
    handlePointerDown(e)
  }

  const handleViewportPointerMove = (e: React.PointerEvent) => {
    if (!shiftOrbitGestureRef.current) handlePointerMove(e)
  }

  const handleViewportPointerUp = (e: React.PointerEvent) => {
    if (shiftOrbitGestureRef.current) {
      shiftOrbitGestureRef.current = false
      return
    }
    handlePointerUp(e)
  }

  const handleViewportPointerLeave = (e: React.PointerEvent) => {
    if (shiftOrbitGestureRef.current) {
      shiftOrbitGestureRef.current = false
      return
    }
    handlePointerLeave(e)
  }

  return (
    <div
      ref={bindContainerRef}
      className={`viewport-panel ${isActive ? 'active' : ''}${isHovered ? ' hovered' : ''} tool-${activeTool} ${cursorClass}${imageDropMode !== 'off' ? ' image-drop-active' : ''}`}
      onClick={viewportGizmoActive ? undefined : onActivate}
      onPointerDown={viewportGizmoActive ? undefined : handleViewportPointerDown}
      onPointerMove={viewportGizmoActive ? undefined : handleViewportPointerMove}
      onPointerUp={viewportGizmoActive ? undefined : handleViewportPointerUp}
      onPointerLeave={viewportGizmoActive ? undefined : handleViewportPointerLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onContextMenu={view === 'perspective' ? (e) => e.preventDefault() : undefined}
      title={view === 'perspective' ? 'Shift or Alt + left-drag to orbit · two-finger scroll to zoom' : undefined}
    >
      <div className="viewport-view-chrome">
        <span className="viewport-stats">
          {perspectivePrimitiveScrollHeight
            ? `Drag or scroll height (${(primitiveBoxDraft?.scrollHeight ?? 4).toFixed(1)}) · double-click to place`
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
        <ViewportViewPicker view={view} onSelect={handleSelectView} />
      </div>

      {marqueeRect && <MarqueeOverlay rect={marqueeRect} />}

      <ReferenceImageOverlay view={view} containerRef={containerRef} />

      <SymmetryPlaneOverlay view={view} containerRef={containerRef} cameraRef={cameraRef} />

      <ViewportRenderContext.Provider value={{ layoutVisible, continuousFrames }}>
      <ViewportDomContext.Provider value={interactionDom}>
      <Canvas
        className="viewport-canvas-root"
        frameloop={continuousFrames ? 'always' : 'demand'}
        dpr={[1, 2]}
        orthographic={isOrtho}
        eventSource={containerRef as React.RefObject<HTMLElement>}
        camera={{
          position: setup.position,
          zoom: setup.zoom,
          near: 0.1,
          far: 2000,
          up: setup.up,
        }}
        gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
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
          cadPreviewSignal={cadPreview}
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

        {multiObjectGizmoActive && (
          <ObjectSelectionGizmo
            selectionObjectIds={selectionObjectIds}
            activeTool={activeTool}
          />
        )}

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
        <BendVisuals />
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
