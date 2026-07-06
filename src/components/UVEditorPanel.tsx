import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from 'react'
import { useShallow } from 'zustand/react/shallow'
import { FloatingPanel } from './FloatingPanel'
import { useAppStore } from '../store/appStore'
import { compositeLayers } from '../pixel/compositeLayers'
import { pickOpenFile } from '../io/fileDialogs'
import { IMAGE_IMPORT_FILTERS } from '../io/download'
import { ensureObjectUVs, resolveUvMappingMode, detachFacesUvTopology, type SceneObjectWithUVs } from '../uv/uvObject'
import { activeObjectTextureId, listSceneTextures } from '../uv/sceneTextures'
import {
  boundaryEdgesForFacesSpatial,
  expandFaceToPlanarRegion,
  expandFacesToPlanarRegions,
  getFaceGroupMap,
  spatialMeshEdgeKey,
  type FaceGroup,
} from '../mesh/faceGroups'
import {
  uvToPixel,
  pixelToUv,
  uvBoundsFromIndices,
  uvBoundsCenter,
  blockbenchSlotLabelCenters,
  BLOCKBENCH_ATLAS_COLS,
  BLOCKBENCH_ATLAS_ROWS,
  rotateUvSnapshot,
  scaleUvSnapshot,
  type UvBounds,
} from '../uv/uvEditing'
import {
  collectIslandSnapTargets,
  collectVertexSnapTargets,
  snapUvDrag,
  type UvSnapContext,
  type UvSnapMode,
} from '../uv/uvSnap'
import { UV_UNWRAP_METHODS, type UvUnwrapMethod } from '../uv/uvUnwrap'
import type { Uv2 } from '../uv/uvTypes'

const CHECKER = 16
const HANDLE_SIZE = 7
const ROTATE_HANDLE_RADIUS = 7
const ROTATE_HANDLE_OFFSET = 28
const RESIZE_HANDLE_SIZE = 6
const MIN_ZOOM = 0.06
const MAX_ZOOM = 32
const DRAG_THRESHOLD_PX = 4
const AUTO_FIT_MIN_VISIBLE_PX = 8

function isBboxVisibleInViewport(
  box: { minX: number; minY: number; maxX: number; maxY: number },
  cw: number,
  ch: number,
  panX: number,
  panY: number,
  zoom: number,
  minVisiblePx = AUTO_FIT_MIN_VISIBLE_PX
): boolean {
  const sx0 = panX + box.minX * zoom
  const sy0 = panY + box.minY * zoom
  const sx1 = panX + box.maxX * zoom
  const sy1 = panY + box.maxY * zoom
  const ix0 = Math.max(0, sx0)
  const iy0 = Math.max(0, sy0)
  const ix1 = Math.min(cw, sx1)
  const iy1 = Math.min(ch, sy1)
  return ix1 - ix0 >= minVisiblePx && iy1 - iy0 >= minVisiblePx
}

type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
type UvDragKind = 'pan' | 'marquee' | 'handle' | 'faceDrag' | 'faceRotate' | 'faceScale'

import { useTheme } from '../theme/useTheme'

function drawChecker(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  gridA: string,
  gridB: string
) {
  for (let y = 0; y < h; y += CHECKER) {
    for (let x = 0; x < w; x += CHECKER) {
      const odd = ((x / CHECKER) | 0) + ((y / CHECKER) | 0)
      ctx.fillStyle = odd % 2 === 0 ? gridA : gridB
      ctx.fillRect(x, y, CHECKER, CHECKER)
    }
  }
}

function pointInPolygon(px: number, py: number, poly: { x: number; y: number }[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x
    const yi = poly[i].y
    const xj = poly[j].x
    const yj = poly[j].y
    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-12) + xi
    if (intersect) inside = !inside
  }
  return inside
}

function uvEdgePixels(
  obj: SceneObjectWithUVs,
  uvs: Uv2[],
  regionFaces: number[],
  va: number,
  vb: number,
  texW: number,
  texH: number
): [{ x: number; y: number }, { x: number; y: number }] | null {
  const target = spatialMeshEdgeKey(obj, va, vb)
  for (const fi of regionFaces) {
    const face = obj.faces[fi]
    const uvIdx = obj.faceUvIndices[fi]
    if (!face || !uvIdx?.length) continue
    for (let i = 0; i < face.length; i++) {
      const a = face[i]
      const b = face[(i + 1) % face.length]
      if (spatialMeshEdgeKey(obj, a, b) !== target) continue
      const uia = uvIdx[i]
      const uib = uvIdx[(i + 1) % face.length]
      return [
        uvToPixel(uvs[uia] ?? { u: 0, v: 0 }, texW, texH),
        uvToPixel(uvs[uib] ?? { u: 0, v: 0 }, texW, texH),
      ]
    }
  }
  return null
}

function drawRegionFill(
  ctx: CanvasRenderingContext2D,
  obj: SceneObjectWithUVs,
  uvs: Uv2[],
  faceIndices: number[],
  fillStyle: string,
  texW: number,
  texH: number
) {
  ctx.beginPath()
  let hasPath = false
  for (const fi of faceIndices) {
    const uvIdx = obj.faceUvIndices[fi]
    if (!uvIdx?.length) continue
    const p0 = uvToPixel(uvs[uvIdx[0]] ?? { u: 0, v: 0 }, texW, texH)
    ctx.moveTo(p0.x, p0.y)
    for (let i = 1; i < uvIdx.length; i++) {
      const p = uvToPixel(uvs[uvIdx[i]] ?? { u: 0, v: 0 }, texW, texH)
      ctx.lineTo(p.x, p.y)
    }
    ctx.closePath()
    hasPath = true
  }
  if (!hasPath) return
  ctx.fillStyle = fillStyle
  ctx.fill()
}

function drawRegionBoundary(
  ctx: CanvasRenderingContext2D,
  obj: SceneObjectWithUVs,
  uvs: Uv2[],
  faceIndices: number[],
  strokeStyle: string,
  lineWidth: number,
  texW: number,
  texH: number
) {
  const edges = boundaryEdgesForFacesSpatial(obj, faceIndices)
  if (edges.length === 0) return
  ctx.beginPath()
  for (const [va, vb] of edges) {
    const seg = uvEdgePixels(obj, uvs, faceIndices, va, vb, texW, texH)
    if (!seg) continue
    ctx.moveTo(seg[0].x, seg[0].y)
    ctx.lineTo(seg[1].x, seg[1].y)
  }
  ctx.strokeStyle = strokeStyle
  ctx.lineWidth = lineWidth
  ctx.stroke()
}

function resolveUvRegionState(
  group: FaceGroup,
  selectedFaceSet: Set<number>,
  hoverGroupId: number | null
): 'idle' | 'hover' | 'selected' {
  if (group.faceIndices.some((fi) => selectedFaceSet.has(fi))) return 'selected'
  if (hoverGroupId !== null && hoverGroupId === group.id) return 'hover'
  return 'idle'
}

function drawNavigatorArrow(
  ctx: CanvasRenderingContext2D,
  cw: number,
  ch: number,
  panX: number,
  panY: number,
  zoom: number,
  box: { cx: number; cy: number } | null,
  fillColor: string,
  strokeColor: string
) {
  if (!box) return
  const scx = panX + box.cx * zoom
  const scy = panY + box.cy * zoom
  if (scx >= 12 && scx <= cw - 12 && scy >= 12 && scy <= ch - 12) return

  const vcx = cw / 2
  const vcy = ch / 2
  const dx = scx - vcx
  const dy = scy - vcy
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return

  let t = Infinity
  if (dx > 1) t = Math.min(t, (cw - 20 - vcx) / dx)
  if (dx < -1) t = Math.min(t, (20 - vcx) / dx)
  if (dy > 1) t = Math.min(t, (ch - 20 - vcy) / dy)
  if (dy < -1) t = Math.min(t, (20 - vcy) / dy)
  if (!Number.isFinite(t) || t <= 0) return

  const ex = vcx + dx * t
  const ey = vcy + dy * t
  const angle = Math.atan2(scy - ey, scx - ex)
  const size = 10

  ctx.save()
  ctx.fillStyle = fillColor
  ctx.strokeStyle = strokeColor
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(ex + Math.cos(angle) * size, ey + Math.sin(angle) * size)
  ctx.lineTo(ex + Math.cos(angle + 2.4) * size * 0.65, ey + Math.sin(angle + 2.4) * size * 0.65)
  ctx.lineTo(ex + Math.cos(angle - 2.4) * size * 0.65, ey + Math.sin(angle - 2.4) * size * 0.65)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()
  ctx.restore()
}

