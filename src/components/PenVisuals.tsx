import { useEffect, useMemo } from 'react'
import { Billboard, Line } from '@react-three/drei'
import * as THREE from 'three'
import type { ViewType, StrokeMode } from '../store/appStore'
import { planeToStroke3D } from '../utils/screenToWorld'
import { sampleAnchors, handleSegments } from '../vector/bezier'
import type { VectorAnchor } from '../vector/types'
import type { VectorPenDraft } from '../store/appStore'
import { ExtrudePreviewMesh } from './ExtrudePreviewMesh'
import { useTheme } from '../theme/useTheme'

interface PenThemeColors {
  stroke: string
  handleLine: string
  anchorFill: string
  anchorStroke: string
  handleDot: string
  closeRing: string
  fillPreview: string
  closeTargetFill: string
}

function toWorld(
  p: { x: number; y: number },
  view: ViewType,
  depth: number
): THREE.Vector3 {
  const v = planeToStroke3D(p.x, p.y, view, depth)
  return new THREE.Vector3(v.x, v.y, v.z)
}

function AnchorSquare({
  position,
  view,
  depth,
  highlight,
  closeTarget,
  colors,
}: {
  position: { x: number; y: number }
  view: ViewType
  depth: number
  highlight?: boolean
  closeTarget?: boolean
  colors: PenThemeColors
}) {
  const world = useMemo(() => toWorld(position, view, depth), [position, view, depth])
  const size = closeTarget ? 5.5 : highlight ? 4.8 : 4
  const color = closeTarget ? colors.closeRing : colors.anchorStroke

  const planeGeo = useMemo(() => new THREE.PlaneGeometry(size, size), [size])
  const edgesGeo = useMemo(() => new THREE.EdgesGeometry(planeGeo), [planeGeo])
  useEffect(
    () => () => {
      planeGeo.dispose()
      edgesGeo.dispose()
    },
    [planeGeo, edgesGeo]
  )

  return (
    <Billboard position={world}>
      <mesh geometry={planeGeo}>
        <meshBasicMaterial
          color={closeTarget ? colors.closeTargetFill : colors.anchorFill}
          transparent
          opacity={closeTarget ? 0.85 : 0.95}
        />
      </mesh>
      <lineSegments geometry={edgesGeo}>
        <lineBasicMaterial color={color} />
      </lineSegments>
    </Billboard>
  )
}

function HandleDot({
  position,
  view,
  depth,
  color,
}: {
  position: { x: number; y: number }
  view: ViewType
  depth: number
  color: string
}) {
  const world = useMemo(() => toWorld(position, view, depth), [position, view, depth])
  return (
    <mesh position={world}>
      <sphereGeometry args={[1.2, 8, 8]} />
      <meshBasicMaterial color={color} transparent opacity={0.95} />
    </mesh>
  )
}

function FillPreview({
  anchors,
  view,
  depth,
  closed,
  fillColor,
}: {
  anchors: VectorAnchor[]
  view: ViewType
  depth: number
  closed: boolean
  fillColor: string
}) {
  const geometry = useMemo(() => {
    if (anchors.length < 3) return null
    const pts = sampleAnchors(anchors, closed, 0.5)
    if (pts.length < 3) return null

    const shape = new THREE.Shape()
    shape.moveTo(pts[0].x, pts[0].y)
    for (let i = 1; i < pts.length; i++) {
      shape.lineTo(pts[i].x, pts[i].y)
    }
    if (closed) shape.closePath()

    const geo = new THREE.ShapeGeometry(shape, 12)
    const pos = geo.getAttribute('position')
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const y = pos.getY(i)
      const w = planeToStroke3D(x, y, view, depth)
      pos.setXYZ(i, w.x, w.y, w.z)
    }
    pos.needsUpdate = true
    geo.computeVertexNormals()
    return geo
  }, [anchors, view, depth, closed])

  if (!geometry) return null

  return (
    <mesh geometry={geometry} renderOrder={0}>
      <meshBasicMaterial
        color={fillColor}
        transparent
        opacity={0.12}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  )
}

interface PenVisualsProps {
  draft: VectorPenDraft
  view: ViewType
  depth: number
  showFillPreview: boolean
  extrudeMode: boolean
  strokeMode: StrokeMode
}

export function PenVisuals({
  draft,
  view,
  depth,
  showFillPreview,
  extrudeMode,
  strokeMode,
}: PenVisualsProps) {
  const theme = useTheme()
  const colors: PenThemeColors = {
    stroke: theme.accent,
    handleLine: theme.textMuted,
    anchorFill: theme.text,
    anchorStroke: theme.accent,
    handleDot: theme.accent,
    closeRing: theme.accentGreen,
    fillPreview: theme.accent,
    closeTargetFill: theme.bgDark,
  }

  const curvePoints = useMemo(() => {
    const pts = sampleAnchors(draft.anchors, false, 0.35, draft.previewPoint)
    return pts.map((p) => {
      const w = planeToStroke3D(p.x, p.y, view, depth)
      return [w.x, w.y, w.z] as [number, number, number]
    })
  }, [draft, view, depth])

  const previewPath = useMemo(() => {
    if (draft.anchors.length < 2) return []
    return sampleAnchors(
      draft.anchors,
      draft.closeTargetActive,
      0.35,
      draft.previewPoint
    )
  }, [draft.anchors, draft.closeTargetActive, draft.previewPoint])

  const handleLines = useMemo(() => handleSegments(draft.anchors), [draft.anchors])
  const pendingIndex = draft.pendingAnchorIndex

  const previewClosed =
    draft.closeTargetActive || (strokeMode === 'outline' && draft.anchors.length >= 3)
  const showExtrudePreview =
    previewPath.length >= 2 &&
    (extrudeMode || strokeMode === 'outline' || strokeMode === 'centerline')

  return (
    <group>
      {showExtrudePreview && (
        <ExtrudePreviewMesh points={previewPath} view={view} closed={previewClosed} />
      )}

      {showFillPreview && strokeMode === 'blob' && !extrudeMode && draft.anchors.length >= 3 && (
        <FillPreview
          anchors={draft.anchors}
          view={view}
          depth={depth}
          closed={draft.closeTargetActive}
          fillColor={colors.fillPreview}
        />
      )}

      {curvePoints.length >= 2 && (
        <Line
          points={curvePoints}
          color={colors.stroke}
          lineWidth={1.75}
          transparent
          opacity={0.95}
        />
      )}

      {handleLines.map(([a, b], i) => {
        const wa = planeToStroke3D(a.x, a.y, view, depth)
        const wb = planeToStroke3D(b.x, b.y, view, depth)
        return (
          <Line
            key={`hl-${i}`}
            points={[
              [wa.x, wa.y, wa.z],
              [wb.x, wb.y, wb.z],
            ]}
            color={colors.handleLine}
            lineWidth={1}
            transparent
            opacity={0.8}
          />
        )
      })}

      {draft.anchors.map((anchor, i) => (
        <group key={anchor.id}>
          {anchor.inHandle && (
            <HandleDot position={anchor.inHandle} view={view} depth={depth} color={colors.handleDot} />
          )}
          {anchor.outHandle && (
            <HandleDot position={anchor.outHandle} view={view} depth={depth} color={colors.handleDot} />
          )}
          <AnchorSquare
            position={anchor.position}
            view={view}
            depth={depth}
            highlight={pendingIndex === i}
            closeTarget={draft.closeTargetActive && i === 0 && draft.anchors.length >= 3}
            colors={colors}
          />
        </group>
      ))}
    </group>
  )
}
