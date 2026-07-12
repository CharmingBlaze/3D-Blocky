import { useMemo, useRef } from 'react'
import { Line } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '../store/appStore'
import { useTheme } from '../theme/useTheme'

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
  const { knifeDraft, activeTool } = useAppStore(
    useShallow((s) => ({
      knifeDraft: s.knifeDraft,
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

  const snapped = hover?.snap === 'edge' || hover?.snap === 'vertex'
  const hoverFill =
    hover?.snap === 'vertex' ? '#ffffff' : hover?.snap === 'edge' ? snapGreen : snapOrange

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

      {placed.map((p, i) => (
        <KnifeSquare
          key={`knife-pt-${i}`}
          position={[p.world.x, p.world.y, p.world.z]}
          fill="#141414"
          outline="#f5f5f5"
          sizePx={7}
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
