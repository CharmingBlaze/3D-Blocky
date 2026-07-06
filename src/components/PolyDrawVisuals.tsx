import { useMemo, useEffect } from 'react'
import { Line } from '@react-three/drei'
import * as THREE from 'three'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '../store/appStore'
import { triangulatePolygon } from '../mesh/geometry2d'

import { useTheme } from '../theme/useTheme'
import { hexToNumber } from '../theme/themes'

function pointMarker(world: { x: number; y: number; z: number }, color: string, size = 0.42) {
  return (
    <mesh key={`${world.x}-${world.y}-${world.z}-${color}-${size}`} position={[world.x, world.y, world.z]} renderOrder={25}>
      <sphereGeometry args={[size, 10, 10]} />
      <meshBasicMaterial color={color} depthTest={false} transparent opacity={0.98} />
    </mesh>
  )
}

export function PolyDrawVisuals() {
  const { accent, vertexIdle } = useTheme()
  const placedColor = vertexIdle
  const edgeColor = accent
  const fillColor = hexToNumber(accent)
  const { polyDrawDraft, activeTool } = useAppStore(
    useShallow((s) => ({
      polyDrawDraft: s.polyDrawDraft,
      activeTool: s.activeTool,
    }))
  )

  const fillGeometry = useMemo(() => {
    if (!polyDrawDraft || polyDrawDraft.points.length < 3) return null
    const worlds = polyDrawDraft.points.map((p) => p.world)
    if (polyDrawDraft.previewWorld && polyDrawDraft.points.length >= 2) {
      worlds.push(polyDrawDraft.previewWorld)
    }
    const tris = triangulatePolygon(worlds)
    if (tris.length === 0) return null

    const positions: number[] = []
    for (const w of worlds) positions.push(w.x, w.y, w.z)

    const indices: number[] = []
    for (const [a, b, c] of tris) indices.push(a, b, c)

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    geo.setIndex(indices)
    geo.computeVertexNormals()
    return geo
  }, [polyDrawDraft])

  useEffect(() => () => fillGeometry?.dispose(), [fillGeometry])

  if (activeTool !== 'poly-draw' || !polyDrawDraft) return null

  const { points, previewWorld, snapHighlight } = polyDrawDraft

  const edgePoints: [number, number, number][] = points.map((p) => [p.world.x, p.world.y, p.world.z])
  if (previewWorld && points.length > 0) {
    edgePoints.push([previewWorld.x, previewWorld.y, previewWorld.z])
  }

  const closedPreview =
    polyDrawDraft.points.length >= 3 &&
    previewWorld &&
    snapHighlight?.isDraft

  const loopPoints = closedPreview
    ? [...edgePoints, edgePoints[0] as [number, number, number]]
    : edgePoints

  return (
    <group renderOrder={24}>
      {loopPoints.length >= 2 && (
        <Line
          points={loopPoints}
          color={edgeColor}
          lineWidth={1.5}
          dashed={!closedPreview}
          dashSize={3}
          gapSize={2}
          transparent
          opacity={0.9}
          depthTest={false}
        />
      )}

      {fillGeometry && (
        <mesh geometry={fillGeometry} renderOrder={23}>
          <meshStandardMaterial
            color={fillColor}
            transparent
            opacity={0.22}
            flatShading
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      )}

      {previewWorld && !snapHighlight && pointMarker(previewWorld, placedColor, 0.36)}
    </group>
  )
}
