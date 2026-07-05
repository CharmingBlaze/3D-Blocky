import { useCallback, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { useAppStore, type ViewType } from '../store/appStore'
import { clientToPlane } from '../utils/screenToWorld'
import { isOrthoView } from '../primitives/viewAxes'
import {
  symmetryLineInView,
  symmetryPlaneFromPlanePoint,
  worldSymmetryLineEndpoints,
} from '../symmetry/symmetry'

interface SymmetryPlaneOverlayProps {
  view: ViewType
  containerRef: React.RefObject<HTMLDivElement | null>
  cameraRef: React.RefObject<THREE.Camera | null>
}

function projectWorldToClient(
  world: { x: number; y: number; z: number },
  rect: DOMRect,
  camera: THREE.Camera
): { x: number; y: number } | null {
  camera.updateMatrixWorld()
  if ('updateProjectionMatrix' in camera && typeof camera.updateProjectionMatrix === 'function') {
    camera.updateProjectionMatrix()
  }
  const v = new THREE.Vector3(world.x, world.y, world.z)
  v.project(camera)
  if (v.z > 1) return null
  return {
    x: rect.left + (v.x * 0.5 + 0.5) * rect.width,
    y: rect.top + (-v.y * 0.5 + 0.5) * rect.height,
  }
}

export function SymmetryPlaneOverlay({ view, containerRef, cameraRef }: SymmetryPlaneOverlayProps) {
  const symmetryEnabled = useAppStore((s) => s.symmetryEnabled)
  const symmetryAxis = useAppStore((s) => s.symmetryAxis)
  const symmetryPlane = useAppStore((s) => s.symmetryPlane)
  const defaultDepth = useAppStore((s) => s.defaultDepth)
  const setSymmetryPlane = useAppStore((s) => s.setSymmetryPlane)

  const [linePx, setLinePx] = useState<{
    orientation: 'vertical' | 'horizontal'
    position: number
  } | null>(null)
  const dragRef = useRef(false)

  const updateLine = useCallback(() => {
    const container = containerRef.current
    const camera = cameraRef.current
    if (!container || !camera || !symmetryEnabled || !isOrthoView(view)) {
      setLinePx(null)
      return
    }
    if (!symmetryLineInView(view, symmetryAxis)) {
      setLinePx(null)
      return
    }
    const endpoints = worldSymmetryLineEndpoints(view, symmetryAxis, symmetryPlane, defaultDepth, 800)
    if (!endpoints) {
      setLinePx(null)
      return
    }
    const rect = container.getBoundingClientRect()
    const p0 = projectWorldToClient(endpoints[0], rect, camera)
    const p1 = projectWorldToClient(endpoints[1], rect, camera)
    if (!p0 || !p1) {
      setLinePx(null)
      return
    }
    const info = symmetryLineInView(view, symmetryAxis)!
    setLinePx({
      orientation: info.orientation,
      position: info.orientation === 'vertical' ? (p0.x + p1.x) / 2 : (p0.y + p1.y) / 2,
    })
  }, [
    containerRef,
    cameraRef,
    symmetryEnabled,
    symmetryAxis,
    symmetryPlane,
    defaultDepth,
    view,
  ])

  useEffect(() => {
    updateLine()
    const container = containerRef.current
    const onResize = () => updateLine()
    window.addEventListener('resize', onResize)
    const observer =
      container != null ? new ResizeObserver(onResize) : null
    if (container && observer) observer.observe(container)
    return () => {
      window.removeEventListener('resize', onResize)
      observer?.disconnect()
    }
  }, [updateLine, containerRef])

  const onPointerDown = (e: React.PointerEvent) => {
    if (!linePx || e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    dragRef.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return
    e.preventDefault()
    e.stopPropagation()
    const container = containerRef.current
    const camera = cameraRef.current
    if (!container || !camera || !isOrthoView(view)) return
    const rect = container.getBoundingClientRect()
    const planePt = clientToPlane(e.clientX, e.clientY, rect, camera, view, 0)
    if (!planePt) return
    const next = symmetryPlaneFromPlanePoint(planePt, view, symmetryAxis)
    if (next != null && Number.isFinite(next)) setSymmetryPlane(next)
  }

  const onPointerUp = (e: React.PointerEvent) => {
    if (!dragRef.current) return
    dragRef.current = false
    e.currentTarget.releasePointerCapture(e.pointerId)
  }

  if (!symmetryEnabled || !linePx || !isOrthoView(view)) return null

  const container = containerRef.current
  if (!container) return null
  const rect = container.getBoundingClientRect()

  const style: React.CSSProperties =
    linePx.orientation === 'vertical'
      ? {
          left: linePx.position - rect.left,
          top: 0,
          width: 10,
          height: '100%',
          transform: 'translateX(-50%)',
          cursor: 'ew-resize',
        }
      : {
          left: 0,
          top: linePx.position - rect.top,
          width: '100%',
          height: 10,
          transform: 'translateY(-50%)',
          cursor: 'ns-resize',
        }

  return (
    <div
      className="symmetry-plane-overlay"
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div
        className={`symmetry-plane-line symmetry-plane-line-${linePx.orientation}`}
        aria-hidden
      />
    </div>
  )
}
