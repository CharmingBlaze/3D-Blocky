import { useEffect, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import * as THREE from 'three'
import { useAppStore, type ViewType } from '../store/appStore'
import { buildExtrudePreviewGeometry } from '../preview/extrudePreview'
import type { Vec2 } from '../utils/math'

interface ExtrudePreviewMeshProps {
  points: Vec2[]
  view: ViewType
  closed?: boolean
}

export function ExtrudePreviewMesh({ points, view, closed }: ExtrudePreviewMeshProps) {
  const {
    extrudeAmount,
    defaultDepth,
    brushDensity,
    closeThreshold,
    activeColor,
    strokeMode,
    polyBudget,
    hairTipStyle,
    currentStrokePlane,
  } = useAppStore(
    useShallow((s) => ({
      extrudeAmount: s.extrudeAmount,
      defaultDepth: s.defaultDepth,
      brushDensity: s.brushDensity,
      closeThreshold: s.closeThreshold,
      activeColor: s.activeColor,
      strokeMode: s.strokeMode,
      polyBudget: s.polyBudget,
      hairTipStyle: s.hairTipStyle,
      currentStrokePlane: s.currentStrokePlane,
    }))
  )

  const geometry = useMemo(() => {
    if (points.length < 2) return null
    return buildExtrudePreviewGeometry(
      points,
      view,
      defaultDepth,
      extrudeAmount,
      brushDensity,
      closeThreshold,
      closed,
      { strokeMode, polyBudget, hairTipStyle, planeFrame: currentStrokePlane }
    )
  }, [
    points,
    view,
    defaultDepth,
    extrudeAmount,
    brushDensity,
    closeThreshold,
    closed,
    strokeMode,
    polyBudget,
    hairTipStyle,
    currentStrokePlane,
  ])

  useEffect(() => () => geometry?.dispose(), [geometry])

  if (!geometry) return null

  const color = new THREE.Color(activeColor)

  return (
    <mesh geometry={geometry} renderOrder={1}>
      <meshStandardMaterial
        color={color}
        transparent
        opacity={0.22}
        flatShading
        side={THREE.DoubleSide}
        depthWrite={false}
        emissive={color}
        emissiveIntensity={0.04}
      />
    </mesh>
  )
}
