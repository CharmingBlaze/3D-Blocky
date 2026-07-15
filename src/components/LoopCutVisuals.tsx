import { useMemo, useRef } from 'react'
import { Line } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '../store/appStore'
import { loopCutPreviewPositions, loopCutPreviewSegments } from '../mesh/meshTopologyOps'
import { worldPointFromObject } from '../mesh/objectTransform'
import { parseEdgeKey } from '../mesh/meshSelection'
import { mirrorWorldPoint } from '../symmetry/symmetry'
import { useTheme } from '../theme/useTheme'
import { worldUnitsForScreenPixels } from '../utils/screenScale'
import type { Vec3 } from '../utils/math'

type WorldSegment = { a: Vec3; b: Vec3 }

function mirrorSegment(seg: WorldSegment, axis: 'x' | 'y' | 'z', plane: number): WorldSegment {
  return {
    a: mirrorWorldPoint(seg.a, axis, plane),
    b: mirrorWorldPoint(seg.b, axis, plane),
  }
}

/**
 * Thin camera-facing crosshair for loop-cut edge hits.
 * Open center keeps the exact cut location readable.
 */
function CutMark({
  position,
  color,
  outline = '#0a0c10',
  sizePx = 3.5,
  opacity = 0.9,
}: {
  position: Vec3
  color: string
  outline?: string
  sizePx?: number
  opacity?: number
}) {
  const groupRef = useRef<THREE.Group>(null)
  const worldRef = useRef(new THREE.Vector3())
  const { camera, size } = useThree()

  useFrame(() => {
    const g = groupRef.current
    if (!g) return
    g.quaternion.copy(camera.quaternion)
    const world = worldRef.current.set(position.x, position.y, position.z)
    g.scale.setScalar(worldUnitsForScreenPixels(camera, world, sizePx, size.height))
  })

  const stroke = 0.11
  const outlineStroke = 0.2
  const gap = 0.22
  const arm = (1 - gap) * 0.5
  const armMid = gap * 0.5 + arm * 0.5

  const matProps = {
    transparent: true as const,
    opacity,
    depthTest: false,
    depthWrite: false,
    toneMapped: false as const,
  }

  return (
    <group ref={groupRef} position={[position.x, position.y, position.z]} renderOrder={27}>
      {(
        [
          [armMid, 0, outlineStroke, arm],
          [-armMid, 0, outlineStroke, arm],
          [0, armMid, arm, outlineStroke],
          [0, -armMid, arm, outlineStroke],
        ] as const
      ).map(([x, y, w, h], i) => (
        <mesh key={`o-${i}`} position={[x, y, -0.02]} renderOrder={26}>
          <planeGeometry args={[w, h]} />
          <meshBasicMaterial color={outline} {...matProps} />
        </mesh>
      ))}
      {(
        [
          [armMid, 0, stroke, arm],
          [-armMid, 0, stroke, arm],
          [0, armMid, arm, stroke],
          [0, -armMid, arm, stroke],
        ] as const
      ).map(([x, y, w, h], i) => (
        <mesh key={`c-${i}`} position={[x, y, 0]} renderOrder={27}>
          <planeGeometry args={[w, h]} />
          <meshBasicMaterial color={color} {...matProps} />
        </mesh>
      ))}
    </group>
  )
}

