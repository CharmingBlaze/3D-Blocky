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
  const { extrudeMode, extrudeAmount, defaultDepth, brushDensity, closeThreshold, activeColor } =
    useAppStore(
      useShallow((s) => ({
        extrudeMode: s.extrudeMode,
        extrudeAmount: s.extrudeAmount,
        defaultDepth: s.defaultDepth,
        brushDensity: s.brushDensity,
        closeThreshold: s.closeThreshold,
        activeColor: s.activeColor,
      }))
    )

  const geometry = useMemo(() => {
    if (!extrudeMode || points.length < 2) return null
    return buildExtrudePreviewGeometry(
      points,
      view,
      defaultDepth,
      extrudeAmount,
      brushDensity,
      closeThreshold,
      closed
    )
  }, [
    extrudeMode,
    points,
    view,
    defaultDepth,
    extrudeAmount,
    brushDensity,
    closeThreshold,
    closed,
  ])

  useEffect(() => () => geometry?.dispose(), [geometry])

  if (!geometry) return null

  const color = new THREE.Color(activeColor)

  return (
    <mesh geometry={geometry} renderOrder={1}>
      <meshStandardMaterial
        color={color}
        transparent
        opacity={0.42}
        flatShading
        side={THREE.DoubleSide}
        depthWrite={false}
        emissive={color}
        emissiveIntensity={0.08}
      />
    </mesh>
  )
}
