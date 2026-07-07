import { Line } from '@react-three/drei'
import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '../store/appStore'
import { bendAxisDirection } from '../mesh/bendDeform'
import { useTheme } from '../theme/useTheme'

export function BendVisuals() {
  const { accent, accentPink, meshHover } = useTheme()
  const { bendDraft, activeTool } = useAppStore(
    useShallow((s) => ({
      bendDraft: s.bendDraft,
      activeTool: s.activeTool,
    }))
  )

  const axisLine = useMemo(() => {
    if (!bendDraft) return null
    const fallback = { x: 1, y: 0, z: 0 }
    const dir = bendAxisDirection(bendDraft.axisOrigin, bendDraft.axisEnd, fallback)
    const span = 4
    return {
      start: {
        x: bendDraft.axisOrigin.x - dir.x * span,
        y: bendDraft.axisOrigin.y - dir.y * span,
        z: bendDraft.axisOrigin.z - dir.z * span,
      },
      end: bendDraft.axisEnd ?? {
        x: bendDraft.axisOrigin.x + dir.x * span,
        y: bendDraft.axisOrigin.y + dir.y * span,
        z: bendDraft.axisOrigin.z + dir.z * span,
      },
    }
  }, [bendDraft])

  if (activeTool !== 'bend' || !bendDraft || !axisLine) return null

  return (
    <group renderOrder={26}>
      <Line
        points={[
          [axisLine.start.x, axisLine.start.y, axisLine.start.z],
          [axisLine.end.x, axisLine.end.y, axisLine.end.z],
        ]}
        color={bendDraft.axisLocked ? accentPink : accent}
        lineWidth={2.5}
        dashed={!bendDraft.axisLocked}
        dashSize={4}
        gapSize={2}
      />

      <mesh position={[bendDraft.axisOrigin.x, bendDraft.axisOrigin.y, bendDraft.axisOrigin.z]} renderOrder={27}>
        <sphereGeometry args={[0.22, 10, 10]} />
        <meshBasicMaterial color={meshHover} depthTest={false} transparent opacity={0.95} />
      </mesh>

      {bendDraft.axisEnd && !bendDraft.axisLocked && (
        <mesh position={[bendDraft.axisEnd.x, bendDraft.axisEnd.y, bendDraft.axisEnd.z]} renderOrder={27}>
          <sphereGeometry args={[0.18, 10, 10]} />
          <meshBasicMaterial color={accentPink} depthTest={false} transparent opacity={0.95} />
        </mesh>
      )}
    </group>
  )
}
