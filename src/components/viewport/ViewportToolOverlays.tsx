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
import { useAppStore } from '../../store/appStore'
import { useViewportRuntime } from './ViewportRuntimeContext'
import * as THREE from 'three'
import { useMemo } from 'react'

function ActiveAxisLine({ modal }: { modal: any }) {
  const color = modal.axisLock === 'x' ? '#ff3333' : modal.axisLock === 'y' ? '#33ff33' : '#3333ff'
  
  const points = useMemo(() => {
    const pts = []
    const pivot = modal.pivotWorld
    const extent = 1000
    if (modal.axisLock === 'x') {
      pts.push(new THREE.Vector3(pivot.x - extent, pivot.y, pivot.z))
      pts.push(new THREE.Vector3(pivot.x + extent, pivot.y, pivot.z))
    } else if (modal.axisLock === 'y') {
      pts.push(new THREE.Vector3(pivot.x, pivot.y - extent, pivot.z))
      pts.push(new THREE.Vector3(pivot.x, pivot.y + extent, pivot.z))
    } else if (modal.axisLock === 'z') {
      pts.push(new THREE.Vector3(pivot.x, pivot.y, pivot.z - extent))
      pts.push(new THREE.Vector3(pivot.x, pivot.y, pivot.z + extent))
    }
    return pts
  }, [modal.axisLock, modal.pivotWorld])

  const geometry = useMemo(() => {
    return new THREE.BufferGeometry().setFromPoints(points)
  }, [points])

  const lineObject = useMemo(() => {
    return new THREE.Line(
      geometry,
      new THREE.LineBasicMaterial({ color, depthTest: false, depthWrite: false, transparent: true, opacity: 0.6 })
    )
  }, [geometry, color])

  return <primitive object={lineObject} />
}

function ModalAxisLine() {
  const meshModal = useAppStore((s) => s.meshModal)
  const objModal = useAppStore((s) => s.objectTransformModal)
  const modal = meshModal || objModal
  if (!modal || !modal.axisLock) return null

  return <ActiveAxisLine modal={modal} />
}

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
      {showToolPreviews && (activeTool === 'knife' || activeTool === 'mirror-knife') && (
        <KnifeVisuals />
      )}
      {showToolPreviews && activeTool === 'bend' && <BendVisuals />}
      {showToolPreviews && activeTool === 'loop-cut' && <LoopCutVisuals />}
      {showToolPreviews && <DrawVertexOverlay />}
      {showToolPreviews && <SketchSourceVisuals />}
      {billboardImagesLength > 0 && <BillboardImages />}

      {/* Stroke preview mounts in perspective too (world-space ExtrudePreviewMesh). */}
      {showToolPreviews && <StrokeCanvas view={view} />}
      {showToolPreviews && view !== 'perspective' && <VectorCanvas view={view} />}

      <ModalAxisLine />
    </>
  )
}
