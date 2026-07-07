import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { ThemedTransformControls } from './ThemedTransformControls'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import {
  cloneTransform,
  ensureTransform,
  selectionWorldCenter,
  transformObjectsWithGizmo,
} from '../mesh/objectTransform'
import { useAppStore, type ActiveTool } from '../store/appStore'

const TRANSFORM_TOOLS: ActiveTool[] = ['move', 'rotate', 'scale']

function toolToMode(tool: ActiveTool): 'translate' | 'rotate' | 'scale' {
  if (tool === 'rotate') return 'rotate'
  if (tool === 'scale') return 'scale'
  return 'translate'
}

type DragState = {
  baseTransforms: Record<string, ReturnType<typeof cloneTransform>>
  objectIds: string[]
  pivotWorld: THREE.Vector3
  startPosition: THREE.Vector3
  startQuaternion: THREE.Quaternion
  startScale: THREE.Vector3
}

interface ObjectSelectionGizmoProps {
  selectionObjectIds: string[]
  activeTool: ActiveTool
}

export function ObjectSelectionGizmo({
  selectionObjectIds,
  activeTool,
}: ObjectSelectionGizmoProps) {
  const anchorRef = useRef<THREE.Object3D>(null)
  const draggingRef = useRef(false)
  const dragStateRef = useRef<DragState | null>(null)
  const glDomElement = useThree((s) => s.gl.domElement)

  const objects = useAppStore((s) => s.objects)
  const commitHistory = useAppStore((s) => s.commitHistory)
  const updateSelectionObjectTransforms = useAppStore((s) => s.updateSelectionObjectTransforms)

  const center = useMemo(
    () => selectionWorldCenter(objects, selectionObjectIds),
    [objects, selectionObjectIds]
  )

  useEffect(() => {
    const anchor = anchorRef.current
    if (!anchor || draggingRef.current) return
    anchor.position.set(center.x, center.y, center.z)
    anchor.rotation.set(0, 0, 0)
    anchor.scale.set(1, 1, 1)
    anchor.updateMatrixWorld()
  }, [center, activeTool, selectionObjectIds.join(',')])

  const beginDrag = () => {
    const anchor = anchorRef.current
    if (!anchor || selectionObjectIds.length === 0) return

    draggingRef.current = true

    const baseTransforms: DragState['baseTransforms'] = {}
    for (const id of selectionObjectIds) {
      const obj = objects.find((o) => o.id === id)
      if (obj) baseTransforms[id] = cloneTransform(ensureTransform(obj))
    }

    dragStateRef.current = {
      baseTransforms,
      objectIds: [...selectionObjectIds],
      pivotWorld: new THREE.Vector3(center.x, center.y, center.z),
      startPosition: anchor.position.clone(),
      startQuaternion: anchor.quaternion.clone(),
      startScale: anchor.scale.clone(),
    }
  }

  const applyGizmo = () => {
    const anchor = anchorRef.current
    const drag = dragStateRef.current
    if (!anchor || !drag) return

    const transforms = transformObjectsWithGizmo(
      drag.baseTransforms,
      drag.objectIds,
      { x: drag.pivotWorld.x, y: drag.pivotWorld.y, z: drag.pivotWorld.z },
      drag.startPosition,
      drag.startQuaternion,
      drag.startScale,
      anchor.position,
      anchor.quaternion,
      anchor.scale
    )

    updateSelectionObjectTransforms(transforms)
  }

  const endDrag = () => {
    const drag = dragStateRef.current
    draggingRef.current = false

    let changed = false
    if (drag) {
      const latest = useAppStore.getState().objects
      for (const id of drag.objectIds) {
        const base = drag.baseTransforms[id]
        const obj = latest.find((o) => o.id === id)
        if (!base || !obj) continue
        const current = ensureTransform(obj)
        if (
          Math.abs(base.position.x - current.position.x) > 1e-6 ||
          Math.abs(base.position.y - current.position.y) > 1e-6 ||
          Math.abs(base.position.z - current.position.z) > 1e-6 ||
          Math.abs(base.rotation.x - current.rotation.x) > 1e-6 ||
          Math.abs(base.rotation.y - current.rotation.y) > 1e-6 ||
          Math.abs(base.rotation.z - current.rotation.z) > 1e-6 ||
          Math.abs(base.scale.x - current.scale.x) > 1e-6 ||
          Math.abs(base.scale.y - current.scale.y) > 1e-6 ||
          Math.abs(base.scale.z - current.scale.z) > 1e-6
        ) {
          changed = true
          break
        }
      }
    }

    dragStateRef.current = null
    if (changed) {
      commitHistory('Transform selection')
    }

    const anchor = anchorRef.current
    if (!anchor) return
    const c = selectionWorldCenter(useAppStore.getState().objects, selectionObjectIds)
    anchor.position.set(c.x, c.y, c.z)
    anchor.rotation.set(0, 0, 0)
    anchor.scale.set(1, 1, 1)
    anchor.updateMatrixWorld()
  }

  if (!TRANSFORM_TOOLS.includes(activeTool) || selectionObjectIds.length < 2) {
    return null
  }

  return (
    <>
      <object3D ref={anchorRef} />
      <ThemedTransformControls
        object={anchorRef as RefObject<THREE.Object3D>}
        domElement={glDomElement}
        mode={toolToMode(activeTool)}
        space="world"
        size={1.2}
        onMouseDown={beginDrag}
        onMouseUp={endDrag}
        onObjectChange={applyGizmo}
      />
    </>
  )
}