export function LoopCutVisuals() {
  const { accentOrange, meshHover } = useTheme()
  const {
    loopCutDraft,
    activeTool,
    loopCutObject,
    symmetryEnabled,
    symmetryAxis,
    symmetryPlane,
  } = useAppStore(
    useShallow((s) => ({
      loopCutDraft: s.loopCutDraft,
      activeTool: s.activeTool,
      loopCutObject: s.loopCutDraft
        ? (s.objects.find((o) => o.id === s.loopCutDraft!.objectId) ?? null)
        : null,
      symmetryEnabled: s.symmetryEnabled,
      symmetryAxis: s.symmetryAxis,
      symmetryPlane: s.symmetryPlane,
    }))
  )

  const preview = useMemo(() => {
    if (!loopCutDraft || activeTool !== 'loop-cut') return null
    const obj = loopCutObject
    if (!obj) return null

    const numCuts = loopCutDraft.numCuts ?? 1
    const factor = (loopCutDraft.t - 0.5) * 2

    const allSegments: WorldSegment[][] = []
    const allDots: Vec3[][] = []
    for (let i = 0; i < numCuts; i++) {
      const tDefault = (i + 1) / (numCuts + 1)
      let tVal = tDefault
      if (factor > 0) {
        tVal = tDefault + factor * (1 - tDefault)
      } else if (factor < 0) {
        tVal = tDefault + factor * tDefault
      }

      const segments = loopCutPreviewSegments(obj, loopCutDraft.loopEdges, tVal).map(
        ([a, b]) => ({
          a: worldPointFromObject(obj, a),
          b: worldPointFromObject(obj, b),
        })
      )
      const dots = loopCutPreviewPositions(obj, loopCutDraft.loopEdges, tVal).map((p) =>
        worldPointFromObject(obj, p)
      )
      allSegments.push(segments)
      allDots.push(dots)
    }

    const seed = parseEdgeKey(loopCutDraft.seedEdge)
    const seedWorld = seed.map((vi) => worldPointFromObject(obj, obj.positions[vi]))

    let mirroredSegments: WorldSegment[][] = []
    let mirroredDots: Vec3[][] = []
    let mirroredSeed: Vec3[] = []
    if (symmetryEnabled) {
      mirroredSegments = allSegments.map((segments) =>
        segments.map((seg) => mirrorSegment(seg, symmetryAxis, symmetryPlane))
      )
      mirroredDots = allDots.map((dots) =>
        dots.map((p) => mirrorWorldPoint(p, symmetryAxis, symmetryPlane))
      )
      mirroredSeed = seedWorld.map((p) => mirrorWorldPoint(p, symmetryAxis, symmetryPlane))
    }

    return {
      allSegments,
      allDots,
      seedWorld,
      mirroredSegments,
      mirroredDots,
      mirroredSeed,
      showMirror: symmetryEnabled,
    }
  }, [
    loopCutDraft,
    activeTool,
    loopCutObject,
    symmetryEnabled,
    symmetryAxis,
    symmetryPlane,
  ])

  if (!preview) return null

  return (
    <group renderOrder={26}>
      {preview.allSegments.map((segments, cutIdx) =>
        segments.map(({ a, b }, i) => (
          <Line
            key={`cut-${cutIdx}-segment-${i}`}
            points={[
              [a.x, a.y, a.z],
              [b.x, b.y, b.z],
            ]}
            color={accentOrange}
            lineWidth={2.5}
            depthTest={false}
            transparent
            opacity={1}
            toneMapped={false}
          />
        ))
      )}
      {preview.allDots.map((dots, cutIdx) =>
        dots.map((p, i) => (
          <CutMark
            key={`cut-${cutIdx}-dot-${i}`}
            position={p}
            color={accentOrange}
            sizePx={3.5}
            opacity={0.85}
          />
        ))
      )}
      {preview.seedWorld.map((p, i) => (
        <CutMark
          key={`seed-${i}`}
          position={p}
          color={meshHover}
          sizePx={5}
          opacity={0.95}
        />
      ))}

      {preview.showMirror &&
        preview.mirroredSegments.map((segments, cutIdx) =>
          segments.map(({ a, b }, i) => (
            <Line
              key={`mirror-cut-${cutIdx}-segment-${i}`}
              points={[
                [a.x, a.y, a.z],
                [b.x, b.y, b.z],
              ]}
              color={accentOrange}
              lineWidth={2.5}
              depthTest={false}
              transparent
              opacity={0.45}
              toneMapped={false}
            />
          ))
        )}
      {preview.showMirror &&
        preview.mirroredDots.map((dots, cutIdx) =>
          dots.map((p, i) => (
            <CutMark
              key={`mirror-cut-${cutIdx}-dot-${i}`}
              position={p}
              color={accentOrange}
              sizePx={3.5}
              opacity={0.3}
            />
          ))
        )}
      {preview.showMirror &&
        preview.mirroredSeed.map((p, i) => (
          <CutMark
            key={`mirror-seed-${i}`}
            position={p}
            color={meshHover}
            sizePx={5}
            opacity={0.3}
          />
        ))}
    </group>
  )
}
