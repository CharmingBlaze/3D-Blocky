import { useMemo, useRef } from 'react'
import { Line } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '../store/appStore'
import { useTheme } from '../theme/useTheme'
import { previewKnifeCutWorldPoints } from '../mesh/meshKnife'
import { worldDeltaToLocal } from '../mesh/objectTransform'
import type { SceneObject } from '../mesh/HalfEdgeMesh'
import type { KnifeDraft } from '../store/cadMeshToolsSlice'

type KnifeIntersectionCacheEntry = {
  object: SceneObject
  points: [number, number, number][]
}

// KnifeVisuals is mounted once per visible Quad View pane. Share the identical
// topology preview so pointer movement traverses the mesh only once, not four times.
const knifeIntersectionCache = new WeakMap<KnifeDraft, KnifeIntersectionCacheEntry>()

function knifeCutIntersections(
  knifeDraft: KnifeDraft,
  knifeObject: SceneObject
): [number, number, number][] {
  const cached = knifeIntersectionCache.get(knifeDraft)
  if (cached?.object === knifeObject) return cached.points

  const path = knifeDraft.hover
    ? [...knifeDraft.points, knifeDraft.hover]
    : knifeDraft.points
  if (path.length < 2) return []

  const localForward = worldDeltaToLocal(knifeObject, knifeDraft.viewForward)
  const intersections: [number, number, number][] = []
  const seen = new Set<string>()
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i]!
    const b = path[i + 1]!
    for (const point of previewKnifeCutWorldPoints(
      knifeObject,
      a.local,
      b.local,
      localForward
    )) {
      const tuple: [number, number, number] = [point.x, point.y, point.z]
      const key = `${Math.round(point.x * 1e5)},${Math.round(point.y * 1e5)},${Math.round(point.z * 1e5)}`
      if (seen.has(key)) continue
      seen.add(key)
      intersections.push(tuple)
    }
  }
  knifeIntersectionCache.set(knifeDraft, { object: knifeObject, points: intersections })
  return intersections
}

/** Camera-facing square vertex handle (Blockbench-style). */
function KnifeSquare({
  position,
  fill,
  outline = '#111111',
  sizePx,
  glow = false,
}: {
  position: [number, number, number]
  fill: string
  outline?: string
  sizePx: number
  glow?: boolean
}) {
  const groupRef = useRef<THREE.Group>(null)
  const { camera, size } = useThree()

  useFrame(() => {
    const g = groupRef.current
    if (!g) return
    g.quaternion.copy(camera.quaternion)
    const dist = camera.position.distanceTo(g.position)
    let worldPerPixel = 0.02
    if (camera instanceof THREE.PerspectiveCamera) {
      const vFov = (camera.fov * Math.PI) / 180
      worldPerPixel = (2 * Math.tan(vFov / 2) * dist) / Math.max(1, size.height)
    } else if (camera instanceof THREE.OrthographicCamera) {
      worldPerPixel = (camera.top - camera.bottom) / Math.max(1, size.height)
    }
    const s = Math.max(0.015, sizePx * worldPerPixel)
    g.scale.set(s, s, s)
  })

  return (
    <group ref={groupRef} position={position} renderOrder={32}>
      {glow && (
        <mesh renderOrder={30}>
          <planeGeometry args={[2.3, 2.3]} />
          <meshBasicMaterial color={fill} transparent opacity={0.22} depthTest={false} toneMapped={false} />
        </mesh>
      )}
      <mesh renderOrder={31} position={[0, 0, -0.02]}>
        <planeGeometry args={[1.4, 1.4]} />
        <meshBasicMaterial color={outline} depthTest={false} toneMapped={false} />
      </mesh>
      <mesh renderOrder={32}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial color={fill} depthTest={false} toneMapped={false} />
      </mesh>
    </group>
  )
}

function dashSizes(pts: [number, number, number][]): { dash: number; gap: number } {
  if (pts.length < 2) return { dash: 0.14, gap: 0.1 }
  let total = 0
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!
    const b = pts[i]!
    total += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
  }
  const avg = total / Math.max(1, pts.length - 1)
  const dash = Math.min(0.4, Math.max(0.05, avg * 0.14))
  return { dash, gap: dash * 0.75 }
}

