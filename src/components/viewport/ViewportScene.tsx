import { SymmetryPlaneVisual } from '../SymmetryPlaneVisual'
import { ViewportGrid } from '../ViewportGrid'
import { ViewportLighting } from '../ViewportLighting'
import { WebGLContextHandler } from '../WebGLContextHandler'
import { ViewportPointerPolicy } from '../ViewportPointerPolicy'
import { ViewportCamera } from './ViewportCamera'
import { ViewportControls } from './ViewportControls'
import { ViewportInvalidatorBridge, ViewportSceneInvalidator } from './ViewportInvalidator'
import { ViewportObjects } from './ViewportObjects'
import { ViewportToolOverlays } from './ViewportToolOverlays'
import type { SceneObject } from '../../mesh/HalfEdgeMesh'
import type { MeshComponentSelection } from '../../mesh/meshSelection'
import type { ActiveTool, SelectionMode, ViewType } from '../../store/appStore'
import type { ViewportDisplayMode } from '../../rendering/viewportDisplay'
import type { ViewportSlotIndex } from '../../scene/viewTypes'

/** R3F scene graph for one viewport slot. */
export function ViewportScene({
  view,
  slotIndex,
  isActiveViewport,
  showToolPreviews,
  containerRef,
  enableZoom,
  disableMiddlePan,
  canvasPointerEvents,
  objects,
  selectedObjectSet,
  selectedObjectId,
  gizmoTargetId,
  facetExaggeration,
  showDensityHeatmap,
  selectionMode,
  viewportDisplayMode,
  viewportXRay,
  showGrid,
  defaultDepth,
  themeId,
  meshSelection,
  selectionObjectIds,
  activeTool,
  cadPreviewSignal,
  primitiveBoxDraft,
  multiObjectGizmoActive,
  componentGizmoActive,
  componentGizmoObject,
  billboardImagesLength,
  viewportBg,
}: {
  view: ViewType
  slotIndex: ViewportSlotIndex
  isActiveViewport: boolean
  showToolPreviews: boolean
  containerRef: React.RefObject<HTMLDivElement | null>
  enableZoom: boolean
  disableMiddlePan: boolean
  canvasPointerEvents: boolean
  objects: SceneObject[]
  selectedObjectSet: Set<string>
  selectedObjectId: string | null
  gizmoTargetId: string | null
  facetExaggeration: number
  showDensityHeatmap: boolean
  selectionMode: SelectionMode
  viewportDisplayMode: ViewportDisplayMode
  viewportXRay: boolean
  showGrid: boolean
  defaultDepth: number
  themeId: unknown
  meshSelection: MeshComponentSelection | null
  selectionObjectIds: string[]
  activeTool: ActiveTool
  cadPreviewSignal: unknown
  primitiveBoxDraft: unknown
  multiObjectGizmoActive: boolean
  componentGizmoActive: boolean
  componentGizmoObject: SceneObject | null | undefined
  billboardImagesLength: number
  viewportBg: string
}) {
  return (
    <>
      <ViewportInvalidatorBridge />
      <ViewportSceneInvalidator
        objects={objects}
        themeId={themeId}
        meshSelection={meshSelection}
        selectionObjectIds={selectionObjectIds}
        selectedObjectId={selectedObjectId}
        viewportDisplayMode={viewportDisplayMode}
        viewportXRay={viewportXRay}
        activeTool={activeTool}
        showGrid={showGrid}
        facetExaggeration={facetExaggeration}
        showDensityHeatmap={showDensityHeatmap}
        cadPreviewSignal={cadPreviewSignal}
      />
      <WebGLContextHandler />
      <ViewportPointerPolicy gizmoActive={canvasPointerEvents} />

      <ViewportCamera view={view} isActiveViewport={isActiveViewport} objects={objects} />

      <color attach="background" args={[viewportBg]} />
      <ViewportLighting />

      <ViewportControls
        rootRef={containerRef}
        view={view}
        slotIndex={slotIndex}
        enableZoom={enableZoom}
        disableMiddlePan={disableMiddlePan}
      />

      {showGrid && <ViewportGrid view={view} depth={defaultDepth} />}

      <SymmetryPlaneVisual view={view} />

      <ViewportObjects
        objects={objects}
        selectedObjectSet={selectedObjectSet}
        selectedObjectId={selectedObjectId}
        gizmoTargetId={gizmoTargetId}
        facetExaggeration={facetExaggeration}
        showDensityHeatmap={showDensityHeatmap}
        selectionMode={selectionMode}
        viewportDisplayMode={viewportDisplayMode}
        viewportXRay={viewportXRay}
      />

      <ViewportToolOverlays
        view={view}
        showToolPreviews={showToolPreviews}
        activeTool={activeTool}
        primitiveBoxDraft={primitiveBoxDraft}
        multiObjectGizmoActive={multiObjectGizmoActive}
        componentGizmoActive={componentGizmoActive}
        selectionObjectIds={selectionObjectIds}
        meshSelection={meshSelection}
        componentGizmoObject={componentGizmoObject}
        billboardImagesLength={billboardImagesLength}
      />
    </>
  )
}
