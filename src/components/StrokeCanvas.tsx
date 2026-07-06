import { useMemo } from 'react'
import { Line } from '@react-three/drei'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore, type ViewType } from '../store/appStore'
import { planeToStroke3D } from '../utils/screenToWorld'
import { isSketchNearClose } from '../stroke/sketchDoodle'
import { ExtrudePreviewMesh } from './ExtrudePreviewMesh'
import { useTheme } from '../theme/useTheme'

interface StrokeCanvasProps {
  view: ViewType
}

export function StrokeCanvas({ view }: StrokeCanvasProps) {
  const { accentGreen } = useTheme()
  const {
    currentStroke,
    currentStrokePreview,
    currentStrokeView,
    isDrawing,
    activeColor,
    defaultDepth,
    sketchExtrudeMode,
    autoConnectPaths,
    closeThreshold,
  } = useAppStore(
    useShallow((s) => ({
      currentStroke: s.currentStroke,
      currentStrokePreview: s.currentStrokePreview,
      currentStrokeView: s.currentStrokeView,
      isDrawing: s.isDrawing,
      activeColor: s.activeColor,
      defaultDepth: s.defaultDepth,
      sketchExtrudeMode: s.sketchExtrudeMode,
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

  const strokePath = useMemo(() => {
    if (!isDrawing || currentStrokeView !== view || currentStroke.length === 0) return []
    const pts = [...currentStroke]
    if (
      currentStrokePreview &&
      (pts.length === 0 ||
        pts[pts.length - 1].x !== currentStrokePreview.x ||
        pts[pts.length - 1].y !== currentStrokePreview.y)
    ) {
      pts.push(currentStrokePreview)
    }
    return pts.map((p) => planeToStroke3D(p.x, p.y, view, defaultDepth))
  }, [currentStroke, currentStrokePreview, currentStrokeView, view, defaultDepth, isDrawing])

  const vertexPoints = useMemo(() => {
    if (!isDrawing || currentStrokeView !== view) return []
    return currentStroke.map((p) => planeToStroke3D(p.x, p.y, view, defaultDepth))
  }, [currentStroke, currentStrokeView, view, defaultDepth, isDrawing])

  if (!isDrawing || currentStrokeView !== view || strokePath.length === 0) return null

  const color = `#${activeColor.toString(16).padStart(6, '0')}`

  return (
    <>
      {sketchExtrudeMode && <ExtrudePreviewMesh points={currentStroke} view={view} />}
      {strokePath.length >= 2 && (
        <Line
          points={strokePath}
          color={color}
          lineWidth={sketchExtrudeMode ? 1.5 : 2}
          transparent
          opacity={sketchExtrudeMode ? 0.55 : 0.9}
          depthTest={false}
        />
      )}
      {vertexPoints.map((p, i) => (
        <mesh key={`stroke-vert-${i}`} position={p} renderOrder={22}>
          <sphereGeometry args={[i === 0 && nearClose ? 0.42 : 0.28, 8, 8]} />
          <meshBasicMaterial
            color={i === 0 && nearClose ? accentGreen : color}
            depthTest={false}
            transparent
            opacity={i === 0 && nearClose ? 1 : 0.95}
          />
        </mesh>
      ))}
      {currentStrokePreview && strokePath.length > 0 && (
        <mesh position={strokePath[strokePath.length - 1]} renderOrder={23}>
          <sphereGeometry args={[0.22, 8, 8]} />
          <meshBasicMaterial color={color} depthTest={false} transparent opacity={0.65} />
        </mesh>
      )}
    </>
  )
}
