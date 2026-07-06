import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { ThemedTransformControls } from './ThemedTransformControls'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { SceneObject } from '../mesh/HalfEdgeMesh'
import {
  getAffectedVertices,
  meshSelectionWorldCenter,
  transformMeshSelectionWithGizmo,
  type MeshComponentSelection,
} from '../mesh/meshSelection'
import { useAppStore, type ActiveTool } from '../store/appStore'

const TRANSFORM_TOOLS: ActiveTool[] = ['move', 'rotate', 'scale']

function toolToMode(tool: ActiveTool): 'translate' | 'rotate' | 'scale' {
  if (tool === 'rotate') return 'rotate'
  if (tool === 'scale') return 'scale'
  return 'translate'
}

interface MeshSelectionGizmoProps {
  object: SceneObject
  meshSelection: MeshComponentSelection
  activeTool: ActiveTool
}

type DragState = {
  basePositions: Record<number, Vec3>
  pivotWorld: THREE.Vector3
  startPosition: THREE.Vector3
  startQuaternion: THREE.Quaternion
  startScale: THREE.Vector3
}

type Vec3 = { x: number; y: number; z: number }

export function MeshSelectionGizmo({
  object,
  meshSelection,
  activeTool,
}: MeshSelectionGizmoProps) {
  const anchorRef = useRef<THREE.Object3D>(null)
  const draggingRef = useRef(false)
  const dragStateRef = useRef<DragState | null>(null)
  const changedRef = useRef(false)
  const glDomElement = useThree((s) => s.gl.domElement)

  const commitHistory = useAppStore((s) => s.commitHistory)
  const updateObject = useAppStore((s) => s.updateObject)

  const center = useMemo(
    () => meshSelectionWorldCenter(object, meshSelection),
    [object, meshSelection]
  )

  useEffect(() => {
    const anchor = anchorRef.current
    if (!anchor || draggingRef.current) return
    anchor.position.set(center.x, center.y, center.z)
    anchor.rotation.set(0, 0, 0)
    anchor.scale.set(1, 1, 1)
    anchor.updateMatrixWorld()
  }, [center, activeTool])

  const beginDrag = () => {
    const anchor = anchorRef.current
    if (!anchor || object.topologyLocked) return

    draggingRef.current = true
    changedRef.current = false

    const verts = getAffectedVertices(meshSelection, object)
    const basePositions: Record<number, Vec3> = {}
    for (const vi of verts) {
      basePositions[vi] = { ...object.positions[vi] }
    }

    dragStateRef.current = {
      basePositions,
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

    const verts = getAffectedVertices(meshSelection, object)
    const positions = transformMeshSelectionWithGizmo(
      object,
      verts,
      drag.basePositions,
      { x: drag.pivotWorld.x, y: drag.pivotWorld.y, z: drag.pivotWorld.z },
      drag.startPosition,
      drag.startQuaternion,
      drag.startScale,
      anchor.position,
      anchor.quaternion,
      anchor.scale
    )

    const live = useAppStore.getState().objects.find((o) => o.id === object.id)
    if (live) {
      let moved = false
      for (const vi of verts) {
        const next = positions[vi]
        const prev = live.positions[vi]
        if (!next || !prev) continue
        if (
          Math.abs(next.x - prev.x) > 1e-6 ||
          Math.abs(next.y - prev.y) > 1e-6 ||
          Math.abs(next.z - prev.z) > 1e-6
        ) {
          moved = true
          break
        }
      }
      if (!moved) return
    }

    updateObject(object.id, { positions })
    changedRef.current = true
  }

  const endDrag = () => {
    const drag = dragStateRef.current
    draggingRef.current = false

    let changed = false
    if (drag) {
      const latest = useAppStore.getState().objects.find((o) => o.id === object.id)
      if (latest) {
        for (const vi of Object.keys(drag.basePositions).map(Number)) {
          const base = drag.basePositions[vi]
          const cur = latest.positions[vi]
          if (!base || !cur) continue
          if (
            Math.abs(base.x - cur.x) > 1e-6 ||
            Math.abs(base.y - cur.y) > 1e-6 ||
            Math.abs(base.z - cur.z) > 1e-6
          ) {
            changed = true
            break
          }
        }
      }
    }

    dragStateRef.current = null
    if (changed) {
      commitHistory('Transform components')
    }
    changedRef.current = false

    const anchor = anchorRef.current
    if (!anchor) return

    const latest = useAppStore.getState().objects.find((o) => o.id === object.id)
    if (!latest) return

    const c = meshSelectionWorldCenter(latest, meshSelection)
    anchor.position.set(c.x, c.y, c.z)
    anchor.rotation.set(0, 0, 0)
    anchor.scale.set(1, 1, 1)
    anchor.updateMatrixWorld()
  }

  if (!TRANSFORM_TOOLS.includes(activeTool) || object.topologyLocked) {
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
        size={1.1}
        onMouseDown={beginDrag}
        onMouseUp={endDrag}
        onObjectChange={applyGizmo}
      />
    </>
  )
}
