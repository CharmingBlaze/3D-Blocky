import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '../store/appStore'
import { worldPointFromObject } from '../mesh/objectTransform'

import { useTheme } from '../theme/useTheme'

function markerKey(objId: string, vi: number) {
  return `${objId}-${vi}`
}

const VERTEX_SIZE = 0.24
const VERTEX_HOVER_SIZE = 0.38
const POLY_DRAW_VERTEX_SIZE = 0.38
const POLY_DRAW_VERTEX_HOVER_SIZE = 0.54
const POLY_DRAW_DRAFT_SIZE = 0.42
const POLY_DRAW_CURSOR_PREVIEW_SIZE = 0.34

export function DrawVertexOverlay() {
  const { vertexIdle, vertexHoverBorder, vertexDraft, vertexDraftHover } = useTheme()
  const vertexColor = vertexIdle
  const vertexHoverColor = vertexHoverBorder
  const draftVertexColor = vertexDraft
  const draftHoverColor = vertexDraftHover
  const {
    activeTool,
    objects,
    selectionObjectIds,
    polyDrawSnapAllScene,
    polyDrawHover,
    polyDrawDraft,
  } = useAppStore(
    useShallow((s) => ({
      activeTool: s.activeTool,
      objects: s.objects,
      selectionObjectIds: s.selectionObjectIds,
      polyDrawSnapAllScene: s.polyDrawSnapAllScene,
      polyDrawHover: s.polyDrawHover,
      polyDrawDraft: s.polyDrawDraft,
    }))
  )

  const isPolyDraw = activeTool === 'poly-draw'
  const showVertices = activeTool === 'draw' || isPolyDraw

  const visibleObjects = useMemo(() => {
    if (!showVertices) return []
    if (isPolyDraw && polyDrawSnapAllScene) return objects
    if (selectionObjectIds.length > 0) {
      return objects.filter((o) => selectionObjectIds.includes(o.id))
    }
    return objects
  }, [showVertices, isPolyDraw, objects, selectionObjectIds, polyDrawSnapAllScene])

  const hoverSnap = polyDrawHover?.snap ?? null
  const hoveredMeshKey =
    hoverSnap?.kind === 'mesh' ? markerKey(hoverSnap.objectId, hoverSnap.vertexIndex) : null
  const hoveredDraftIndex = hoverSnap?.kind === 'draft' ? hoverSnap.draftIndex : null

  const meshMarkers = useMemo(() => {
    if (!showVertices) return []
    const out: { x: number; y: number; z: number; key: string }[] = []
    for (const obj of visibleObjects) {
      for (let vi = 0; vi < obj.positions.length; vi++) {
        const w = worldPointFromObject(obj, obj.positions[vi])
        out.push({ x: w.x, y: w.y, z: w.z, key: markerKey(obj.id, vi) })
      }
    }
    return out
  }, [showVertices, visibleObjects])

  const draftMarkers = useMemo(() => {
    if (!showVertices || !isPolyDraw || !polyDrawDraft) return []
    return polyDrawDraft.points.map((p, i) => ({
      x: p.world.x,
      y: p.world.y,
      z: p.world.z,
      index: i,
    }))
  }, [showVertices, isPolyDraw, polyDrawDraft])

  const showCursorPreview =
    showVertices &&
    isPolyDraw &&
    polyDrawHover &&
    !hoveredMeshKey &&
    hoveredDraftIndex === null &&
    polyDrawHover.snap === null

  if (!showVertices) return null
  if (meshMarkers.length === 0 && draftMarkers.length === 0 && !showCursorPreview) return null

  return (
    <group renderOrder={21}>
      {meshMarkers.map((m) => {
        const hovered = m.key === hoveredMeshKey
        const size = isPolyDraw ? POLY_DRAW_VERTEX_SIZE : VERTEX_SIZE
        const hoverSize = isPolyDraw ? POLY_DRAW_VERTEX_HOVER_SIZE : VERTEX_HOVER_SIZE
        return (
          <mesh key={m.key} position={[m.x, m.y, m.z]} renderOrder={hovered ? 23 : 21}>
            <sphereGeometry args={[hovered ? hoverSize : size, 10, 10]} />
            <meshBasicMaterial
              color={hovered ? vertexHoverColor : vertexColor}
              depthTest
              depthWrite
            />
          </mesh>
        )
      })}

      {draftMarkers.map((m) => {
        const hovered = m.index === hoveredDraftIndex
        const size = hovered ? POLY_DRAW_VERTEX_HOVER_SIZE : POLY_DRAW_DRAFT_SIZE
        return (
          <mesh
            key={`draft-${m.index}`}
            position={[m.x, m.y, m.z]}
            renderOrder={hovered ? 24 : 22}
          >
            <sphereGeometry args={[size, 10, 10]} />
            <meshBasicMaterial
              color={hovered ? draftHoverColor : draftVertexColor}
              depthTest
              depthWrite
            />
          </mesh>
        )
      })}

      {showCursorPreview && polyDrawHover && (
        <mesh
          position={[polyDrawHover.world.x, polyDrawHover.world.y, polyDrawHover.world.z]}
          renderOrder={22}
        >
          <sphereGeometry args={[POLY_DRAW_CURSOR_PREVIEW_SIZE, 10, 10]} />
          <meshBasicMaterial color={draftVertexColor} depthTest depthWrite />
        </mesh>
      )}
    </group>
  )
}
