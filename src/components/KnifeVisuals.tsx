import { useMemo, useRef } from 'react'
import { Line } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '../store/appStore'
import { useTheme } from '../theme/useTheme'
import { previewKnifeCutWorldPoints } from '../mesh/meshKnife'
import { worldDeltaToLocal, localPointFromWorld } from '../mesh/objectTransform'
import { mirrorKnifePath, mirrorKnifePoint } from '../mesh/knifeUtils'
import { mirrorWorldPoint } from '../symmetry/symmetry'
import { worldUnitsForScreenPixels } from '../utils/screenScale'
import type { SymmetryAxis } from '../symmetry/symmetry'
import type { SceneObject } from '../mesh/HalfEdgeMesh'
import type { KnifeDraft } from '../store/cadMeshToolsSlice'

type KnifeIntersectionCacheEntry = {
  object: SceneObject
  isMirror: boolean
  symmetryAxis: SymmetryAxis
  symmetryPlane: number
  primary: [number, number, number][]
  mirrored: [number, number, number][]
}

// KnifeVisuals is mounted once per visible Quad View pane. Share the identical
// topology preview so pointer movement traverses the mesh only once, not four times.
const knifeIntersectionCache = new WeakMap<KnifeDraft, KnifeIntersectionCacheEntry>()

/**
 * Cut-crossing dots for the primary stroke, plus exact world-space reflections
 * when Mirror Knife is active.
 *
 * Important: do NOT re-run the plane-cut preview on the mirrored polyline —
 * that finds unrelated edge hits and looks like scattered garbage on the
 * opposite side. Mirror the primary crossings instead (pure reflection).
 */