export function UVEditorPanel() {
  const theme = useTheme()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{
    kind: UvDragKind | 'pending'
    activeKind?: UvDragKind
    uvIndices?: number[]
    startUvs?: Uv2[]
    pivotUv?: Uv2
    startAngle?: number
    startBounds?: UvBounds
    resizeHandle?: ResizeHandle
    startX?: number
    startY?: number
    startClientX?: number
    startClientY?: number
    panX?: number
    panY?: number
    marquee?: { x0: number; y0: number; x1: number; y1: number }
    additive?: boolean
  } | null>(null)

  const draftUvsRef = useRef<Uv2[] | null>(null)
  const redrawRafRef = useRef<number | null>(null)
  const canvasSizeRef = useRef({ w: 0, h: 0 })
  const liveViewRef = useRef<{ panX: number; panY: number; zoom: number } | null>(null)
  const hoverRef = useRef<{
    face: number | null
    point: number | null
    cursor: string
  }>({ face: null, point: null, cursor: 'crosshair' })
  const [hoverCursor, setHoverCursor] = useState('crosshair')
  const [uvEditorDisplayMode, setUvEditorDisplayMode] = useState<'polys' | 'tris' | 'regions'>('regions')

  const {
    uvEditorOpen,
    uvEditorPanel,
    uvEditorGridDivisions,
    uvEditorSnap,
    uvEditorSnapMode,
    uvEditorSmartUvAngle,
    uvEditorMode,
    uvEditorSelectedPoints,
    uvEditorSelectedFaces,
    uvEditorZoom,
    uvEditorPanX,
    uvEditorPanY,
    uvEditorShowGrid,
    uvEditorTilePreview,
    uvEditorViewAll,
    uvEditorAutoFit,
    uvEditorSticky,
    setUvEditorOpen,
    setUvEditorPanel,
    setUvEditorGridDivisions,
    setUvEditorSnap,
    setUvEditorSnapMode,
    setUvEditorSmartUvAngle,
    setUvEditorMode,
    setUvEditorSelectedPoints,
    setUvEditorSelectedFaces,
    setUvEditorView,
    setUvEditorShowGrid,
    setUvEditorTilePreview,
    setUvEditorViewAll,
    setUvEditorAutoFit,
    setUvEditorSticky,
    selectedObjectId,
    meshSelection,
    loadObjectTexture,
    assignObjectTextureDocument,
    setObjectUvPoints,
    transformSelectedUvIslands,
    unwrapSelectedUvFaces,
    selectUvFaces,
    setObjectUvMappingMode,
    captureUndoPoint,
    replaceHistoryHead,
    updateObject,
  } = useAppStore(
    useShallow((s) => ({
      uvEditorOpen: s.uvEditorOpen,
      uvEditorPanel: s.uvEditorPanel,
      uvEditorGridDivisions: s.uvEditorGridDivisions,
      uvEditorSnap: s.uvEditorSnap,
      uvEditorSnapMode: s.uvEditorSnapMode,
      uvEditorSmartUvAngle: s.uvEditorSmartUvAngle,
      uvEditorMode: s.uvEditorMode,
      uvEditorSelectedPoints: s.uvEditorSelectedPoints,
      uvEditorSelectedFaces: s.uvEditorSelectedFaces,
      uvEditorZoom: s.uvEditorZoom,
      uvEditorPanX: s.uvEditorPanX,
      uvEditorPanY: s.uvEditorPanY,
      uvEditorShowGrid: s.uvEditorShowGrid,
      uvEditorTilePreview: s.uvEditorTilePreview,
      uvEditorViewAll: s.uvEditorViewAll,
      uvEditorAutoFit: s.uvEditorAutoFit,
      uvEditorSticky: s.uvEditorSticky,
      setUvEditorOpen: s.setUvEditorOpen,
      setUvEditorPanel: s.setUvEditorPanel,
      setUvEditorGridDivisions: s.setUvEditorGridDivisions,
      setUvEditorSnap: s.setUvEditorSnap,
      setUvEditorSnapMode: s.setUvEditorSnapMode,
      setUvEditorSmartUvAngle: s.setUvEditorSmartUvAngle,
      setUvEditorMode: s.setUvEditorMode,
      setUvEditorSelectedPoints: s.setUvEditorSelectedPoints,
      setUvEditorSelectedFaces: s.setUvEditorSelectedFaces,
      setUvEditorView: s.setUvEditorView,
      setUvEditorShowGrid: s.setUvEditorShowGrid,
      setUvEditorTilePreview: s.setUvEditorTilePreview,
      setUvEditorViewAll: s.setUvEditorViewAll,
      setUvEditorAutoFit: s.setUvEditorAutoFit,
      setUvEditorSticky: s.setUvEditorSticky,
      selectedObjectId: s.selectedObjectId,
      meshSelection: s.meshSelection,
      loadObjectTexture: s.loadObjectTexture,
      assignObjectTextureDocument: s.assignObjectTextureDocument,
      setObjectUvPoints: s.setObjectUvPoints,
      transformSelectedUvIslands: s.transformSelectedUvIslands,
      unwrapSelectedUvFaces: s.unwrapSelectedUvFaces,
      selectUvFaces: s.selectUvFaces,
      setObjectUvMappingMode: s.setObjectUvMappingMode,
      captureUndoPoint: s.captureUndoPoint,
      replaceHistoryHead: s.replaceHistoryHead,
      updateObject: s.updateObject,
    }))
  )

  const objectId = selectedObjectId ?? meshSelection?.objectId ?? null
  const obj = useAppStore((s) =>
    objectId ? s.objects.find((o) => o.id === objectId) ?? null : null
  )
  const sceneTextures = useAppStore(
    useShallow((s) => listSceneTextures(s.pixelDocuments, s.objectTextures, s.objects))
  )
  const activeTextureId = useMemo(() => activeObjectTextureId(obj), [obj])
  const texId = activeTextureId
  const texture = useAppStore((s) => (texId ? s.objectTextures[texId] : undefined))
  const pixelDoc = useAppStore((s) => (texId ? s.pixelDocuments[texId] : undefined))
  const texW = pixelDoc?.width ?? texture?.width ?? 256
  const texH = pixelDoc?.height ?? texture?.height ?? 256
  const zoom = uvEditorZoom
  const pan = useMemo(() => ({ x: uvEditorPanX, y: uvEditorPanY }), [uvEditorPanX, uvEditorPanY])

  const setZoom = useCallback(
    (value: number | ((prev: number) => number)) => {
      const next = typeof value === 'function' ? value(uvEditorZoom) : value
      const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next))
      setUvEditorView(clamped, uvEditorPanX, uvEditorPanY)
    },
    [uvEditorZoom, uvEditorPanX, uvEditorPanY, setUvEditorView]
  )

  const setPan = useCallback(
    (value: { x: number; y: number } | ((prev: { x: number; y: number }) => { x: number; y: number })) => {
      const prev = { x: uvEditorPanX, y: uvEditorPanY }
      const next = typeof value === 'function' ? value(prev) : value
      setUvEditorView(uvEditorZoom, next.x, next.y)
    },
    [uvEditorZoom, uvEditorPanX, uvEditorPanY, setUvEditorView]
  )

  const [spacePan, setSpacePan] = useState(false)
  const [unwrapMethod, setUnwrapMethod] = useState<UvUnwrapMethod>('auto')
  const snapCtxRef = useRef<UvSnapContext | null>(null)
  const dragSelectionBoundsRef = useRef<{
    minX: number
    minY: number
    maxX: number
    maxY: number
  } | null>(null)
  const [islandFields, setIslandFields] = useState({ x: 0, y: 0, w: texW, h: texH, rot: 0 })
  const [pointFields, setPointFields] = useState({ x: 0, y: 0 })
  const textureImgRef = useRef<HTMLImageElement | null>(null)
  const pixelSourceCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const lastIslandRotRef = useRef(0)
  const lastClickRef = useRef({ t: 0, x: 0, y: 0 })
  const lastAutoFitFacesRef = useRef<number[]>([])

  const ensured = useMemo(() => (obj ? ensureObjectUVs(obj) : null), [obj])

  const getUvs = useCallback(() => draftUvsRef.current ?? ensured?.uvs ?? [], [ensured])

  const allFaceIndices = useMemo(
    () => (ensured ? ensured.faces.map((_, i) => i) : []),
    [ensured]
  )

  const faceGroupMap = useMemo(() => (obj ? getFaceGroupMap(obj) : null), [obj])

  const regionFacesForEdit = useMemo(() => {
    if (!obj || uvEditorSelectedFaces.length === 0) return []
    const shouldExpand = uvEditorDisplayMode === 'regions' || (uvEditorDisplayMode === 'polys' && uvEditorSticky)
    if (shouldExpand) return expandFacesToPlanarRegions(obj, uvEditorSelectedFaces)
    return [...uvEditorSelectedFaces]
  }, [obj, uvEditorSelectedFaces, uvEditorSticky, uvEditorDisplayMode])

  const selectedFaceSet = useMemo(
    () => new Set(regionFacesForEdit),
    [regionFacesForEdit]
  )

  const isolatedFaceView =
    uvEditorMode === 'faces' &&
    !uvEditorViewAll &&
    regionFacesForEdit.length > 0

  const visibleFaceIndices = useMemo(() => {
    if (!ensured) return []
    if (uvEditorViewAll || !regionFacesForEdit.length) {
      return ensured.faces.map((_, i) => i)
    }
    return regionFacesForEdit
  }, [ensured, uvEditorViewAll, regionFacesForEdit])

  const clearAllUvSelection = useCallback(() => {
    setUvEditorSelectedPoints([])
    if (objectId) selectUvFaces(objectId, [])
    else setUvEditorSelectedFaces([])
  }, [objectId, selectUvFaces, setUvEditorSelectedPoints, setUvEditorSelectedFaces])

  /** Sticky: whole coplanar region; off: single face breaks away on move. */
  const resolveFacePick = useCallback(
    (faceIndex: number, current: number[], additive: boolean): number[] => {
      if (!obj) return current
      const shouldExpand = uvEditorDisplayMode === 'regions' || (uvEditorDisplayMode === 'polys' && uvEditorSticky)
      if (!shouldExpand) {
        if (!additive) return [faceIndex]
        return current.includes(faceIndex)
          ? current.filter((fi) => fi !== faceIndex)
          : [...current, faceIndex]
      }
      const region = faceGroupMap
        ? (faceGroupMap.groups.find((g) => g.faceIndices.includes(faceIndex))?.faceIndices ?? expandFaceToPlanarRegion(obj, faceIndex))
        : expandFaceToPlanarRegion(obj, faceIndex)
      if (!additive) return region
      const allSelected = region.length > 0 && region.every((fi) => current.includes(fi))
      if (allSelected) {
        const remove = new Set(region)
        return current.filter((fi) => !remove.has(fi))
      }
      return [...new Set([...current, ...region])]
    },
    [obj, uvEditorSticky, uvEditorDisplayMode, faceGroupMap]
  )

  const getFacePixels = useCallback(
    (fi: number) => {
      if (!ensured) return []
      const uvs = getUvs()
      const uvIdx = ensured.faceUvIndices[fi]
      if (!uvIdx?.length) return []
      return uvIdx.map((ui) => uvToPixel(uvs[ui] ?? { u: 0, v: 0 }, texW, texH))
    },
    [ensured, getUvs, texW, texH]
  )

  const collectFaceUvIndices = useCallback(
    (faceIndices: number[], source: SceneObjectWithUVs | null = ensured) => {
      if (!source) return []
      const set = new Set<number>()
      for (const fi of faceIndices) {
        for (const ui of source.faceUvIndices[fi] ?? []) set.add(ui)
      }
      return [...set]
    },
    [ensured]
  )

  const prepareFaceTransformMesh = useCallback(
    (faceIndices: number[]): SceneObjectWithUVs | null => {
      if (!obj || !objectId || !ensured) return null
      if (uvEditorSticky) return ensured
      const detached = detachFacesUvTopology(obj, faceIndices)
      updateObject(objectId, {
        uvs: detached.uvs,
        faceUvIndices: detached.faceUvIndices,
      })
      return detached
    },
    [obj, objectId, ensured, uvEditorSticky, updateObject]
  )

  const getSelectionPivotUv = useCallback(
    (faceIndices: number[]) => {
      if (!ensured) return { u: 0.5, v: 0.5 }
      const uvIndices = collectFaceUvIndices(faceIndices)
      if (uvIndices.length === 0) return { u: 0.5, v: 0.5 }
      return uvBoundsCenter(uvBoundsFromIndices(getUvs(), uvIndices))
    },
    [collectFaceUvIndices, ensured, getUvs]
  )

  const getSelectionBBoxPx = useCallback(
    (faceIndices: number[]) => {
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const fi of faceIndices) {
        for (const p of getFacePixels(fi)) {
          minX = Math.min(minX, p.x)
          minY = Math.min(minY, p.y)
          maxX = Math.max(maxX, p.x)
          maxY = Math.max(maxY, p.y)
        }
      }
      if (!Number.isFinite(minX)) return null
      return { minX, minY, maxX, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 }
    },
    [getFacePixels]
  )

  const getRotateHandlePx = useCallback(
    (faceIndices: number[]) => {
      const box = getSelectionBBoxPx(faceIndices)
      if (!box) return null
      const offset = ROTATE_HANDLE_OFFSET / zoom
      return { x: box.cx, y: box.minY - offset }
    },
    [getSelectionBBoxPx, zoom]
  )

  const getSelectionBoundsUv = useCallback(
    (faceIndices: number[]) => {
      const uvIndices = collectFaceUvIndices(faceIndices)
      return uvBoundsFromIndices(getUvs(), uvIndices)
    },
    [collectFaceUvIndices, getUvs]
  )

  const pickResizeHandle = useCallback(
    (px: number, py: number, faceIndices: number[]): ResizeHandle | null => {
      const box = getSelectionBBoxPx(faceIndices)
      if (!box) return null
      const threshold = RESIZE_HANDLE_SIZE / zoom + 3
      const handles: { id: ResizeHandle; x: number; y: number }[] = [
        { id: 'nw', x: box.minX, y: box.minY },
        { id: 'n', x: box.cx, y: box.minY },
        { id: 'ne', x: box.maxX, y: box.minY },
        { id: 'e', x: box.maxX, y: box.cy },
        { id: 'se', x: box.maxX, y: box.maxY },
        { id: 's', x: box.cx, y: box.maxY },
        { id: 'sw', x: box.minX, y: box.maxY },
        { id: 'w', x: box.minX, y: box.cy },
      ]
      for (const h of handles) {
        if (Math.abs(px - h.x) <= threshold && Math.abs(py - h.y) <= threshold) return h.id
      }
      return null
    },
    [getSelectionBBoxPx, zoom]
  )

  const getScalePivotForHandle = (bounds: UvBounds, handle: ResizeHandle): Uv2 => {
    const cx = (bounds.minU + bounds.maxU) / 2
    const cy = (bounds.minV + bounds.maxV) / 2
    switch (handle) {
      case 'e':
        return { u: bounds.minU, v: cy }
      case 'w':
        return { u: bounds.maxU, v: cy }
      case 'n':
        return { u: cx, v: bounds.minV }
      case 's':
        return { u: cx, v: bounds.maxV }
      case 'ne':
        return { u: bounds.minU, v: bounds.minV }
      case 'nw':
        return { u: bounds.maxU, v: bounds.minV }
      case 'se':
        return { u: bounds.minU, v: bounds.maxV }
      case 'sw':
        return { u: bounds.maxU, v: bounds.maxV }
      default:
        return { u: cx, v: cy }
    }
  }

  const getScaleFromHandle = (bounds: UvBounds, handle: ResizeHandle, currUv: Uv2): [number, number] => {
    const w = bounds.maxU - bounds.minU || 1e-6
    const h = bounds.maxV - bounds.minV || 1e-6
    let scaleU = 1
    let scaleV = 1
    if (handle.includes('e')) scaleU = (currUv.u - bounds.minU) / w
    if (handle.includes('w')) scaleU = (bounds.maxU - currUv.u) / w
    // V increases upward; north edge is maxV, south is minV (pixel Y is flipped).
    if (handle.includes('n')) scaleV = (currUv.v - bounds.minV) / h
    if (handle.includes('s')) scaleV = (bounds.maxV - currUv.v) / h
    return [Math.max(0.01, scaleU), Math.max(0.01, scaleV)]
  }

  const frameToFaceIndices = useCallback(
    (faceIndices: number[]) => {
      const container = containerRef.current
      if (!container) return
      const cw = container.clientWidth
      const ch = container.clientHeight
      if (cw <= 0 || ch <= 0) return

      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity

      for (const ui of collectFaceUvIndices(faceIndices)) {
        const { x, y } = uvToPixel(getUvs()[ui] ?? { u: 0, v: 0 }, texW, texH)
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }

      if (!Number.isFinite(minX)) {
        setPan({ x: 24, y: 24 })
        setZoom(1)
        return
      }

      const pad = 32
      const bw = Math.max(maxX - minX, 1)
      const bh = Math.max(maxY - minY, 1)
      const nz = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min((cw - pad * 2) / bw, (ch - pad * 2) / bh)))
      setZoom(nz)
      setPan({
        x: (cw - (minX + maxX) * nz) / 2,
        y: (ch - (minY + maxY) * nz) / 2,
      })
    },
    [collectFaceUvIndices, getUvs, texW, texH, setPan, setZoom]
  )

  const frameSelection = useCallback(() => {
    if (regionFacesForEdit.length > 0 && !uvEditorViewAll) {
      frameToFaceIndices(regionFacesForEdit)
      return
    }

    const container = containerRef.current
    if (!container) return
    const cw = container.clientWidth
    const ch = container.clientHeight
    if (cw <= 0 || ch <= 0) return

    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity

    const addIndices = (uvIndices: number[]) => {
      for (const ui of uvIndices) {
        const { x, y } = uvToPixel(getUvs()[ui] ?? { u: 0, v: 0 }, texW, texH)
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
    }

    if (uvEditorSelectedPoints.length > 0) {
      addIndices(uvEditorSelectedPoints)
    } else if (ensured) {
      addIndices(ensured.uvs.map((_, i) => i))
    }

    if (!Number.isFinite(minX)) {
      setPan({ x: 24, y: 24 })
      setZoom(1)
      return
    }

    const pad = 32
    const bw = Math.max(maxX - minX, 1)
    const bh = Math.max(maxY - minY, 1)
    const nz = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min((cw - pad * 2) / bw, (ch - pad * 2) / bh)))
    setZoom(nz)
    setPan({
      x: (cw - (minX + maxX) * nz) / 2,
      y: (ch - (minY + maxY) * nz) / 2,
    })
  }, [
    ensured,
    frameToFaceIndices,
    getUvs,
    texW,
    texH,
    regionFacesForEdit,
    uvEditorViewAll,
    uvEditorSelectedPoints,
    setPan,
    setZoom,
  ])

  const getViewPanZoom = useCallback(() => {
    const live = liveViewRef.current
    if (live) return live
    const state = useAppStore.getState()
    return {
      panX: state.uvEditorPanX,
      panY: state.uvEditorPanY,
      zoom: state.uvEditorZoom,
    }
  }, [])

  const clearPanPreview = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.style.transform = ''
    canvas.style.willChange = ''
  }, [])

  const applyPanPreview = useCallback((dx: number, dy: number) => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.style.willChange = 'transform'
    canvas.style.transform = `translate3d(${dx}px, ${dy}px, 0)`
  }, [])

  const screenToUvPixel = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current
      if (!canvas) return { x: 0, y: 0 }
      const rect = canvas.getBoundingClientRect()
      const sx = clientX - rect.left
      const sy = clientY - rect.top
      const { panX, panY, zoom: z } = getViewPanZoom()
      return {
        x: (sx - panX) / z,
        y: (sy - panY) / z,
      }
    },
    [getViewPanZoom]
  )

  const ensureSelectionVisible = useCallback(
    (faceIndices: number[]) => {
      if (!uvEditorAutoFit || faceIndices.length === 0) return
      const container = containerRef.current
      if (!container) return
      const box = getSelectionBBoxPx(faceIndices)
      if (!box) return
      const cw = container.clientWidth
      const ch = container.clientHeight
      if (cw <= 0 || ch <= 0) return
      const { panX, panY, zoom: viewZoom } = getViewPanZoom()
      if (isBboxVisibleInViewport(box, cw, ch, panX, panY, viewZoom)) return
      frameToFaceIndices(faceIndices)
    },
    [uvEditorAutoFit, getSelectionBBoxPx, getViewPanZoom, frameToFaceIndices]
  )

  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container || !ensured) return
    const cw = container.clientWidth
    const ch = container.clientHeight
    if (canvasSizeRef.current.w !== cw || canvasSizeRef.current.h !== ch) {
      canvas.width = cw
      canvas.height = ch
      canvasSizeRef.current = { w: cw, h: ch }
    }
    clearPanPreview()
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const { panX, panY, zoom: viewZoom } = getViewPanZoom()
    const hoverFace = hoverRef.current.face
    const hoverPoint = hoverRef.current.point

    ctx.clearRect(0, 0, cw, ch)
    ctx.save()
    ctx.translate(panX, panY)
    ctx.scale(viewZoom, viewZoom)

    ctx.fillStyle = theme.uvCanvasBg
    ctx.fillRect(0, 0, texW, texH)

    const img = textureImgRef.current ?? pixelSourceCanvasRef.current
    if (img && uvEditorTilePreview) {
      ctx.globalAlpha = 0.3
      for (let ty = -1; ty <= 1; ty++) {
        for (let tx = -1; tx <= 1; tx++) {
          if (tx === 0 && ty === 0) continue
          ctx.drawImage(img, tx * texW, ty * texH, texW, texH)
        }
      }
      ctx.globalAlpha = 1
    }

    if (img) {
      ctx.drawImage(img, 0, 0, texW, texH)
    } else {
      drawChecker(ctx, texW, texH, theme.uvGridA, theme.uvGridB)
    }

    ctx.strokeStyle = theme.accent
    ctx.globalAlpha = 0.45
    ctx.lineWidth = 2 / viewZoom
    ctx.strokeRect(0, 0, texW, texH)
    ctx.globalAlpha = 1

    if (resolveUvMappingMode(ensured) === 'perFace') {
      ctx.strokeStyle = 'rgba(255,255,255,0.18)'
      ctx.lineWidth = 1.25 / viewZoom
      for (let c = 1; c < BLOCKBENCH_ATLAS_COLS; c++) {
        const x = (c * texW) / BLOCKBENCH_ATLAS_COLS
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, texH)
        ctx.stroke()
      }
      for (let r = 1; r < BLOCKBENCH_ATLAS_ROWS; r++) {
        const y = (r * texH) / BLOCKBENCH_ATLAS_ROWS
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(texW, y)
        ctx.stroke()
      }
      ctx.fillStyle = 'rgba(255,255,255,0.28)'
      ctx.font = `${Math.max(9, 11 / viewZoom)}px system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      for (const slot of blockbenchSlotLabelCenters()) {
        const px = uvToPixel({ u: slot.u, v: slot.v }, texW, texH)
        ctx.fillText(slot.label, px.x, px.y)
      }
    }

    if (uvEditorShowGrid) {
      ctx.strokeStyle = 'rgba(255,255,255,0.12)'
      ctx.lineWidth = 1 / viewZoom
      const stepX = texW / uvEditorGridDivisions
      const stepY = texH / uvEditorGridDivisions
      for (let i = 0; i <= uvEditorGridDivisions; i++) {
        ctx.beginPath()
        ctx.moveTo(i * stepX, 0)
        ctx.lineTo(i * stepX, texH)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(0, i * stepY)
        ctx.lineTo(texW, i * stepY)
        ctx.stroke()
      }
    }

    ctx.strokeStyle = theme.accent
    ctx.globalAlpha = 0.9
    ctx.lineWidth = 1.5 / viewZoom

    const uvs = getUvs()
    const hoverGroupId =
      hoverFace !== null && faceGroupMap ? (faceGroupMap.faceToGroup[hoverFace] ?? null) : null
    const hasFaceSelection = uvEditorMode === 'faces' && selectedFaceSet.size > 0

    if (ensured) {
      if (uvEditorDisplayMode === 'regions' && faceGroupMap) {
        if (isolatedFaceView) {
          drawRegionFill(
            ctx,
            ensured,
            uvs,
            visibleFaceIndices,
            'rgba(110, 203, 245, 0.12)',
            texW,
            texH
          )
          drawRegionBoundary(
            ctx,
            ensured,
            uvs,
            visibleFaceIndices,
            theme.accent,
            2.25 / viewZoom,
            texW,
            texH
          )
        } else {
          for (const group of faceGroupMap.groups) {
            const state = resolveUvRegionState(group, selectedFaceSet, hoverGroupId)
            const dimmed = hasFaceSelection && state === 'idle'

            let fill = 'rgba(255,255,255,0.02)'
            let stroke = 'rgba(255,255,255,0.18)'
            let strokeW = 1 / viewZoom
            if (state === 'selected') {
              fill = 'rgba(110, 203, 245, 0.12)'
              stroke = theme.accent
              strokeW = 2.25 / viewZoom
            } else if (state === 'hover') {
              fill = 'rgba(255, 178, 102, 0.15)'
              stroke = theme.meshHover
              strokeW = 2 / viewZoom
            } else if (dimmed) {
              fill = 'rgba(0,0,0,0.1)'
              stroke = 'rgba(255,255,255,0.05)'
            }

            drawRegionFill(ctx, ensured, uvs, group.faceIndices, fill, texW, texH)

            ctx.beginPath()
            for (const fi of group.faceIndices) {
              const pts = getFacePixels(fi)
              if (pts.length < 3) continue
              ctx.moveTo(pts[0].x, pts[0].y)
              for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
              ctx.closePath()
            }
            ctx.strokeStyle = state === 'selected' ? 'rgba(110, 203, 245, 0.35)' : 'rgba(255, 255, 255, 0.08)'
            ctx.lineWidth = 1 / viewZoom
            ctx.stroke()

            drawRegionBoundary(ctx, ensured, uvs, group.faceIndices, stroke, strokeW, texW, texH)
          }
        }
      } else if (uvEditorDisplayMode === 'tris') {
        for (const fi of visibleFaceIndices) {
          const pts = getFacePixels(fi)
          if (pts.length < 3) continue

          const isSelected = selectedFaceSet.has(fi)
          const isHovered = hoverFace === fi
          const dimmed = hasFaceSelection && !isSelected

          let fill = 'rgba(255,255,255,0.02)'
          let stroke = 'rgba(255,255,255,0.15)'
          if (isSelected) {
            fill = 'rgba(110, 203, 245, 0.12)'
            stroke = theme.accent
          } else if (isHovered) {
            fill = 'rgba(255, 178, 102, 0.15)'
            stroke = theme.meshHover
          } else if (dimmed) {
            fill = 'rgba(0,0,0,0.1)'
            stroke = 'rgba(255,255,255,0.05)'
          }

          ctx.beginPath()
          for (let i = 1; i <= pts.length - 2; i++) {
            ctx.moveTo(pts[0].x, pts[0].y)
            ctx.lineTo(pts[i].x, pts[i].y)
            ctx.lineTo(pts[i + 1].x, pts[i + 1].y)
            ctx.closePath()
          }
          ctx.fillStyle = fill
          ctx.fill()
          ctx.strokeStyle = stroke
          ctx.lineWidth = (isSelected || isHovered ? 1.5 : 1) / viewZoom
          ctx.stroke()
        }
      } else {
        for (const fi of visibleFaceIndices) {
          const pts = getFacePixels(fi)
          if (pts.length < 3) continue

          const isSelected = selectedFaceSet.has(fi)
          const isHovered = hoverFace === fi
          const dimmed = hasFaceSelection && !isSelected

          let fill = 'rgba(255,255,255,0.02)'
          let stroke = 'rgba(255,255,255,0.18)'
          if (isSelected) {
            fill = 'rgba(110, 203, 245, 0.12)'
            stroke = theme.accent
          } else if (isHovered) {
            fill = 'rgba(255, 178, 102, 0.15)'
            stroke = theme.meshHover
          } else if (dimmed) {
            fill = 'rgba(0,0,0,0.1)'
            stroke = 'rgba(255,255,255,0.05)'
          }

          ctx.beginPath()
          ctx.moveTo(pts[0].x, pts[0].y)
          for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
          ctx.closePath()

          ctx.fillStyle = fill
          ctx.fill()
          ctx.strokeStyle = stroke
          ctx.lineWidth = (isSelected || isHovered ? 1.5 : 1) / viewZoom
          ctx.stroke()
        }
      }
    }

    if (uvEditorMode === 'points') {
      const handleSet = new Set<number>()
      for (const fi of visibleFaceIndices) {
        for (const ui of ensured.faceUvIndices[fi] ?? []) handleSet.add(ui)
      }

      for (const ui of handleSet) {
        const uv = getUvs()[ui] ?? { u: 0, v: 0 }
        const { x, y } = uvToPixel(uv, texW, texH)
        const selected = uvEditorSelectedPoints.includes(ui)
        const hovered = hoverPoint === ui

        const r = (hovered ? 5.5 : 4) / viewZoom
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)

        if (selected) {
          ctx.shadowColor = theme.accent
          ctx.shadowBlur = 6
          ctx.fillStyle = theme.accent
          ctx.strokeStyle = '#ffffff'
          ctx.lineWidth = 2 / viewZoom
        } else if (hovered) {
          ctx.fillStyle = theme.meshHover
          ctx.strokeStyle = theme.accent
          ctx.lineWidth = 1.5 / viewZoom
        } else {
          ctx.fillStyle = theme.uvCanvasBg || '#1e1e24'
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)'
          ctx.lineWidth = 1.25 / viewZoom
        }

        ctx.fill()
        ctx.stroke()
        ctx.shadowBlur = 0

        if (!selected && !hovered) {
          ctx.beginPath()
          ctx.arc(x, y, 1.25 / viewZoom, 0, Math.PI * 2)
          ctx.fillStyle = 'rgba(255, 255, 255, 0.8)'
          ctx.fill()
        }
      }
    }

    if (uvEditorMode === 'faces' && regionFacesForEdit.length > 0) {
      const box = getSelectionBBoxPx(regionFacesForEdit)
      const handle = getRotateHandlePx(regionFacesForEdit)
      const pivotPx = uvToPixel(getSelectionPivotUv(regionFacesForEdit), texW, texH)

      if (box) {
        ctx.fillStyle = 'rgba(110, 203, 245, 0.04)'
        ctx.fillRect(box.minX, box.minY, box.maxX - box.minX, box.maxY - box.minY)

        ctx.strokeStyle = theme.accent
        ctx.setLineDash([5 / viewZoom, 4 / viewZoom])
        ctx.lineWidth = 1.25 / viewZoom
        ctx.strokeRect(box.minX, box.minY, box.maxX - box.minX, box.maxY - box.minY)
        ctx.setLineDash([])

        const hs = RESIZE_HANDLE_SIZE / viewZoom
        const r = hs / 2
        const handles = [
          { x: box.minX, y: box.minY },
          { x: box.cx, y: box.minY },
          { x: box.maxX, y: box.minY },
          { x: box.maxX, y: box.cy },
          { x: box.maxX, y: box.maxY },
          { x: box.cx, y: box.maxY },
          { x: box.minX, y: box.maxY },
          { x: box.minX, y: box.cy },
        ]
        for (const h of handles) {
          ctx.beginPath()
          ctx.arc(h.x, h.y, r, 0, Math.PI * 2)
          ctx.fillStyle = '#ffffff'
          ctx.strokeStyle = theme.accent
          ctx.lineWidth = 1.5 / viewZoom
          ctx.fill()
          ctx.stroke()
        }
      }

      if (handle) {
        ctx.beginPath()
        ctx.moveTo(pivotPx.x, pivotPx.y)
        ctx.lineTo(handle.x, handle.y)
        ctx.strokeStyle = theme.accent
        ctx.globalAlpha = 0.55
        ctx.lineWidth = 1 / viewZoom
        ctx.stroke()
        ctx.globalAlpha = 1

        const hr = ROTATE_HANDLE_RADIUS / viewZoom
        ctx.beginPath()
        ctx.arc(handle.x, handle.y, hr, 0, Math.PI * 2)
        ctx.fillStyle = theme.accent
        ctx.fill()
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 1.5 / viewZoom
        ctx.stroke()

        ctx.beginPath()
        ctx.arc(handle.x, handle.y, hr * 0.45, 0, Math.PI * 2)
        ctx.fillStyle = '#ffffff'
        ctx.fill()
      }
    }

    if (dragRef.current?.kind === 'marquee' && dragRef.current.marquee) {
      const m = dragRef.current.marquee
      const w = m.x1 - m.x0
      const h = m.y1 - m.y0
      
      ctx.fillStyle = 'rgba(110, 203, 245, 0.06)'
      ctx.fillRect(m.x0, m.y0, w, h)

      ctx.strokeStyle = theme.accent
      ctx.setLineDash([4 / viewZoom, 4 / viewZoom])
      ctx.lineWidth = 1.25 / viewZoom
      ctx.strokeRect(m.x0, m.y0, w, h)
      ctx.setLineDash([])
    }

    ctx.restore()

    const navBox =
      uvEditorSelectedFaces.length > 0
        ? getSelectionBBoxPx(regionFacesForEdit)
        : uvEditorSelectedPoints.length > 0
          ? (() => {
              let minX = Infinity
              let minY = Infinity
              let maxX = -Infinity
              let maxY = -Infinity
              for (const ui of uvEditorSelectedPoints) {
                const { x, y } = uvToPixel(getUvs()[ui] ?? { u: 0, v: 0 }, texW, texH)
                minX = Math.min(minX, x)
                minY = Math.min(minY, y)
                maxX = Math.max(maxX, x)
                maxY = Math.max(maxY, y)
              }
              if (!Number.isFinite(minX)) return null
              return { minX, minY, maxX, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 }
            })()
          : null
    if (navBox) {
      drawNavigatorArrow(ctx, cw, ch, panX, panY, viewZoom, navBox, theme.accent, theme.uvCanvasBg)
    }
  }, [
    ensured,
    obj,
    faceGroupMap,
    selectedFaceSet,
    visibleFaceIndices,
    isolatedFaceView,
    getFacePixels,
    texW,
    texH,
    getViewPanZoom,
    uvEditorShowGrid,
    uvEditorTilePreview,
    uvEditorGridDivisions,
    uvEditorSelectedPoints,
    uvEditorSelectedFaces,
    uvEditorMode,
    texture?.url,
    uvEditorPanel.width,
    uvEditorPanel.height,
    getSelectionBBoxPx,
    getRotateHandlePx,
    getSelectionPivotUv,
    getUvs,
    theme,
    clearPanPreview,
    uvEditorDisplayMode,
  ])

  const scheduleRedraw = useCallback(() => {
    if (redrawRafRef.current != null) return
    redrawRafRef.current = requestAnimationFrame(() => {
      redrawRafRef.current = null
      redraw()
    })
  }, [redraw])

  const applyUvDraft = useCallback(
    (updates: Array<{ uvIndex: number; u: number; v: number }>) => {
      if (!ensured || updates.length === 0) return
      const base = draftUvsRef.current ?? ensured.uvs.map((u) => ({ ...u }))
      const next = base.map((u) => ({ ...u }))
      for (const u of updates) next[u.uvIndex] = { u: u.u, v: u.v }
      draftUvsRef.current = next
      scheduleRedraw()
    },
    [ensured, scheduleRedraw]
  )

  const flushDraftUvs = useCallback(() => {
    if (!objectId || !draftUvsRef.current || !ensured) {
      draftUvsRef.current = null
      return
    }
    const draft = draftUvsRef.current
    const updates: Array<{ uvIndex: number; u: number; v: number }> = []
    for (let i = 0; i < draft.length; i++) {
      const orig = ensured.uvs[i]
      const d = draft[i]
      if (!orig || orig.u !== d.u || orig.v !== d.v) {
        updates.push({ uvIndex: i, u: d.u, v: d.v })
      }
    }
    draftUvsRef.current = null
    if (updates.length > 0) setObjectUvPoints(objectId, updates, false)
  }, [objectId, ensured, setObjectUvPoints])

  useEffect(() => {
    if (pixelDoc) {
      const canvas = pixelSourceCanvasRef.current ?? document.createElement('canvas')
      pixelSourceCanvasRef.current = canvas
      canvas.width = pixelDoc.width
      canvas.height = pixelDoc.height
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const composite = compositeLayers(pixelDoc)
      ctx.putImageData(
        new ImageData(new Uint8ClampedArray(composite), pixelDoc.width, pixelDoc.height),
        0,
        0
      )
      textureImgRef.current = null
      scheduleRedraw()
      return
    }

    if (!texture?.url) {
      textureImgRef.current = null
      scheduleRedraw()
      return
    }
    let cancelled = false
    const img = new Image()
    img.onload = () => {
      if (!cancelled) {
        textureImgRef.current = img
        scheduleRedraw()
      }
    }
    img.src = texture.url
    return () => {
      cancelled = true
    }
  }, [pixelDoc, texture?.url, scheduleRedraw])

  useEffect(() => {
    return () => {
      if (redrawRafRef.current != null) cancelAnimationFrame(redrawRafRef.current)
    }
  }, [])

  useEffect(() => {
    if (!uvEditorOpen || !objectId || !ensured || !obj) return
    if (meshSelection?.objectId === objectId && meshSelection.faces.length > 0) {
      const shouldExpand = uvEditorDisplayMode === 'regions' || (uvEditorDisplayMode === 'polys' && uvEditorSticky)
      const expanded = shouldExpand
        ? expandFacesToPlanarRegions(obj, meshSelection.faces)
        : [...meshSelection.faces]
      setUvEditorSelectedFaces(expanded)
      setUvEditorSelectedPoints([])
    } else if (meshSelection?.objectId === objectId) {
      setUvEditorSelectedFaces([])
      setUvEditorSelectedPoints([])
    }
  }, [uvEditorOpen, objectId, ensured, obj, meshSelection?.objectId, meshSelection?.faces, uvEditorSticky, uvEditorDisplayMode, setUvEditorSelectedFaces, setUvEditorSelectedPoints])

  useEffect(() => {
    if (!uvEditorOpen || !uvEditorAutoFit || uvEditorMode !== 'faces' || !obj) {
      lastAutoFitFacesRef.current = []
      return
    }
    if (uvEditorSelectedFaces.length === 0) {
      lastAutoFitFacesRef.current = []
      return
    }
    const prev = lastAutoFitFacesRef.current
    if (
      prev.length === uvEditorSelectedFaces.length &&
      prev.every((face, index) => face === uvEditorSelectedFaces[index])
    ) {
      return
    }
    lastAutoFitFacesRef.current = [...uvEditorSelectedFaces]
    const shouldExpand = uvEditorDisplayMode === 'regions' || (uvEditorDisplayMode === 'polys' && uvEditorSticky)
    const expanded = shouldExpand
      ? expandFacesToPlanarRegions(obj, uvEditorSelectedFaces)
      : uvEditorSelectedFaces
    const id = window.requestAnimationFrame(() => ensureSelectionVisible(expanded))
    return () => window.cancelAnimationFrame(id)
  }, [
    uvEditorSelectedFaces,
    uvEditorOpen,
    uvEditorAutoFit,
    uvEditorMode,
    obj,
    uvEditorSticky,
    uvEditorDisplayMode,
    ensureSelectionVisible,
  ])

  useEffect(() => {
    redraw()
  }, [redraw, obj, uvEditorOpen])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver(() => redraw())
    observer.observe(container)
    return () => observer.disconnect()
  }, [redraw])

  useEffect(() => {
    const onResize = () => redraw()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [redraw])

  const pickHandle = (px: number, py: number): number | null => {
    if (!ensured || uvEditorMode !== 'points') return null
    const threshold = HANDLE_SIZE / zoom + 2
    const set = new Set<number>()
    for (const fi of visibleFaceIndices) {
      for (const ui of ensured.faceUvIndices[fi] ?? []) set.add(ui)
    }
    for (const ui of set) {
      const { x, y } = uvToPixel(getUvs()[ui] ?? { u: 0, v: 0 }, texW, texH)
      if (Math.abs(px - x) <= threshold && Math.abs(py - y) <= threshold) return ui
    }
    return null
  }

  const pickRotateHandle = (px: number, py: number): boolean => {
    if (uvEditorMode !== 'faces' || uvEditorSelectedFaces.length === 0) return false
    const handle = getRotateHandlePx(regionFacesForEdit)
    if (!handle) return false
    const threshold = ROTATE_HANDLE_RADIUS / zoom + 4
    return Math.hypot(px - handle.x, py - handle.y) <= threshold
  }

  const pickFace = (px: number, py: number): number | null => {
    if (!ensured) return null
    const candidates = isolatedFaceView
      ? visibleFaceIndices
      : faceGroupMap
        ? faceGroupMap.groups.flatMap((g) => g.faceIndices)
        : visibleFaceIndices
    for (let i = candidates.length - 1; i >= 0; i--) {
      const faceIndex = candidates[i]
      const poly = getFacePixels(faceIndex)
      if (poly.length >= 3 && pointInPolygon(px, py, poly)) return faceIndex
    }
    return null
  }

  const isInSelectionBBox = useCallback(
    (px: number, py: number, faceIndices: number[]) => {
      const box = getSelectionBBoxPx(faceIndices)
      if (!box) return false
      const pad = 4 / (liveViewRef.current?.zoom ?? zoom)
      return (
        px >= box.minX - pad &&
        px <= box.maxX + pad &&
        py >= box.minY - pad &&
        py <= box.maxY + pad
      )
    },
    [getSelectionBBoxPx, zoom]
  )

  const beginPendingUvDrag = (
    activeKind: UvDragKind,
    uvIndices: number[],
    startUvs: Uv2[],
    startX: number,
    startY: number,
    clientX: number,
    clientY: number,
    extra: Partial<NonNullable<typeof dragRef.current>> = {}
  ) => {
    dragRef.current = {
      kind: 'pending',
      activeKind,
      uvIndices,
      startUvs,
      startX,
      startY,
      startClientX: clientX,
      startClientY: clientY,
      ...extra,
    }
  }

  const buildSnapContext = useCallback(
    (uvIndices: number[], excludeFaces: number[]) => {
      if (!ensured) return
      snapCtxRef.current = {
        texW,
        texH,
        gridDivisions: uvEditorGridDivisions,
        vertexTargets: collectVertexSnapTargets(
          ensured.uvs,
          new Set(uvIndices),
          texW,
          texH
        ),
        islandTargets: collectIslandSnapTargets(
          ensured.uvs,
          ensured.faceUvIndices,
          new Set(excludeFaces),
          texW,
          texH
        ),
        thresholdPx: Math.max(6, 10 / (liveViewRef.current?.zoom ?? zoom)),
      }
    },
    [ensured, texW, texH, uvEditorGridDivisions, zoom]
  )

  const activatePendingDrag = useCallback(() => {
    const d = dragRef.current
    if (!d || d.kind !== 'pending' || !d.activeKind || !ensured || !objectId) return false
    d.kind = d.activeKind
    captureUndoPoint('Edit UV')

    const editFaces = regionFacesForEdit
    const transformMesh =
      d.activeKind === 'faceDrag' ||
      d.activeKind === 'faceRotate' ||
      d.activeKind === 'faceScale'
        ? prepareFaceTransformMesh(editFaces)
        : null
    const mesh = transformMesh ?? ensured

    if (transformMesh && d.uvIndices) {
      const uvIndices = collectFaceUvIndices(editFaces, mesh)
      d.uvIndices = uvIndices
      d.startUvs = uvIndices.map((i) => ({ ...mesh.uvs[i]! }))
    }

    draftUvsRef.current = mesh.uvs.map((u) => ({ ...u }))

    buildSnapContext(d.uvIndices ?? [], editFaces)
    if (d.activeKind === 'faceDrag' && editFaces.length > 0) {
      dragSelectionBoundsRef.current = getSelectionBBoxPx(editFaces)
    } else {
      dragSelectionBoundsRef.current = null
    }
    return true
  }, [
    ensured,
    objectId,
    captureUndoPoint,
    buildSnapContext,
    regionFacesForEdit,
    prepareFaceTransformMesh,
    collectFaceUvIndices,
    getSelectionBBoxPx,
  ])

  const commitLiveView = useCallback(() => {
    const live = liveViewRef.current
    if (live) {
      setUvEditorView(live.zoom, live.panX, live.panY)
      liveViewRef.current = null
    }
  }, [setUvEditorView])

  const updateHoverAt = (clientX: number, clientY: number) => {
    if (!ensured) return
    const px = screenToUvPixel(clientX, clientY)
    let cursor = 'crosshair'
    let face: number | null = null
    let point: number | null = null

    if (uvEditorMode === 'faces' && uvEditorSelectedFaces.length > 0) {
      if (pickResizeHandle(px.x, px.y, regionFacesForEdit)) {
        cursor = 'nwse-resize'
      } else if (pickRotateHandle(px.x, px.y)) {
        cursor = 'grab'
      } else if (isInSelectionBBox(px.x, px.y, regionFacesForEdit)) {
        cursor = 'move'
      }
    }

    if (uvEditorMode === 'points') {
      point = pickHandle(px.x, px.y)
      if (point !== null) cursor = 'pointer'
    }

    if (uvEditorMode === 'faces') {
      face = pickFace(px.x, px.y)
      if (face !== null && cursor === 'crosshair') cursor = 'pointer'
    }

    const prev = hoverRef.current
    if (prev.face === face && prev.point === point && prev.cursor === cursor) return
    hoverRef.current = { face, point, cursor }
    setHoverCursor(cursor)
    scheduleRedraw()
  }

  const moveSelectionToCursor = useCallback(
    (px: number, py: number) => {
      if (!objectId || !ensured) return
      const clickUv = pixelToUv(px, py, texW, texH)
      const hasFaceSel = uvEditorMode === 'faces' && uvEditorSelectedFaces.length > 0
      const hasPointSel = uvEditorMode === 'points' && uvEditorSelectedPoints.length > 0
      if (!hasFaceSel && !hasPointSel) return
      const pivot = hasFaceSel
        ? getSelectionPivotUv(regionFacesForEdit)
        : uvBoundsCenter(uvBoundsFromIndices(getUvs(), uvEditorSelectedPoints))
      if (hasFaceSel) prepareFaceTransformMesh(regionFacesForEdit)
      transformSelectedUvIslands({
        translate: [clickUv.u - pivot.u, clickUv.v - pivot.v],
      })
    },
    [
      objectId,
      ensured,
      texW,
      texH,
      uvEditorMode,
      uvEditorSelectedFaces,
      uvEditorSelectedPoints,
      regionFacesForEdit,
      getUvs,
      getSelectionPivotUv,
      prepareFaceTransformMesh,
      transformSelectedUvIslands,
    ]
  )

  const onPointerDown = (e: React.PointerEvent) => {
    if (!objectId || !ensured) return
    const px = screenToUvPixel(e.clientX, e.clientY)
    let capturePointer = false

    const now = Date.now()
    if (
      e.button === 0 &&
      !e.ctrlKey &&
      !e.altKey &&
      !spacePan &&
      now - lastClickRef.current.t < 350 &&
      Math.hypot(px.x - lastClickRef.current.x, px.y - lastClickRef.current.y) < 10
    ) {
      frameSelection()
      lastClickRef.current = { t: 0, x: 0, y: 0 }
      return
    }
    lastClickRef.current = { t: now, x: px.x, y: px.y }

    if (e.button === 0 && e.altKey && !e.ctrlKey) {
      moveSelectionToCursor(px.x, px.y)
      return
    }

    if (e.button === 1 || (e.button === 0 && spacePan)) {
      e.preventDefault()
      liveViewRef.current = { panX: pan.x, panY: pan.y, zoom }
      dragRef.current = {
        kind: 'pan',
        panX: pan.x,
        panY: pan.y,
        startClientX: e.clientX,
        startClientY: e.clientY,
      }
      setHoverCursor('grabbing')
      capturePointer = true
    } else if (e.button !== 0) {
      return
    } else if (uvEditorMode === 'points') {
      const handle = pickHandle(px.x, px.y)
      if (handle !== null) {
        const indices =
          e.shiftKey && uvEditorSelectedPoints.includes(handle)
            ? uvEditorSelectedPoints.filter((i) => i !== handle)
            : e.shiftKey
              ? [...new Set([...uvEditorSelectedPoints, handle])]
              : [handle]
        setUvEditorSelectedPoints(indices)
        if (!e.shiftKey) setUvEditorSelectedFaces([])
        beginPendingUvDrag(
          'handle',
          indices,
          indices.map((i) => ({ ...ensured.uvs[i] })),
          px.x,
          px.y,
          e.clientX,
          e.clientY
        )
        capturePointer = true
      } else {
        if (!e.shiftKey) {
          clearAllUvSelection()
        }
        dragRef.current = {
          kind: 'marquee',
          startX: px.x,
          startY: px.y,
          marquee: { x0: px.x, y0: px.y, x1: px.x, y1: px.y },
          additive: e.shiftKey,
        }
        capturePointer = true
      }
    } else if (uvEditorMode === 'faces') {
      const resize = uvEditorSelectedFaces.length > 0 ? pickResizeHandle(px.x, px.y, regionFacesForEdit) : null
      const rotate = uvEditorSelectedFaces.length > 0 ? pickRotateHandle(px.x, px.y) : false

      if (resize) {
        captureUndoPoint('Edit UV')
        const mesh = prepareFaceTransformMesh(regionFacesForEdit) ?? ensured
        const uvIndices = collectFaceUvIndices(regionFacesForEdit, mesh)
        const startBounds = getSelectionBoundsUv(regionFacesForEdit)
        const pivotUv = getScalePivotForHandle(startBounds, resize)
        draftUvsRef.current = mesh.uvs.map((u) => ({ ...u }))
        buildSnapContext(uvIndices, regionFacesForEdit)
        dragSelectionBoundsRef.current = getSelectionBBoxPx(regionFacesForEdit)
        dragRef.current = {
          kind: 'faceScale',
          uvIndices,
          startUvs: uvIndices.map((i) => ({ ...mesh.uvs[i]! })),
          startBounds,
          resizeHandle: resize,
          pivotUv,
          startX: px.x,
          startY: px.y,
        }
        capturePointer = true
      } else if (rotate) {
        captureUndoPoint('Edit UV')
        const mesh = prepareFaceTransformMesh(regionFacesForEdit) ?? ensured
        const uvIndices = collectFaceUvIndices(regionFacesForEdit, mesh)
        const pivotUv = getSelectionPivotUv(regionFacesForEdit)
        const startUv = pixelToUv(px.x, px.y, texW, texH)
        const startAngle = Math.atan2(startUv.v - pivotUv.v, startUv.u - pivotUv.u)
        draftUvsRef.current = mesh.uvs.map((u) => ({ ...u }))
        buildSnapContext(uvIndices, regionFacesForEdit)
        dragSelectionBoundsRef.current = getSelectionBBoxPx(regionFacesForEdit)
        dragRef.current = {
          kind: 'faceRotate',
          uvIndices,
          startUvs: uvIndices.map((i) => ({ ...mesh.uvs[i]! })),
          pivotUv: { ...pivotUv },
          startAngle,
          startX: px.x,
          startY: px.y,
        }
        setIslandFields((f) => ({ ...f, rot: 0 }))
        lastIslandRotRef.current = 0
        capturePointer = true
      } else {
        const clickedFace = pickFace(px.x, px.y)
        if (clickedFace !== null) {
          const isAlreadySelected = uvEditorSelectedFaces.includes(clickedFace)
          const nextFaces = isAlreadySelected
            ? uvEditorSelectedFaces
            : resolveFacePick(clickedFace, uvEditorSelectedFaces, e.shiftKey)

          if (!isAlreadySelected) {
            selectUvFaces(objectId, nextFaces)
          }

          const uvIndices = collectFaceUvIndices(nextFaces)
          beginPendingUvDrag(
            'faceDrag',
            uvIndices,
            uvIndices.map((i) => ({ ...ensured.uvs[i] })),
            px.x,
            px.y,
            e.clientX,
            e.clientY
          )
          capturePointer = true
        } else {
          if (!e.shiftKey) {
            clearAllUvSelection()
            selectUvFaces(objectId, [])
          }
          dragRef.current = {
            kind: 'marquee',
            startX: px.x,
            startY: px.y,
            marquee: { x0: px.x, y0: px.y, x1: px.x, y1: px.y },
            additive: e.shiftKey,
          }
          capturePointer = true
        }
      }
    }

    if (capturePointer) {
      canvasRef.current?.setPointerCapture(e.pointerId)
    }
  }

  const applySnap = (
    u: number,
    v: number,
    ctrl: boolean,
    dragKind: 'point' | 'island',
    anchorPx?: { x: number; y: number }
  ) => {
    const enabled = ctrl ? !uvEditorSnap : uvEditorSnap
    const mode: UvSnapMode = enabled ? uvEditorSnapMode : 'off'
    const ctx = snapCtxRef.current
    if (!ctx || mode === 'off') return { u, v }

    const effectiveMode =
      mode === 'island' && dragKind === 'point' ? 'vertex' : mode

    return snapUvDrag(
      u,
      v,
      effectiveMode,
      ctx,
      dragKind,
      dragSelectionBoundsRef.current,
      anchorPx
    )
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d || !objectId || !ensured) {
      updateHoverAt(e.clientX, e.clientY)
      return
    }

    if (d.kind === 'pending' && d.startClientX !== undefined && d.startClientY !== undefined) {
      const dist = Math.hypot(e.clientX - d.startClientX, e.clientY - d.startClientY)
      if (dist >= DRAG_THRESHOLD_PX) activatePendingDrag()
    }

    const active = dragRef.current
    if (!active || active.kind === 'pending') return

    if (active.kind === 'pan' && active.panX !== undefined && active.startClientX !== undefined) {
      const dx = e.clientX - active.startClientX
      const dy = e.clientY - (active.startClientY ?? 0)
      liveViewRef.current = {
        panX: active.panX + dx,
        panY: (active.panY ?? 0) + dy,
        zoom,
      }
      applyPanPreview(dx, dy)
      return
    }

    if (
      (active.kind === 'handle' || active.kind === 'faceDrag') &&
      active.uvIndices &&
      active.startUvs &&
      active.startX !== undefined
    ) {
      const px = screenToUvPixel(e.clientX, e.clientY)
      const startUv = pixelToUv(active.startX, active.startY ?? 0, texW, texH)
      const currUv = pixelToUv(px.x, px.y, texW, texH)
      const du = currUv.u - startUv.u
      const dv = currUv.v - startUv.v
      const updates = active.uvIndices.map((ui, idx) => {
        const base = active.startUvs![idx]
        const snapped = applySnap(base.u + du, base.v + dv, e.ctrlKey, active.kind === 'faceDrag' ? 'island' : 'point', {
          x: px.x,
          y: px.y,
        })
        return { uvIndex: ui, u: snapped.u, v: snapped.v }
      })
      applyUvDraft(updates)
      return
    }

    if (
      active.kind === 'faceScale' &&
      active.uvIndices &&
      active.startUvs &&
      active.startBounds &&
      active.resizeHandle &&
      active.pivotUv
    ) {
      const px = screenToUvPixel(e.clientX, e.clientY)
      const currUv = pixelToUv(px.x, px.y, texW, texH)
      const [scaleU, scaleV] = getScaleFromHandle(active.startBounds, active.resizeHandle, currUv)
      const scaled = scaleUvSnapshot(active.startUvs, scaleU, scaleV, active.pivotUv)
      const updates = active.uvIndices.map((ui, idx) => {
        const uv = scaled[idx]
        const snapped = applySnap(uv.u, uv.v, e.ctrlKey, 'island', { x: px.x, y: px.y })
        return { uvIndex: ui, u: snapped.u, v: snapped.v }
      })
      applyUvDraft(updates)
      return
    }

    if (
      active.kind === 'faceRotate' &&
      active.uvIndices &&
      active.startUvs &&
      active.pivotUv &&
      active.startAngle !== undefined
    ) {
      const px = screenToUvPixel(e.clientX, e.clientY)
      const currUv = pixelToUv(px.x, px.y, texW, texH)
      const pivot = active.pivotUv
      const angle =
        Math.atan2(currUv.v - pivot.v, currUv.u - pivot.u) - active.startAngle
      const rotated = rotateUvSnapshot(active.startUvs, angle, pivot)
      const updates = active.uvIndices.map((ui, idx) => {
        const uv = rotated[idx]
        const snapped = applySnap(uv.u, uv.v, e.ctrlKey, 'island', { x: px.x, y: px.y })
        return { uvIndex: ui, u: snapped.u, v: snapped.v }
      })
      applyUvDraft(updates)
      lastIslandRotRef.current = Math.round((angle * 180) / Math.PI)
      return
    }

    if (active.kind === 'marquee' && active.startX !== undefined && active.startY !== undefined) {
      const px = screenToUvPixel(e.clientX, e.clientY)
      active.marquee = { x0: active.startX, y0: active.startY, x1: px.x, y1: px.y }
      scheduleRedraw()
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    if (canvasRef.current?.hasPointerCapture(e.pointerId)) {
      canvasRef.current.releasePointerCapture(e.pointerId)
    }
    const d = dragRef.current
    if (d?.kind === 'marquee' && d.marquee && ensured) {
      const x0 = Math.min(d.marquee.x0, d.marquee.x1)
      const x1 = Math.max(d.marquee.x0, d.marquee.x1)
      const y0 = Math.min(d.marquee.y0, d.marquee.y1)
      const y1 = Math.max(d.marquee.y0, d.marquee.y1)

      if (uvEditorMode === 'points') {
        const picked: number[] = []
        const set = new Set<number>()
        for (const fi of allFaceIndices) {
          for (const ui of ensured.faceUvIndices[fi] ?? []) set.add(ui)
        }
        for (const ui of set) {
          const { x, y } = uvToPixel(getUvs()[ui] ?? { u: 0, v: 0 }, texW, texH)
          if (x >= x0 && x <= x1 && y >= y0 && y <= y1) picked.push(ui)
        }
        const prev = useAppStore.getState().uvEditorSelectedPoints
        if (picked.length > 0) {
          setUvEditorSelectedPoints(d.additive ? [...new Set([...prev, ...picked])] : picked)
        } else if (!d.additive) {
          clearAllUvSelection()
        }
      } else {
        const picked: number[] = []
        for (const fi of allFaceIndices) {
          const pts = getFacePixels(fi)
          const anyInside = pts.some(
            (p) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1
          )
          if (anyInside) picked.push(fi)
        }
        const prev = useAppStore.getState().uvEditorSelectedFaces
        if (picked.length > 0) {
          const expanded = obj
            ? uvEditorSticky
              ? expandFacesToPlanarRegions(obj, picked)
              : picked
            : picked
          const next = d.additive ? [...new Set([...prev, ...expanded])] : expanded
          if (objectId) selectUvFaces(objectId, next)
        } else if (!d.additive) {
          clearAllUvSelection()
          if (objectId) selectUvFaces(objectId, [])
        }
      }
    }
    const kind = dragRef.current?.kind
    const wasPending = kind === 'pending'
    dragRef.current = null
    if (kind === 'pan') {
      commitLiveView()
      scheduleRedraw()
      setHoverCursor('crosshair')
      updateHoverAt(e.clientX, e.clientY)
      return
    }
    commitLiveView()
    if (
      kind === 'handle' ||
      kind === 'faceDrag' ||
      kind === 'faceRotate' ||
      kind === 'faceScale'
    ) {
      flushDraftUvs()
      replaceHistoryHead('Edit UV')
      if (kind === 'faceRotate') {
        setIslandFields((f) => ({ ...f, rot: lastIslandRotRef.current }))
      }
    } else if (!wasPending) {
      draftUvsRef.current = null
    }
    updateHoverAt(e.clientX, e.clientY)
    redraw()
  }

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const factor = e.deltaY > 0 ? 0.9 : 1.1
    const px = screenToUvPixel(e.clientX, e.clientY)
    setZoom((z) => {
      const nz = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * factor))
      const rect = canvasRef.current!.getBoundingClientRect()
      setPan({
        x: e.clientX - rect.left - px.x * nz,
        y: e.clientY - rect.top - px.y * nz,
      })
      return nz
    })
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.target instanceof HTMLInputElement)) {
        if (e.code === 'Space') {
          e.preventDefault()
          setSpacePan(true)
        }
        if (e.code === 'KeyF') {
          e.preventDefault()
          frameSelection()
        }
        if (e.code === 'KeyA' && (e.ctrlKey || e.metaKey) && objectId && uvEditorMode === 'faces') {
          e.preventDefault()
          selectUvFaces(objectId, allFaceIndices)
        }
        if (
          objectId &&
          (uvEditorSelectedPoints.length > 0 || uvEditorSelectedFaces.length > 0)
        ) {
          const step = e.shiftKey ? texW / uvEditorGridDivisions : 1
          const du = e.key === 'ArrowLeft' ? -step / texW : e.key === 'ArrowRight' ? step / texW : 0
          const dv = e.key === 'ArrowUp' ? -step / texH : e.key === 'ArrowDown' ? step / texH : 0
          if (du || dv) {
            e.preventDefault()
            transformSelectedUvIslands({ translate: [du, dv] })
          }
        }
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpacePan(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [
    objectId,
    allFaceIndices,
    uvEditorSelectedPoints,
    uvEditorSelectedFaces,
    texW,
    texH,
    uvEditorGridDivisions,
    uvEditorMode,
    transformSelectedUvIslands,
    frameSelection,
    selectUvFaces,
  ])

  const onImport = async () => {
    if (!objectId) return
    const file = await pickOpenFile({
      title: 'Import texture',
      filters: IMAGE_IMPORT_FILTERS,
    })
    if (file) await loadObjectTexture(objectId, file)
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file?.type.startsWith('image/') && objectId) void loadObjectTexture(objectId, file)
  }

  const updatePointField = (axis: 'x' | 'y', value: number) => {
    if (!objectId || uvEditorSelectedPoints.length === 0) return
    const uv = pixelToUv(
      axis === 'x' ? value : pointFields.x,
      axis === 'y' ? value : pointFields.y,
      texW,
      texH
    )
    if (uvEditorSelectedPoints.length === 1) {
      setObjectUvPoints(objectId, [{ uvIndex: uvEditorSelectedPoints[0], u: uv.u, v: uv.v }], true)
    } else {
      const first = ensured?.uvs[uvEditorSelectedPoints[0]]
      if (!first) return
      const du = uv.u - first.u
      const dv = uv.v - first.v
      transformSelectedUvIslands({ translate: [du, dv] })
    }
  }

  useEffect(() => {
    if (!ensured || uvEditorSelectedFaces.length === 0) return
    const box = getSelectionBBoxPx(regionFacesForEdit)
    if (!box) return
    setIslandFields({
      x: Math.round(box.minX),
      y: Math.round(box.minY),
      w: Math.round(box.maxX - box.minX),
      h: Math.round(box.maxY - box.minY),
      rot: 0,
    })
    lastIslandRotRef.current = 0
  }, [ensured, uvEditorSelectedFaces, texW, texH, obj, getSelectionBBoxPx])

  useEffect(() => {
    draftUvsRef.current = null
  }, [obj?.id])

  const applyIslandTransform = useCallback(() => {
    if (uvEditorSelectedFaces.length === 0) return
    transformSelectedUvIslands({
      position: [islandFields.x / texW, islandFields.y / texH],
      size: [islandFields.w / texW, islandFields.h / texH],
      rotation: (islandFields.rot * Math.PI) / 180,
    })
  }, [uvEditorSelectedFaces.length, islandFields, texW, texH, transformSelectedUvIslands])

  useEffect(() => {
    if (!ensured || uvEditorSelectedPoints.length === 0) return
    const uv = getUvs()[uvEditorSelectedPoints[0]]
    if (!uv) return
    const px = uvToPixel(uv, texW, texH)
    setPointFields({ x: Math.round(px.x), y: Math.round(px.y) })
  }, [ensured, uvEditorSelectedPoints, texW, texH, obj, getUvs])

  if (!uvEditorOpen) return null

  return (
    <FloatingPanel
      title="UV Editor"
      open={uvEditorOpen}
      state={uvEditorPanel}
      minWidth={360}
      minHeight={320}
      onClose={() => setUvEditorOpen(false)}
      onStateChange={setUvEditorPanel}
    >
      <div
        className="uv-editor"
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
      >
        <div className="uv-editor-toolbar">
          {objectId && (
            <label
              className="uv-editor-texture-select"
              title="Scene textures — pick an atlas shared by any number of objects"
            >
              <span className="uv-editor-texture-label">Texture</span>
              <select
                className="shape-kind-select side-select uv-texture-select"
                value={activeTextureId ?? ''}
                onChange={(e) => {
                  const id = e.target.value
                  if (id) assignObjectTextureDocument(objectId, id)
                }}
                disabled={sceneTextures.length === 0}
              >
                {sceneTextures.length === 0 ? (
                  <option value="">No textures — import one</option>
                ) : (
                  <>
                    {!activeTextureId && <option value="">Select texture…</option>}
                    {sceneTextures.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.label}
                      </option>
                    ))}
                  </>
                )}
              </select>
            </label>
          )}
          <div className="uv-editor-mode-group">
            <button
              type="button"
              className={`uv-mode-btn ${uvEditorMode === 'points' ? 'active' : ''}`}
              onClick={() => setUvEditorMode('points')}
              title="Select and move UV points"
            >
              Points
            </button>
            <button
              type="button"
              className={`uv-mode-btn ${uvEditorMode === 'faces' ? 'active' : ''}`}
              onClick={() => setUvEditorMode('faces')}
              title="Select and move UV face islands"
            >
              Faces
            </button>
          </div>
          {obj && objectId && (
            <div className="uv-editor-mode-group" title="UV mapping mode">
              <button
                type="button"
                className={`uv-mode-btn ${resolveUvMappingMode(obj) === 'perFace' ? 'active' : ''}`}
                onClick={() => setObjectUvMappingMode(objectId, 'perFace')}
                title="Per-face planar UV (scale-correct per face)"
              >
                Per-Face
              </button>
              <button
                type="button"
                className={`uv-mode-btn ${resolveUvMappingMode(obj) === 'box' ? 'active' : ''}`}
                onClick={() => setObjectUvMappingMode(objectId, 'box')}
                title="Box UV — each face maps to a full 0–1 square"
              >
                Box UV
              </button>
            </div>
          )}
          <button type="button" className="uv-tool-btn" onClick={() => void onImport()}>
            Import…
          </button>
          <button type="button" className="uv-tool-btn" onClick={() => transformSelectedUvIslands('flipH')}>
            Flip H
          </button>
          <button type="button" className="uv-tool-btn" onClick={() => transformSelectedUvIslands('flipV')}>
            Flip V
          </button>
          <button type="button" className="uv-tool-btn" onClick={() => transformSelectedUvIslands('rotateCW')}>
            Rot 90°
          </button>
          <button type="button" className="uv-tool-btn" onClick={() => transformSelectedUvIslands('rotateCCW')}>
            Rot −90°
          </button>
          <button type="button" className="uv-tool-btn" onClick={() => transformSelectedUvIslands('fit')}>
            Fit
          </button>
          <select
            className="shape-kind-select side-select uv-unwrap-select"
            value={unwrapMethod}
            onChange={(e) => setUnwrapMethod(e.target.value as UvUnwrapMethod)}
            title="Unwrap method"
          >
            {UV_UNWRAP_METHODS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="uv-tool-btn uv-tool-btn-primary"
            onClick={() => unwrapSelectedUvFaces(unwrapMethod)}
            title={
              UV_UNWRAP_METHODS.find((m) => m.id === unwrapMethod)?.hint ??
              'Unwrap selected faces (or all if none selected)'
            }
          >
            Unwrap
          </button>
          {(unwrapMethod === 'smart' || unwrapMethod === 'auto') && (
            <label className="uv-editor-angle" title="Smart UV angle limit (degrees)">
              °
              <input
                className="uv-grid-input"
                type="number"
                min={1}
                max={180}
                value={uvEditorSmartUvAngle}
                onChange={(e) => setUvEditorSmartUvAngle(Number(e.target.value))}
              />
            </label>
          )}
          <button type="button" className="uv-tool-btn" onClick={() => transformSelectedUvIslands('flipH')} title="Mirror UV horizontally">
            Mirror
          </button>
          <button type="button" className="uv-tool-btn" onClick={frameSelection} title="Frame view (F · double-click)">
            Frame
          </button>
          <label className="uv-editor-toggle" title="When selecting a face, pan/zoom to it only if it is off-screen. Manual pan and zoom are kept otherwise.">
            <input
              type="checkbox"
              checked={uvEditorAutoFit}
              onChange={(e) => setUvEditorAutoFit(e.target.checked)}
            />
            Auto fit
          </label>
          <label
            className="uv-editor-toggle"
            title="When on, coplanar faces move together. When off, each face breaks away on move."
          >
            <input
              type="checkbox"
              checked={uvEditorSticky}
              onChange={(e) => setUvEditorSticky(e.target.checked)}
            />
            Sticky
          </label>
          <button
            type="button"
            className={`uv-tool-btn ${uvEditorViewAll ? 'active' : ''}`}
            onClick={() => setUvEditorViewAll(!uvEditorViewAll)}
            title="Show all UV islands in the atlas (Blockbench UV window)"
          >
            All
          </button>
          <label className="uv-editor-toggle">
            <input
              type="checkbox"
              checked={uvEditorShowGrid}
              onChange={(e) => setUvEditorShowGrid(e.target.checked)}
            />
            Grid
          </label>
          <label className="uv-editor-toggle">
            <input type="checkbox" checked={uvEditorSnap} onChange={(e) => setUvEditorSnap(e.target.checked)} />
            Snap
          </label>
          <select
            className="shape-kind-select side-select uv-snap-select"
            value={uvEditorSnapMode}
            disabled={!uvEditorSnap}
            onChange={(e) => setUvEditorSnapMode(e.target.value as UvSnapMode)}
            title={
              uvEditorMode === 'faces'
                ? 'Island snap aligns selected faces to other UV islands'
                : 'Vertex snap aligns points to other UV vertices'
            }
          >
            <option value="grid">Grid</option>
            <option value="vertex">Vertices</option>
            <option value="island">Islands</option>
          </select>
          <select
            className="shape-kind-select side-select uv-display-select"
            value={uvEditorDisplayMode}
            onChange={(e) => setUvEditorDisplayMode(e.target.value as any)}
            title="UV Display mode: Quads/Polys, Triangles, or coplanar Regions"
          >
            <option value="polys">Quads/Polys</option>
            <option value="tris">Triangles</option>
            <option value="regions">Regions</option>
          </select>
          <label className="uv-editor-toggle" title="3×3 tiled texture preview">
            <input
              type="checkbox"
              checked={uvEditorTilePreview}
              onChange={(e) => setUvEditorTilePreview(e.target.checked)}
            />
            Tile
          </label>
          <input
            className="uv-grid-input"
            type="number"
            min={1}
            max={64}
            value={uvEditorGridDivisions}
            onChange={(e) => setUvEditorGridDivisions(Number(e.target.value))}
            title="Grid divisions"
          />
        </div>

        <div className="uv-editor-shortcuts">
          <span>
            {uvEditorMode === 'faces'
              ? uvEditorViewAll
                ? 'All islands: full packed atlas · toggle All off to focus selection'
                : 'Selected face(s) only · All = full atlas · Unwrap repacks islands'
              : 'Points: drag handles · Snap to verts/grid'}
            {' · Scroll zoom · Space/middle pan · Alt+click reposition · F frame'}
          </span>
        </div>

        {(texture || pixelDoc) && (
          <div className="uv-editor-meta">
            {pixelDoc ? 'Pixel texture' : texture!.name} — {texW}×{texH}px
            <span className="uv-editor-hint"> · Shift+click toggle region · Ctrl+drag box-select</span>
          </div>
        )}
        {!texture && (
          <div className="uv-editor-meta uv-editor-hint">
            Shift+click toggle planar region · Ctrl+drag box-select · Alt+click move selection to cursor
          </div>
        )}

        <div
          ref={containerRef}
          className="uv-editor-canvas-wrap"
          style={{ cursor: hoverCursor }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={(e) => {
            if (dragRef.current?.kind === 'pan') {
              onPointerUp(e)
              return
            }
            hoverRef.current = { face: null, point: null, cursor: 'crosshair' }
            setHoverCursor('crosshair')
            scheduleRedraw()
          }}
          onAuxClick={(e) => e.preventDefault()}
          onWheel={onWheel}
        >
          <canvas ref={canvasRef} className="uv-editor-canvas" />
          {!obj && <div className="uv-editor-empty">Select an object to edit UVs</div>}
        </div>

        <div className="uv-editor-precision">
          <div className="uv-precision-group">
            <span className="uv-precision-label">Point (px)</span>
            <label>
              X
              <input
                type="number"
                value={pointFields.x}
                disabled={uvEditorSelectedPoints.length === 0}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  setPointFields((f) => ({ ...f, x: v }))
                  updatePointField('x', v)
                }}
              />
            </label>
            <label>
              Y
              <input
                type="number"
                value={pointFields.y}
                disabled={uvEditorSelectedPoints.length === 0}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  setPointFields((f) => ({ ...f, y: v }))
                  updatePointField('y', v)
                }}
              />
            </label>
          </div>
          <div className="uv-precision-group">
            <span className="uv-precision-label">Island (px)</span>
            <label>
              X
              <input
                type="number"
                value={islandFields.x}
                onChange={(e) => setIslandFields((f) => ({ ...f, x: Number(e.target.value) }))}
                onBlur={applyIslandTransform}
              />
            </label>
            <label>
              Y
              <input
                type="number"
                value={islandFields.y}
                onChange={(e) => setIslandFields((f) => ({ ...f, y: Number(e.target.value) }))}
                onBlur={applyIslandTransform}
              />
            </label>
            <label>
              W
              <input
                type="number"
                value={islandFields.w}
                onChange={(e) => setIslandFields((f) => ({ ...f, w: Number(e.target.value) }))}
                onBlur={applyIslandTransform}
              />
            </label>
            <label>
              H
              <input
                type="number"
                value={islandFields.h}
                onChange={(e) => setIslandFields((f) => ({ ...f, h: Number(e.target.value) }))}
                onBlur={applyIslandTransform}
              />
            </label>
            <label>
              Rot°
              <input
                type="number"
                value={islandFields.rot}
                disabled={uvEditorSelectedFaces.length === 0}
                onChange={(e) => setIslandFields((f) => ({ ...f, rot: Number(e.target.value) }))}
                onBlur={() => {
                  if (uvEditorSelectedFaces.length === 0) return
                  const deltaDeg = islandFields.rot - lastIslandRotRef.current
                  if (Math.abs(deltaDeg) < 1e-6) return
                  transformSelectedUvIslands({
                    rotate: (deltaDeg * Math.PI) / 180,
                  })
                  lastIslandRotRef.current = islandFields.rot
                }}
              />
            </label>
          </div>
        </div>
      </div>
    </FloatingPanel>
  )
}
