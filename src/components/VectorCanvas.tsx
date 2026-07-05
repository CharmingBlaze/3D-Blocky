import { useMemo, useEffect } from 'react'
import { Line } from '@react-three/drei'
import { useShallow } from 'zustand/react/shallow'
import * as THREE from 'three'
import { useAppStore, type ViewType } from '../store/appStore'
import { planeToStroke3D } from '../utils/screenToWorld'
import { shapeDraftOutline } from '../vector/shapeDraftGeometry'
import { pathEndpoints } from '../vector/autoConnect'
import { generateShapeMesh } from '../mesh/lowPolyPrimitives'
import { projectMeshToView } from '../stroke/worldProjection'
import { PenVisuals } from './PenVisuals'
import { useTheme } from '../theme/useTheme'

interface VectorCanvasProps {
  view: ViewType
}

function toLine(
  pts: { x: number; y: number }[],
  view: ViewType,
  depth: number
): [number, number, number][] {
  return pts.map((p) => {
    const v = planeToStroke3D(p.x, p.y, view, depth)
    return [v.x, v.y, v.z] as [number, number, number]
  })
}

export function VectorCanvas({ view }: VectorCanvasProps) {
  const { accentGreen } = useTheme()
  const {
    vectorDraft,
    vectorDraftView,
    vectorIsDrawing,
    vectorPenDraft,
    activeTool,
    activeShapeKind,
    activeColor,
    defaultDepth,
    autoConnectPaths,
    vectorDocument,
    strokeMode,
    extrudeMode,
    polyBudget,
    roundedBoxRoundness,
    roundedBoxSubdivisions,
  } = useAppStore(
    useShallow((s) => ({
      vectorDraft: s.vectorDraft,
      vectorDraftView: s.vectorDraftView,
      vectorIsDrawing: s.vectorIsDrawing,
      vectorPenDraft: s.vectorPenDraft,
      activeTool: s.activeTool,
      activeShapeKind: s.activeShapeKind,
      activeColor: s.activeColor,
      defaultDepth: s.defaultDepth,
      autoConnectPaths: s.autoConnectPaths,
      vectorDocument: s.vectorDocument,
      strokeMode: s.strokeMode,
      extrudeMode: s.extrudeMode,
      polyBudget: s.polyBudget,
      roundedBoxRoundness: s.roundedBoxRoundness,
      roundedBoxSubdivisions: s.roundedBoxSubdivisions,
    }))
  )

  const color = useMemo(
    () => `#${activeColor.toString(16).padStart(6, '0')}`,
    [activeColor]
  )

  const shapeLine = useMemo(() => {
    if (!vectorIsDrawing || vectorDraftView !== view || vectorDraft.length < 2) return null
    if (activeTool !== 'vector-shape') return null
    if (activeShapeKind === 'roundedBox') return null
    const a = vectorDraft[0]
    const b = vectorDraft[vectorDraft.length - 1]
    return toLine(shapeDraftOutline(activeShapeKind, a, b), view, defaultDepth)
  }, [
    vectorIsDrawing,
    vectorDraftView,
    view,
    vectorDraft,
    activeTool,
    activeShapeKind,
    defaultDepth,
  ])

  const roundedBoxPreviewGeometry = useMemo(() => {
    if (
      !vectorIsDrawing ||
      vectorDraftView !== view ||
      vectorDraft.length < 2 ||
      activeTool !== 'vector-shape' ||
      activeShapeKind !== 'roundedBox'
    ) {
      return null
    }
    const a = vectorDraft[0]
    const b = vectorDraft[vectorDraft.length - 1]
    const mesh = generateShapeMesh(
      'roundedBox',
      a,
      b,
      polyBudget,
      activeColor,
      { roundness: roundedBoxRoundness, subdivisions: roundedBoxSubdivisions }
    )
    if (!mesh) return null
    projectMeshToView(mesh, view, defaultDepth)
    const data = mesh.toMeshData(true, 0)
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(data.positions, 3))
    geo.setIndex(new THREE.BufferAttribute(data.indices, 1))
    geo.computeVertexNormals()
    return geo
  }, [
    vectorIsDrawing,
    vectorDraftView,
    view,
    vectorDraft,
    activeTool,
    activeShapeKind,
    polyBudget,
    activeColor,
    defaultDepth,
    roundedBoxRoundness,
    roundedBoxSubdivisions,
  ])

  useEffect(() => () => roundedBoxPreviewGeometry?.dispose(), [roundedBoxPreviewGeometry])

  const snapLine = useMemo(() => {
    if (!autoConnectPaths || activeTool !== 'vector-pen') return null
    const pts: { x: number; y: number }[] = []
    for (const path of vectorDocument.paths) {
      if (path.view !== view || path.source !== 'pen' || path.closed) continue
      for (const ep of pathEndpoints(path)) {
        pts.push(ep.position)
      }
    }
    if (pts.length === 0) return null
    return toLine(pts, view, defaultDepth)
  }, [autoConnectPaths, activeTool, vectorDocument.paths, view, defaultDepth])

  const showFillPreview =
    strokeMode === 'outline' || strokeMode === 'blob' || extrudeMode

  if (roundedBoxPreviewGeometry) {
    return (
      <mesh geometry={roundedBoxPreviewGeometry} renderOrder={21}>
        <meshStandardMaterial
          color={activeColor}
          transparent
          opacity={0.42}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
    )
  }

  if (shapeLine && shapeLine.length >= 2) {
    return (
      <Line
        points={shapeLine}
        color={color}
        lineWidth={2}
        transparent
        opacity={0.85}
      />
    )
  }

  if (activeTool !== 'vector-pen') return null

  return (
    <>
      {snapLine && (
        <Line
          points={snapLine}
          color={accentGreen}
          lineWidth={3}
          transparent
          opacity={0.75}
        />
      )}
      {vectorPenDraft && vectorPenDraft.view === view && (
        <PenVisuals
          draft={vectorPenDraft}
          view={view}
          depth={defaultDepth}
          showFillPreview={showFillPreview}
          extrudeMode={extrudeMode}
        />
      )}
    </>
  )
}
