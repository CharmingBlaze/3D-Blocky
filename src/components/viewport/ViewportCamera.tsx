import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Vector3 } from 'three'
import type * as THREE from 'three'
import { useAppStore, type ViewType } from '../../store/appStore'
import { getCameraSetup } from '../../scene/viewTypes'
import { applyViewportFit } from '../../viewport/fitViewports'
import { invalidateViewport } from '../../rendering/viewportInvalidation'
import { useViewportRuntime } from './ViewportRuntimeContext'

const _viewMoveRight = new Vector3()
const _viewMoveUp = new Vector3()
const _viewMoveForward = new Vector3()

export function applyOrthoCamera(view: ViewType, camera: THREE.Camera): void {
  if (view === 'perspective') return
  const setup = getCameraSetup(view)
  camera.up.set(setup.up[0], setup.up[1], setup.up[2])
  camera.lookAt(0, 0, 0)
  if ('updateProjectionMatrix' in camera && typeof camera.updateProjectionMatrix === 'function') {
    camera.updateProjectionMatrix()
  }
}

export function ViewMoveBasisSync({ enabled }: { enabled: boolean }) {
  const setViewMoveBasis = useAppStore((s) => s.setViewMoveBasis)
  const lastBasisRef = useRef<{ right: { x: number; y: number; z: number }; up: { x: number; y: number; z: number } } | null>(null)

  useFrame(({ camera }) => {
    if (!enabled) return
    camera.matrixWorld.extractBasis(_viewMoveRight, _viewMoveUp, _viewMoveForward)

    const prev = lastBasisRef.current
    const next = {
      right: { x: _viewMoveRight.x, y: _viewMoveRight.y, z: _viewMoveRight.z },
      up: { x: _viewMoveUp.x, y: _viewMoveUp.y, z: _viewMoveUp.z },
    }
    if (
      prev &&
      Math.abs(prev.right.x - next.right.x) < 1e-4 &&
      Math.abs(prev.right.y - next.right.y) < 1e-4 &&
      Math.abs(prev.right.z - next.right.z) < 1e-4 &&
      Math.abs(prev.up.x - next.up.x) < 1e-4 &&
      Math.abs(prev.up.y - next.up.y) < 1e-4 &&
      Math.abs(prev.up.z - next.up.z) < 1e-4
    ) {
      return
    }
    lastBasisRef.current = next
    setViewMoveBasis(next)
  })

  useEffect(() => {
    if (!enabled) {
      lastBasisRef.current = null
      setViewMoveBasis(null)
    }
  }, [enabled, setViewMoveBasis])

  return null
}

/** Applies store fit requests: reset each view’s orientation and frame the selection. */
export function ViewportFitController({ view }: { view: ViewType }) {
  const fitRequest = useAppStore((s) => s.viewportFitRequest)
  const camera = useThree((s) => s.camera)
  const controls = useThree((s) => s.controls)
  const size = useThree((s) => s.size)
  const { slotIndex, layoutVisible } = useViewportRuntime()
  const lastNonceRef = useRef(0)

  useEffect(() => {
    if (!fitRequest || fitRequest.nonce === lastNonceRef.current) return
    lastNonceRef.current = fitRequest.nonce
    const orbit =
      controls &&
      typeof controls === 'object' &&
      'target' in controls &&
      'update' in controls
        ? (controls as { target: THREE.Vector3; update: () => void })
        : null
    applyViewportFit(camera, orbit, view, fitRequest, size)
    if (layoutVisible) invalidateViewport(slotIndex, 'fit')
  }, [fitRequest, camera, controls, view, size, slotIndex, layoutVisible])

  return null
}

export function ViewportCamera({
  view,
  isActiveViewport,
}: {
  view: ViewType
  isActiveViewport: boolean
}) {
  return (
    <>
      <ViewMoveBasisSync enabled={isActiveViewport && view === 'perspective'} />
      <ViewportFitController view={view} />
    </>
  )
}
