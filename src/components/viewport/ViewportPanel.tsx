import { useCallback, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type * as THREE from 'three'
import { useViewportSlotInteraction } from '../../rendering/viewportFrameLoop'
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
    billboardImages,
    viewportXRay,
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
      viewportXRay: s.viewportXRay,
      setActiveView: s.setActiveView,
      setViewportSlotView: s.setViewportSlotView,
      pixelTextureRevision: s.pixelTextureRevision,
    }))
  )

  const interaction = useViewportSlotInteraction(slotIndex)

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

  // Camera orbit/pan/zoom: continuous only on this slot (localActive).
  // Shared mesh edits + live CAD/stroke drafts: keep every *visible* slot
  // continuous so peers mirror the change immediately (demand invalidate alone
  // is not enough while drafts update every pointer move).
  const continuousFrames =
    layoutVisible &&
    (interaction.localActive ||
      interaction.sharedActiveAnywhere ||
      cadPreviewActive)

  const quality: 'high' | 'low' = layoutVisible && isActive ? 'high' : 'low'

  const handleSelectView = useCallback(
    (nextView: SelectableViewType) => {
      setViewportSlotView(slotIndex, nextView)
      if (isActive) setActiveView(nextView)
    },
    [slotIndex, isActive, setViewportSlotView, setActiveView]
  )

  const isActiveViewport = isActive && activeView === view
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
  const vertCount = useMemo(
    () => objects.reduce((s, o) => s + o.positions.length, 0),
    [objects]
  )
  const selectedObjectSet = useMemo(
    () => new Set(selectionObjectIds),
    [selectionObjectIds]
  )
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
    // TransformControls listens on the canvas and runs first; when it claims a
    // handle, skip selection/marquee so gizmo drags are not stolen.
    if (isGizmoHandlingPointer()) return
    handlePointerDown(e)
  }

  const handleViewportPointerMove = (e: React.PointerEvent) => {
    if (cameraNavigationGestureRef.current) return
    if (isGizmoHandlingPointer()) return
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
    if (isGizmoHandlingPointer()) return
    handlePointerLeave(e)
  }

  return (
    <div
      ref={bindContainerRef}
      className={`viewport-panel ${isActive ? 'active' : ''}${isHovered ? ' hovered' : ''} tool-${activeTool} ${cursorClass}${imageDropMode !== 'off' ? ' image-drop-active' : ''}${imageDragOver ? ' image-drag-over' : ''}`}
      onClick={onActivate}
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
        isActive={isActive}
        activeTool={activeTool}
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
              pixelTextureRevision={pixelTextureRevision}
              cadPreviewSignal={cadPreview}
              primitiveBoxDraft={primitiveBoxDraft}
              multiObjectGizmoActive={multiObjectGizmoActive}
              componentGizmoActive={componentGizmoActive}
              componentGizmoObject={componentGizmoObject}
              billboardImagesLength={billboardImages.length}
              viewportBg={viewportBg}
            />
          </ViewportDomContext.Provider>
        </ViewportRuntimeProvider>
      </ViewportRenderContext.Provider>
    </div>
  )
}
