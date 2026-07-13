import { memo, useEffect, useRef, type RefObject } from 'react'
import { ThemedTransformControls } from './ThemedTransformControls'
import { useThree } from '@react-three/fiber'
import type * as THREE from 'three'
import { useAppStore, type ActiveTool, type SelectionMode } from '../store/appStore'
import { ensureTransform, getObjectPivot, cloneTransform, transformFromObject3D, transformsEqual } from '../mesh/objectTransform'
import { registerPickTarget, unregisterPickTarget } from '../select/pickRegistry'
import { useViewportSlotIndex } from './viewport/ViewportRuntimeContext'
import { MeshRenderer } from './MeshRenderer'
import { MeshEditVisuals } from './MeshEditVisuals'
import { NormalVisuals } from './NormalVisuals'
import type { SceneObject } from '../mesh/HalfEdgeMesh'
import type { ViewportDisplayMode } from '../rendering/viewportDisplay'
import { VIEWPORT_DISPLAY_CONFIG } from '../rendering/viewportDisplay'

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
  viewportXRay: boolean
}

function ObjectMeshEditOverlay({
  object,
  selectionMode,
  isSelected,
  showNormals,
}: {
  object: SceneObject
  selectionMode: SelectionMode
  isSelected: boolean
  showNormals: boolean
}) {
  const activeTool = useAppStore((s) => s.activeTool)
  const isDrawing = useAppStore((s) => s.isDrawing)
  const meshSelection = useAppStore((s) =>
    s.meshSelection?.objectId === object.id ? s.meshSelection : null
  )
  const meshHover = useAppStore((s) =>
    s.meshHover?.objectId === object.id ? s.meshHover : null
  )

  // Knife / loop-cut use their own overlays — hide edit handles so the view stays clean.
  if (isDrawing || activeTool === 'knife' || activeTool === 'loop-cut') {
    if (!showNormals) return null
    return (
      <NormalVisuals
        object={object}
        meshSelection={meshSelection}
        meshHover={meshHover}
      />
    )
  }

  const inComponentMode = isComponentSelectionMode(selectionMode)
  const showMeshEdit =
    inComponentMode &&
    (isSelected || meshSelection !== null || meshHover !== null)

  if (!showMeshEdit && !showNormals) return null

  return (
    <>
      {showMeshEdit && (
        <MeshEditVisuals
          object={object}
          selectionMode={selectionMode}
          meshSelection={meshSelection}
          meshHover={meshHover}
          showPickableOverlay={isSelected && inComponentMode}
        />
      )}
      {showNormals && (
        <NormalVisuals
          object={object}
          meshSelection={meshSelection}
          meshHover={meshHover}
        />
      )}
    </>
  )
}

/** Subscribes to activeTool only for the gizmo target — keeps other ObjectNodes memo-stable. */
function ObjectTransformGizmo({
  object,
  rootRef,
  draggingRef,
}: {
  object: SceneObject
  rootRef: RefObject<THREE.Group | null>
  draggingRef: React.MutableRefObject<boolean>
}) {
  const activeTool = useAppStore((s) => s.activeTool)
  const updateObjectTransform = useAppStore((s) => s.updateObjectTransform)
  const commitHistory = useAppStore((s) => s.commitHistory)
  const glDomElement = useThree((s) => s.gl.domElement)
  const dragBaseTransformRef = useRef<ReturnType<typeof cloneTransform> | null>(null)

  if (!TRANSFORM_TOOLS.includes(activeTool)) return null

  const syncFromGroup = () => {
    const g = rootRef.current
    if (!g) return
    const next = transformFromObject3D(g)
    const live = useAppStore.getState().objects.find((o) => o.id === object.id)
    const current = live ? ensureTransform(live) : null
    if (current && transformsEqual(next, current)) return
    updateObjectTransform(object.id, next)
  }

  return (
    <ThemedTransformControls
      object={rootRef as RefObject<THREE.Object3D>}
      domElement={glDomElement}
      mode={toolToMode(activeTool)}
      space="world"
      size={1.2}
      onMouseDown={() => {
        draggingRef.current = true
        dragBaseTransformRef.current = cloneTransform(ensureTransform(object))
      }}
      onMouseUp={() => {
        draggingRef.current = false
        const base = dragBaseTransformRef.current
        const g = rootRef.current
        if (base && g) {
          const final = transformFromObject3D(g)
          if (!transformsEqual(base, final)) {
            syncFromGroup()
            commitHistory('Transform')
          }
        }
        dragBaseTransformRef.current = null
      }}
      onObjectChange={() => {
        syncFromGroup()
      }}
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
  viewportXRay,
}: ObjectNodeProps) {
  const rootRef = useRef<THREE.Group>(null)
  const draggingRef = useRef(false)
  const slotIndex = useViewportSlotIndex()
  const isDrawing = useAppStore((s) => s.isDrawing)

  const tr = ensureTransform(object)
  const pivot = getObjectPivot(object)
  const showObjectGizmo =
    isGizmoTarget && isSelected && selectionMode === 'object'

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
    registerPickTarget(slotIndex, object.id, g)
    return () => unregisterPickTarget(slotIndex, object.id)
  }, [object.id, slotIndex])

  return (
    <>
      <group ref={rootRef}>
        <group position={[-pivot.x, -pivot.y, -pivot.z]}>
          <MeshRenderer
            object={object}
            isSelected={isSelected}
            isPrimary={isPrimary}
            objectSelectionOutline={isSelected && selectionMode === 'object' && !isDrawing}
            facetExaggeration={facetExaggeration}
            showDensityHeatmap={showDensityHeatmap}
            displayMode={viewportDisplayMode}
            viewportXRay={viewportXRay}
          />
          <ObjectMeshEditOverlay
            object={object}
            selectionMode={selectionMode}
            isSelected={isSelected}
            showNormals={VIEWPORT_DISPLAY_CONFIG[viewportDisplayMode].showNormals}
          />
        </group>
      </group>

      {showObjectGizmo && (
        <ObjectTransformGizmo object={object} rootRef={rootRef} draggingRef={draggingRef} />
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
  prev.viewportDisplayMode === next.viewportDisplayMode &&
  prev.viewportXRay === next.viewportXRay
)
