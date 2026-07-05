import { memo, useEffect, useRef, type RefObject } from 'react'
import { ThemedTransformControls } from './ThemedTransformControls'
import { useThree } from '@react-three/fiber'
import type * as THREE from 'three'
import { useAppStore, type ActiveTool, type SelectionMode } from '../store/appStore'
import { ensureTransform, getObjectPivot } from '../mesh/objectTransform'
import { registerPickTarget, unregisterPickTarget } from '../select/pickRegistry'
import { MeshRenderer } from './MeshRenderer'
import { MeshEditVisuals } from './MeshEditVisuals'
import type { SceneObject } from '../mesh/HalfEdgeMesh'
import type { ViewportDisplayMode } from '../rendering/viewportDisplay'

function isComponentSelectionMode(mode: SelectionMode): boolean {
  return mode === 'vertex' || mode === 'edge' || mode === 'face'
}

const TRANSFORM_TOOLS: ActiveTool[] = ['move', 'rotate', 'scale']

function toolToMode(tool: ActiveTool): 'translate' | 'rotate' | 'scale' {
  if (tool === 'rotate') return 'rotate'
  if (tool === 'scale') return 'scale'
  return 'translate'
}

interface ObjectNodeProps {
  object: SceneObject
  isSelected: boolean
  isPrimary: boolean
  isGizmoTarget: boolean
  facetExaggeration: number
  showDensityHeatmap: boolean
  selectionMode: SelectionMode
  viewportDisplayMode: ViewportDisplayMode
}

function ObjectMeshEditOverlay({
  object,
  selectionMode,
  isSelected,
}: {
  object: SceneObject
  selectionMode: SelectionMode
  isSelected: boolean
}) {
  const meshSelection = useAppStore((s) =>
    s.meshSelection?.objectId === object.id ? s.meshSelection : null
  )
  const meshHover = useAppStore((s) =>
    s.meshHover?.objectId === object.id ? s.meshHover : null
  )

  const inComponentMode = isComponentSelectionMode(selectionMode)
  const showMeshEdit =
    inComponentMode &&
    (isSelected || meshSelection !== null || meshHover !== null)

  if (!showMeshEdit) return null

  return (
    <MeshEditVisuals
      object={object}
      selectionMode={selectionMode}
      meshSelection={meshSelection}
      meshHover={meshHover}
      showPickableOverlay={isSelected && inComponentMode}
    />
  )
}

function ObjectNodeInner({
  object,
  isSelected,
  isPrimary,
  isGizmoTarget,
  facetExaggeration,
  showDensityHeatmap,
  selectionMode,
  viewportDisplayMode,
}: ObjectNodeProps) {
  const rootRef = useRef<THREE.Group>(null)
  const draggingRef = useRef(false)
  const activeTool = useAppStore((s) => s.activeTool)
  const updateObjectTransform = useAppStore((s) => s.updateObjectTransform)
  const pushHistory = useAppStore((s) => s.pushHistory)
  const savedRef = useRef(false)
  const glDomElement = useThree((s) => s.gl.domElement)

  const tr = ensureTransform(object)
  const pivot = getObjectPivot(object)
  const showObjectGizmo =
    isGizmoTarget &&
    isSelected &&
    selectionMode === 'object' &&
    TRANSFORM_TOOLS.includes(activeTool)

  useEffect(() => {
    const g = rootRef.current
    if (!g || draggingRef.current) return
    g.position.set(tr.position.x, tr.position.y, tr.position.z)
    g.rotation.set(tr.rotation.x, tr.rotation.y, tr.rotation.z)
    g.scale.set(tr.scale.x, tr.scale.y, tr.scale.z)
  }, [tr, object.id])

  useEffect(() => {
    const g = rootRef.current
    if (!g) return
    registerPickTarget(object.id, g)
    return () => unregisterPickTarget(object.id)
  }, [object.id])

  const syncFromGroup = () => {
    const g = rootRef.current
    if (!g) return
    updateObjectTransform(object.id, {
      position: { x: g.position.x, y: g.position.y, z: g.position.z },
      rotation: { x: g.rotation.x, y: g.rotation.y, z: g.rotation.z },
      scale: { x: g.scale.x, y: g.scale.y, z: g.scale.z },
    })
  }

  return (
    <>
      <group ref={rootRef}>
        <group position={[-pivot.x, -pivot.y, -pivot.z]}>
          <MeshRenderer
            object={object}
            isSelected={isSelected}
            isPrimary={isPrimary}
            objectSelectionOutline={isSelected && selectionMode === 'object'}
            facetExaggeration={facetExaggeration}
            showDensityHeatmap={showDensityHeatmap}
            displayMode={viewportDisplayMode}
          />
          <ObjectMeshEditOverlay
            object={object}
            selectionMode={selectionMode}
            isSelected={isSelected}
          />
        </group>
      </group>

      {showObjectGizmo && (
        <ThemedTransformControls
          object={rootRef as RefObject<THREE.Object3D>}
          domElement={glDomElement}
          mode={toolToMode(activeTool)}
          space="world"
          size={1.2}
          onMouseDown={() => {
            draggingRef.current = true
            if (!savedRef.current) {
              pushHistory()
              savedRef.current = true
            }
          }}
          onMouseUp={() => {
            draggingRef.current = false
            savedRef.current = false
            syncFromGroup()
          }}
          onObjectChange={syncFromGroup}
        />
      )}
    </>
  )
}

export const ObjectNode = memo(ObjectNodeInner, (prev, next) =>
  prev.object === next.object &&
  prev.isSelected === next.isSelected &&
  prev.isPrimary === next.isPrimary &&
  prev.isGizmoTarget === next.isGizmoTarget &&
  prev.facetExaggeration === next.facetExaggeration &&
  prev.showDensityHeatmap === next.showDensityHeatmap &&
  prev.selectionMode === next.selectionMode &&
  prev.viewportDisplayMode === next.viewportDisplayMode
)
