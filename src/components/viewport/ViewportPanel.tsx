import { useCallback, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type * as THREE from 'three'
import {
  shouldViewportRenderContinuously,
  useViewportSlotInteraction,
} from '../../rendering/viewportFrameLoop'
import { ViewportRenderContext } from '../ViewportRenderContext'
import { ViewportDomContext } from '../ViewportDomContext'
import { useAppStore } from '../../store/appStore'
import { getViewportBackground } from '../../theme/themes'
import { selectionHasComponents } from '../../mesh/meshSelection'
import type { SelectableViewType } from '../../scene/viewTypes'
import { useViewportPointerHandlers } from '../../hooks/useViewportPointerHandlers'
import {
  DEFORM_TOOLS,
  MESH_EDIT_TOOLS,
  SCULPT_TOOLS,
  TRANSFORM_GIZMO_TOOLS,
  VECTOR_TOOLS,
  canPickComponentSelection,
  isComponentSelectionMode,
} from '../../viewport/viewportInteractionUtils'
import { isGizmoHandlingPointer } from '../../viewport/gizmoPointerGate'
import { ViewportRuntimeProvider } from './ViewportRuntimeContext'
import { ViewportCanvas } from './ViewportCanvas'
import { ViewportDomOverlays } from './ViewportDomOverlays'
import { ViewportStats } from './ViewportStats'
import { resolvePrimaryNavigation } from './ViewportControls'
import type { ViewportSlotProps } from './viewportTypes'
import { isSceneObjectVisible } from '../../scene/objectVisibility'

export function ViewportPanel({
  view,
  slotIndex,
  isActive,
  isHovered,
  onActivate,
  layoutVisible,
}: ViewportSlotProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const cameraRef = useRef<THREE.Camera | null>(null)
  const cameraNavigationGestureRef = useRef(false)
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
    billboardImagesLength,
    viewportXRay,
    pixelEditorOpen,
    pixelEditorPaintOnModel,
    setActiveView,
    setViewportSlotView,
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
      billboardImagesLength: s.billboardImages.length,
      viewportXRay: s.viewportXRay,
      pixelEditorOpen: s.pixelEditorOpen,
      pixelEditorPaintOnModel: s.pixelEditorPaintOnModel,
      setActiveView: s.setActiveView,
      setViewportSlotView: s.setViewportSlotView,
    }))
  )

  const interaction = useViewportSlotInteraction(slotIndex)

  const cadPreviewActive = useAppStore(
    (s) =>
      s.primitiveBoxDraft != null ||
      s.polyDrawDraft != null ||
      s.polyDrawHover != null ||
      s.vectorPenDraft != null ||
      (s.vectorIsDrawing && s.vectorDraft.length > 0) ||
      s.isDrawing ||
      s.currentStrokePreview != null ||
      s.knifeDraft != null ||
      s.bendDraft != null ||
      s.loopCutDraft != null ||
      s.extrudeDragAnchor != null ||
      s.meshModal != null ||
      s.objectTransformModal != null
  )

  // Camera/tool motion stays continuous only at its source. Peer panes use the
  // existing scene/draft invalidation bridge and render once per changed state.
  const continuousFrames = shouldViewportRenderContinuously({
    layoutVisible,
    isActive,
    localActive: interaction.localActive,
    sharedActiveHere: interaction.sharedActiveHere,
    cadPreviewActive,
  })

  const quality: 'high' | 'low' = layoutVisible && isActive ? 'high' : 'low'

  const handleSelectView = useCallback(
    (nextView: SelectableViewType) => {
      setViewportSlotView(slotIndex, nextView)
      if (isActive) setActiveView(nextView)
    },
    [slotIndex, isActive, setViewportSlotView, setActiveView]
  )

  const isActiveViewport = isActive && activeView === view
  const pixelPaintActive = pixelEditorOpen && pixelEditorPaintOnModel
  const viewportBg = getViewportBackground(themeId, viewportDisplayMode)
  // Live tool/stroke previews must appear in every visible slot so Quad View stays in sync.
  const showToolPreviews = layoutVisible

  const {
    marqueeRect,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerLeave,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    imageDragOver,
    perspectivePrimitiveScrollHeight,
    roundedBoxParamWheel,
  } = useViewportPointerHandlers({
    view,
    onActivate,
    layoutVisible,
    slotIndex,
    containerRef,
    cameraRef,
  })

  const selectedObj = objects.find((o) => o.id === selectedObjectId)
  const selectedObjectsVisible = selectionObjectIds.every((id) => {
    const object = objects.find((entry) => entry.id === id)
    return object ? isSceneObjectVisible(object) : false
  })
  const vertCount = useMemo(
    () => objects.reduce((s, o) => s + o.positions.length, 0),
    [objects]
  )
  const selectedObjectSet = useMemo(
    () => new Set(selectionObjectIds),
    [selectionObjectIds]
  )
  const gizmoTargetId = isActiveViewport && !pixelPaintActive
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
    !pixelPaintActive &&
    selectionMode === 'object' &&
    selectionObjectIds.length === 1 &&
    selectedObjectsVisible &&
    TRANSFORM_GIZMO_TOOLS.includes(activeTool) &&
    !selectionHasComponents(meshSelection)

  const multiObjectGizmoActive =
    isActiveViewport &&
    !pixelPaintActive &&
    selectionMode === 'object' &&
    selectionObjectIds.length > 1 &&
    selectedObjectsVisible &&
    TRANSFORM_GIZMO_TOOLS.includes(activeTool) &&
    !selectionHasComponents(meshSelection)

  const componentGizmoActive =
    isActiveViewport &&
    !pixelPaintActive &&
    isComponentSelectionMode(selectionMode) &&
    componentGizmoObject != null &&
    isSceneObjectVisible(componentGizmoObject) &&
    !componentGizmoObject.topologyLocked &&
    TRANSFORM_GIZMO_TOOLS.includes(activeTool)

  const transformGizmoActive = objectGizmoActive || multiObjectGizmoActive || componentGizmoActive

  const billboardGizmoActive =
    isActiveViewport &&
    !pixelPaintActive &&
    !!selectedBillboardImageId &&
    TRANSFORM_GIZMO_TOOLS.includes(activeTool)

  const billboardPickActive =
    isActiveViewport &&
    !pixelPaintActive &&
    billboardImagesLength > 0 &&
    selectionMode === 'object' &&
    (activeTool === 'select-object' || TRANSFORM_GIZMO_TOOLS.includes(activeTool))

  const viewportGizmoActive = transformGizmoActive || billboardGizmoActive
  // Painting is a viewport-wide interaction. Keep every visible canvas as a
  // direct pointer target, including inactive orthographic panes.
  const canvasPointerEvents = viewportGizmoActive || billboardPickActive || pixelPaintActive

  const cursorClass =
    selectionMode === 'object' && activeTool === 'select-object'
      ? 'cursor-select'
      : isComponentSelectionMode(selectionMode) && canPickComponentSelection(activeTool)
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

  const statsLabel = perspectivePrimitiveScrollHeight
    ? `Drag or scroll height (${(primitiveBoxDraft?.scrollHeight ?? 4).toFixed(1)}) · double-click to place`
    : roundedBoxParamWheel
      ? `Rounded box · sub ${roundedBoxSubdivisions} · round ${Math.round(roundedBoxRoundness * 100)}% · scroll / Shift+scroll`
      : selectedObj
        ? `${selectedObj.name} · ${selectedObj.positions.length}v${
            selectionObjectIds.length > 1 ? ` · ${selectionObjectIds.length} selected` : ''
          }`
        : `${vertCount}v total${
            selectionObjectIds.length > 1 ? ` · ${selectionObjectIds.length} selected` : ''
          }`

  const isCameraNavigationGesture = (e: React.PointerEvent) =>
    e.button === 0 && resolvePrimaryNavigation(e, view === 'perspective') != null

  const handleViewportPointerDown = (e: React.PointerEvent) => {
    if (isCameraNavigationGesture(e)) {
      // Camera gestures bypass the normal tool handler, so explicitly make this
      // pane active before OrbitControls consumes the drag. This keeps Quad View
      // shortcuts, gizmos, and subsequent edits tied to the camera the user moved.
      onActivate()
      cameraNavigationGestureRef.current = true
      e.preventDefault()
      return
    }
    // Model painting belongs to the pane under the pointer. Do not let a
    // transform gizmo in the previously active pane consume the first stroke.
    // The pane's own handler uses its local camera, so Front/Right/Top map the
    // hit through their actual view direction just like Perspective does.
    if (pixelPaintActive) {
      onActivate()
      handlePointerDown(e)
      return
    }
    // TransformControls listens on the canvas and runs first; when it claims a
    // handle, skip selection/marquee so gizmo drags are not stolen.
    if (isGizmoHandlingPointer()) return
    handlePointerDown(e)
  }

  const handleViewportPointerMove = (e: React.PointerEvent) => {
    if (cameraNavigationGestureRef.current) return
    if (!pixelPaintActive && isGizmoHandlingPointer()) return
    handlePointerMove(e)
  }

  const handleViewportPointerUp = (e: React.PointerEvent) => {
    if (cameraNavigationGestureRef.current) {
      cameraNavigationGestureRef.current = false
      return
    }
    // Gate is cleared in TransformControls mouseUp before bubble reaches here.
    handlePointerUp(e)
  }

  const handleViewportPointerLeave = (e: React.PointerEvent) => {
    if (cameraNavigationGestureRef.current) {
      cameraNavigationGestureRef.current = false
      return
    }
    if (!pixelPaintActive && isGizmoHandlingPointer()) return
    handlePointerLeave(e)
  }

  const handleViewportPointerEnter = () => {
    // In paint mode, hovering a pane selects its camera before the first pixel
    // is placed. This makes the active paint view visibly follow the mouse.
    if (pixelPaintActive && !isActive) onActivate()
  }

  return (
    <div
      ref={bindContainerRef}
      className={`viewport-panel ${isActive ? 'active' : ''}${isHovered ? ' hovered' : ''} tool-${activeTool} ${cursorClass}${pixelPaintActive ? ' pixel-paint-active' : ''}${imageDropMode !== 'off' ? ' image-drop-active' : ''}${imageDragOver ? ' image-drag-over' : ''}`}
      onClick={onActivate}
      onPointerEnter={handleViewportPointerEnter}
      onPointerDown={handleViewportPointerDown}
      onPointerMove={handleViewportPointerMove}
      onPointerUp={handleViewportPointerUp}
      onPointerLeave={handleViewportPointerLeave}
      onWheelCapture={!isActive ? onActivate : undefined}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onContextMenu={
        view === 'perspective' || activeTool === 'knife' || activeTool === 'mirror-knife'
          ? (e) => e.preventDefault()
          : undefined
      }
      title={
        view === 'perspective'
          ? 'Alt + left-drag to orbit · Shift + Alt or Ctrl + left-drag to pan · two-finger scroll to zoom'
          : 'Shift + Alt or Ctrl + left-drag to pan · two-finger scroll to zoom'
      }
    >
      <ViewportStats view={view} statsLabel={statsLabel} onSelectView={handleSelectView} />

      <ViewportDomOverlays
        view={view}
        containerRef={containerRef}
        cameraRef={cameraRef}
        marqueeRect={marqueeRect}
      />

      <ViewportRenderContext.Provider value={{ layoutVisible, continuousFrames }}>
        <ViewportRuntimeProvider
          slotIndex={slotIndex}
          view={view}
          isActive={isActive}
          isHovered={isHovered}
          layoutVisible={layoutVisible}
          continuousFrames={continuousFrames}
          quality={quality}
        >
          <ViewportDomContext.Provider value={interactionDom}>
            <ViewportCanvas
              containerRef={containerRef}
              cameraRef={cameraRef}
              canvasPointerEvents={canvasPointerEvents}
              enableZoom={!perspectivePrimitiveScrollHeight}
              disableMiddlePan={perspectivePrimitiveScrollHeight}
              isActiveViewport={isActiveViewport}
              showToolPreviews={showToolPreviews}
              objects={objects}
              selectedObjectSet={selectedObjectSet}
              selectedObjectId={selectedObjectId}
              gizmoTargetId={gizmoTargetId}
              facetExaggeration={facetExaggeration}
              showDensityHeatmap={showDensityHeatmap}
              selectionMode={selectionMode}
              viewportDisplayMode={viewportDisplayMode}
              viewportXRay={viewportXRay}
              showGrid={showGrid}
              defaultDepth={defaultDepth}
              themeId={themeId}
              meshSelection={meshSelection}
              selectionObjectIds={selectionObjectIds}
              activeTool={activeTool}
              cadPreviewSignal={cadPreviewActive}
              primitiveBoxDraft={primitiveBoxDraft}
              multiObjectGizmoActive={multiObjectGizmoActive}
              componentGizmoActive={componentGizmoActive}
              componentGizmoObject={componentGizmoObject}
              billboardImagesLength={billboardImagesLength}
              viewportBg={viewportBg}
            />
          </ViewportDomContext.Provider>
        </ViewportRuntimeProvider>
      </ViewportRenderContext.Provider>
    </div>
  )
}
