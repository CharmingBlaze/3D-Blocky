import { Line } from '@react-three/drei'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '../store/appStore'
import { useTheme } from '../theme/useTheme'

export function KnifeVisuals() {
  const { danger, meshHover, accentPink } = useTheme()
  const { knifeDraft, activeTool } = useAppStore(
    useShallow((s) => ({
      knifeDraft: s.knifeDraft,
      activeTool: s.activeTool,
    }))
  )

  if (activeTool !== 'knife' || !knifeDraft) return null

  const { start, end, committed = [] } = knifeDraft
  const lineEnd = end ?? start

  return (
    <group renderOrder={26}>
      {committed.map((seg, i) => (
        <Line
          key={`knife-seg-${i}`}
          points={[
            [seg.start.x, seg.start.y, seg.start.z],
            [seg.end.x, seg.end.y, seg.end.z],
          ]}
          color={accentPink}
          lineWidth={2}
          transparent
          opacity={0.55}
        />
      ))}

      {start && end && (
        <Line
          points={[
            [start.x, start.y, start.z],
            [lineEnd!.x, lineEnd!.y, lineEnd!.z],
          ]}
          color={danger}
          lineWidth={2.5}
          dashed
          dashSize={4}
          gapSize={2}
        />
      )}

      {start && (
        <mesh position={[start.x, start.y, start.z]} renderOrder={27}>
          <sphereGeometry args={[0.25, 8, 8]} />
          <meshBasicMaterial color={meshHover} depthTest={false} transparent opacity={0.95} />
        </mesh>
      )}

      {end && (
        <mesh position={[end.x, end.y, end.z]} renderOrder={27}>
          <sphereGeometry args={[0.2, 8, 8]} />
          <meshBasicMaterial color={danger} depthTest={false} transparent opacity={0.95} />
        </mesh>
      )}
    </group>
  )
}
