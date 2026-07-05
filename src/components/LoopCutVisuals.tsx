import { useMemo } from 'react'
import { Line } from '@react-three/drei'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '../store/appStore'
import { loopCutPreviewPositions } from '../mesh/meshTopologyOps'
import { worldPointFromObject } from '../mesh/objectTransform'
import { parseEdgeKey } from '../mesh/meshSelection'
import { useTheme } from '../theme/useTheme'

export function LoopCutVisuals() {
  const { accentOrange, meshHover } = useTheme()
  const { loopCutDraft, activeTool, objects } = useAppStore(
    useShallow((s) => ({
      loopCutDraft: s.loopCutDraft,
      activeTool: s.activeTool,
      objects: s.objects,
    }))
  )

  const preview = useMemo(() => {
    if (!loopCutDraft || activeTool !== 'loop-cut') return null
    const obj = objects.find((o) => o.id === loopCutDraft.objectId)
    if (!obj) return null

    const localPts = loopCutPreviewPositions(obj, loopCutDraft.loopEdges, loopCutDraft.t)
    const worldPts = localPts.map((p) => worldPointFromObject(obj, p))

    const seed = parseEdgeKey(loopCutDraft.seedEdge)
    const seedWorld = seed.map((vi) => worldPointFromObject(obj, obj.positions[vi]))

    return { worldPts, seedWorld }
  }, [loopCutDraft, activeTool, objects])

  if (!preview) return null

  const linePoints = preview.worldPts.map(
    (p) => [p.x, p.y, p.z] as [number, number, number]
  )

  return (
    <group renderOrder={26}>
      {linePoints.length >= 2 && (
        <Line points={linePoints} color={accentOrange} lineWidth={2.5} />
      )}
      {preview.seedWorld.map((p, i) => (
        <mesh key={`seed-${i}`} position={[p.x, p.y, p.z]} renderOrder={27}>
          <sphereGeometry args={[0.22, 8, 8]} />
          <meshBasicMaterial color={meshHover} depthTest={false} transparent opacity={0.95} />
        </mesh>
      ))}
      {preview.worldPts.map((p, i) => (
        <mesh key={`cut-${i}`} position={[p.x, p.y, p.z]} renderOrder={27}>
          <sphereGeometry args={[0.18, 8, 8]} />
          <meshBasicMaterial color={accentOrange} depthTest={false} transparent opacity={0.95} />
        </mesh>
      ))}
    </group>
  )
}