/**
 * Blockbench-like knife overlay:
 * square vertex markers, high-contrast preview path, and clear snap feedback.
 */
export function KnifeVisuals() {
  const { accent, accentGreen, accentOrange } = useTheme()
  const { knifeDraft, knifeObject, activeTool } = useAppStore(
    useShallow((s) => ({
      knifeDraft: s.knifeDraft,
      knifeObject: s.knifeDraft
        ? (s.objects.find((object) => object.id === s.knifeDraft!.objectId) ?? null)
        : null,
      activeTool: s.activeTool,
    }))
  )

  const lineColor = useMemo(() => {
    if (!accent || accent === '#000000' || accent === '#111111' || accent === '#1a1a18') {
      return '#3d8bff'
    }
    return accent
  }, [accent])

  const snapGreen = accentGreen && accentGreen !== '#000000' ? accentGreen : '#2fd15a'
  const snapOrange = accentOrange && accentOrange !== '#000000' ? accentOrange : '#ffb347'

  const cutIntersections = useMemo(() => {
    if (!knifeDraft || !knifeObject) return []
    return knifeCutIntersections(knifeDraft, knifeObject)
  }, [knifeDraft, knifeObject])

  if (activeTool !== 'knife' || !knifeDraft) return null

  const hover = knifeDraft.hover
  const placed = knifeDraft.points
  const last = placed[placed.length - 1]

  const confirmedPath: [number, number, number][] = placed.map((p) => [
    p.world.x,
    p.world.y,
    p.world.z,
  ])

  const previewSegment: [number, number, number][] | null =
    last && hover
      ? [
          [last.world.x, last.world.y, last.world.z],
          [hover.world.x, hover.world.y, hover.world.z],
        ]
      : null

  const { dash, gap } = dashSizes(previewSegment ?? confirmedPath)
  // Clear perforated look while moving (Blockbench-style rubber-band).
  const previewDash = Math.max(0.06, dash * 1.05)
  const previewGap = Math.max(0.05, gap * 1.15)

  const snapped = hover?.snap !== 'face'
  const hoverFill =
    hover?.snap === 'vertex' || hover?.snap === 'path'
      ? '#ffffff'
      : hover?.snap === 'edge'
        ? snapGreen
        : hover?.snap === 'face-center'
          ? '#50d8ff'
          : hover?.snap === 'grid'
            ? '#d59cff'
            : snapOrange

  return (
    <group renderOrder={28}>
      {confirmedPath.length >= 2 && (
        <>
          <Line points={confirmedPath} color="#080a0e" lineWidth={5.2} depthTest={false} transparent opacity={0.85} toneMapped={false} />
          <Line points={confirmedPath} color={lineColor} lineWidth={2.2} depthTest={false} transparent opacity={1} toneMapped={false} />
        </>
      )}

      {previewSegment && (
        <>
          <Line points={previewSegment} color="#080a0e" lineWidth={4.6} depthTest={false} transparent opacity={0.78} toneMapped={false} />
          <Line
            points={previewSegment}
            color={hoverFill}
            lineWidth={2.2}
            dashed
            dashSize={previewDash}
            gapSize={previewGap}
            depthTest={false}
            transparent
            opacity={1}
            toneMapped={false}
          />
        </>
      )}

      {cutIntersections.map((point, i) => (
        <KnifeSquare
          key={`knife-crossing-${i}`}
          position={point}
          fill={lineColor}
          outline="#f7fbff"
          sizePx={5}
        />
      ))}

      {placed.map((p, i) => (
        <KnifeSquare
          key={`knife-pt-${i}`}
          position={[p.world.x, p.world.y, p.world.z]}
          fill={i === placed.length - 1 ? lineColor : '#141414'}
          outline="#ffffff"
          sizePx={i === placed.length - 1 ? 8 : 7}
        />
      ))}

      {hover && (
        <KnifeSquare
          position={[hover.world.x, hover.world.y, hover.world.z]}
          fill={hoverFill}
          outline="#111111"
          sizePx={snapped ? 10 : 7}
          glow={snapped}
        />
      )}
    </group>
  )
}
