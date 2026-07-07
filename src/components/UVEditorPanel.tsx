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
  snapIslandDrag,
  snapPixelToTargets,
  type UvSnapContext,
  type UvSnapMode,
} from '../uv/uvSnap'
import { type UvUnwrapMethod } from '../uv/uvUnwrap'
import type { Uv2 } from '../uv/uvTypes'
import { clearUvDraft, setUvDraft } from '../uv/uvDraftRelay'
import { UvEditorToolbar } from './uv/UvEditorToolbar'

const HANDLE_SIZE = 7
const ROTATE_HANDLE_RADIUS = 7
const ROTATE_HANDLE_OFFSET = 28
const RESIZE_HANDLE_SIZE = 6
const MIN_ZOOM = 0.06
const MAX_ZOOM = 32
const DRAG_THRESHOLD_PX = 1
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

let checkerPattern: CanvasPattern | null = null
let checkerPatternColors = ''

function drawChecker(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  gridA: string,
  gridB: string
) {
  const colorKey = `${gridA}-${gridB}`
  if (!checkerPattern || checkerPatternColors !== colorKey) {
    const offscreen = document.createElement('canvas')
    offscreen.width = 32
    offscreen.height = 32
    const octx = offscreen.getContext('2d')
    if (octx) {
      octx.fillStyle = gridA
      octx.fillRect(0, 0, 32, 32)
      octx.fillStyle = gridB
      octx.fillRect(0, 0, 16, 16)
      octx.fillRect(16, 16, 16, 16)
      checkerPattern = ctx.createPattern(offscreen, 'repeat')
      checkerPatternColors = colorKey
    }
  }

  if (checkerPattern) {
    ctx.fillStyle = checkerPattern
    ctx.fillRect(0, 0, w, h)
  } else {
    ctx.fillStyle = gridA
    ctx.fillRect(0, 0, w, h)
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
  texH: number,
  precomputedEdges?: [number, number][]
) {
  const edges = precomputedEdges ?? boundaryEdgesForFacesSpatial(obj, faceIndices)
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
    faces?: number[]
  } | null>(null)

  const draftUvsRef = useRef<Uv2[] | null>(null)
  const previewRelayRafRef = useRef<number | null>(null)
  const redrawRafRef = useRef<number | null>(null)
  const canvasSizeRef = useRef({ w: 0, h: 0 })
  const liveViewRef = useRef<{ panX: number; panY: number; zoom: number } | null>(null)
  const dragWindowListenersRef = useRef<{
    pointerId: number
    onMove: (e: PointerEvent) => void
    onUp: (e: PointerEvent) => void
  } | null>(null)
  const moveCanvasDragRef = useRef<(e: PointerEvent) => void>(() => {})
  const finishCanvasDragRef = useRef<(e: PointerEvent) => void>(() => {})
  const hoverRef = useRef<{
    face: number | null
    point: number | null
    cursor: string
  }>({ face: null, point: null, cursor: 'crosshair' })
  const [hoverCursor, setHoverCursor] = useState('crosshair')

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
  const pixelDocuments = useAppStore((s) => s.pixelDocuments)
  const objectTextures = useAppStore((s) => s.objectTextures)
  const sceneObjects = useAppStore((s) => s.objects)
  const sceneTextures = useMemo(
    () => listSceneTextures(pixelDocuments, objectTextures, sceneObjects),
    [pixelDocuments, objectTextures, sceneObjects]
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
    if (uvEditorSticky) return expandFacesToPlanarRegions(obj, uvEditorSelectedFaces)
    return [...uvEditorSelectedFaces]
  }, [obj, uvEditorSelectedFaces, uvEditorSticky])

  const ensuredRef = useRef<SceneObjectWithUVs | null>(null)
  const objectIdRef = useRef<string | null>(null)
  const regionFacesForEditRef = useRef<number[]>([])

  useEffect(() => {
    ensuredRef.current = ensured
    objectIdRef.current = objectId
    regionFacesForEditRef.current = regionFacesForEdit
  }, [ensured, objectId, regionFacesForEdit])

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

  const groupBoundaryEdges = useMemo(() => {
    const map = new Map<number, [number, number][]>()
    if (!obj || !faceGroupMap) return map
    for (const group of faceGroupMap.groups) {
      map.set(group.id, boundaryEdgesForFacesSpatial(obj, group.faceIndices))
    }
    return map
  }, [obj, faceGroupMap])

  const isolatedBoundaryEdges = useMemo(() => {
    if (!obj || !isolatedFaceView) return null
    return boundaryEdgesForFacesSpatial(obj, regionFacesForEdit)
  }, [obj, isolatedFaceView, regionFacesForEdit])

  const clearAllUvSelection = useCallback(() => {
    setUvEditorSelectedPoints([])
    if (objectId) selectUvFaces(objectId, [])
    else setUvEditorSelectedFaces([])
  }, [objectId, selectUvFaces, setUvEditorSelectedPoints, setUvEditorSelectedFaces])

  /** Sticky: whole coplanar region; off: single face breaks away on move. */
  const resolveFacePick = useCallback(
    (faceIndex: number, current: number[], additive: boolean): number[] => {
      if (!obj) return current
      if (!uvEditorSticky) {
        if (!additive) return [faceIndex]
        return current.includes(faceIndex)
          ? current.filter((fi) => fi !== faceIndex)
          : [...current, faceIndex]
      }
      const region = expandFaceToPlanarRegion(obj, faceIndex)
      if (!additive) return region
      const allSelected = region.length > 0 && region.every((fi) => current.includes(fi))
      if (allSelected) {
        const remove = new Set(region)
        return current.filter((fi) => !remove.has(fi))
      }
      return [...new Set([...current, ...region])]
    },
    [obj, uvEditorSticky]
  )

  const getFacePixels = useCallback(
    (fi: number) => {
      const mesh = ensuredRef.current ?? ensured
      if (!mesh) return []
      const uvs = getUvs()
      const uvIdx = mesh.faceUvIndices[fi]
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
      ensuredRef.current = detached
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

  const fitCanvasToCamera = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    const cw = container.clientWidth
    const ch = container.clientHeight
    if (cw <= 0 || ch <= 0) return

    const pad = 32
    const nz = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min((cw - pad * 2) / texW, (ch - pad * 2) / texH)))
    setZoom(nz)
    setPan({
      x: (cw - texW * nz) / 2,
      y: (ch - texH * nz) / 2,
    })
  }, [texW, texH, setPan, setZoom])

  // Custom Overlay Scrollbar calculations
  const cw = canvasSizeRef.current.w || 600
  const ch = canvasSizeRef.current.h || 600

  const xMinVisible = -pan.x / zoom
  const xMaxVisible = (cw - pan.x) / zoom
  const yMinVisible = -pan.y / zoom
  const yMaxVisible = (ch - pan.y) / zoom

  const docX0 = -texW * 0.5
  const docX1 = texW * 1.5
  const docY0 = -texH * 0.5
  const docY1 = texH * 1.5

  const minDocX = Math.min(docX0, xMinVisible)
  const maxDocX = Math.max(docX1, xMaxVisible)
  const minDocY = Math.min(docY0, yMinVisible)
  const maxDocY = Math.max(docY1, yMaxVisible)

  const spanX = Math.max(maxDocX - minDocX, 1)
  const spanY = Math.max(maxDocY - minDocY, 1)
  const viewW = cw / zoom
  const viewH = ch / zoom

  const trackW = cw - 16
  const thumbRatioX = Math.min(1, viewW / spanX)
  const thumbW = Math.max(24, trackW * thumbRatioX)
  const posRatioX = spanX - viewW > 0 ? (xMinVisible - minDocX) / (spanX - viewW) : 0
  const thumbX = (trackW - thumbW) * posRatioX

  const trackH = ch - 16
  const thumbRatioY = Math.min(1, viewH / spanY)
  const thumbHSize = Math.max(24, trackH * thumbRatioY)
  const posRatioY = spanY - viewH > 0 ? (yMinVisible - minDocY) / (spanY - viewH) : 0
  const thumbY = (trackH - thumbHSize) * posRatioY

  const handleScrollHMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const startClientX = e.clientX
    const startPanX = pan.x

    const currentZoom = zoom
    const currentPanY = pan.y
    const ratio = (spanX - viewW) / Math.max(1, trackW - thumbW)

    const onMouseMove = (moveEvent: MouseEvent) => {
      const dx = moveEvent.clientX - startClientX
      const nextPanX = startPanX - dx * ratio * currentZoom
      setUvEditorView(currentZoom, nextPanX, currentPanY)
    }

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }, [pan.x, pan.y, zoom, spanX, viewW, trackW, thumbW, setUvEditorView])

  const handleScrollVMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const startClientY = e.clientY
    const startPanY = pan.y

    const currentZoom = zoom
    const currentPanX = pan.x
    const ratio = (spanY - viewH) / Math.max(1, trackH - thumbHSize)

    const onMouseMove = (moveEvent: MouseEvent) => {
      const dy = moveEvent.clientY - startClientY
      const nextPanY = startPanY - dy * ratio * currentZoom
      setUvEditorView(currentZoom, currentPanX, nextPanY)
    }

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }, [pan.x, pan.y, zoom, spanY, viewH, trackH, thumbHSize, setUvEditorView])

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


  const screenToUvPixel = useCallback(
    (clientX: number, clientY: number) => {
      const container = containerRef.current
      if (!container) return { x: 0, y: 0 }
      const rect = container.getBoundingClientRect()
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
    if (!canvas || !container) return
    const mesh = ensuredRef.current ?? ensured
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
    ctx.imageSmoothingEnabled = false

    const { panX, panY, zoom: viewZoom } = getViewPanZoom()
    const hoverFace = hoverRef.current.face
    const hoverPoint = hoverRef.current.point

    ctx.clearRect(0, 0, cw, ch)
    ctx.save()
    ctx.translate(panX, panY)
    ctx.scale(viewZoom, viewZoom)

    if (!mesh) {
      drawChecker(ctx, texW, texH, theme.uvGridA, theme.uvGridB)
      ctx.restore()
      return
    }

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

    if (resolveUvMappingMode(mesh) === 'perFace') {
      ctx.strokeStyle = 'rgba(255,255,255,0.18)'
      ctx.lineWidth = 1.25 / viewZoom
      ctx.beginPath()
      for (let c = 1; c < BLOCKBENCH_ATLAS_COLS; c++) {
        const x = (c * texW) / BLOCKBENCH_ATLAS_COLS
        ctx.moveTo(x, 0)
        ctx.lineTo(x, texH)
      }
      for (let r = 1; r < BLOCKBENCH_ATLAS_ROWS; r++) {
        const y = (r * texH) / BLOCKBENCH_ATLAS_ROWS
        ctx.moveTo(0, y)
        ctx.lineTo(texW, y)
      }
      ctx.stroke()

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
      ctx.beginPath()
      for (let i = 0; i <= uvEditorGridDivisions; i++) {
        ctx.moveTo(i * stepX, 0)
        ctx.lineTo(i * stepX, texH)
        ctx.moveTo(0, i * stepY)
        ctx.lineTo(texW, i * stepY)
      }
      ctx.stroke()
    }

    ctx.strokeStyle = theme.accent
    ctx.globalAlpha = 0.9
    ctx.lineWidth = 1.5 / viewZoom

    const uvs = getUvs()
    const hoverGroupId =
      hoverFace !== null && faceGroupMap ? (faceGroupMap.faceToGroup[hoverFace] ?? null) : null
    const hasFaceSelection = uvEditorMode === 'faces' && selectedFaceSet.size > 0

    if (uvEditorMode === 'faces' && mesh) {
      if (isolatedFaceView) {
        drawRegionFill(
          ctx,
          mesh,
          uvs,
          visibleFaceIndices,
          theme.css['--accent-soft'],
          texW,
          texH
        )
        drawRegionBoundary(
          ctx,
          mesh,
          uvs,
          visibleFaceIndices,
          theme.accent,
          2.25 / viewZoom,
          texW,
          texH,
          isolatedBoundaryEdges ?? undefined
        )
      } else if (faceGroupMap) {
        for (const group of faceGroupMap.groups) {
          const state = resolveUvRegionState(group, selectedFaceSet, hoverGroupId)
          const dimmed = hasFaceSelection && state === 'idle'

          let fill = 'rgba(255,255,255,0.04)'
          let stroke = 'rgba(255,255,255,0.22)'
          let strokeW = 1.25 / viewZoom
          if (state === 'selected') {
            fill = theme.css['--accent-soft']
            stroke = theme.accent
            strokeW = 2.25 / viewZoom
          } else if (state === 'hover') {
            fill = theme.css['--accent-orange-soft']
            stroke = theme.meshHover
            strokeW = 2 / viewZoom
          } else if (dimmed) {
            fill = 'rgba(0,0,0,0.06)'
            stroke = 'rgba(255,255,255,0.07)'
          }

          drawRegionFill(ctx, mesh, uvs, group.faceIndices, fill, texW, texH)
          drawRegionBoundary(
            ctx,
            mesh,
            uvs,
            group.faceIndices,
            stroke,
            strokeW,
            texW,
            texH,
            groupBoundaryEdges.get(group.id)
          )
        }
      } else {
        ctx.beginPath()
        for (const fi of visibleFaceIndices) {
          const pts = getFacePixels(fi)
          if (pts.length < 3) continue
          ctx.moveTo(pts[0].x, pts[0].y)
          for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
          ctx.closePath()
        }
        ctx.fillStyle = 'rgba(255,255,255,0.03)'
        ctx.fill()
        ctx.strokeStyle = 'rgba(255,255,255,0.18)'
        ctx.stroke()
      }
    } else {
      ctx.beginPath()
      for (const fi of visibleFaceIndices) {
        const pts = getFacePixels(fi)
        if (pts.length < 3) continue
        ctx.moveTo(pts[0].x, pts[0].y)
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
        ctx.closePath()
      }
      ctx.fillStyle = 'rgba(255,255,255,0.03)'
      ctx.fill()
      ctx.strokeStyle = 'rgba(255,255,255,0.18)'
      ctx.stroke()
    }

    if (uvEditorMode === 'points') {
      const handleSet = new Set<number>()
      for (const fi of visibleFaceIndices) {
        for (const ui of mesh.faceUvIndices[fi] ?? []) handleSet.add(ui)
      }

      for (const ui of handleSet) {
        const uv = getUvs()[ui] ?? { u: 0, v: 0 }
        const { x, y } = uvToPixel(uv, texW, texH)
        const selected = uvEditorSelectedPoints.includes(ui)
        const hovered = hoverPoint === ui
        const hs = (hovered ? HANDLE_SIZE + 2 : HANDLE_SIZE) / viewZoom
        ctx.fillStyle = selected ? theme.accent : hovered ? theme.meshHover : theme.text
        ctx.strokeStyle = selected || hovered ? theme.text : theme.accent
        ctx.lineWidth = 1 / viewZoom
        ctx.fillRect(x - hs / 2, y - hs / 2, hs, hs)
        ctx.strokeRect(x - hs / 2, y - hs / 2, hs, hs)
      }
    }

    if (uvEditorMode === 'faces' && regionFacesForEdit.length > 0) {
      const box = getSelectionBBoxPx(regionFacesForEdit)
      const handle = getRotateHandlePx(regionFacesForEdit)
      const pivotPx = uvToPixel(getSelectionPivotUv(regionFacesForEdit), texW, texH)

      if (box) {
        ctx.setLineDash([5 / viewZoom, 4 / viewZoom])
        ctx.strokeStyle = theme.accent
        ctx.globalAlpha = 0.55
        ctx.lineWidth = 1 / viewZoom
        ctx.strokeRect(box.minX, box.minY, box.maxX - box.minX, box.maxY - box.minY)
        ctx.globalAlpha = 1
        ctx.setLineDash([])

        const hs = RESIZE_HANDLE_SIZE / viewZoom
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
          ctx.fillStyle = theme.text
          ctx.strokeStyle = theme.accent
          ctx.lineWidth = 1 / viewZoom
          ctx.fillRect(h.x - hs / 2, h.y - hs / 2, hs, hs)
          ctx.strokeRect(h.x - hs / 2, h.y - hs / 2, hs, hs)
        }

        ctx.setLineDash([3 / viewZoom, 3 / viewZoom])
        ctx.strokeStyle = theme.accent
        ctx.globalAlpha = 0.25
        ctx.fillStyle = theme.css['--accent-soft']
        ctx.fillRect(box.minX, box.minY, box.maxX - box.minX, box.maxY - box.minY)
        ctx.globalAlpha = 0.55
        ctx.strokeRect(box.minX, box.minY, box.maxX - box.minX, box.maxY - box.minY)
        ctx.globalAlpha = 1
        ctx.setLineDash([])
      }

      if (handle) {
        ctx.beginPath()
        ctx.moveTo(pivotPx.x, pivotPx.y)
        ctx.lineTo(handle.x, handle.y)
        ctx.strokeStyle = theme.accent
        ctx.globalAlpha = 0.7
        ctx.lineWidth = 1 / viewZoom
        ctx.stroke()
        ctx.globalAlpha = 1

        const hr = ROTATE_HANDLE_RADIUS / viewZoom
        ctx.beginPath()
        ctx.arc(handle.x, handle.y, hr, 0, Math.PI * 2)
        ctx.fillStyle = theme.accent
        ctx.fill()
        ctx.strokeStyle = theme.text
        ctx.lineWidth = 1.25 / viewZoom
        ctx.stroke()

        ctx.beginPath()
        ctx.arc(handle.x, handle.y, hr * 0.55, 0.25 * Math.PI, 1.45 * Math.PI)
        ctx.strokeStyle = theme.uvCanvasBg
        ctx.lineWidth = 1.25 / viewZoom
        ctx.stroke()
      }
    }

    if (dragRef.current?.kind === 'marquee' && dragRef.current.marquee) {
      const m = dragRef.current.marquee
      ctx.strokeStyle = theme.accent
      ctx.setLineDash([4 / viewZoom, 4 / viewZoom])
      ctx.strokeRect(m.x0, m.y0, m.x1 - m.x0, m.y1 - m.y0)
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
    pan.x,
    pan.y,
    zoom,
  ])

  const scheduleRedraw = useCallback(() => {
    if (redrawRafRef.current != null) return
    redrawRafRef.current = requestAnimationFrame(() => {
      redrawRafRef.current = null
      redraw()
    })
  }, [redraw])

  const applyPanPreview = useCallback(() => {
    scheduleRedraw()
  }, [scheduleRedraw])

  const detachDragWindowListeners = useCallback(() => {
    const listeners = dragWindowListenersRef.current
    if (!listeners) return
    window.removeEventListener('pointermove', listeners.onMove)
    window.removeEventListener('pointerup', listeners.onUp)
    window.removeEventListener('pointercancel', listeners.onUp)
    dragWindowListenersRef.current = null
  }, [])

  const attachDragWindowListeners = useCallback(
    (pointerId: number) => {
      detachDragWindowListeners()
      const onWinMove = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return
        moveCanvasDragRef.current(ev)
      }
      const onWinUp = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return
        finishCanvasDragRef.current(ev)
        detachDragWindowListeners()
      }
      dragWindowListenersRef.current = { pointerId, onMove: onWinMove, onUp: onWinUp }
      window.addEventListener('pointermove', onWinMove)
      window.addEventListener('pointerup', onWinUp)
      window.addEventListener('pointercancel', onWinUp)
    },
    [detachDragWindowListeners]
  )

  useEffect(() => () => detachDragWindowListeners(), [detachDragWindowListeners])

  const cancelPreviewRelay = useCallback(() => {
    if (previewRelayRafRef.current !== null) {
      cancelAnimationFrame(previewRelayRafRef.current)
      previewRelayRafRef.current = null
    }
  }, [])

  const publishViewportDraft = useCallback(() => {
    if (!objectId || !draftUvsRef.current) return
    if (previewRelayRafRef.current !== null) return
    previewRelayRafRef.current = requestAnimationFrame(() => {
      previewRelayRafRef.current = null
      const draft = draftUvsRef.current
      if (draft && objectId) setUvDraft(objectId, draft)
    })
  }, [objectId])

  const resetDraftPreview = useCallback(() => {
    cancelPreviewRelay()
    draftUvsRef.current = null
    if (objectId) clearUvDraft(objectId)
  }, [objectId, cancelPreviewRelay])

  const applyUvDraft = useCallback(
    (updates: Array<{ uvIndex: number; u: number; v: number }>) => {
      const mesh = ensuredRef.current ?? ensured
      if (!mesh || updates.length === 0) return
      const base = draftUvsRef.current ?? mesh.uvs.map((u) => ({ ...u }))
      const next = base.map((u) => ({ ...u }))
      for (const u of updates) next[u.uvIndex] = { u: u.u, v: u.v }
      draftUvsRef.current = next
      publishViewportDraft()
      const drag = dragRef.current
      const isLiveUvDrag =
        drag &&
        drag.kind !== 'pan' &&
        drag.kind !== 'marquee' &&
        (drag.kind === 'handle' ||
          drag.kind === 'faceDrag' ||
          drag.kind === 'faceRotate' ||
          drag.kind === 'faceScale' ||
          (drag.kind === 'pending' &&
            (drag.activeKind === 'faceDrag' || drag.activeKind === 'handle')))
      if (isLiveUvDrag) {
        if (redrawRafRef.current != null) {
          cancelAnimationFrame(redrawRafRef.current)
          redrawRafRef.current = null
        }
        redraw()
      } else {
        scheduleRedraw()
      }
    },
    [ensured, scheduleRedraw, redraw, publishViewportDraft]
  )

  const flushDraftUvs = useCallback(() => {
    cancelPreviewRelay()
    if (objectId) clearUvDraft(objectId)
    if (!objectId || !draftUvsRef.current) {
      draftUvsRef.current = null
      return
    }
    const draft = draftUvsRef.current
    const liveObj = useAppStore.getState().objects.find((o) => o.id === objectId)
    const baseUvs = liveObj?.uvs?.length ? liveObj.uvs : ensured?.uvs
    draftUvsRef.current = null
    if (!baseUvs) return
    const updates: Array<{ uvIndex: number; u: number; v: number }> = []
    for (let i = 0; i < draft.length; i++) {
      const orig = baseUvs[i]
      const d = draft[i]
      if (!orig || orig.u !== d.u || orig.v !== d.v) {
        updates.push({ uvIndex: i, u: d.u, v: d.v })
      }
    }
    if (updates.length > 0) setObjectUvPoints(objectId, updates, false)
  }, [objectId, ensured, setObjectUvPoints, cancelPreviewRelay])

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
      const expanded = uvEditorSticky
        ? expandFacesToPlanarRegions(obj, meshSelection.faces)
        : [...meshSelection.faces]
      setUvEditorSelectedFaces(expanded)
      setUvEditorSelectedPoints([])
    } else if (meshSelection?.objectId === objectId) {
      setUvEditorSelectedFaces([])
      setUvEditorSelectedPoints([])
    }
  }, [uvEditorOpen, objectId, ensured, obj, meshSelection?.objectId, meshSelection?.faces, uvEditorSticky, setUvEditorSelectedFaces, setUvEditorSelectedPoints])

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
    const expanded = uvEditorSticky
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
    ensureSelectionVisible,
  ])

  useEffect(() => {
    redraw()
  }, [redraw, obj, uvEditorOpen, pan.x, pan.y, zoom])

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
    const mesh = ensuredRef.current ?? ensured
    if (mesh) {
      draftUvsRef.current = mesh.uvs.map((u) => ({ ...u }))
    }
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
    const latestEnsured = ensuredRef.current
    const latestObjectId = objectIdRef.current
    if (!d || d.kind !== 'pending' || !d.activeKind || !latestEnsured || !latestObjectId) return false
    d.kind = d.activeKind
    captureUndoPoint('Edit UV')

    const editFaces = d.faces ?? regionFacesForEditRef.current
    const transformMesh =
      d.activeKind === 'faceDrag' ||
      d.activeKind === 'faceRotate' ||
      d.activeKind === 'faceScale'
        ? prepareFaceTransformMesh(editFaces)
        : null
    const mesh = transformMesh ?? latestEnsured

    if (transformMesh && transformMesh !== latestEnsured && d.uvIndices) {
      const uvIndices = collectFaceUvIndices(editFaces, mesh)
      d.uvIndices = uvIndices
      d.startUvs = uvIndices.map((i) => ({ ...mesh.uvs[i]! }))
    }

    draftUvsRef.current = mesh.uvs.map((u) => ({ ...u }))
    ensuredRef.current = mesh

    buildSnapContext(d.uvIndices ?? [], editFaces)
    if (d.activeKind === 'faceDrag' && editFaces.length > 0) {
      dragSelectionBoundsRef.current = getSelectionBBoxPx(editFaces)
    } else {
      dragSelectionBoundsRef.current = null
    }
    return true
  }, [
    captureUndoPoint,
    buildSnapContext,
    prepareFaceTransformMesh,
    collectFaceUvIndices,
    getSelectionBBoxPx,
  ])

  const startFaceDragNow = useCallback(
    (
      faceIndices: number[],
      px: { x: number; y: number },
      clientX: number,
      clientY: number
    ) => {
      if (!ensured || !objectId) return false
      captureUndoPoint('Edit UV')
      const mesh = prepareFaceTransformMesh(faceIndices) ?? ensured
      const uvIndices = collectFaceUvIndices(faceIndices, mesh)
      draftUvsRef.current = mesh.uvs.map((u) => ({ ...u }))
      ensuredRef.current = mesh
      buildSnapContext(uvIndices, faceIndices)
      dragSelectionBoundsRef.current = getSelectionBBoxPx(faceIndices)
      dragRef.current = {
        kind: 'faceDrag',
        uvIndices,
        startUvs: uvIndices.map((i) => ({ ...mesh.uvs[i]! })),
        startX: px.x,
        startY: px.y,
        startClientX: clientX,
        startClientY: clientY,
        faces: [...faceIndices],
      }
      return true
    },
    [
      ensured,
      objectId,
      captureUndoPoint,
      prepareFaceTransformMesh,
      collectFaceUvIndices,
      buildSnapContext,
      getSelectionBBoxPx,
    ]
  )

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

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button === 1 || e.button === 2) {
      e.preventDefault()
    }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    const px = screenToUvPixel(e.clientX, e.clientY)
    let capturePointer = false

    if (e.button === 1 || e.button === 2 || (e.button === 0 && spacePan)) {
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
    } else if (!objectId || !ensured) {
      return
    } else {
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

    if (e.ctrlKey) {
      dragRef.current = {
        kind: 'marquee',
        startX: px.x,
        startY: px.y,
        marquee: { x0: px.x, y0: px.y, x1: px.x, y1: px.y },
        additive: e.shiftKey,
      }
      capturePointer = true
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
      } else if (!e.shiftKey) {
        clearAllUvSelection()
      }
    } else if (uvEditorMode === 'faces' && uvEditorSelectedFaces.length > 0) {
      const resize = pickResizeHandle(px.x, px.y, regionFacesForEdit)
      if (resize) {
        captureUndoPoint('Edit UV')
        const mesh = prepareFaceTransformMesh(regionFacesForEdit) ?? ensured
        const uvIndices = collectFaceUvIndices(regionFacesForEdit, mesh)
        const startBounds = getSelectionBoundsUv(regionFacesForEdit)
        const pivotUv = getScalePivotForHandle(startBounds, resize)
        draftUvsRef.current = mesh.uvs.map((u) => ({ ...u }))
        ensuredRef.current = mesh
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
      } else if (pickRotateHandle(px.x, px.y)) {
        captureUndoPoint('Edit UV')
        const mesh = prepareFaceTransformMesh(regionFacesForEdit) ?? ensured
        const uvIndices = collectFaceUvIndices(regionFacesForEdit, mesh)
        const pivotUv = getSelectionPivotUv(regionFacesForEdit)
        const startUv = pixelToUv(px.x, px.y, texW, texH)
        const startAngle = Math.atan2(startUv.v - pivotUv.v, startUv.u - pivotUv.u)
        draftUvsRef.current = mesh.uvs.map((u) => ({ ...u }))
        ensuredRef.current = mesh
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
      } else if (isInSelectionBBox(px.x, px.y, regionFacesForEdit)) {
        if (startFaceDragNow(regionFacesForEdit, px, e.clientX, e.clientY)) {
          capturePointer = true
        }
      }
    }

    if (!capturePointer && uvEditorMode === 'faces') {
      const face = pickFace(px.x, px.y)
      if (face !== null) {
        const nextFaces = resolveFacePick(face, uvEditorSelectedFaces, e.shiftKey)
        selectUvFaces(objectId, nextFaces)
        const uvIndices = collectFaceUvIndices(nextFaces)
        beginPendingUvDrag(
          'faceDrag',
          uvIndices,
          uvIndices.map((i) => ({ ...ensured.uvs[i] })),
          px.x,
          px.y,
          e.clientX,
          e.clientY,
          { faces: nextFaces }
        )
        capturePointer = true
      } else if (!e.shiftKey) {
        clearAllUvSelection()
        selectUvFaces(objectId, [])
      }
    }
    }

    if (capturePointer) {
      e.preventDefault()
      const el = e.currentTarget as HTMLElement
      el.setPointerCapture(e.pointerId)
      attachDragWindowListeners(e.pointerId)
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

  const applyFaceDragAtPointer = (
    clientX: number,
    clientY: number,
    ctrlKey: boolean,
    drag: NonNullable<typeof dragRef.current>
  ) => {
    if (!drag.uvIndices || !drag.startUvs || drag.startX === undefined) return
    const px = screenToUvPixel(clientX, clientY)
    const startUv = pixelToUv(drag.startX, drag.startY ?? 0, texW, texH)
    const currUv = pixelToUv(px.x, px.y, texW, texH)
    const du = currUv.u - startUv.u
    const dv = currUv.v - startUv.v

    let snapDu = du
    let snapDv = dv
    const enabled = ctrlKey ? !uvEditorSnap : uvEditorSnap
    const mode: UvSnapMode = enabled ? uvEditorSnapMode : 'off'
    const ctx = snapCtxRef.current
    if (ctx && mode !== 'off') {
      if (mode === 'grid') {
        const stepU = 1 / ctx.gridDivisions
        const stepV = 1 / ctx.gridDivisions
        snapDu = Math.round(du / stepU) * stepU
        snapDv = Math.round(dv / stepV) * stepV
      } else if (mode === 'island' && dragSelectionBoundsRef.current) {
        const bounds = dragSelectionBoundsRef.current
        const pdx = (currUv.u - startUv.u) * texW
        const pdy = (currUv.v - startUv.v) * texH
        const draggedBounds = {
          minX: bounds.minX + pdx,
          minY: bounds.minY + pdy,
          maxX: bounds.maxX + pdx,
          maxY: bounds.maxY + pdy,
        }
        const { dx, dy } = snapIslandDrag(
          draggedBounds,
          ctx.islandTargets,
          ctx.thresholdPx
        )
        const snapPx = { x: px.x + dx, y: px.y + dy }
        const snapUv = pixelToUv(snapPx.x, snapPx.y, texW, texH)
        snapDu = snapUv.u - startUv.u
        snapDv = snapUv.v - startUv.v
      } else if (mode === 'vertex') {
        const snapped = snapPixelToTargets(px.x, px.y, ctx.vertexTargets, ctx.thresholdPx)
        const snapUv = pixelToUv(snapped.x, snapped.y, texW, texH)
        snapDu = snapUv.u - startUv.u
        snapDv = snapUv.v - startUv.v
      }
    }

    const updates = drag.uvIndices.map((ui, idx) => {
      const base = drag.startUvs![idx]
      return { uvIndex: ui, u: base.u + snapDu, v: base.v + snapDv }
    })
    applyUvDraft(updates)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) {
      updateHoverAt(e.clientX, e.clientY)
      return
    }

    if (d.kind === 'pending' && d.startClientX !== undefined && d.startClientY !== undefined) {
      const dist = Math.hypot(e.clientX - d.startClientX, e.clientY - d.startClientY)
      if (d.activeKind === 'faceDrag' && dist > 0) {
        if (dist >= DRAG_THRESHOLD_PX) activatePendingDrag()
        applyFaceDragAtPointer(e.clientX, e.clientY, e.ctrlKey, dragRef.current!)
        return
      }
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
      applyPanPreview()
      return
    }

    if (!objectId || !ensured) return

    if (
      (active.kind === 'handle' || active.kind === 'faceDrag') &&
      active.uvIndices &&
      active.startUvs &&
      active.startX !== undefined
    ) {
      if (active.kind === 'faceDrag') {
        applyFaceDragAtPointer(e.clientX, e.clientY, e.ctrlKey, active)
        return
      }

      const px = screenToUvPixel(e.clientX, e.clientY)
      const startUv = pixelToUv(active.startX, active.startY ?? 0, texW, texH)
      const currUv = pixelToUv(px.x, px.y, texW, texH)
      const du = currUv.u - startUv.u
      const dv = currUv.v - startUv.v
      const updates = active.uvIndices.map((ui, idx) => {
        const base = active.startUvs![idx]
        const snapped = applySnap(base.u + du, base.v + dv, e.ctrlKey, 'point', {
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
      let [scaleU, scaleV] = getScaleFromHandle(active.startBounds, active.resizeHandle, currUv)
      if (e.ctrlKey) {
        scaleU = Math.round(scaleU / 0.1) * 0.1
        scaleV = Math.round(scaleV / 0.1) * 0.1
      }
      const scaled = scaleUvSnapshot(active.startUvs, scaleU, scaleV, active.pivotUv)
      const updates = active.uvIndices.map((ui, idx) => {
        const uv = scaled[idx]
        return { uvIndex: ui, u: uv.u, v: uv.v }
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
      let angle = Math.atan2(currUv.v - pivot.v, currUv.u - pivot.u) - active.startAngle
      if (e.ctrlKey) {
        const step = 15 * Math.PI / 180
        angle = Math.round(angle / step) * step
      }
      const rotated = rotateUvSnapshot(active.startUvs, angle, pivot)
      const updates = active.uvIndices.map((ui, idx) => {
        const uv = rotated[idx]
        return { uvIndex: ui, u: uv.u, v: uv.v }
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
    if (!dragRef.current) return

    const el = containerRef.current
    if (el?.hasPointerCapture(e.pointerId)) {
      el.releasePointerCapture(e.pointerId)
    }
    detachDragWindowListeners()
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
    const kind = d?.kind
    const wasPending = kind === 'pending'
    const pendingDrag = wasPending ? d : null
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
    } else if (wasPending && objectId && ensured && pendingDrag) {
      const dist =
        pendingDrag.startClientX !== undefined
          ? Math.hypot(
              e.clientX - pendingDrag.startClientX,
              e.clientY - (pendingDrag.startClientY ?? 0)
            )
          : 0

      if (
        dist >= DRAG_THRESHOLD_PX &&
        pendingDrag.activeKind === 'faceDrag' &&
        pendingDrag.uvIndices &&
        pendingDrag.startUvs
      ) {
        captureUndoPoint('Edit UV')
        flushDraftUvs()
        replaceHistoryHead('Edit UV')
      } else {
        if (dist > 0 && pendingDrag.uvIndices && pendingDrag.startUvs) {
          const reverts = pendingDrag.uvIndices.map((ui, idx) => ({
            uvIndex: ui,
            u: pendingDrag.startUvs![idx].u,
            v: pendingDrag.startUvs![idx].v,
          }))
          setObjectUvPoints(objectId, reverts, false)
        }
        draftUvsRef.current = null
        if (objectId) clearUvDraft(objectId)
        cancelPreviewRelay()
        const px = screenToUvPixel(e.clientX, e.clientY)
        if (uvEditorMode === 'faces') {
          const face = pickFace(px.x, px.y)
          if (face !== null) {
            const nextFaces = resolveFacePick(face, uvEditorSelectedFaces, e.shiftKey)
            selectUvFaces(objectId, nextFaces)
          } else if (!e.shiftKey) {
            clearAllUvSelection()
            selectUvFaces(objectId, [])
          }
        } else if (uvEditorMode === 'points') {
          const handle = pickHandle(px.x, px.y)
          if (handle !== null) {
            const indices = e.shiftKey
              ? uvEditorSelectedPoints.includes(handle)
                ? uvEditorSelectedPoints.filter((i) => i !== handle)
                : [...uvEditorSelectedPoints, handle]
              : [handle]
            setUvEditorSelectedPoints(indices)
            setUvEditorSelectedFaces([])
          } else if (!e.shiftKey) {
            clearAllUvSelection()
          }
        }
      }
    } else {
      resetDraftPreview()
    }
    updateHoverAt(e.clientX, e.clientY)
    redraw()
  }

  moveCanvasDragRef.current = (ev: PointerEvent) => {
    onPointerMove(ev as unknown as React.PointerEvent)
  }
  finishCanvasDragRef.current = (ev: PointerEvent) => {
    onPointerUp(ev as unknown as React.PointerEvent)
  }

  useEffect(() => {
    const el = containerRef.current
    if (!el || !uvEditorOpen) return

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()

      const state = useAppStore.getState()
      const currentZoom = state.uvEditorZoom
      const currentPanX = state.uvEditorPanX
      const currentPanY = state.uvEditorPanY

      const factor = e.deltaY > 0 ? 0.9 : 1.1
      const nz = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, currentZoom * factor))

      const sx = e.clientX - rect.left
      const sy = e.clientY - rect.top

      const px = (sx - currentPanX) / currentZoom
      const py = (sy - currentPanY) / currentZoom
      const nx = sx - px * nz
      const ny = sy - py * nz

      setUvEditorView(nz, nx, ny)
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [uvEditorOpen, setUvEditorView])

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
        if (e.code === 'KeyU' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.repeat) {
          e.preventDefault()
          unwrapSelectedUvFaces(unwrapMethod)
        }
        if (e.code === 'KeyA' && !e.altKey && !e.shiftKey) {
          e.preventDefault()
          if (e.ctrlKey || e.metaKey) {
            if (objectId) {
              if (uvEditorMode === 'faces') selectUvFaces(objectId, allFaceIndices)
              else setUvEditorSelectedPoints(getUvs().map((_, i) => i))
            }
          } else {
            if (objectId) {
              if (uvEditorMode === 'faces') {
                if (uvEditorSelectedFaces.length > 0) {
                  selectUvFaces(objectId, [])
                } else {
                  selectUvFaces(objectId, allFaceIndices)
                }
              } else {
                if (uvEditorSelectedPoints.length > 0) {
                  setUvEditorSelectedPoints([])
                } else {
                  setUvEditorSelectedPoints(getUvs().map((_, i) => i))
                }
              }
            }
          }
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
    unwrapSelectedUvFaces,
    unwrapMethod,
    getUvs,
    setUvEditorSelectedPoints,
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
    const next = {
      x: Math.round(box.minX),
      y: Math.round(box.minY),
      w: Math.round(box.maxX - box.minX),
      h: Math.round(box.maxY - box.minY),
      rot: 0,
    }
    setIslandFields((prev) =>
      prev.x === next.x &&
      prev.y === next.y &&
      prev.w === next.w &&
      prev.h === next.h &&
      prev.rot === next.rot
        ? prev
        : next
    )
    lastIslandRotRef.current = 0
  }, [ensured, uvEditorSelectedFaces, regionFacesForEdit, getSelectionBBoxPx])

  useEffect(() => {
    resetDraftPreview()
  }, [obj?.id, resetDraftPreview])

  useEffect(() => {
    if (uvEditorOpen) return
    cancelPreviewRelay()
    clearUvDraft()
  }, [uvEditorOpen, cancelPreviewRelay])

  useEffect(() => {
    return () => {
      cancelPreviewRelay()
      clearUvDraft()
    }
  }, [cancelPreviewRelay])

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
      minWidth={560}
      minHeight={360}
      onClose={() => setUvEditorOpen(false)}
      onStateChange={setUvEditorPanel}
    >
      <div
        className="uv-editor"
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
      >
        <UvEditorToolbar
          objectId={objectId}
          obj={obj}
          sceneTextures={sceneTextures}
          activeTextureId={activeTextureId}
          uvEditorMode={uvEditorMode}
          uvEditorSnap={uvEditorSnap}
          uvEditorSnapMode={uvEditorSnapMode}
          uvEditorSmartUvAngle={uvEditorSmartUvAngle}
          uvEditorShowGrid={uvEditorShowGrid}
          uvEditorTilePreview={uvEditorTilePreview}
          uvEditorViewAll={uvEditorViewAll}
          uvEditorAutoFit={uvEditorAutoFit}
          uvEditorSticky={uvEditorSticky}
          uvEditorGridDivisions={uvEditorGridDivisions}
          unwrapMethod={unwrapMethod}
          onImport={onImport}
          onAssignTexture={(id) => assignObjectTextureDocument(objectId!, id)}
          onSetUvEditorMode={setUvEditorMode}
          onSetMappingMode={(mode) => objectId && setObjectUvMappingMode(objectId, mode)}
          onTransform={(op) => transformSelectedUvIslands(op)}
          onUnwrap={unwrapSelectedUvFaces}
          onSetUnwrapMethod={setUnwrapMethod}
          onSetSmartUvAngle={setUvEditorSmartUvAngle}
          onFrameSelection={frameSelection}
          onFitCanvas={fitCanvasToCamera}
          onSetAutoFit={setUvEditorAutoFit}
          onSetSticky={setUvEditorSticky}
          onSetViewAll={setUvEditorViewAll}
          onSetShowGrid={setUvEditorShowGrid}
          onSetSnap={setUvEditorSnap}
          onSetSnapMode={setUvEditorSnapMode}
          onSetTilePreview={setUvEditorTilePreview}
          onSetGridDivisions={setUvEditorGridDivisions}
        />

        <div className="uv-editor-main">
          <div className="uv-editor-status">
            {(texture || pixelDoc) && (
              <span className="uv-editor-status-text">
                {pixelDoc ? 'Pixel texture' : texture!.name} · {texW}×{texH}px
              </span>
            )}
            <span className="uv-editor-status-hint">
              {uvEditorMode === 'faces'
                ? uvEditorViewAll
                  ? 'Full atlas view'
                  : 'Face island edit'
                : 'Point edit'}
              {' · Scroll zoom · Middle drag pan · Space pan · F frame'}
            </span>
          </div>

          <div
            ref={containerRef}
            className="uv-editor-canvas-wrap"
            style={{ cursor: hoverCursor }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onMouseDown={onMouseDown}
            onContextMenu={(e) => e.preventDefault()}
            onPointerLeave={() => {
              if (dragRef.current) return
              hoverRef.current = { face: null, point: null, cursor: 'crosshair' }
              setHoverCursor('crosshair')
              scheduleRedraw()
            }}
            onAuxClick={(e) => e.preventDefault()}
          >
            <canvas ref={canvasRef} className="uv-editor-canvas" />
            {!obj && <div className="uv-editor-empty">Select an object to edit UVs</div>}

            {/* Horizontal Scrollbar */}
            {thumbRatioX < 1 && (
              <div
                className="uv-scrollbar uv-scrollbar-horizontal"
                style={{
                  position: 'absolute',
                  left: '2px',
                  bottom: '2px',
                  width: `${trackW}px`,
                  height: '8px',
                  background: 'rgba(0, 0, 0, 0.15)',
                  borderRadius: '4px',
                  zIndex: 10,
                }}
              >
                <div
                  className="uv-scrollbar-thumb"
                  onMouseDown={handleScrollHMouseDown}
                  style={{
                    position: 'absolute',
                    left: `${thumbX}px`,
                    top: '1px',
                    width: `${thumbW}px`,
                    height: '6px',
                    background: 'rgba(255, 255, 255, 0.25)',
                    borderRadius: '3px',
                    cursor: 'pointer',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.45)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.25)'
                  }}
                />
              </div>
            )}

            {/* Vertical Scrollbar */}
            {thumbRatioY < 1 && (
              <div
                className="uv-scrollbar uv-scrollbar-vertical"
                style={{
                  position: 'absolute',
                  right: '2px',
                  top: '2px',
                  width: '8px',
                  height: `${trackH}px`,
                  background: 'rgba(0, 0, 0, 0.15)',
                  borderRadius: '4px',
                  zIndex: 10,
                }}
              >
                <div
                  className="uv-scrollbar-thumb"
                  onMouseDown={handleScrollVMouseDown}
                  style={{
                    position: 'absolute',
                    top: `${thumbY}px`,
                    left: '1px',
                    width: '6px',
                    height: `${thumbHSize}px`,
                    background: 'rgba(255, 255, 255, 0.25)',
                    borderRadius: '3px',
                    cursor: 'pointer',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.45)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(255, 255, 255, 0.25)'
                  }}
                />
              </div>
            )}
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
      </div>
    </FloatingPanel>
  )
}
