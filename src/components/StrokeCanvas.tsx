import { useMemo, useRef } from 'react'
import { Line } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore, type ViewType } from '../store/appStore'
import { planeToStroke3D } from '../utils/screenToWorld'
import { isSketchNearClose } from '../stroke/sketchDoodle'
import { useTheme } from '../theme/useTheme'
import { ExtrudePreviewMesh } from './ExtrudePreviewMesh'
import type { Vec2 } from '../utils/math'
import { worldUnitsForScreenPixels } from '../utils/screenScale'

interface StrokeCanvasProps {
  view: ViewType
}

function SketchPointMarker({
  position,
  color,
  outline,
  sizePx,
}: {
  position: [number, number, number]
  color: string
  outline: string
  sizePx: number
}) {
  const rootRef = useRef<THREE.Group>(null)
  const worldRef = useRef(new THREE.Vector3())
  const { camera, size } = useThree()

  useFrame(() => {
    const root = rootRef.current
    if (!root) return
    root.quaternion.copy(camera.quaternion)
    const world = worldRef.current.set(position[0], position[1], position[2])
    root.scale.setScalar(worldUnitsForScreenPixels(camera, world, sizePx, size.height))
  })

  return (
    <group ref={rootRef} position={position} renderOrder={24}>
      <mesh position={[0, 0, -0.01]}>
        <planeGeometry args={[1.5, 1.5]} />
        <meshBasicMaterial color={outline} depthTest={false} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial color={color} depthTest={false} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  )
}

export function StrokeCanvas({ view }: StrokeCanvasProps) {
  const { accentGreen } = useTheme()
  const {
    currentStroke,
    currentStrokePreview,
    currentStrokeView,
    currentStrokePlane,
    isDrawing,
    activeColor,
    defaultDepth,
    autoConnectPaths,
    closeThreshold,
  } = useAppStore(
    useShallow((s) => ({
      currentStroke: s.currentStroke,
      currentStrokePreview: s.currentStrokePreview,
      currentStrokeView: s.currentStrokeView,
      currentStrokePlane: s.currentStrokePlane,
      isDrawing: s.isDrawing,
      activeColor: s.activeColor,
      defaultDepth: s.defaultDepth,
      autoConnectPaths: s.autoConnectPaths,
      closeThreshold: s.closeThreshold,
    }))
  )

  const nearClose = useMemo(
    () =>
      autoConnectPaths &&
      isSketchNearClose(currentStroke, currentStrokePreview, closeThreshold),
    [autoConnectPaths, currentStroke, currentStrokePreview, closeThreshold]
  )

  /** Plane points for the live 3D preview (shared across every viewport). */
  const previewPoints = useMemo((): Vec2[] => {
    if (!isDrawing || !currentStrokeView) return []
    if (currentStrokeView === 'perspective' && !currentStrokePlane) return []
    if (currentStroke.length === 0) return []
    const pts = [...currentStroke]
    if (
      currentStrokePreview &&
      (pts.length === 0 ||
        pts[pts.length - 1]!.x !== currentStrokePreview.x ||
        pts[pts.length - 1]!.y !== currentStrokePreview.y)
    ) {
      pts.push(currentStrokePreview)
    }
    return pts
  }, [isDrawing, currentStrokeView, currentStrokePlane, currentStroke, currentStrokePreview])

  const showPlaneGuides = isDrawing && currentStrokeView === view
  // Keep the drawing view clean — only a thin path. Volume hull lives in peer views.
  const showVolumePreview =
    isDrawing &&
    currentStrokeView != null &&
    !(currentStrokeView === 'perspective' && !currentStrokePlane) &&
    currentStrokeView !== view &&
    previewPoints.length >= 2

  const strokePath = useMemo(() => {
    if (!showPlaneGuides || currentStroke.length === 0) return []
    return previewPoints.map((p) =>
      planeToStroke3D(p.x, p.y, view, defaultDepth, currentStrokePlane)
    )
  }, [
    showPlaneGuides,
    currentStroke.length,
    previewPoints,
    view,
    defaultDepth,
    currentStrokePlane,
  ])

  if (!isDrawing || previewPoints.length === 0) return null

  const color = `#${activeColor.toString(16).padStart(6, '0')}`
  const firstPoint = strokePath[0]
  const currentPoint = strokePath[strokePath.length - 1]

  return (
    <>
      {showVolumePreview && currentStrokeView && (
        <ExtrudePreviewMesh
          points={previewPoints}
          view={currentStrokeView}
          closed={nearClose}
        />
      )}

      {showPlaneGuides && strokePath.length >= 2 && (
        <Line
          points={strokePath}
          color={color}
          lineWidth={1.25}
          transparent
          opacity={0.75}
          depthTest={false}
        />
      )}
      {showPlaneGuides && firstPoint && (
        <SketchPointMarker
          position={[firstPoint.x, firstPoint.y, firstPoint.z]}
          color={nearClose ? accentGreen : color}
          outline="#f7fbff"
          sizePx={nearClose ? 12 : 9}
        />
      )}
      {showPlaneGuides && currentPoint && strokePath.length > 1 && (
        <SketchPointMarker
          position={[currentPoint.x, currentPoint.y, currentPoint.z]}
          color={currentStrokePreview ? color : '#f7fbff'}
          outline="#11151c"
          sizePx={8}
        />
      )}
    </>
  )
}
