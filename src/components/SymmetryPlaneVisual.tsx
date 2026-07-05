import { useMemo } from 'react'
import { Line } from '@react-three/drei'
import { useAppStore, type ViewType } from '../store/appStore'
import { isOrthoView } from '../primitives/viewAxes'
import { symmetryLineInView, worldSymmetryLineEndpoints } from '../symmetry/symmetry'
import { useTheme } from '../theme/useTheme'

interface SymmetryPlaneVisualProps {
  view: ViewType
}

export function SymmetryPlaneVisual({ view }: SymmetryPlaneVisualProps) {
  const { symmetryPlane: planeColor } = useTheme()
  const symmetryEnabled = useAppStore((s) => s.symmetryEnabled)
  const symmetryAxis = useAppStore((s) => s.symmetryAxis)
  const symmetryPlane = useAppStore((s) => s.symmetryPlane)
  const defaultDepth = useAppStore((s) => s.defaultDepth)

  const points = useMemo(() => {
    if (!symmetryEnabled || !isOrthoView(view)) return null
    if (!symmetryLineInView(view, symmetryAxis)) return null
    const endpoints = worldSymmetryLineEndpoints(view, symmetryAxis, symmetryPlane, defaultDepth)
    if (!endpoints) return null
    const [a, b] = endpoints
    return [
      [a.x, a.y, a.z] as [number, number, number],
      [b.x, b.y, b.z] as [number, number, number],
    ]
  }, [symmetryEnabled, symmetryAxis, symmetryPlane, defaultDepth, view])

  if (!points) return null

  return (
    <Line
      points={points}
      color={planeColor}
      lineWidth={1.5}
      dashed
      dashSize={0.12}
      gapSize={0.08}
      transparent
      opacity={0.85}
      depthTest={false}
      renderOrder={50}
    />
  )
}
