import { MeshSelectionGizmo } from '../MeshSelectionGizmo'
import { ObjectSelectionGizmo } from '../ObjectSelectionGizmo'
import { PrimitiveBoxCanvas } from '../PrimitiveBoxCanvas'
import { PolyDrawVisuals } from '../PolyDrawVisuals'
import { KnifeVisuals } from '../KnifeVisuals'
import { BendVisuals } from '../BendVisuals'
import { LoopCutVisuals } from '../LoopCutVisuals'
import { DrawVertexOverlay } from '../DrawVertexOverlay'
import { StrokeCanvas } from '../StrokeCanvas'
import { SketchSourceVisuals } from '../SketchSourceVisuals'
import { VectorCanvas } from '../VectorCanvas'
import { BillboardImages } from '../BillboardImages'
import type { SceneObject } from '../../mesh/HalfEdgeMesh'
import type { MeshComponentSelection } from '../../mesh/meshSelection'
import type { ActiveTool, ViewType } from '../../store/appStore'
import { useViewportRuntime } from './ViewportRuntimeContext'

/**
 * Tool previews and gizmos.
 * Live CAD/stroke drafts mount in every visible slot so Quad View stays synced.
 * Selection gizmos follow caller flags. Committed geometry stays in ViewportObjects.
 */
export function ViewportToolOverlays({
  view,
  showToolPreviews,
  activeTool,
  primitiveBoxDraft,
  multiObjectGizmoActive,
  componentGizmoActive,
  selectionObjectIds,
  meshSelection,
  componentGizmoObject,
  billboardImagesLength,
}: {
  view: ViewType
  /** Knife / bend / poly-draw / stroke — every visible slot. */
  showToolPreviews: boolean
  activeTool: ActiveTool
  primitiveBoxDraft: unknown
  multiObjectGizmoActive: boolean
  componentGizmoActive: boolean
  selectionObjectIds: string[]
  meshSelection: MeshComponentSelection | null
  componentGizmoObject: SceneObject | null | undefined
  billboardImagesLength: number
}) {
  const { layoutVisible } = useViewportRuntime()
  if (!layoutVisible) return null

  return (
    <>
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

      {showToolPreviews && (activeTool === 'primitive-box' || primitiveBoxDraft) && (
        <PrimitiveBoxCanvas />
      )}
      {showToolPreviews && activeTool === 'poly-draw' && <PolyDrawVisuals />}
      {showToolPreviews && activeTool === 'knife' && <KnifeVisuals />}
      {showToolPreviews && activeTool === 'bend' && <BendVisuals />}
      {showToolPreviews && activeTool === 'loop-cut' && <LoopCutVisuals />}
      {showToolPreviews && <DrawVertexOverlay />}
      {showToolPreviews && <SketchSourceVisuals />}
      {billboardImagesLength > 0 && <BillboardImages />}

      {/* Stroke preview mounts in perspective too (world-space ExtrudePreviewMesh). */}
      {showToolPreviews && <StrokeCanvas view={view} />}
      {showToolPreviews && view !== 'perspective' && <VectorCanvas view={view} />}
    </>
  )
}
