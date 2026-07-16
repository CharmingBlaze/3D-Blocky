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
import { getPixelCompositeCache } from '../pixel/pixelCompositeCache'
import { pickOpenFile } from '../io/fileDialogs'
import { IMAGE_IMPORT_FILTERS } from '../io/download'
import { ensureObjectUVs, resolveUvMappingMode, detachFacesUvTopology, type SceneObjectWithUVs } from '../uv/uvObject'
import { activeObjectTextureId, listSceneTextures } from '../uv/sceneTextures'
import {
  boundaryEdgesForFacesSpatial,
  expandFaceToPlanarRegion,
  expandFacesToPlanarRegions,
  getFaceGroupMap,
  type FaceGroup,
} from '../mesh/faceGroups'
import { drawRegionBoundary, drawRegionFill } from '../uv/uvOverlayDraw'
import {
  uvToPixel,
  pixelToUv,
  uvBoundsFromIndices,
  uvBoundsCenter,
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
import { type UvUnwrapMethod } from '../uv/uvUnwrap'
import type { Uv2 } from '../uv/uvTypes'
import { clearUvDraft, clearUvDraftIfMatch, scheduleUvDraft } from '../uv/uvDraftRelay'
import {
  applyFaceDragOverlayTransform,
  applyFaceRotateOverlayTransform,
  applyFaceScaleOverlayTransform,
  clearFaceDragOverlay,
  faceDragScreenDelta,
  faceDragScreenToUvDelta,
  faceRotateAngleFromUv,
  type FaceDragPreviewState,
  type FaceRotatePreviewState,
  type FaceScalePreviewState,
} from '../uv/uvFaceDragPreview'
import {
  applyUvLive3dDelta,
  isCssUvLiveOverlayMode,
  uvScreenOriginFromPivot,
  writeUvLive3dPool,
  type UvLiveOverlayMode,
} from '../uv/uvTransformSession'
import {
  isUvEditorScrollbarTarget,
  clampUvEditorZoom,
  uvEditorFitRect,
  uvEditorPanCssFromPainted,
  uvEditorPanFromScrollRatio,
  uvEditorScrollAxisMetrics,
  uvEditorScrollDocSpan,
  uvEditorScreenToWorld,
  uvEditorWheelZoom,
} from '../uv/uvEditorView'
import { UvEditorToolbar } from './uv/UvEditorToolbar'
import { UvObjectPreview } from './uv/UvObjectPreview'
import { polygonIntersectsMarquee } from '../uv/uvMarquee'
import { connectedUvFaces } from '../uv/uvSelection'
import { resolveUvPreviewFaceSelection } from '../uv/uvPreviewSelection'

const HANDLE_SIZE = 7
const ROTATE_HANDLE_RADIUS = 7
const ROTATE_HANDLE_OFFSET = 28
const RESIZE_HANDLE_SIZE = 6
const RESIZE_HANDLE_HIT_PADDING = 1
const MIN_RESIZE_BOUNDS_SCREEN_SIZE = 32
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

export function UVEditorPanel({ workspace = false }: { workspace?: boolean }) {
  const theme = useTheme()
  const workspaceRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewLayerRef = useRef<HTMLDivElement | null>(null)
  const screenOverlayRef = useRef<HTMLCanvasElement | null>(null)
  const paintedViewRef = useRef({ panX: 0, panY: 0, zoom: 1 })
  const viewportSizeRef = useRef({ w: 0, h: 0 })
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
  const pendingTopologyRef = useRef<{ objectId: string; faceUvIndices: number[][] } | null>(null)
  const previewRelayRafRef = useRef<number | null>(null)
  /** Store-topology UV pool for live 3D preview during face-drag (separate from editor detach). */
  const faceDrag3dRef = useRef<{
    indices: number[]
    starts: Uv2[]
    pool: Uv2[]
  } | null>(null)
  const redrawRafRef = useRef<number | null>(null)
  const canvasSizeRef = useRef({ w: 0, h: 0 }) // viewport buffer size
  const liveViewRef = useRef<{ panX: number; panY: number; zoom: number } | null>(null)
  /** During face move/rotate, omit selected islands from the main canvas (they live on the overlay). */
  const omitSelectionPaintRef = useRef(false)
  const faceDragPreviewRef = useRef<FaceDragPreviewState | null>(null)
  const faceRotatePreviewRef = useRef<FaceRotatePreviewState | null>(null)
  const faceScalePreviewRef = useRef<FaceScalePreviewState | null>(null)
  /** Blockbench-style session: css-* freezes atlas + CSS; repaint freezes atlas + overlay redraw. */
  const liveOverlayModeRef = useRef<UvLiveOverlayMode | null>(null)
  const selectionOverlayRef = useRef<HTMLCanvasElement | null>(null)
  const scrollThumbHRef = useRef<HTMLDivElement | null>(null)
  const scrollThumbVRef = useRef<HTMLDivElement | null>(null)
  const faceDragCssLiveRef = useRef(false)
  const zoomViewRafRef = useRef<number | null>(null)
  const pendingZoomViewRef = useRef<{ zoom: number; panX: number; panY: number } | null>(null)
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
    showUvPaintOverlay,
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
    setShowUvPaintOverlay,
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
      showUvPaintOverlay: s.pixelEditorShowUvOverlay,
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
      setShowUvPaintOverlay: s.setPixelEditorShowUvOverlay,
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
  const pixelDocRevision = useAppStore((s) => (texId ? (s.pixelDocRevisions[texId] ?? 0) : 0))
  const texW = pixelDoc?.width ?? texture?.width ?? 256
  const texH = pixelDoc?.height ?? texture?.height ?? 256
  const zoom = uvEditorZoom
  const pan = useMemo(() => ({ x: uvEditorPanX, y: uvEditorPanY }), [uvEditorPanX, uvEditorPanY])

  const commitView = useCallback(
    (view: { zoom: number; panX: number; panY: number }) => {
      setUvEditorView(clampUvEditorZoom(view.zoom, MIN_ZOOM, MAX_ZOOM), view.panX, view.panY)
    },
    [setUvEditorView]
  )

  const [spacePan, setSpacePan] = useState(false)
  const [imageLayerEdit, setImageLayerEdit] = useState(false)
  const [autoResizeUvsWithImage, setAutoResizeUvsWithImage] = useState(false)
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
  const pixelSourceImageDataRef = useRef<ImageData | null>(null)
  const lastIslandRotRef = useRef(0)
  const lastClickRef = useRef({ t: 0, x: 0, y: 0 })
  const lastAutoFitFacesRef = useRef<number[]>([])
  const lastFittedObjectRef = useRef<string | null>(null)

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

  const selectConnectedIsland = useCallback(() => {
    if (!objectId || !ensured || uvEditorMode !== 'faces') return
    const seed = uvEditorSelectedFaces[0]
    if (seed === undefined) return
    selectUvFaces(objectId, connectedUvFaces(ensured.faceUvIndices, seed))
  }, [objectId, ensured, uvEditorMode, uvEditorSelectedFaces, selectUvFaces])

  /** Sticky: whole coplanar region; off: single face breaks away on move. */
  const resolveFacePick = useCallback(
    (faceIndex: number, current: number[], additive: boolean): number[] => {
      if (!obj) return current
      if (!uvEditorSticky) {
        return resolveUvPreviewFaceSelection(current, faceIndex, additive)
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
    (faceIndices: number[], source: SceneObjectWithUVs | null = ensuredRef.current ?? ensured) => {
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
      const detached = detachFacesUvTopology(obj, faceIndices)
      pendingTopologyRef.current = { objectId, faceUvIndices: detached.faceUvIndices }
      ensuredRef.current = detached
      return detached
    },
    [obj, objectId, ensured]
  )

  const getSelectionPivotUv = useCallback(
    (faceIndices: number[]) => {
      const mesh = ensuredRef.current ?? ensured
      if (!mesh) return { u: 0.5, v: 0.5 }
      const uvIndices = collectFaceUvIndices(faceIndices, mesh)
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

  const pickResizeHandle = useCallback(
    (px: number, py: number, faceIndices: number[]): ResizeHandle | null => {
      const box = getSelectionBBoxPx(faceIndices)
      if (!box) return null
      const viewZoom = zoom
      const screenWidth = (box.maxX - box.minX) * viewZoom
      const screenHeight = (box.maxY - box.minY) * viewZoom
      // When an island is tiny on screen, eight resize hit zones overlap its
      // entire interior and make moving practically impossible. At that scale,
      // treat the island as move-only until the user zooms in.
      if (
        screenWidth < MIN_RESIZE_BOUNDS_SCREEN_SIZE ||
        screenHeight < MIN_RESIZE_BOUNDS_SCREEN_SIZE
      ) {
        return null
      }
      // Match the visible handle's half-size plus a small screen-space pad.
      const threshold = (RESIZE_HANDLE_SIZE / 2 + RESIZE_HANDLE_HIT_PADDING) / viewZoom
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
        commitView({ zoom: 1, panX: 24, panY: 24 })
        return
      }

      const pad = 32
      commitView(uvEditorFitRect({ minX, minY, maxX, maxY }, cw, ch, pad, MIN_ZOOM, MAX_ZOOM))
    },
    [collectFaceUvIndices, getUvs, texW, texH, commitView]
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
      commitView({ zoom: 1, panX: 24, panY: 24 })
      return
    }

    const pad = 32
    commitView(uvEditorFitRect({ minX, minY, maxX, maxY }, cw, ch, pad, MIN_ZOOM, MAX_ZOOM))
  }, [
    ensured,
    frameToFaceIndices,
    getUvs,
    texW,
    texH,
    regionFacesForEdit,
    uvEditorViewAll,
    uvEditorSelectedPoints,
    commitView,
  ])

  const fitCanvasToCamera = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    const cw = container.clientWidth
    const ch = container.clientHeight
    if (cw <= 0 || ch <= 0) return

    const pad = 32
    commitView(uvEditorFitRect({ minX: 0, minY: 0, maxX: texW, maxY: texH }, cw, ch, pad, MIN_ZOOM, MAX_ZOOM))
  }, [texW, texH, commitView])

  // Scrollbars use a fixed padded-atlas document so thumbs stay meaningful when zoomed in.
  const containerEl = containerRef.current
  if (containerEl) {
    const w = containerEl.clientWidth
    const h = containerEl.clientHeight
    if (w > 0 && h > 0) viewportSizeRef.current = { w, h }
  }
  const cw = viewportSizeRef.current.w || containerEl?.clientWidth || 600
  const ch = viewportSizeRef.current.h || containerEl?.clientHeight || 600

  const docX0 = -texW * 0.5
  const docX1 = texW * 1.5
  const docY0 = -texH * 0.5
  const docY1 = texH * 1.5
  const docSpanX = Math.max(docX1 - docX0, 1)
  const docSpanY = Math.max(docY1 - docY0, 1)
  const viewW = cw / Math.max(zoom, 1e-6)
  const viewH = ch / Math.max(zoom, 1e-6)
  const xMinVisible = -pan.x / Math.max(zoom, 1e-6)
  const yMinVisible = -pan.y / Math.max(zoom, 1e-6)

  const trackW = Math.max(1, cw - 16)
  const trackH = Math.max(1, ch - 16)
  const thumbW = Math.max(24, trackW * Math.min(1, viewW / docSpanX))
  const thumbHSize = Math.max(24, trackH * Math.min(1, viewH / docSpanY))
  const scrollRangeX = Math.max(0, docSpanX - viewW)
  const scrollRangeY = Math.max(0, docSpanY - viewH)
  const posRatioX =
    scrollRangeX > 0 ? Math.max(0, Math.min(1, (xMinVisible - docX0) / scrollRangeX)) : 0
  const posRatioY =
    scrollRangeY > 0 ? Math.max(0, Math.min(1, (yMinVisible - docY0) / scrollRangeY)) : 0
  const thumbX = (trackW - thumbW) * posRatioX
  const thumbY = (trackH - thumbHSize) * posRatioY
  const showScrollH = scrollRangeX > 1e-3
  const showScrollV = scrollRangeY > 1e-3

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

  /** Pan moves the frozen viewport paint; zoom/content changes call redraw. */
  const applyCamera = useCallback(() => {
    const layer = viewLayerRef.current
    if (!layer) return
    const live = getViewPanZoom()
    const painted = paintedViewRef.current
    if (Math.abs(live.zoom - painted.zoom) > 1e-6) {
      layer.style.transform = ''
      return
    }
    layer.style.transform = uvEditorPanCssFromPainted(painted, live)
  }, [getViewPanZoom])

  const syncScrollThumbsFromView = useCallback(
    (view: { panX: number; panY: number; zoom: number }) => {
      const container = containerRef.current
      const vw = Math.max(1, viewportSizeRef.current.w || container?.clientWidth || 600)
      const vh = Math.max(1, viewportSizeRef.current.h || container?.clientHeight || 600)
      const z = Math.max(view.zoom, 1e-6)
      const xMin = -view.panX / z
      const yMin = -view.panY / z
      const visW = vw / z
      const visH = vh / z
      const d0x = -texW * 0.5
      const d1x = texW * 1.5
      const d0y = -texH * 0.5
      const d1y = texH * 1.5
      const spanXv = Math.max(d1x - d0x, 1)
      const spanYv = Math.max(d1y - d0y, 1)
      const trackWv = Math.max(1, vw - 16)
      const trackHv = Math.max(1, vh - 16)
      const thumbWv = Math.max(24, trackWv * Math.min(1, visW / spanXv))
      const thumbHv = Math.max(24, trackHv * Math.min(1, visH / spanYv))
      const rangeX = Math.max(0, spanXv - visW)
      const rangeY = Math.max(0, spanYv - visH)
      const posXv = rangeX > 0 ? Math.max(0, Math.min(1, (xMin - d0x) / rangeX)) : 0
      const posYv = rangeY > 0 ? Math.max(0, Math.min(1, (yMin - d0y) / rangeY)) : 0
      if (scrollThumbHRef.current) {
        scrollThumbHRef.current.style.left = `${(trackWv - thumbWv) * posXv}px`
        scrollThumbHRef.current.style.width = `${thumbWv}px`
      }
      if (scrollThumbVRef.current) {
        scrollThumbVRef.current.style.top = `${(trackHv - thumbHv) * posYv}px`
        scrollThumbVRef.current.style.height = `${thumbHv}px`
      }
    },
    [texW, texH]
  )

  const finishScrollbarPan = useCallback(() => {
    const live = liveViewRef.current
    if (!live) return
    // Do not clear liveView here — clearing before the store updates snaps the camera back.
    setUvEditorView(live.zoom, live.panX, live.panY)
    applyCamera()
  }, [setUvEditorView, applyCamera])

  const handleScrollHThumbDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      const container = containerRef.current
      if (container) {
        viewportSizeRef.current = { w: container.clientWidth, h: container.clientHeight }
      }
      const startClientX = e.clientX
      const view = getViewPanZoom()
      const startPanX = view.panX
      const currentZoom = view.zoom
      const currentPanY = view.panY
      const vw = Math.max(1, viewportSizeRef.current.w || 600)
      const { span } = uvEditorScrollDocSpan(texW)
      const { panPerPx } = uvEditorScrollAxisMetrics(vw, currentZoom, span)
      liveViewRef.current = { zoom: currentZoom, panX: startPanX, panY: currentPanY }
      dragRef.current = null

      const onPointerMove = (moveEvent: PointerEvent) => {
        const dx = moveEvent.clientX - startClientX
        liveViewRef.current = {
          zoom: currentZoom,
          panX: startPanX - dx * panPerPx,
          panY: currentPanY,
        }
        applyCamera()
        syncScrollThumbsFromView(liveViewRef.current)
      }

      const onPointerUp = () => {
        window.removeEventListener('pointermove', onPointerMove)
        window.removeEventListener('pointerup', onPointerUp)
        window.removeEventListener('pointercancel', onPointerUp)
        finishScrollbarPan()
      }

      window.addEventListener('pointermove', onPointerMove)
      window.addEventListener('pointerup', onPointerUp)
      window.addEventListener('pointercancel', onPointerUp)
    },
    [getViewPanZoom, texW, applyCamera, syncScrollThumbsFromView, finishScrollbarPan]
  )

  const handleScrollVThumbDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      const container = containerRef.current
      if (container) {
        viewportSizeRef.current = { w: container.clientWidth, h: container.clientHeight }
      }
      const startClientY = e.clientY
      const view = getViewPanZoom()
      const startPanY = view.panY
      const currentZoom = view.zoom
      const currentPanX = view.panX
      const vh = Math.max(1, viewportSizeRef.current.h || 600)
      const { span } = uvEditorScrollDocSpan(texH)
      const { panPerPx } = uvEditorScrollAxisMetrics(vh, currentZoom, span)
      liveViewRef.current = { zoom: currentZoom, panX: currentPanX, panY: startPanY }
      dragRef.current = null

      const onPointerMove = (moveEvent: PointerEvent) => {
        const dy = moveEvent.clientY - startClientY
        liveViewRef.current = {
          zoom: currentZoom,
          panX: currentPanX,
          panY: startPanY - dy * panPerPx,
        }
        applyCamera()
        syncScrollThumbsFromView(liveViewRef.current)
      }

      const onPointerUp = () => {
        window.removeEventListener('pointermove', onPointerMove)
        window.removeEventListener('pointerup', onPointerUp)
        window.removeEventListener('pointercancel', onPointerUp)
        finishScrollbarPan()
      }

      window.addEventListener('pointermove', onPointerMove)
      window.addEventListener('pointerup', onPointerUp)
      window.addEventListener('pointercancel', onPointerUp)
    },
    [getViewPanZoom, texH, applyCamera, syncScrollThumbsFromView, finishScrollbarPan]
  )

  const handleScrollHTrackDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.target !== e.currentTarget || e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      const clickX = e.clientX - rect.left
      const view = getViewPanZoom()
      const vw = Math.max(1, viewportSizeRef.current.w || cw)
      const { doc0, span } = uvEditorScrollDocSpan(texW)
      const { track, thumb, range } = uvEditorScrollAxisMetrics(vw, view.zoom, span)
      if (range <= 0) return
      const ratio = Math.max(0, Math.min(1, (clickX - thumb / 2) / Math.max(1, track - thumb)))
      liveViewRef.current = {
        zoom: view.zoom,
        panX: uvEditorPanFromScrollRatio(doc0, range, ratio, view.zoom),
        panY: view.panY,
      }
      dragRef.current = null
      applyCamera()
      syncScrollThumbsFromView(liveViewRef.current)
      finishScrollbarPan()
    },
    [getViewPanZoom, cw, texW, applyCamera, syncScrollThumbsFromView, finishScrollbarPan]
  )

  const handleScrollVTrackDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.target !== e.currentTarget || e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      const clickY = e.clientY - rect.top
      const view = getViewPanZoom()
      const vh = Math.max(1, viewportSizeRef.current.h || ch)
      const { doc0, span } = uvEditorScrollDocSpan(texH)
      const { track, thumb, range } = uvEditorScrollAxisMetrics(vh, view.zoom, span)
      if (range <= 0) return
      const ratio = Math.max(0, Math.min(1, (clickY - thumb / 2) / Math.max(1, track - thumb)))
      liveViewRef.current = {
        zoom: view.zoom,
        panX: view.panX,
        panY: uvEditorPanFromScrollRatio(doc0, range, ratio, view.zoom),
      }
      dragRef.current = null
      applyCamera()
      syncScrollThumbsFromView(liveViewRef.current)
      finishScrollbarPan()
    },
    [getViewPanZoom, ch, texH, applyCamera, syncScrollThumbsFromView, finishScrollbarPan]
  )

  const screenToUvPixel = useCallback(
    (clientX: number, clientY: number) => {
      const container = containerRef.current
      if (!container) return { x: 0, y: 0 }
      const rect = container.getBoundingClientRect()
      const sx = clientX - rect.left
      const sy = clientY - rect.top
      const { panX, panY, zoom: z } = getViewPanZoom()
      return uvEditorScreenToWorld({ panX, panY, zoom: z }, sx, sy)
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

  const clearSelectionOverlay = useCallback(() => {
    faceDragCssLiveRef.current = false
    liveOverlayModeRef.current = null
    faceDragPreviewRef.current = null
    faceRotatePreviewRef.current = null
    faceScalePreviewRef.current = null
    faceDrag3dRef.current = null
    omitSelectionPaintRef.current = false
    clearFaceDragOverlay(selectionOverlayRef.current)
  }, [])

  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    const screen = screenOverlayRef.current
    if (!canvas || !container) return
    const mesh = ensuredRef.current ?? ensured

    const cw = container.clientWidth
    const ch = container.clientHeight
    viewportSizeRef.current = { w: cw, h: ch }
    if (screen) {
      if (screen.width !== cw) screen.width = cw
      if (screen.height !== ch) screen.height = ch
      const sctx = screen.getContext('2d')
      if (sctx) sctx.clearRect(0, 0, cw, ch)
    }

    // Face-transform preview freezes the atlas; camera pan still works via CSS.
    if (faceDragCssLiveRef.current) return

    const { panX, panY, zoom: viewZoom } = getViewPanZoom()
    // Viewport-sized buffer (not world×zoom) — keeps large textures editable.
    const dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2)
    const bufW = Math.max(1, Math.floor(cw * dpr))
    const bufH = Math.max(1, Math.floor(ch * dpr))
    if (canvas.width !== bufW || canvas.height !== bufH) {
      canvas.width = bufW
      canvas.height = bufH
    }
    canvas.style.width = `${cw}px`
    canvas.style.height = `${ch}px`
    canvasSizeRef.current = { w: bufW, h: bufH }
    const overlay = selectionOverlayRef.current
    if (overlay) {
      if (overlay.width !== bufW) overlay.width = bufW
      if (overlay.height !== bufH) overlay.height = bufH
      overlay.style.width = `${cw}px`
      overlay.style.height = `${ch}px`
    }

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.imageSmoothingEnabled = false

    // Hover is drawn on the screen overlay — avoid full atlas repaints on mousemove.
    const omitSelected = omitSelectionPaintRef.current
    const lw = (n: number) => n / Math.max(viewZoom, 1e-6)

    const paintSelectedFacesAndChrome = () => {
      if (!mesh || regionFacesForEdit.length === 0) return
      const uvs = getUvs()
      drawRegionFill(ctx, mesh, uvs, regionFacesForEdit, theme.css['--accent-soft'], texW, texH)
      drawRegionBoundary(
        ctx,
        mesh,
        uvs,
        regionFacesForEdit,
        theme.accent,
        lw(2.25),
        texW,
        texH,
        isolatedBoundaryEdges ?? undefined
      )

      const box = getSelectionBBoxPx(regionFacesForEdit)
      const handle = getRotateHandlePx(regionFacesForEdit)
      const pivotPx = uvToPixel(getSelectionPivotUv(regionFacesForEdit), texW, texH)

      if (box) {
        ctx.setLineDash([lw(5), lw(4)])
        ctx.strokeStyle = theme.accent
        ctx.globalAlpha = 0.55
        ctx.lineWidth = lw(1)
        ctx.strokeRect(box.minX, box.minY, box.maxX - box.minX, box.maxY - box.minY)
        ctx.globalAlpha = 1
        ctx.setLineDash([])

        const hs = lw(RESIZE_HANDLE_SIZE)
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
          ctx.lineWidth = lw(1)
          ctx.fillRect(h.x - hs / 2, h.y - hs / 2, hs, hs)
          ctx.strokeRect(h.x - hs / 2, h.y - hs / 2, hs, hs)
        }

        ctx.setLineDash([lw(3), lw(3)])
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
        ctx.lineWidth = lw(1)
        ctx.stroke()
        ctx.globalAlpha = 1

        const hr = lw(ROTATE_HANDLE_RADIUS)
        ctx.beginPath()
        ctx.arc(handle.x, handle.y, hr, 0, Math.PI * 2)
        ctx.fillStyle = theme.accent
        ctx.fill()
        ctx.strokeStyle = theme.text
        ctx.lineWidth = lw(1.25)
        ctx.stroke()

        ctx.beginPath()
        ctx.arc(handle.x, handle.y, hr * 0.55, 0.25 * Math.PI, 1.45 * Math.PI)
        ctx.strokeStyle = theme.uvCanvasBg
        ctx.lineWidth = lw(1.25)
        ctx.stroke()
      }
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, cw, ch)
    ctx.save()
    ctx.translate(panX, panY)
    ctx.scale(viewZoom, viewZoom)

    if (!mesh) {
      drawChecker(ctx, texW, texH, theme.uvGridA, theme.uvGridB)
      ctx.restore()
      paintedViewRef.current = { panX, panY, zoom: viewZoom }
      applyCamera()
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
      const repeat = obj?.material?.textureRepeat ?? [1, 1]
      const offset = obj?.material?.textureOffset ?? [0, 0]
      const rotation = obj?.material?.textureRotation ?? 0
      const transformed =
        Math.abs(repeat[0] - 1) > 1e-6 ||
        Math.abs(repeat[1] - 1) > 1e-6 ||
        Math.abs(offset[0]) > 1e-6 ||
        Math.abs(offset[1]) > 1e-6 ||
        Math.abs(rotation) > 1e-6
      if (transformed) {
        const pattern = ctx.createPattern(img, 'repeat')
        if (pattern) {
          pattern.setTransform(
            new DOMMatrix()
              .translate(offset[0] * texW, offset[1] * texH)
              .scale(1 / Math.max(0.01, repeat[0]), 1 / Math.max(0.01, repeat[1]))
          )
          ctx.save()
          ctx.beginPath()
          ctx.rect(0, 0, texW, texH)
          ctx.clip()
          ctx.translate(texW / 2, texH / 2)
          ctx.rotate((rotation * Math.PI) / 180)
          ctx.translate(-texW / 2, -texH / 2)
          ctx.fillStyle = pattern
          ctx.fillRect(-texW * 2, -texH * 2, texW * 5, texH * 5)
          ctx.restore()
        }
      } else {
        ctx.drawImage(img, 0, 0, texW, texH)
      }
    } else {
      drawChecker(ctx, texW, texH, theme.uvGridA, theme.uvGridB)
    }

    ctx.strokeStyle = theme.accent
    ctx.globalAlpha = 0.45
    ctx.lineWidth = lw(2)
    ctx.strokeRect(0, 0, texW, texH)
    ctx.globalAlpha = 1

    if (resolveUvMappingMode(mesh) === 'perFace') {
      ctx.strokeStyle = 'rgba(255,255,255,0.18)'
      ctx.lineWidth = lw(1.25)
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

    }

    if (uvEditorShowGrid) {
      ctx.strokeStyle = 'rgba(255,255,255,0.12)'
      ctx.lineWidth = lw(1)
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

    const uvs = getUvs()
    // Hover highlight is on the screen overlay — keep the atlas paint stable.
    const hoverGroupId = null as number | null
    const hasFaceSelection = uvEditorMode === 'faces' && selectedFaceSet.size > 0
    const skipSelectedRegions = hasFaceSelection
    const liveOmitUvIndices =
      omitSelected && dragRef.current?.uvIndices?.length
        ? new Set(dragRef.current.uvIndices)
        : null

    if (uvEditorMode === 'faces' && mesh) {
      if (faceGroupMap) {
        for (const group of faceGroupMap.groups) {
          const state = resolveUvRegionState(group, selectedFaceSet, hoverGroupId)
          if (skipSelectedRegions && state === 'selected') continue
          const dimmed = hasFaceSelection && state === 'idle'

          let fill = 'rgba(255,255,255,0.04)'
          let stroke = 'rgba(255,255,255,0.22)'
          let strokeW = lw(1.25)
          if (state === 'selected') {
            fill = theme.css['--accent-soft']
            stroke = theme.accent
            strokeW = lw(2.25)
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
          if (skipSelectedRegions && selectedFaceSet.has(fi)) continue
          const pts = getFacePixels(fi)
          if (pts.length < 3) continue
          ctx.moveTo(pts[0].x, pts[0].y)
          for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
          ctx.closePath()
        }
        ctx.fillStyle = 'rgba(255,255,255,0.03)'
        ctx.fill()
        ctx.strokeStyle = 'rgba(255,255,255,0.18)'
        ctx.lineWidth = lw(1)
        ctx.stroke()
      }
    } else {
      ctx.beginPath()
      for (const fi of visibleFaceIndices) {
        // Live point-edit session: those faces move on the overlay instead.
        if (
          liveOmitUvIndices &&
          mesh.faceUvIndices[fi]?.some((ui) => liveOmitUvIndices.has(ui))
        ) {
          continue
        }
        const pts = getFacePixels(fi)
        if (pts.length < 3) continue
        ctx.moveTo(pts[0].x, pts[0].y)
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
        ctx.closePath()
      }
      ctx.fillStyle = 'rgba(255,255,255,0.03)'
      ctx.fill()
      ctx.strokeStyle = 'rgba(255,255,255,0.18)'
      ctx.lineWidth = lw(1)
      ctx.stroke()
    }

    if (uvEditorMode === 'points') {
      const handleSet = new Set<number>()
      for (const fi of visibleFaceIndices) {
        for (const ui of mesh.faceUvIndices[fi] ?? []) handleSet.add(ui)
      }

      for (const ui of handleSet) {
        if (liveOmitUvIndices?.has(ui)) continue
        const uv = getUvs()[ui] ?? { u: 0, v: 0 }
        const { x, y } = uvToPixel(uv, texW, texH)
        const selected = uvEditorSelectedPoints.includes(ui)
        const hs = lw(HANDLE_SIZE)
        ctx.fillStyle = selected ? theme.accent : theme.text
        ctx.strokeStyle = selected ? theme.text : theme.accent
        ctx.lineWidth = lw(1)
        ctx.fillRect(x - hs / 2, y - hs / 2, hs, hs)
        ctx.strokeRect(x - hs / 2, y - hs / 2, hs, hs)
      }
    }

    if (!omitSelected && uvEditorMode === 'faces' && regionFacesForEdit.length > 0) {
      paintSelectedFacesAndChrome()
    }

    if (dragRef.current?.kind === 'marquee' && dragRef.current.marquee) {
      const m = dragRef.current.marquee
      ctx.strokeStyle = theme.accent
      ctx.setLineDash([lw(4), lw(4)])
      ctx.lineWidth = lw(1)
      ctx.strokeRect(m.x0, m.y0, m.x1 - m.x0, m.y1 - m.y0)
      ctx.setLineDash([])
    }

    ctx.restore()
    paintedViewRef.current = { panX, panY, zoom: viewZoom }
    applyCamera()

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
    if (navBox && screen) {
      const sctx = screen.getContext('2d')
      if (sctx) {
        drawNavigatorArrow(sctx, cw, ch, panX, panY, viewZoom, navBox, theme.accent, theme.uvCanvasBg)
      }
    }
  }, [
    ensured,
    faceGroupMap,
    selectedFaceSet,
    visibleFaceIndices,
    isolatedBoundaryEdges,
    groupBoundaryEdges,
    regionFacesForEdit,
    getFacePixels,
    texW,
    texH,
    getViewPanZoom,
    applyCamera,
    uvEditorShowGrid,
    uvEditorTilePreview,
    uvEditorGridDivisions,
    uvEditorSelectedPoints,
    uvEditorSelectedFaces,
    uvEditorMode,
    texture?.url,
    obj?.material?.textureRepeat,
    obj?.material?.textureOffset,
    obj?.material?.textureRotation,
    uvEditorPanel.width,
    uvEditorPanel.height,
    getSelectionBBoxPx,
    getRotateHandlePx,
    getSelectionPivotUv,
    getUvs,
    theme,
  ])

  const scheduleRedraw = useCallback(() => {
    if (redrawRafRef.current != null) return
    redrawRafRef.current = requestAnimationFrame(() => {
      redrawRafRef.current = null
      redraw()
    })
  }, [redraw])

  const paintSelectionOverlay = useCallback(
    (opts?: { pose?: 'start' | 'draft' }) => {
      const overlay = selectionOverlayRef.current
      const container = containerRef.current
      const mesh = ensuredRef.current ?? ensured
      const pose = opts?.pose ?? 'start'
      if (!overlay || !container || !mesh) return

      const cw = container.clientWidth
      const ch = container.clientHeight
      const dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2)
      const bufW = Math.max(1, Math.floor(cw * dpr))
      const bufH = Math.max(1, Math.floor(ch * dpr))
      if (overlay.width !== bufW) overlay.width = bufW
      if (overlay.height !== bufH) overlay.height = bufH
      overlay.style.width = `${cw}px`
      overlay.style.height = `${ch}px`

      const octx = overlay.getContext('2d')
      if (!octx) return
      octx.imageSmoothingEnabled = false
      const { panX, panY, zoom: viewZoom } = paintedViewRef.current
      const lw = (n: number) => n / Math.max(viewZoom, 1e-6)
      octx.setTransform(dpr, 0, 0, dpr, 0, 0)
      octx.clearRect(0, 0, cw, ch)
      octx.save()
      octx.translate(panX, panY)
      octx.scale(viewZoom, viewZoom)

      const drag = dragRef.current
      const savedDraft = draftUvsRef.current
      // CSS transforms need the gesture-start silhouette; repaint mode uses live draft UVs.
      if (pose === 'start' && drag?.uvIndices && drag.startUvs) {
        const base = savedDraft ?? mesh.uvs
        const startPose = base.map((uv) => ({ ...uv }))
        for (let i = 0; i < drag.uvIndices.length; i++) {
          startPose[drag.uvIndices[i]!] = { ...drag.startUvs[i]! }
        }
        draftUvsRef.current = startPose
      }
      const uvs = getUvs()

      const facesForOverlay =
        regionFacesForEdit.length > 0
          ? regionFacesForEdit
          : (() => {
              // Point edits: outline faces that share the dragged UV indices.
              if (!drag?.uvIndices?.length) return [] as number[]
              const wanted = new Set(drag.uvIndices)
              const faces: number[] = []
              for (let fi = 0; fi < mesh.faceUvIndices.length; fi++) {
                const idxs = mesh.faceUvIndices[fi]
                if (idxs?.some((ui) => wanted.has(ui))) faces.push(fi)
              }
              return faces
            })()

      if (facesForOverlay.length > 0) {
        drawRegionFill(octx, mesh, uvs, facesForOverlay, theme.css['--accent-soft'], texW, texH)
        drawRegionBoundary(
          octx,
          mesh,
          uvs,
          facesForOverlay,
          theme.accent,
          lw(2.25),
          texW,
          texH,
          isolatedBoundaryEdges ?? undefined
        )
        const box = getSelectionBBoxPx(facesForOverlay)
        if (box) {
          const hs = lw(RESIZE_HANDLE_SIZE)
          octx.strokeStyle = theme.accent
          octx.globalAlpha = 0.55
          octx.lineWidth = lw(1)
          octx.strokeRect(box.minX, box.minY, box.maxX - box.minX, box.maxY - box.minY)
          octx.globalAlpha = 0.28
          octx.fillStyle = theme.css['--accent-soft']
          octx.fillRect(box.minX, box.minY, box.maxX - box.minX, box.maxY - box.minY)
          octx.globalAlpha = 1
          for (const h of [
            { x: box.minX, y: box.minY },
            { x: box.cx, y: box.minY },
            { x: box.maxX, y: box.minY },
            { x: box.maxX, y: box.cy },
            { x: box.maxX, y: box.maxY },
            { x: box.cx, y: box.maxY },
            { x: box.minX, y: box.maxY },
            { x: box.minX, y: box.cy },
          ]) {
            octx.fillStyle = theme.text
            octx.strokeStyle = theme.accent
            octx.fillRect(h.x - hs / 2, h.y - hs / 2, hs, hs)
            octx.strokeRect(h.x - hs / 2, h.y - hs / 2, hs, hs)
          }
        }
      }

      // Point handles (points mode / vertex drag).
      const pointIndices =
        drag?.kind === 'handle' || drag?.activeKind === 'handle'
          ? drag.uvIndices ?? []
          : uvEditorSelectedPoints
      if (pointIndices.length > 0) {
        const hs = lw(HANDLE_SIZE)
        for (const ui of pointIndices) {
          const uv = uvs[ui]
          if (!uv) continue
          const p = uvToPixel(uv, texW, texH)
          octx.fillStyle = theme.accent
          octx.strokeStyle = theme.text
          octx.lineWidth = lw(1)
          octx.fillRect(p.x - hs / 2, p.y - hs / 2, hs, hs)
          octx.strokeRect(p.x - hs / 2, p.y - hs / 2, hs, hs)
        }
      }

      octx.restore()
      draftUvsRef.current = savedDraft
      if (pose === 'draft' || !isCssUvLiveOverlayMode(liveOverlayModeRef.current)) {
        overlay.style.transform = ''
        overlay.style.transformOrigin = ''
      }
    },
    [
      ensured,
      regionFacesForEdit,
      getUvs,
      theme,
      texW,
      texH,
      isolatedBoundaryEdges,
      getSelectionBBoxPx,
      uvEditorSelectedPoints,
    ]
  )

  const paintHoverOverlay = useCallback(() => {
    const screen = screenOverlayRef.current
    const container = containerRef.current
    const mesh = ensuredRef.current ?? ensured
    if (!screen || !container) return
    const cw = container.clientWidth
    const ch = container.clientHeight
    if (cw <= 0 || ch <= 0) return
    if (screen.width !== cw) screen.width = cw
    if (screen.height !== ch) screen.height = ch
    const sctx = screen.getContext('2d')
    if (!sctx) return
    sctx.clearRect(0, 0, cw, ch)

    const { panX, panY, zoom: viewZoom } = getViewPanZoom()
    const hoverFace = hoverRef.current.face
    const hoverPoint = hoverRef.current.point

    if (mesh && (hoverFace !== null || hoverPoint !== null) && !faceDragCssLiveRef.current) {
      const lw = (n: number) => n / Math.max(viewZoom, 1e-6)
      sctx.save()
      sctx.translate(panX, panY)
      sctx.scale(viewZoom, viewZoom)
      if (hoverFace !== null && uvEditorMode === 'faces') {
        const groupId = faceGroupMap?.faceToGroup[hoverFace] ?? null
        const group =
          groupId !== null && faceGroupMap
            ? faceGroupMap.groups.find((g) => g.id === groupId) ?? null
            : null
        const faces = group?.faceIndices ?? [hoverFace]
        drawRegionFill(sctx, mesh, getUvs(), faces, theme.css['--accent-orange-soft'], texW, texH)
        drawRegionBoundary(
          sctx,
          mesh,
          getUvs(),
          faces,
          theme.meshHover,
          lw(2),
          texW,
          texH,
          group ? groupBoundaryEdges.get(group.id) : undefined
        )
      }
      if (hoverPoint !== null && uvEditorMode === 'points') {
        const uv = getUvs()[hoverPoint] ?? { u: 0, v: 0 }
        const { x, y } = uvToPixel(uv, texW, texH)
        const hs = lw(HANDLE_SIZE + 2)
        sctx.fillStyle = theme.meshHover
        sctx.strokeStyle = theme.text
        sctx.lineWidth = lw(1)
        sctx.fillRect(x - hs / 2, y - hs / 2, hs, hs)
        sctx.strokeRect(x - hs / 2, y - hs / 2, hs, hs)
      }
      sctx.restore()
    }

    if (uvEditorSelectedFaces.length > 0) {
      const navBox = getSelectionBBoxPx(regionFacesForEdit)
      if (navBox) {
        drawNavigatorArrow(sctx, cw, ch, panX, panY, viewZoom, navBox, theme.accent, theme.uvCanvasBg)
      }
    }
  }, [
    ensured,
    getViewPanZoom,
    getUvs,
    faceGroupMap,
    groupBoundaryEdges,
    uvEditorMode,
    theme,
    texW,
    texH,
    uvEditorSelectedFaces.length,
    getSelectionBBoxPx,
    regionFacesForEdit,
  ])

  const paintMarqueeOverlay = useCallback((marquee: { x0: number; y0: number; x1: number; y1: number }) => {
    const screen = screenOverlayRef.current
    const container = containerRef.current
    if (!screen || !container) return
    const width = container.clientWidth
    const height = container.clientHeight
    if (screen.width !== width) screen.width = width
    if (screen.height !== height) screen.height = height
    const ctx = screen.getContext('2d')
    if (!ctx) return
    const view = getViewPanZoom()
    const x0 = marquee.x0 * view.zoom + view.panX
    const y0 = marquee.y0 * view.zoom + view.panY
    const x1 = marquee.x1 * view.zoom + view.panX
    const y1 = marquee.y1 * view.zoom + view.panY
    const left = Math.min(x0, x1)
    const top = Math.min(y0, y1)
    const boxWidth = Math.abs(x1 - x0)
    const boxHeight = Math.abs(y1 - y0)
    ctx.clearRect(0, 0, width, height)
    ctx.save()
    ctx.fillStyle = theme.css['--accent-soft']
    ctx.strokeStyle = theme.accent
    ctx.lineWidth = 1
    ctx.setLineDash([5, 3])
    ctx.fillRect(left, top, boxWidth, boxHeight)
    ctx.strokeRect(left + 0.5, top + 0.5, boxWidth, boxHeight)
    ctx.restore()
  }, [getViewPanZoom, theme])

  const beginLive3dFacePreview = useCallback(
    (indicesOverride?: number[]) => {
      // Live 3D uses the *store* UV topology (MeshRenderer), not the detached editor copy.
      if (!objectId) return
      const liveObj = useAppStore.getState().objects.find((o) => o.id === objectId)
      if (!liveObj) return
      const base = ensureObjectUVs(liveObj)
      const faces = regionFacesForEditRef.current
      const indices =
        indicesOverride ??
        (faces.length > 0 ? collectFaceUvIndices(faces, base) : [])
      if (indices.length === 0) return
      faceDrag3dRef.current = {
        indices,
        starts: indices.map((i) => ({ ...base.uvs[i]! })),
        pool: base.uvs.map((uv) => ({ ...uv })),
      }
    },
    [objectId, collectFaceUvIndices]
  )

  /**
   * Blockbench-style transform session:
   * freeze atlas → paint selection overlay once (or per-move for repaint) → live 3D UV patch.
   */
  const beginFaceTransformPreview = useCallback(
    (
      mode: UvLiveOverlayMode,
      opts?: {
        startClientX?: number
        startClientY?: number
        pivotUv?: Uv2
        startAngle?: number
        uvIndices?: number[]
      }
    ) => {
      const { panX, panY, zoom: viewZoom } = getViewPanZoom()
      omitSelectionPaintRef.current = true
      faceDragCssLiveRef.current = false
      liveOverlayModeRef.current = null
      faceDragPreviewRef.current = null
      faceRotatePreviewRef.current = null
      faceScalePreviewRef.current = null
      clearFaceDragOverlay(selectionOverlayRef.current)

      beginLive3dFacePreview(opts?.uvIndices)

      redraw()
      const pose = mode === 'repaint' ? 'draft' : 'start'
      paintSelectionOverlay({ pose })

      if (mode === 'css-move' && opts?.startClientX !== undefined && opts.startClientY !== undefined) {
        faceDragPreviewRef.current = {
          startClientX: opts.startClientX,
          startClientY: opts.startClientY,
          zoom: viewZoom,
          texW,
          texH,
        }
      } else if (mode === 'css-rotate' && opts?.pivotUv && opts.startAngle !== undefined) {
        const origin = uvScreenOriginFromPivot(opts.pivotUv, panX, panY, viewZoom, texW, texH)
        faceRotatePreviewRef.current = {
          pivotU: opts.pivotUv.u,
          pivotV: opts.pivotUv.v,
          startAngle: opts.startAngle,
          ...origin,
        }
      } else if (mode === 'css-scale' && opts?.pivotUv) {
        faceScalePreviewRef.current = uvScreenOriginFromPivot(
          opts.pivotUv,
          panX,
          panY,
          viewZoom,
          texW,
          texH
        )
      }

      liveOverlayModeRef.current = mode
      faceDragCssLiveRef.current = true
    },
    [getViewPanZoom, beginLive3dFacePreview, redraw, paintSelectionOverlay, texW, texH]
  )

  const beginFaceDragPreview = useCallback(
    (startClientX: number, startClientY: number) => {
      beginFaceTransformPreview('css-move', { startClientX, startClientY })
    },
    [beginFaceTransformPreview]
  )

  const beginFaceRotatePreview = useCallback(
    (pivotUv: Uv2, startAngle: number) => {
      beginFaceTransformPreview('css-rotate', { pivotUv, startAngle })
    },
    [beginFaceTransformPreview]
  )

  const beginFaceScalePreview = useCallback(
    (pivotUv: Uv2) => {
      beginFaceTransformPreview('css-scale', { pivotUv })
    },
    [beginFaceTransformPreview]
  )

  const beginHandleLivePreview = useCallback(
    (uvIndices: number[]) => {
      beginFaceTransformPreview('repaint', { uvIndices })
    },
    [beginFaceTransformPreview]
  )

  const detachDragWindowListeners = useCallback(() => {
    const listeners = dragWindowListenersRef.current
    if (!listeners) return
    window.removeEventListener('pointermove', listeners.onMove)
    window.removeEventListener('pointerup', listeners.onUp)
    window.removeEventListener('pointercancel', listeners.onUp)
    dragWindowListenersRef.current = null
  }, [])

  useEffect(() => () => detachDragWindowListeners(), [detachDragWindowListeners])

  const cancelPreviewRelay = useCallback(() => {
    if (previewRelayRafRef.current !== null) {
      cancelAnimationFrame(previewRelayRafRef.current)
      previewRelayRafRef.current = null
    }
  }, [])

  const resetDraftPreview = useCallback(() => {
    cancelPreviewRelay()
    draftUvsRef.current = null
    pendingTopologyRef.current = null
    if (objectId) clearUvDraft(objectId)
  }, [objectId, cancelPreviewRelay])

  const applyUvDraft = useCallback(
    (updates: Array<{ uvIndex: number; u: number; v: number }>, redrawCanvas = true) => {
      const mesh = ensuredRef.current ?? ensured
      if (!mesh || updates.length === 0) return
      // Allocate the working UV pool once per gesture, then mutate it in place.
      const next = draftUvsRef.current ?? mesh.uvs.map((u) => ({ ...u }))
      for (const u of updates) next[u.uvIndex] = { u: u.u, v: u.v }
      draftUvsRef.current = next
      if (redrawCanvas) scheduleRedraw()
      // Live 3D: patch GPU UV buffers once per frame — never write the app store mid-drag.
      if (objectId) scheduleUvDraft(objectId, next)
    },
    [ensured, scheduleRedraw, objectId]
  )

  const flushDraftUvs = useCallback(() => {
    cancelPreviewRelay()
    if (!objectId || !draftUvsRef.current) {
      draftUvsRef.current = null
      pendingTopologyRef.current = null
      if (objectId) clearUvDraft(objectId)
      return
    }
    const draft = draftUvsRef.current
    const pendingTopology = pendingTopologyRef.current
    const liveObj = useAppStore.getState().objects.find((o) => o.id === objectId)
    const baseUvs = liveObj?.uvs?.length ? liveObj.uvs : ensured?.uvs
    draftUvsRef.current = null
    pendingTopologyRef.current = null
    if (!baseUvs) {
      clearUvDraftIfMatch(objectId, draft)
      return
    }
    const updates: Array<{ uvIndex: number; u: number; v: number }> = []
    for (let i = 0; i < draft.length; i++) {
      const orig = baseUvs[i]
      const d = draft[i]
      if (!orig || orig.u !== d.u || orig.v !== d.v) {
        updates.push({ uvIndex: i, u: d.u, v: d.v })
      }
    }
    if (updates.length === 0) {
      clearUvDraftIfMatch(objectId, draft)
      return
    }
    if (pendingTopology?.objectId === objectId) {
      updateObject(objectId, {
        uvs: draft.map((uv) => ({ ...uv })),
        faceUvIndices: pendingTopology.faceUvIndices,
        uvAutoPacked: true,
      })
    } else {
      setObjectUvPoints(objectId, updates, false)
    }
    // Keep the GPU draft alive through the store commit/render boundary. Clearing
    // synchronously here briefly restored the old UV buffer in the 3D preview.
    requestAnimationFrame(() => clearUvDraftIfMatch(objectId, draft))
  }, [objectId, ensured, setObjectUvPoints, updateObject, cancelPreviewRelay])

  useEffect(() => {
    if (pixelDoc && texId) {
      const canvas = pixelSourceCanvasRef.current ?? document.createElement('canvas')
      pixelSourceCanvasRef.current = canvas
      if (canvas.width !== pixelDoc.width || canvas.height !== pixelDoc.height) {
        canvas.width = pixelDoc.width
        canvas.height = pixelDoc.height
      }
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const cached = getPixelCompositeCache(texId)
      const pixels =
        cached && cached.width === pixelDoc.width && cached.height === pixelDoc.height
          ? cached.pixels
          : compositeLayers(pixelDoc)
      // Reuse ImageData buffer — avoid allocating a full copy on every stroke commit.
      let imageData = pixelSourceImageDataRef.current
      if (!imageData || imageData.width !== pixelDoc.width || imageData.height !== pixelDoc.height) {
        imageData = new ImageData(pixelDoc.width, pixelDoc.height)
        pixelSourceImageDataRef.current = imageData
      }
      imageData.data.set(pixels)
      ctx.putImageData(imageData, 0, 0)
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
  }, [pixelDoc, pixelDocRevision, texId, texture?.url, scheduleRedraw])

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

  // A newly opened/switched object starts with the complete normalized atlas
  // visible. Camera state is otherwise preserved while editing, so UV changes
  // never trigger an unwanted zoom jump or an expensive canvas resize.
  useEffect(() => {
    if (!uvEditorOpen || !objectId || !ensured) {
      if (!uvEditorOpen) lastFittedObjectRef.current = null
      return
    }
    if (lastFittedObjectRef.current === objectId) return
    lastFittedObjectRef.current = objectId
    const id = window.requestAnimationFrame(fitCanvasToCamera)
    return () => window.cancelAnimationFrame(id)
  }, [uvEditorOpen, objectId, ensured, fitCanvasToCamera])

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
  }, [redraw, obj, uvEditorOpen])

  useEffect(() => {
    // Pan: CSS over frozen paint. Zoom: repaint viewport at the new zoom.
    if (Math.abs(zoom - paintedViewRef.current.zoom) > 1e-6) {
      scheduleRedraw()
    } else {
      applyCamera()
    }
  }, [applyCamera, scheduleRedraw, pan.x, pan.y, zoom])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver(() => {
      viewportSizeRef.current = {
        w: container.clientWidth,
        h: container.clientHeight,
      }
      applyCamera()
      redraw()
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [redraw, applyCamera])

  useEffect(() => {
    const onResize = () => redraw()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [redraw])

  const pickHandle = (px: number, py: number): number | null => {
    if (!ensured || uvEditorMode !== 'points') return null
    const viewZ = getViewPanZoom().zoom
    const threshold = HANDLE_SIZE / viewZ + 2
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
    const threshold = ROTATE_HANDLE_RADIUS / getViewPanZoom().zoom + 4
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
    (
      uvIndices: number[],
      excludeFaces: number[],
      source: SceneObjectWithUVs | null = ensuredRef.current ?? ensured
    ) => {
      if (!source) return
      snapCtxRef.current = {
        texW,
        texH,
        gridDivisions: uvEditorGridDivisions,
        vertexTargets: collectVertexSnapTargets(
          source.uvs,
          new Set(uvIndices),
          texW,
          texH
        ),
        islandTargets: collectIslandSnapTargets(
          source.uvs,
          source.faceUvIndices,
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

    buildSnapContext(d.uvIndices ?? [], editFaces, mesh)
    if (d.activeKind === 'faceDrag' && editFaces.length > 0) {
      dragSelectionBoundsRef.current = getSelectionBBoxPx(editFaces)
    } else {
      dragSelectionBoundsRef.current = null
    }

    if (d.activeKind === 'faceDrag' && d.startClientX !== undefined && d.startClientY !== undefined) {
      beginFaceDragPreview(d.startClientX, d.startClientY)
    } else if (d.activeKind === 'handle' && d.uvIndices) {
      beginHandleLivePreview(d.uvIndices)
    } else {
      scheduleRedraw()
    }
    return true
  }, [
    captureUndoPoint,
    buildSnapContext,
    prepareFaceTransformMesh,
    collectFaceUvIndices,
    getSelectionBBoxPx,
    beginFaceDragPreview,
    beginHandleLivePreview,
    scheduleRedraw,
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
      buildSnapContext(uvIndices, faceIndices, mesh)
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
      beginFaceDragPreview(clientX, clientY)
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
      beginFaceDragPreview,
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
      } else if (
        (() => {
          const faceUnderPointer = pickFace(px.x, px.y)
          return faceUnderPointer !== null && regionFacesForEdit.includes(faceUnderPointer)
        })()
      ) {
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
    if (faceDragCssLiveRef.current) return
    // Hover highlight is a cheap screen overlay — never repaint the atlas for it.
    if (prev.face !== face || prev.point !== point) paintHoverOverlay()
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
    // Scrollbars own their pointer stream — canvas must not start pan/select/edit.
    if (isUvEditorScrollbarTarget(e.target)) return

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
      e.preventDefault()
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
    } else if (uvEditorMode === 'faces' && uvEditorSelectedFaces.length > 0 && !e.shiftKey) {
      const resize = pickResizeHandle(px.x, px.y, regionFacesForEdit)
      if (resize) {
        captureUndoPoint('Edit UV')
        const mesh = prepareFaceTransformMesh(regionFacesForEdit) ?? ensured
        const uvIndices = collectFaceUvIndices(regionFacesForEdit, mesh)
        const startBounds = uvBoundsFromIndices(mesh.uvs, uvIndices)
        const pivotUv = getScalePivotForHandle(startBounds, resize)
        draftUvsRef.current = mesh.uvs.map((u) => ({ ...u }))
        ensuredRef.current = mesh
        buildSnapContext(uvIndices, regionFacesForEdit, mesh)
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
        beginFaceScalePreview(pivotUv)
        capturePointer = true
      } else if (pickRotateHandle(px.x, px.y)) {
        captureUndoPoint('Edit UV')
        const mesh = prepareFaceTransformMesh(regionFacesForEdit) ?? ensured
        const uvIndices = collectFaceUvIndices(regionFacesForEdit, mesh)
        const pivotUv = uvBoundsCenter(uvBoundsFromIndices(mesh.uvs, uvIndices))
        const startUv = pixelToUv(px.x, px.y, texW, texH)
        const startAngle = Math.atan2(startUv.v - pivotUv.v, startUv.u - pivotUv.u)
        draftUvsRef.current = mesh.uvs.map((u) => ({ ...u }))
        ensuredRef.current = mesh
        buildSnapContext(uvIndices, regionFacesForEdit, mesh)
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
        beginFaceRotatePreview(pivotUv, startAngle)
        setIslandFields((f) => ({ ...f, rot: 0 }))
        lastIslandRotRef.current = 0
        capturePointer = true
      } else if (
        (() => {
          const faceUnderPointer = pickFace(px.x, px.y)
          return faceUnderPointer !== null && regionFacesForEdit.includes(faceUnderPointer)
        })()
      ) {
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
    _ctrlKey: boolean,
    _drag: NonNullable<typeof dragRef.current>
  ) => {
    // 2D: CSS overlay only. 3D: RAF-coalesced UV buffer patch (no store writes).
    const preview = faceDragPreviewRef.current
    if (!faceDragCssLiveRef.current || !preview) return
    const { sx, sy } = faceDragScreenDelta(preview, clientX, clientY)
    // Overlay bitmap is already at paint zoom (1 screen px ≈ 1 canvas px).
    applyFaceDragOverlayTransform(selectionOverlayRef.current, sx, sy)

    const live3d = faceDrag3dRef.current
    if (!objectId || !live3d) return
    const { du, dv } = faceDragScreenToUvDelta(preview, clientX, clientY)
    applyUvLive3dDelta(live3d, du, dv)
    scheduleUvDraft(objectId, live3d.pool)
  }

  const applyFaceRotateAtPointer = (
    clientX: number,
    clientY: number,
    ctrlKey: boolean
  ): number | null => {
    const preview = faceRotatePreviewRef.current
    if (!faceDragCssLiveRef.current || !preview) return null
    const px = screenToUvPixel(clientX, clientY)
    const currUv = pixelToUv(px.x, px.y, texW, texH)
    let angle = faceRotateAngleFromUv(preview, currUv)
    if (ctrlKey) {
      const step = (15 * Math.PI) / 180
      angle = Math.round(angle / step) * step
    }
    applyFaceRotateOverlayTransform(selectionOverlayRef.current, preview, angle)

    const live3d = faceDrag3dRef.current
    if (objectId && live3d) {
      const rotated = rotateUvSnapshot(live3d.starts, angle, {
        u: preview.pivotU,
        v: preview.pivotV,
      })
      writeUvLive3dPool(live3d, rotated)
      scheduleUvDraft(objectId, live3d.pool)
    }
    lastIslandRotRef.current = Math.round((angle * 180) / Math.PI)
    return angle
  }

  const applyFaceScaleAtPointer = (
    clientX: number,
    clientY: number,
    ctrlKey: boolean,
    drag: NonNullable<typeof dragRef.current>
  ): { scaleU: number; scaleV: number } | null => {
    const preview = faceScalePreviewRef.current
    if (
      !faceDragCssLiveRef.current ||
      !preview ||
      !drag.startBounds ||
      !drag.resizeHandle ||
      !drag.pivotUv ||
      !drag.startUvs ||
      !drag.uvIndices
    ) {
      return null
    }
    const px = screenToUvPixel(clientX, clientY)
    const currUv = pixelToUv(px.x, px.y, texW, texH)
    let [scaleU, scaleV] = getScaleFromHandle(drag.startBounds, drag.resizeHandle, currUv)
    if (ctrlKey) {
      scaleU = Math.round(scaleU / 0.1) * 0.1
      scaleV = Math.round(scaleV / 0.1) * 0.1
    }
    applyFaceScaleOverlayTransform(selectionOverlayRef.current, preview, scaleU, scaleV)

    const live3d = faceDrag3dRef.current
    if (objectId && live3d) {
      const scaled = scaleUvSnapshot(live3d.starts, scaleU, scaleV, drag.pivotUv)
      writeUvLive3dPool(live3d, scaled)
      scheduleUvDraft(objectId, live3d.pool)
    }
    return { scaleU, scaleV }
  }

  const applyHandleDragAtPointer = (
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
    const updates = drag.uvIndices.map((ui, idx) => {
      const base = drag.startUvs![idx]
      const snapped = applySnap(base.u + du, base.v + dv, ctrlKey, 'point', {
        x: px.x,
        y: px.y,
      })
      return { uvIndex: ui, u: snapped.u, v: snapped.v }
    })
    // Freeze atlas: draft + overlay repaint + live 3D (Blockbench-style hot path).
    applyUvDraft(updates, false)
    if (liveOverlayModeRef.current === 'repaint') {
      paintSelectionOverlay({ pose: 'draft' })
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) {
      updateHoverAt(e.clientX, e.clientY)
      return
    }
    e.preventDefault()

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
        zoom: getViewPanZoom().zoom,
      }
      applyCamera()
      syncScrollThumbsFromView(liveViewRef.current)
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
      applyHandleDragAtPointer(e.clientX, e.clientY, e.ctrlKey, active)
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
      applyFaceScaleAtPointer(e.clientX, e.clientY, e.ctrlKey, active)
      return
    }

    if (
      active.kind === 'faceRotate' &&
      active.uvIndices &&
      active.startUvs &&
      active.pivotUv &&
      active.startAngle !== undefined
    ) {
      applyFaceRotateAtPointer(e.clientX, e.clientY, e.ctrlKey)
      return
    }

    if (active.kind === 'marquee' && active.startX !== undefined && active.startY !== undefined) {
      const px = screenToUvPixel(e.clientX, e.clientY)
      active.marquee = { x0: active.startX, y0: active.startY, x1: px.x, y1: px.y }
      paintMarqueeOverlay(active.marquee)
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
          if (polygonIntersectsMarquee(pts, d.marquee)) picked.push(fi)
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
    const preview = faceDragPreviewRef.current
    const rotatePreview = faceRotatePreviewRef.current
    const scalePreview = faceScalePreviewRef.current
    const commitFaceDragPreview =
      kind === 'faceDrag' &&
      faceDragCssLiveRef.current &&
      preview &&
      d?.uvIndices &&
      d.startUvs
    const commitFaceRotatePreview =
      kind === 'faceRotate' &&
      faceDragCssLiveRef.current &&
      rotatePreview &&
      d?.uvIndices &&
      d.startUvs &&
      d.pivotUv
    const commitFaceScalePreview =
      kind === 'faceScale' &&
      faceDragCssLiveRef.current &&
      scalePreview &&
      d?.uvIndices &&
      d.startUvs &&
      d.startBounds &&
      d.resizeHandle &&
      d.pivotUv

    if (commitFaceDragPreview && d.uvIndices && d.startUvs) {
      let { du, dv } = faceDragScreenToUvDelta(preview, e.clientX, e.clientY)
      const enabled = e.ctrlKey ? !uvEditorSnap : uvEditorSnap
      const mode: UvSnapMode = enabled ? uvEditorSnapMode : 'off'
      const snapCtx = snapCtxRef.current
      if (snapCtx && mode === 'grid') {
        const stepU = 1 / snapCtx.gridDivisions
        const stepV = 1 / snapCtx.gridDivisions
        du = Math.round(du / stepU) * stepU
        dv = Math.round(dv / stepV) * stepV
      }
      const updates = d.uvIndices.map((ui, idx) => {
        const base = d.startUvs![idx]
        return { uvIndex: ui, u: base.u + du, v: base.v + dv }
      })
      applyUvDraft(updates, false)
    } else if (commitFaceRotatePreview && d.uvIndices && d.startUvs && d.pivotUv) {
      const px = screenToUvPixel(e.clientX, e.clientY)
      let angle = faceRotateAngleFromUv(rotatePreview, pixelToUv(px.x, px.y, texW, texH))
      if (e.ctrlKey) {
        const step = (15 * Math.PI) / 180
        angle = Math.round(angle / step) * step
      }
      const rotated = rotateUvSnapshot(d.startUvs, angle, d.pivotUv)
      const updates = d.uvIndices.map((ui, idx) => {
        const uv = rotated[idx]!
        return { uvIndex: ui, u: uv.u, v: uv.v }
      })
      applyUvDraft(updates, false)
      lastIslandRotRef.current = Math.round((angle * 180) / Math.PI)
    } else if (
      commitFaceScalePreview &&
      d.uvIndices &&
      d.startUvs &&
      d.startBounds &&
      d.resizeHandle &&
      d.pivotUv
    ) {
      const px = screenToUvPixel(e.clientX, e.clientY)
      let [scaleU, scaleV] = getScaleFromHandle(
        d.startBounds,
        d.resizeHandle,
        pixelToUv(px.x, px.y, texW, texH)
      )
      if (e.ctrlKey) {
        scaleU = Math.round(scaleU / 0.1) * 0.1
        scaleV = Math.round(scaleV / 0.1) * 0.1
      }
      const scaled = scaleUvSnapshot(d.startUvs, scaleU, scaleV, d.pivotUv)
      const updates = d.uvIndices.map((ui, idx) => {
        const uv = scaled[idx]!
        return { uvIndex: ui, u: uv.u, v: uv.v }
      })
      applyUvDraft(updates, false)
    }

    dragRef.current = null
    clearSelectionOverlay()
    if (kind === 'marquee') paintHoverOverlay()
    if (kind === 'pan') {
      commitLiveView()
      applyCamera()
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
      redraw()
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
        // Selection was resolved on pointer-down. Repeating it here toggled a
        // Shift-clicked face/point twice and made additive selection appear broken.
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

    const flushPendingZoom = () => {
      zoomViewRafRef.current = null
      const pending = pendingZoomViewRef.current
      if (!pending) return
      pendingZoomViewRef.current = null
      // Keep liveView until the store matches — clearing first made redraws
      // briefly use the old pan and zoom away from the cursor.
      setUvEditorView(pending.zoom, pending.panX, pending.panY)
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (faceDragCssLiveRef.current) return
      const container = containerRef.current
      if (!container) return
      const rect = container.getBoundingClientRect()
      const screenX = e.clientX - rect.left
      const screenY = e.clientY - rect.top

      const base = liveViewRef.current ?? {
        zoom: useAppStore.getState().uvEditorZoom,
        panX: useAppStore.getState().uvEditorPanX,
        panY: useAppStore.getState().uvEditorPanY,
      }

      const next = uvEditorWheelZoom(base, screenX, screenY, e.deltaY, MIN_ZOOM, MAX_ZOOM)
      liveViewRef.current = next
      pendingZoomViewRef.current = next
      applyCamera()
      scheduleRedraw()
      if (zoomViewRafRef.current === null) {
        zoomViewRafRef.current = requestAnimationFrame(flushPendingZoom)
      }
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('wheel', onWheel)
      if (zoomViewRafRef.current !== null) {
        cancelAnimationFrame(zoomViewRafRef.current)
        zoomViewRafRef.current = null
      }
      const pending = pendingZoomViewRef.current
      if (pending) {
        pendingZoomViewRef.current = null
        setUvEditorView(pending.zoom, pending.panX, pending.panY)
      }
    }
  }, [uvEditorOpen, setUvEditorView, scheduleRedraw, applyCamera])

  useEffect(() => {
    // Drop live camera once the store has caught up (after wheel coalescing).
    const live = liveViewRef.current
    if (
      live &&
      Math.abs(live.zoom - zoom) < 1e-6 &&
      Math.abs(live.panX - pan.x) < 1e-6 &&
      Math.abs(live.panY - pan.y) < 1e-6
    ) {
      liveViewRef.current = null
    }
  }, [pan.x, pan.y, zoom])

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
          resetDraftPreview()
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
    resetDraftPreview,
    getUvs,
    setUvEditorSelectedPoints,
  ])

  const runUnwrap = useCallback(
    (method: UvUnwrapMethod) => {
      resetDraftPreview()
      unwrapSelectedUvFaces(method)
    },
    [resetDraftPreview, unwrapSelectedUvFaces]
  )

  const onImport = async () => {
    if (!objectId) return
    const file = await pickOpenFile({
      title: 'Import texture',
      filters: IMAGE_IMPORT_FILTERS,
    })
    if (file) await loadObjectTexture(objectId, file)
  }

  const zoomCanvasFromCenter = (direction: 'in' | 'out') => {
    const container = containerRef.current
    if (!container) return
    const current = getViewPanZoom()
    const next = uvEditorWheelZoom(
      current,
      container.clientWidth / 2,
      container.clientHeight / 2,
      direction === 'in' ? -120 : 120,
      MIN_ZOOM,
      MAX_ZOOM
    )
    liveViewRef.current = null
    commitView(next)
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file?.type.startsWith('image/') && objectId) void loadObjectTexture(objectId, file)
  }

  const textureWrap = obj?.material?.textureWrap ?? 'clamp'
  const cycleTextureWrap = () => {
    if (!objectId || !obj) return
    const next = textureWrap === 'clamp' ? 'repeat' : textureWrap === 'repeat' ? 'mirror' : 'clamp'
    updateObject(objectId, {
      material: { ...obj.material!, textureWrap: next },
    })
    if (next !== 'clamp') setUvEditorTilePreview(true)
  }

  const setTextureTransform = (patch: {
    repeat?: [number, number]
    offset?: [number, number]
    rotation?: number
    wrap?: 'clamp' | 'repeat' | 'mirror'
  }) => {
    if (!objectId || !obj) return
    updateObject(objectId, {
      material: {
        ...obj.material!,
        textureWrap: patch.wrap ?? (patch.repeat ? 'repeat' : obj.material?.textureWrap ?? 'clamp'),
        textureRepeat: patch.repeat ?? obj.material?.textureRepeat ?? [1, 1],
        textureOffset: patch.offset ?? obj.material?.textureOffset ?? [0, 0],
        textureRotation: patch.rotation ?? obj.material?.textureRotation ?? 0,
      },
    })
    if ((patch.wrap ?? obj.material?.textureWrap) !== 'clamp' || patch.repeat) {
      setUvEditorTilePreview(true)
    }
  }

  const beginImageLayerGesture = (
    event: React.PointerEvent,
    kind: 'move' | 'resize'
  ) => {
    if (!objectId || !obj || !imageLayerEdit) return
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const startY = event.clientY
    const startRepeat = [...(obj.material?.textureRepeat ?? [1, 1])] as [number, number]
    const startOffset = [...(obj.material?.textureOffset ?? [0, 0])] as [number, number]
    const startUvs = ensured?.uvs.map((uv) => ({ ...uv })) ?? []
    const view = getViewPanZoom()
    captureUndoPoint('Edit image layer')

    const onMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startX
      const dy = moveEvent.clientY - startY
      if (kind === 'move') {
        setTextureTransform({
          offset: [
            startOffset[0] + dx / Math.max(1, texW * view.zoom),
            startOffset[1] - dy / Math.max(1, texH * view.zoom),
          ],
        })
        return
      }

      const startWidth = Math.max(20, (texW * view.zoom) / startRepeat[0])
      const startHeight = Math.max(20, (texH * view.zoom) / startRepeat[1])
      const scaleX = Math.max(0.05, (startWidth + dx) / startWidth)
      const scaleY = Math.max(0.05, (startHeight + dy) / startHeight)
      const nextRepeat: [number, number] = [
        Math.max(0.01, startRepeat[0] / scaleX),
        Math.max(0.01, startRepeat[1] / scaleY),
      ]
      setTextureTransform({ repeat: nextRepeat })

      if (autoResizeUvsWithImage && startUvs.length > 0) {
        const updates = startUvs.map((uv, uvIndex) => ({
          uvIndex,
          u: 0.5 + (uv.u - 0.5) * scaleX,
          v: 0.5 + (uv.v - 0.5) * scaleY,
        }))
        setObjectUvPoints(objectId, updates, false)
      }
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      replaceHistoryHead('Edit image layer')
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
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

  // Committed UV pool identity changes on unwrap / island edits — drop any stale draft.
  useEffect(() => {
    draftUvsRef.current = null
    pendingTopologyRef.current = null
  }, [obj?.uvs, obj?.faceUvIndices])

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

  const beginWorkspaceResize = (event: React.PointerEvent) => {
    const workspaceEl = workspaceRef.current
    if (!workspaceEl) return
    event.preventDefault()
    const update = (clientX: number) => {
      const rect = workspaceEl.getBoundingClientRect()
      const ratio = Math.max(0.34, Math.min(0.72, (clientX - rect.left) / Math.max(1, rect.width)))
      workspaceEl.style.setProperty('--uv-workspace-split', `${ratio * 100}%`)
    }
    const onMove = (moveEvent: PointerEvent) => update(moveEvent.clientX)
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  if (!uvEditorOpen) return null

  const editor = (
      <div
        className={workspace ? 'uv-editor uv-editor-left' : 'uv-editor'}
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
          showUvPaintOverlay={showUvPaintOverlay}
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
          onUnwrap={runUnwrap}
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
          onSetShowUvPaintOverlay={setShowUvPaintOverlay}
          onSetGridDivisions={setUvEditorGridDivisions}
          onSetTextureTransform={setTextureTransform}
          onSelectConnected={selectConnectedIsland}
          canSelectConnected={uvEditorMode === 'faces' && uvEditorSelectedFaces.length > 0}
          imageLayerEdit={imageLayerEdit}
          autoResizeUvsWithImage={autoResizeUvsWithImage}
          onSetImageLayerEdit={setImageLayerEdit}
          onSetAutoResizeUvsWithImage={setAutoResizeUvsWithImage}
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
              {' · Shift-click multi-select · Ctrl-drag box · Scroll zoom · Middle drag pan · F frame'}
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
              const prev = hoverRef.current
              hoverRef.current = { face: null, point: null, cursor: 'crosshair' }
              setHoverCursor('crosshair')
              if (prev.face !== null || prev.point !== null) paintHoverOverlay()
            }}
            onAuxClick={(e) => e.preventDefault()}
          >
            <div className="uv-canvas-nav" onPointerDown={(event) => event.stopPropagation()}>
              <button type="button" onClick={() => zoomCanvasFromCenter('out')} aria-label="Zoom out">−</button>
              <span>{Math.round(zoom * 100)}%</span>
              <button type="button" onClick={() => zoomCanvasFromCenter('in')} aria-label="Zoom in">+</button>
              <button type="button" onClick={frameSelection}>Frame</button>
              <button type="button" onClick={fitCanvasToCamera}>Fit canvas</button>
              <button
                type="button"
                className={textureWrap !== 'clamp' ? 'active' : ''}
                onClick={cycleTextureWrap}
                title="Texture edge behavior: Clamp → Repeat → Mirror"
              >
                {textureWrap === 'clamp' ? 'Clamp' : textureWrap === 'repeat' ? 'Repeat' : 'Mirror'}
              </button>
            </div>
            <div ref={viewLayerRef} className="uv-editor-camera">
              <canvas ref={canvasRef} className="uv-editor-canvas" />
              <canvas ref={selectionOverlayRef} className="uv-editor-selection-overlay" aria-hidden />
            </div>
            <canvas ref={screenOverlayRef} className="uv-editor-screen-overlay" aria-hidden />
            {imageLayerEdit && obj && activeTextureId && (
              <div
                className="uv-image-layer-frame"
                style={{
                  left: `${pan.x - (obj.material?.textureOffset?.[0] ?? 0) * texW * zoom}px`,
                  top: `${pan.y + (obj.material?.textureOffset?.[1] ?? 0) * texH * zoom}px`,
                  width: `${Math.max(24, texW * zoom / Math.max(0.01, obj.material?.textureRepeat?.[0] ?? 1))}px`,
                  height: `${Math.max(24, texH * zoom / Math.max(0.01, obj.material?.textureRepeat?.[1] ?? 1))}px`,
                  transform: `rotate(${obj.material?.textureRotation ?? 0}deg)`,
                }}
                onPointerDown={(event) => beginImageLayerGesture(event, 'move')}
              >
                <span>IMAGE LAYER</span>
                <button
                  type="button"
                  className="uv-image-layer-resize"
                  title="Drag to resize image layer"
                  onPointerDown={(event) => beginImageLayerGesture(event, 'resize')}
                />
              </div>
            )}
            {!obj && <div className="uv-editor-empty">Select an object to edit UVs</div>}

            {showScrollH && (
              <div
                className="uv-scrollbar uv-scrollbar-horizontal"
                onPointerDown={handleScrollHTrackDown}
                style={{
                  position: 'absolute',
                  left: '2px',
                  bottom: '2px',
                  width: `${trackW}px`,
                  height: '10px',
                  borderRadius: '4px',
                  zIndex: 20,
                  cursor: 'pointer',
                  pointerEvents: 'auto',
                  touchAction: 'none',
                }}
              >
                <div
                  ref={scrollThumbHRef}
                  className="uv-scrollbar-thumb"
                  onPointerDown={handleScrollHThumbDown}
                  style={{
                    position: 'absolute',
                    left: `${thumbX}px`,
                    top: '2px',
                    width: `${thumbW}px`,
                    height: '6px',
                    borderRadius: '3px',
                    cursor: 'grab',
                    pointerEvents: 'auto',
                    touchAction: 'none',
                  }}
                />
              </div>
            )}

            {showScrollV && (
              <div
                className="uv-scrollbar uv-scrollbar-vertical"
                onPointerDown={handleScrollVTrackDown}
                style={{
                  position: 'absolute',
                  right: '2px',
                  top: '2px',
                  width: '10px',
                  height: `${trackH}px`,
                  borderRadius: '4px',
                  zIndex: 20,
                  cursor: 'pointer',
                  pointerEvents: 'auto',
                  touchAction: 'none',
                }}
              >
                <div
                  ref={scrollThumbVRef}
                  className="uv-scrollbar-thumb"
                  onPointerDown={handleScrollVThumbDown}
                  style={{
                    position: 'absolute',
                    top: `${thumbY}px`,
                    left: '2px',
                    width: '6px',
                    height: `${thumbHSize}px`,
                    borderRadius: '3px',
                    cursor: 'grab',
                    pointerEvents: 'auto',
                    touchAction: 'none',
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
  )

  if (workspace) {
    return (
      <section className="uv-workspace uv-workspace-dedicated">
        <header className="uv-workspace-header">
          <div>
            <strong>UV Workspace</strong>
            <span>{obj ? `Editing ${obj.name}` : 'Select an object to begin'}</span>
          </div>
          <button type="button" onClick={() => setUvEditorOpen(false)} title="Return to modeling">
            Back to Modeling
          </button>
        </header>
        <div ref={workspaceRef} className="uv-editor-workspace">
          {editor}
          <div
            className="uv-workspace-divider"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize UV and 3D preview panes"
            onPointerDown={beginWorkspaceResize}
          />
          <UvObjectPreview object={obj} />
        </div>
      </section>
    )
  }

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
      {editor}
    </FloatingPanel>
  )
}
