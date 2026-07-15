import { Canvas } from '@react-three/fiber'
import type * as THREE from 'three'
import { getCameraSetup } from '../../scene/viewTypes'
import type { ViewType } from '../../store/appStore'
import { applyOrthoCamera } from './ViewportCamera'
import { useViewportRuntime } from './ViewportRuntimeContext'
import { ViewportScene } from './ViewportScene'
import { registerWebGLRenderer } from '../../rendering/textureCache'
import type { SceneObject } from '../../mesh/HalfEdgeMesh'
import type { MeshComponentSelection } from '../../mesh/meshSelection'
import type { ActiveTool, SelectionMode } from '../../store/appStore'
import type { ViewportDisplayMode } from '../../rendering/viewportDisplay'

export function ViewportCanvas({
  containerRef,
  cameraRef,
  canvasPointerEvents,
  enableZoom,
  disableMiddlePan,
  isActiveViewport,
  showToolPreviews,
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
  containerRef: React.RefObject<HTMLDivElement | null>
  cameraRef: React.MutableRefObject<THREE.Camera | null>
  canvasPointerEvents: boolean
  enableZoom: boolean
  disableMiddlePan: boolean
  isActiveViewport: boolean
  showToolPreviews: boolean
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
  const {
    view,
    slotIndex,
    continuousFrames,
    quality,
  } = useViewportRuntime()
  const setup = getCameraSetup(view)
  const isOrtho = setup.orthographic

  return (
    <Canvas
      className="viewport-canvas-root"
      frameloop={continuousFrames ? 'always' : 'demand'}
      dpr={quality === 'high' ? ([1, 2] as [number, number]) : 1}
      orthographic={isOrtho}
      eventSource={containerRef as React.RefObject<HTMLElement>}
      camera={{
        position: setup.position,
        zoom: setup.zoom,
        near: 0.1,
        far: 4000,
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
        registerWebGLRenderer(gl)
        cameraRef.current = camera
        applyOrthoCamera(view as ViewType, camera)
      }}
    >
      <ViewportScene
        view={view}
        slotIndex={slotIndex}
        isActiveViewport={isActiveViewport}
        showToolPreviews={showToolPreviews}
        containerRef={containerRef}
        enableZoom={enableZoom}
        disableMiddlePan={disableMiddlePan}
        canvasPointerEvents={canvasPointerEvents}
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
        cadPreviewSignal={cadPreviewSignal}
        primitiveBoxDraft={primitiveBoxDraft}
        multiObjectGizmoActive={multiObjectGizmoActive}
        componentGizmoActive={componentGizmoActive}
        componentGizmoObject={componentGizmoObject}
        billboardImagesLength={billboardImagesLength}
        viewportBg={viewportBg}
      />
    </Canvas>
  )
}
