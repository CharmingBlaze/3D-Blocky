import { useMemo } from 'react'
import { Line } from '@react-three/drei'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '../store/appStore'
import { loopCutPreviewSegments } from '../mesh/meshTopologyOps'
import { worldPointFromObject } from '../mesh/objectTransform'
import { parseEdgeKey } from '../mesh/meshSelection'
import { useTheme } from '../theme/useTheme'

export function LoopCutVisuals() {
  const { accentOrange, meshHover } = useTheme()
  const { loopCutDraft, activeTool, loopCutObject } = useAppStore(
    useShallow((s) => ({
      loopCutDraft: s.loopCutDraft,
      activeTool: s.activeTool,
      loopCutObject: s.loopCutDraft
        ? (s.objects.find((o) => o.id === s.loopCutDraft!.objectId) ?? null)
        : null,
    }))
  )

  const preview = useMemo(() => {
    if (!loopCutDraft || activeTool !== 'loop-cut') return null
    const obj = loopCutObject
    if (!obj) return null

    const segments = loopCutPreviewSegments(obj, loopCutDraft.loopEdges, loopCutDraft.t).map(
      ([a, b]) => [worldPointFromObject(obj, a), worldPointFromObject(obj, b)] as const
    )

    const seed = parseEdgeKey(loopCutDraft.seedEdge)
    const seedWorld = seed.map((vi) => worldPointFromObject(obj, obj.positions[vi]))

    return { segments, seedWorld }
  }, [loopCutDraft, activeTool, loopCutObject])

  if (!preview) return null

  return (
    <group renderOrder={26}>
      {preview.segments.map(([a, b], i) => (
        <Line
          key={`segment-${i}`}
          points={[
            [a.x, a.y, a.z],
            [b.x, b.y, b.z],
          ]}
          color={accentOrange}
          lineWidth={2.5}
        />
      ))}
      {preview.seedWorld.map((p, i) => (
        <mesh key={`seed-${i}`} position={[p.x, p.y, p.z]} renderOrder={27}>
          <sphereGeometry args={[0.22, 8, 8]} />
          <meshBasicMaterial color={meshHover} depthTest={false} transparent opacity={0.95} />
        </mesh>
      ))}
    </group>
  )
}
