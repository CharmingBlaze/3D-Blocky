import { useMemo } from 'react'
import { Grid, Line } from '@react-three/drei'
import type { ViewType } from '../store/appStore'
import type { OrthoViewType } from '../primitives/viewAxes'
import { orthoViewFromLegacy } from '../primitives/viewAxes'
import { useTheme } from '../theme/useTheme'

interface ViewportGridProps {
  view: ViewType
  depth?: number
}

import { SCENE_GRID_CELL } from '../scene/units'

const CELL = SCENE_GRID_CELL
const SECTION = 40

/** Soft grid fade — keep below camera.far so the horizon softens instead of hard-clipping. */
const GRID_STYLE = {
  cellSize: CELL,
  sectionSize: SECTION,
  cellThickness: 0.5,
  sectionThickness: 1,
  fadeDistance: 1400,
  fadeStrength: 1.05,
  infiniteGrid: true as const,
}

const AXIS_LEN = SECTION * 4

function SharedFloorGrid({
  position = [0, -0.02, 0] as [number, number, number],
  rotation = [0, 0, 0] as [number, number, number],
  fadeDistance = GRID_STYLE.fadeDistance,
  fadeStrength = GRID_STYLE.fadeStrength,
  cellThickness = GRID_STYLE.cellThickness,
  sectionThickness = GRID_STYLE.sectionThickness,
}: {
  position?: [number, number, number]
  rotation?: [number, number, number]
  fadeDistance?: number
  fadeStrength?: number
  cellThickness?: number
  sectionThickness?: number
}) {
  const { gridCell, gridSection } = useTheme()
  return (
    <Grid
      cellSize={GRID_STYLE.cellSize}
      sectionSize={GRID_STYLE.sectionSize}
      infiniteGrid={GRID_STYLE.infiniteGrid}
      cellColor={gridCell}
      sectionColor={gridSection}
      cellThickness={cellThickness}
      sectionThickness={sectionThickness}
      fadeDistance={fadeDistance}
      fadeStrength={fadeStrength}
      position={position}
      rotation={rotation}
    />
  )
}

function AxisLines({
  primary,
  secondary,
  tertiary,
}: {
  primary: [[number, number, number], [number, number, number]]
  secondary: [[number, number, number], [number, number, number]]
  tertiary?: [[number, number, number], [number, number, number]]
}) {
  const { axisX, axisY, axisZ } = useTheme()
  return (
    <>
      <Line points={primary} color={axisX} lineWidth={1.1} transparent opacity={0.45} />
      <Line points={secondary} color={axisY} lineWidth={1.1} transparent opacity={0.45} />
      {tertiary && (
        <Line points={tertiary} color={axisZ} lineWidth={1.1} transparent opacity={0.45} />
      )}
    </>
  )
}

function FlatWorkplaneGrid({
  plane,
  depth = 0,
}: {
  plane: 'front' | 'right'
  depth?: number
}) {
  const layout = useMemo(() => {
    const eps = 0.02
    if (plane === 'front') {
      const z = depth - eps
      return {
        rotation: [Math.PI / 2, 0, 0] as [number, number, number],
        position: [0, 0, z] as [number, number, number],
        primary: [
          [0, 0, z],
          [AXIS_LEN, 0, z],
        ] as [[number, number, number], [number, number, number]],
        secondary: [
          [0, 0, z],
          [0, AXIS_LEN, z],
        ] as [[number, number, number], [number, number, number]],
      }
    }
    const x = depth - eps
    return {
      rotation: [0, 0, -Math.PI / 2] as [number, number, number],
      position: [x, 0, 0] as [number, number, number],
      primary: [
        [x, 0, 0],
        [x, AXIS_LEN, 0],
      ] as [[number, number, number], [number, number, number]],
      secondary: [
        [x, 0, 0],
        [x, 0, AXIS_LEN],
      ] as [[number, number, number], [number, number, number]],
    }
  }, [plane, depth])

  return (
    <group>
      <SharedFloorGrid
        position={layout.position}
        rotation={layout.rotation}
        fadeDistance={1200}
        fadeStrength={1.1}
      />
      <AxisLines primary={layout.primary} secondary={layout.secondary} />
    </group>
  )
}

function WorldGrid3D() {
  return (
    <group>
      <SharedFloorGrid />
      <AxisLines
        primary={[
          [0, 0, 0],
          [AXIS_LEN, 0, 0],
        ]}
        secondary={[
          [0, 0, 0],
          [0, AXIS_LEN, 0],
        ]}
        tertiary={[
          [0, 0, 0],
          [0, 0, AXIS_LEN],
        ]}
      />
    </group>
  )
}

function gridForOrtho(view: OrthoViewType, depth: number) {
  switch (view) {
    case 'front':
    case 'back':
      return <FlatWorkplaneGrid plane="front" depth={depth} />
    case 'left':
    case 'right':
      return <FlatWorkplaneGrid plane="right" depth={depth} />
    case 'top':
    case 'bottom':
      return <WorldGrid3D />
  }
}

export function ViewportGrid({ view, depth = 0 }: ViewportGridProps) {
  if (view === 'perspective') return <WorldGrid3D />
  const ortho = orthoViewFromLegacy(view)
  if (!ortho) return null
  return gridForOrtho(ortho, depth)
}
