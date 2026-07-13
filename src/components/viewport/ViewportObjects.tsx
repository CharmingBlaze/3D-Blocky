import { ObjectNode } from '../ObjectNode'
import type { SceneObject } from '../../mesh/HalfEdgeMesh'
import type { SelectionMode } from '../../store/appStore'
import type { ViewportDisplayMode } from '../../rendering/viewportDisplay'

export function ViewportObjects({
  objects,
  selectedObjectSet,
  selectedObjectId,
  gizmoTargetId,
  facetExaggeration,
  showDensityHeatmap,
  selectionMode,
  viewportDisplayMode,
  viewportXRay,
}: {
  objects: SceneObject[]
  selectedObjectSet: Set<string>
  selectedObjectId: string | null
  gizmoTargetId: string | null
  facetExaggeration: number
  showDensityHeatmap: boolean
  selectionMode: SelectionMode
  viewportDisplayMode: ViewportDisplayMode
  viewportXRay: boolean
}) {
  return (
    <>
      {objects.map((obj) => (
        <ObjectNode
          key={obj.id}
          object={obj}
          isSelected={selectedObjectSet.has(obj.id)}
          isPrimary={obj.id === selectedObjectId}
          isGizmoTarget={obj.id === gizmoTargetId}
          facetExaggeration={facetExaggeration}
          showDensityHeatmap={showDensityHeatmap}
          selectionMode={selectionMode}
          viewportDisplayMode={viewportDisplayMode}
          viewportXRay={viewportXRay}
        />
      ))}
    </>
  )
}