function knifeCutIntersections(
  knifeDraft: KnifeDraft,
  knifeObject: SceneObject,
  isMirror = false,
  symmetryAxis: SymmetryAxis = 'x',
  symmetryPlane = 0
): { primary: [number, number, number][]; mirrored: [number, number, number][] } {
  const cached = knifeIntersectionCache.get(knifeDraft)
  if (
    cached?.object === knifeObject &&
    cached.isMirror === isMirror &&
    cached.symmetryAxis === symmetryAxis &&
    cached.symmetryPlane === symmetryPlane
  ) {
    return { primary: cached.primary, mirrored: cached.mirrored }
  }

  const primaryPaths = [
    ...(knifeDraft.completedPaths ?? []),
    knifeDraft.hover ? [...knifeDraft.points, knifeDraft.hover] : knifeDraft.points,
  ]

  const hasCam = knifeDraft.cameraPosition && knifeDraft.view === 'perspective'
  const localCamPos = hasCam ? localPointFromWorld(knifeObject, knifeDraft.cameraPosition!) : null

  const primary: [number, number, number][] = []
  const mirrored: [number, number, number][] = []
  const seen = new Set<string>()

  const pushHit = (point: { x: number; y: number; z: number }, out: [number, number, number][]) => {
    const tuple: [number, number, number] = [point.x, point.y, point.z]
    const key = `${Math.round(point.x * 1e5)},${Math.round(point.y * 1e5)},${Math.round(point.z * 1e5)}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(tuple)
  }

  for (const path of primaryPaths) {
    if (path.length < 2) continue
    for (let i = 0; i + 1 < path.length; i++) {
      const a = path[i]!
      const b = path[i + 1]!

      let localForward: { x: number; y: number; z: number }
      if (localCamPos) {
        const mid = {
          x: (a.local.x + b.local.x) * 0.5,
          y: (a.local.y + b.local.y) * 0.5,
          z: (a.local.z + b.local.z) * 0.5,
        }
        localForward = {
          x: mid.x - localCamPos.x,
          y: mid.y - localCamPos.y,
          z: mid.z - localCamPos.z,
        }
      } else {
        localForward = worldDeltaToLocal(knifeObject, knifeDraft.viewForward)
      }

      for (const point of previewKnifeCutWorldPoints(
        knifeObject,
        a.local,
        b.local,
        localForward
      )) {
        pushHit(point, primary)
      }
    }
  }

  if (isMirror) {
    for (const hit of primary) {
      // Pure world reflection of the drawn primary hit — never re-project to surface.
      const mir = mirrorWorldPoint(
        { x: hit[0], y: hit[1], z: hit[2] },
        symmetryAxis,
        symmetryPlane
      )
      pushHit(mir, mirrored)
    }
  }

  knifeIntersectionCache.set(knifeDraft, {
    object: knifeObject,
    isMirror,
    symmetryAxis,
    symmetryPlane,
    primary,
    mirrored,
  })
  return { primary, mirrored }
}

type KnifeMarkVariant = 'cross' | 'hollow'

/**
 * Camera-facing CAD hit marker — thin crosshair or hollow square.
 * Open center so the exact cut/snap location stays visible.
 */
function KnifeMark({
  position,
  color,
  outline = '#0a0c10',
  sizePx,
  variant = 'cross',
  glow = false,
  opacity = 1,
}: {
  position: [number, number, number]
  color: string
  outline?: string
  sizePx: number
  variant?: KnifeMarkVariant
  glow?: boolean
  opacity?: number
}) {
  const groupRef = useRef<THREE.Group>(null)
  const worldRef = useRef(new THREE.Vector3())
  const { camera, size } = useThree()

  useFrame(() => {
    const g = groupRef.current
    if (!g) return
    g.quaternion.copy(camera.quaternion)
    const world = worldRef.current.set(position[0], position[1], position[2])
    g.scale.setScalar(worldUnitsForScreenPixels(camera, world, sizePx, size.height))
  })

  const stroke = 0.11
  const outlineStroke = 0.2
  const gap = 0.18
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
    <group ref={groupRef} position={position} renderOrder={32}>
      {glow && (
        <mesh renderOrder={30}>
          <planeGeometry args={[1.6, 1.6]} />
          <meshBasicMaterial color={color} {...matProps} opacity={0.12 * opacity} />
        </mesh>
      )}

      {variant === 'cross' && (
        <>
          {/* Dark outline arms */}
          {(
            [
              [armMid, 0, outlineStroke, arm],
              [-armMid, 0, outlineStroke, arm],
              [0, armMid, arm, outlineStroke],
              [0, -armMid, arm, outlineStroke],
            ] as const
          ).map(([x, y, w, h], i) => (
            <mesh key={`xo-${i}`} position={[x, y, -0.02]} renderOrder={31}>
              <planeGeometry args={[w, h]} />
              <meshBasicMaterial color={outline} {...matProps} />
            </mesh>
          ))}
          {/* Color arms */}
          {(
            [
              [armMid, 0, stroke, arm],
              [-armMid, 0, stroke, arm],
              [0, armMid, arm, stroke],
              [0, -armMid, arm, stroke],
            ] as const
          ).map(([x, y, w, h], i) => (
            <mesh key={`xc-${i}`} position={[x, y, 0]} renderOrder={32}>
              <planeGeometry args={[w, h]} />
              <meshBasicMaterial color={color} {...matProps} />
            </mesh>
          ))}
        </>
      )}

      {variant === 'hollow' && (
        <>
          {/* Outer dark frame */}
          {(
            [
              [0, 0.5, 1 + outlineStroke * 0.5, outlineStroke],
              [0, -0.5, 1 + outlineStroke * 0.5, outlineStroke],
              [0.5, 0, outlineStroke, 1 - outlineStroke],
              [-0.5, 0, outlineStroke, 1 - outlineStroke],
            ] as const
          ).map(([x, y, w, h], i) => (
            <mesh key={`ho-${i}`} position={[x, y, -0.02]} renderOrder={31}>
              <planeGeometry args={[w, h]} />
              <meshBasicMaterial color={outline} {...matProps} />
            </mesh>
          ))}
          {/* Color frame */}
          {(
            [
              [0, 0.5, 1, stroke],
              [0, -0.5, 1, stroke],
              [0.5, 0, stroke, 1 - stroke],
              [-0.5, 0, stroke, 1 - stroke],
            ] as const
          ).map(([x, y, w, h], i) => (
            <mesh key={`hc-${i}`} position={[x, y, 0]} renderOrder={32}>
              <planeGeometry args={[w, h]} />
              <meshBasicMaterial color={color} {...matProps} />
            </mesh>
          ))}
        </>
      )}
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
 * Knife overlay: precise path lines with thin CAD hit markers
 * (crosshairs at cut crossings, hollow squares at endpoints).
 */
export function KnifeVisuals() {
  const { accent, accentGreen, accentOrange } = useTheme()
  const { knifeDraft, knifeObject, activeTool, symmetryAxis, symmetryPlane } = useAppStore(
    useShallow((s) => ({
      knifeDraft: s.knifeDraft,
      knifeObject: s.knifeDraft
        ? (s.objects.find((object) => object.id === s.knifeDraft!.objectId) ?? null)
        : null,
      activeTool: s.activeTool,
      symmetryAxis: s.symmetryAxis,
      symmetryPlane: s.symmetryPlane,
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
    if (!knifeDraft || !knifeObject) return { primary: [], mirrored: [] }
    return knifeCutIntersections(
      knifeDraft,
      knifeObject,
      activeTool === 'mirror-knife',
      symmetryAxis,
      symmetryPlane
    )
  }, [knifeDraft, knifeObject, activeTool, symmetryAxis, symmetryPlane])

  if ((activeTool !== 'knife' && activeTool !== 'mirror-knife') || !knifeDraft) return null

  const hover = knifeDraft.hover
  const placed = knifeDraft.points
  const last = placed[placed.length - 1]
  const isMirror = activeTool === 'mirror-knife'

  const confirmedPaths: [number, number, number][][] = [
    ...(knifeDraft.completedPaths ?? []).map((path) =>
      path.map((p) => [p.world.x, p.world.y, p.world.z] as [number, number, number])
    ),
    placed.map((p) => [p.world.x, p.world.y, p.world.z] as [number, number, number]),
  ].filter((p) => p.length > 0)

  const previewSegment: [number, number, number][] | null =
    last && hover
      ? [
          [last.world.x, last.world.y, last.world.z],
          [hover.world.x, hover.world.y, hover.world.z],
        ]
      : null

  const firstPath = confirmedPaths[0]
  const { dash, gap } = dashSizes(previewSegment ?? (firstPath ?? []))
  // Clear perforated look while moving (Blockbench-style rubber-band).
  const previewDash = Math.max(0.06, dash * 1.05)
  const previewGap = Math.max(0.05, gap * 1.15)

  const snapped = hover?.snap !== 'face' && hover?.snap !== 'space'
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

  // Mirrored ghost paths — exact world reflections of the drawn primary points.
  let mirroredConfirmedPaths: [number, number, number][][] = []
  let mirroredPreviewSegment: [number, number, number][] | null = null

  if (isMirror && knifeObject) {
    const sourcePaths = [
      ...(knifeDraft.completedPaths ?? []),
      placed,
    ].filter((p) => p.length > 0)

    mirroredConfirmedPaths = sourcePaths.map((path) => {
      const mirrored = mirrorKnifePath(path, knifeObject, symmetryAxis, symmetryPlane)
      return mirrored.map(
        (p) => [p.world.x, p.world.y, p.world.z] as [number, number, number]
      )
    })

    if (last && hover) {
      const mirA = mirrorKnifePoint(
        knifeObject,
        last.local,
        symmetryAxis,
        symmetryPlane,
        last.world
      )
      const mirB = mirrorKnifePoint(
        knifeObject,
        hover.local,
        symmetryAxis,
        symmetryPlane,
        hover.world
      )
      mirroredPreviewSegment = [
        [mirA.world.x, mirA.world.y, mirA.world.z],
        [mirB.world.x, mirB.world.y, mirB.world.z],
      ]
    }
  }

  return (
    <group renderOrder={28}>
      {/* Primary paths */}
      {confirmedPaths.map((path, idx) => (
        <group key={`confirmed-path-${idx}`}>
          <Line points={path} color="#080a0e" lineWidth={5.2} depthTest={false} transparent opacity={0.85} toneMapped={false} />
          <Line points={path} color={lineColor} lineWidth={2.2} depthTest={false} transparent opacity={1} toneMapped={false} />
        </group>
      ))}

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

      {/* Mirrored ghost paths */}
      {mirroredConfirmedPaths.map((path, idx) => (
        <group key={`mirrored-path-${idx}`}>
          <Line points={path} color="#080a0e" lineWidth={5.2} depthTest={false} transparent opacity={0.4} toneMapped={false} />
          <Line points={path} color={lineColor} lineWidth={2.2} depthTest={false} transparent opacity={0.5} toneMapped={false} />
        </group>
      ))}

      {mirroredPreviewSegment && (
        <>
          <Line points={mirroredPreviewSegment} color="#080a0e" lineWidth={4.6} depthTest={false} transparent opacity={0.4} toneMapped={false} />
          <Line
            points={mirroredPreviewSegment}
            color={hoverFill}
            lineWidth={2.2}
            dashed
            dashSize={previewDash}
            gapSize={previewGap}
            depthTest={false}
            transparent
            opacity={0.5}
            toneMapped={false}
          />
        </>
      )}

      {cutIntersections.primary.map((point, i) => (
        <KnifeMark
          key={`knife-crossing-${i}`}
          position={point}
          color={lineColor}
          outline="#f7fbff"
          sizePx={3.5}
          variant="cross"
          opacity={0.85}
        />
      ))}
      {cutIntersections.mirrored.map((point, i) => (
        <KnifeMark
          key={`knife-crossing-mirror-${i}`}
          position={point}
          color={lineColor}
          outline="#f7fbff"
          sizePx={3.5}
          variant="cross"
          opacity={0.3}
        />
      ))}

      {/* Primary markers */}
      {[...(knifeDraft.completedPaths ?? []), placed].map((path, pathIdx) =>
        path.map((p, i) => {
          const isLastOfActive =
            pathIdx === (knifeDraft.completedPaths?.length ?? 0) && i === path.length - 1
          return (
            <KnifeMark
              key={`knife-pt-${pathIdx}-${i}`}
              position={[p.world.x, p.world.y, p.world.z]}
              color={isLastOfActive ? lineColor : '#e8eef6'}
              outline="#0a0c10"
              sizePx={isLastOfActive ? 5 : 4}
              variant="hollow"
            />
          )
        })
      )}

      {/* Mirrored ghost markers — exact world reflections of drawn primary points */}
      {isMirror &&
        knifeObject &&
        [...(knifeDraft.completedPaths ?? []), placed].map((path, pathIdx) =>
          path.map((p, i) => {
            const isLastOfActive =
              pathIdx === (knifeDraft.completedPaths?.length ?? 0) && i === path.length - 1
            const mir = mirrorKnifePoint(
              knifeObject,
              p.local,
              symmetryAxis,
              symmetryPlane,
              p.world
            )
            return (
              <KnifeMark
                key={`knife-pt-mirror-${pathIdx}-${i}`}
                position={[mir.world.x, mir.world.y, mir.world.z]}
                color={isLastOfActive ? lineColor : '#e8eef6'}
                outline="#0a0c10"
                sizePx={isLastOfActive ? 5 : 4}
                variant="hollow"
                opacity={0.35}
              />
            )
          })
        )}

      {hover && (
        <KnifeMark
          position={[hover.world.x, hover.world.y, hover.world.z]}
          color={hoverFill}
          outline="#0a0c10"
          sizePx={snapped ? 6 : 5}
          variant="hollow"
          glow={snapped}
        />
      )}

      {/* Mirrored ghost hover marker */}
      {hover && isMirror && knifeObject && (
        <KnifeMark
          position={(() => {
            const mir = mirrorKnifePoint(
              knifeObject,
              hover.local,
              symmetryAxis,
              symmetryPlane,
              hover.world
            )
            return [mir.world.x, mir.world.y, mir.world.z]
          })()}
          color={hoverFill}
          outline="#0a0c10"
          sizePx={snapped ? 6 : 5}
          variant="hollow"
          glow={snapped}
          opacity={0.35}
        />
      )}
    </group>
  )
}
