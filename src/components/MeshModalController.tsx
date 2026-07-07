import { useEffect } from 'react'
import { useAppStore } from '../store/appStore'
import { formatModalValue } from '../mesh/meshOps'
import { formatObjectTransformModalValue } from '../mesh/objectTransformModal'

const MESH_OP_LABELS = {
  extrude: 'Extrude',
  rotate: 'Rotate',
  scale: 'Scale',
  bevel: 'Bevel',
} as const

const OBJECT_OP_LABELS = {
  rotate: 'Rotate',
  scale: 'Scale',
} as const

export function MeshModalController() {
  const meshModal = useAppStore((s) => s.meshModal)
  const objectTransformModal = useAppStore((s) => s.objectTransformModal)
  const updateMeshModalFromPointer = useAppStore((s) => s.updateMeshModalFromPointer)
  const adjustMeshModalWheel = useAppStore((s) => s.adjustMeshModalWheel)
  const confirmMeshModal = useAppStore((s) => s.confirmMeshModal)
  const updateObjectTransformModalFromPointer = useAppStore(
    (s) => s.updateObjectTransformModalFromPointer
  )
  const adjustObjectTransformModalWheel = useAppStore((s) => s.adjustObjectTransformModalWheel)
  const confirmObjectTransformModal = useAppStore((s) => s.confirmObjectTransformModal)

  const activeModal = meshModal ? 'mesh' : objectTransformModal ? 'object' : null

  useEffect(() => {
    if (!activeModal) return

    const onMove = (e: PointerEvent) => {
      if (meshModal) {
        updateMeshModalFromPointer(e.clientX, e.clientY, e.shiftKey, e.ctrlKey)
      } else if (objectTransformModal) {
        updateObjectTransformModalFromPointer(e.clientX, e.clientY, e.shiftKey, e.ctrlKey)
      }
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (meshModal) adjustMeshModalWheel(e.deltaY)
      else if (objectTransformModal) adjustObjectTransformModalWheel(e.deltaY)
    }

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }
      if (e.target instanceof HTMLElement && e.target.closest('.side-panel, .tool-ring-overlay')) {
        return
      }
      e.preventDefault()
      if (meshModal) confirmMeshModal()
      else if (objectTransformModal) confirmObjectTransformModal()
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('pointerdown', onPointerDown, true)

    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [
    activeModal,
    meshModal,
    objectTransformModal,
    updateMeshModalFromPointer,
    adjustMeshModalWheel,
    confirmMeshModal,
    updateObjectTransformModalFromPointer,
    adjustObjectTransformModalWheel,
    confirmObjectTransformModal,
  ])

  if (meshModal) {
    const label = MESH_OP_LABELS[meshModal.op]
    const value = formatModalValue(meshModal.op, meshModal.value)
    const hint =
      meshModal.op === 'extrude'
        ? 'Up/right extrude · left/down inset · scroll to adjust · click to confirm · Esc cancel'
        : meshModal.op === 'rotate'
          ? 'Move mouse horizontally · scroll to adjust · click to confirm · Esc cancel'
          : meshModal.op === 'scale'
            ? 'Move mouse up/down · scroll to adjust · click to confirm · Esc cancel'
            : 'Move mouse · scroll to adjust · click to confirm · Esc cancel'

    return (
      <div className="mesh-modal-hud" role="status">
        <strong>{label}</strong>
        <span className="mesh-modal-value">{value}</span>
        <span className="mesh-modal-hint">{hint}</span>
      </div>
    )
  }

  if (objectTransformModal) {
    const label = OBJECT_OP_LABELS[objectTransformModal.op]
    const value = formatObjectTransformModalValue(
      objectTransformModal.op,
      objectTransformModal.value
    )
    const hint =
      objectTransformModal.op === 'rotate'
        ? 'Move mouse horizontally · scroll to adjust · click to confirm · Esc cancel'
        : 'Move mouse up/down · scroll to adjust · click to confirm · Esc cancel'

    return (
      <div className="mesh-modal-hud" role="status">
        <strong>{label}</strong>
        <span className="mesh-modal-value">{value}</span>
        <span className="mesh-modal-hint">{hint}</span>
      </div>
    )
  }

  return null
}
