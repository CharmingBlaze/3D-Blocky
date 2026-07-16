import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { FloatingPanel } from './FloatingPanel'
import { SideButtonDropdown } from './SideButtonDropdown'
import { PixelToolIcon } from './PixelToolIcons'
import { PixelColorSection } from './material/PixelColorSection'
import { PixelLayersPanel } from './PixelLayersPanel'
import { useAppStore } from '../store/appStore'
import { compositeLayers } from '../pixel/compositeLayers'
import {
  getPixelCompositeCache,
  subscribePixelCompositeCache,
} from '../pixel/pixelCompositeCache'
import { syncPixelDocumentComposite } from '../pixel/pixelEditorSlice'
import type { PixelDirtyRect } from '../pixel/pixelDirtyRect'
import type { PixelTool } from '../pixel/pixelTypes'
import { PIXEL_SIZE_PRESETS } from '../pixel/pixelTypes'
import { resolveEffectiveMaterial } from '../material/materials'
import { pickOpenFile } from '../io/fileDialogs'
import { IMAGE_IMPORT_FILTERS, PIXEL_PROJECT_FILTERS } from '../io/download'
import { listSceneTextures } from '../uv/sceneTextures'
import { constrainPixelShape } from '../pixel/uvPaint'
import { PIXEL_BRUSH_SHAPES, isPixelFreehandPaintTool, type PixelBrushShape } from '../pixel/pixelBrushTypes'
import { drawMarchingAnts, pointInPixelSelection } from '../pixel/pixelMarchingAnts'
import { pointerToDocumentPixel } from '../pixel/pixelCanvasCoordinates'
import { subscribeUvDraft, type UvDraftSnapshot } from '../uv/uvDraftRelay'
import { appConfirm } from '../ui/appConfirm'
import {
  clearUvPaintOverlayCaches,
  paintUvAtlasOverlay,
  resolveSelectedUvOverlayMesh,
} from '../uv/uvPaintOverlay'
import type { Uv2 } from '../uv/uvTypes'

/** Adobe-style tool groups for the floating toolbar. */
const TOOL_GROUPS: { id: PixelTool; label: string; title: string }[][] = [
  [
    { id: 'pencil', label: 'Pencil', title: 'Pixel pencil (P)' },
    { id: 'paintBrush', label: 'Brush', title: 'Paint brush (H)' },
    { id: 'eraser', label: 'Eraser', title: 'Eraser (E)' },
  ],
  [
    { id: 'line', label: 'Line', title: 'Line (L)' },
    { id: 'rectangle', label: 'Rect', title: 'Rectangle (R)' },
    { id: 'ellipse', label: 'Ellipse', title: 'Ellipse (O)' },
    { id: 'bucket', label: 'Bucket', title: 'Bucket fill (B)' },
  ],
  [
    { id: 'rectSelect', label: 'Select', title: 'Rectangle select (M) · Ctrl+drag anytime' },
    { id: 'eyedropper', label: 'Pick', title: 'Eyedropper (I)' },
  ],
]

function normalizeRect(x0: number, y0: number, x1: number, y1: number) {
  return {
    x0: Math.min(x0, x1),
    y0: Math.min(y0, y1),
    x1: Math.max(x0, x1),
    y1: Math.max(y0, y1),
  }
}

export function PixelEditorPanel() {
  const store = useAppStore(
    useShallow((s) => ({
      open: s.pixelEditorOpen,
      panel: s.pixelEditorPanel,
      docId: s.pixelEditorDocId,
      tool: s.pixelEditorTool,
      brushSize: s.pixelEditorBrushSize,
      brushShape: s.pixelEditorBrushShape,
      brushHardness: s.pixelEditorBrushHardness,
      brushOpacity: s.pixelEditorBrushOpacity,
      brushFlow: s.pixelEditorBrushFlow,
      pixelPerfect: s.pixelEditorPixelPerfect,
      symH: s.pixelEditorSymmetryH,
      symV: s.pixelEditorSymmetryV,
      paintOnModel: s.pixelEditorPaintOnModel,
      showUvOverlay: s.pixelEditorShowUvOverlay,
      shapeFilled: s.pixelEditorShapeFilled,
      fillTolerance: s.pixelEditorFillTolerance,
      toolbarPos: s.pixelEditorToolbarPosition,
      selection: s.pixelEditorSelection,
      zoom: s.pixelEditorZoom,
      panX: s.pixelEditorPanX,
      panY: s.pixelEditorPanY,
      selectedObjectId: s.selectedObjectId,
      selectionObjectIds: s.selectionObjectIds,
      setPanel: s.setPixelEditorPanel,
      toggle: s.togglePixelEditor,
      setTool: s.setPixelEditorTool,
      setBrushSize: s.setPixelEditorBrushSize,
      setBrushShape: s.setPixelEditorBrushShape,
      setBrushHardness: s.setPixelEditorBrushHardness,
      setBrushOpacity: s.setPixelEditorBrushOpacity,
      setBrushFlow: s.setPixelEditorBrushFlow,
      setPixelPerfect: s.setPixelEditorPixelPerfect,
      setSymH: s.setPixelEditorSymmetryH,
      setSymV: s.setPixelEditorSymmetryV,
      setPaintOnModel: s.setPixelEditorPaintOnModel,
      setShowUvOverlay: s.setPixelEditorShowUvOverlay,
      setShapeFilled: s.setPixelEditorShapeFilled,
      setFillTolerance: s.setPixelEditorFillTolerance,
      setToolbarPos: s.setPixelEditorToolbarPosition,
      setSelection: s.setPixelEditorSelection,
      setView: s.setPixelEditorView,
      createNew: s.createNewPixelDocument,
      resizeDoc: s.resizeOpenPixelDocument,
      importImage: s.importPixelImage,
      saveDoc: s.savePixelDocument,
      exportPng: s.exportPixelDocumentPng,
      exportProject: s.exportPixelDocumentProject,
      importProject: s.importPixelDocumentProject,
      selectDocument: s.selectPixelEditorDocument,
      assignTexture: s.assignObjectTextureDocument,
      beginEdit: s.beginPixelEdit,
      commitEdit: s.commitPixelEdit,
      paintStroke: s.paintPixelStroke,
      paintShape: s.paintPixelShape,
      bucketFill: s.bucketFillPixel,
      sampleColor: s.samplePixelColor,
      commitColor: s.commitPixelEditorColor,
      setUvEditorOpen: s.setUvEditorOpen,
      resetPixelPaintUvLayout: s.resetPixelPaintUvLayout,
      clearMaterial: s.clearPixelEditorMaterial,
    }))
  )

  // Subscribe only to the open document — not the whole docs map (strokes mutate in place).
  const doc = useAppStore((s) => (s.pixelEditorDocId ? s.pixelDocuments[s.pixelEditorDocId] : null))
  const pixelDocListKey = useAppStore((s) =>
    Object.keys(s.pixelDocuments)
      .map((id) => {
        const d = s.pixelDocuments[id]!
        return `${id}:${d.width}x${d.height}`
      })
      .sort()
      .join('|')
  )
  const objectTextures = useAppStore((s) => s.objectTextures)
  const sceneObjects = useAppStore((s) => s.objects)
  const sceneTextures = useMemo(() => {
    const { pixelDocuments } = useAppStore.getState()
    return listSceneTextures(pixelDocuments, objectTextures, sceneObjects)
  }, [pixelDocListKey, objectTextures, sceneObjects])
  const objectId = store.selectedObjectId ?? store.selectionObjectIds[0] ?? null
  const obj = useAppStore((s) => (objectId ? s.objects.find((o) => o.id === objectId) : null))
  const mat = obj ? resolveEffectiveMaterial(obj) : null
  const canPaintOnModel = Boolean(
    mat?.mode === 'texture' && store.docId && (mat.textureId ?? obj?.id) === store.docId
  )
  const meshSelectionFaces = useAppStore((s) =>
    s.meshSelection?.objectId && objectId && s.meshSelection.objectId === objectId
      ? s.meshSelection.faces
      : null
  )
  const uvEditorSelectedFaces = useAppStore((s) => s.uvEditorSelectedFaces)
  /** Committed UV pool identity — store replaces the array on unwrap / island edits. */
  const committedOverlayUvs = useAppStore((s) => {
    if (!store.showUvOverlay) return null
    return resolveSelectedUvOverlayMesh(s.objects, objectId)?.uvs ?? null
  })
  const committedOverlayFaceUvs = useAppStore((s) => {
    if (!store.showUvOverlay) return null
    return resolveSelectedUvOverlayMesh(s.objects, objectId)?.faceUvIndices ?? null
  })

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const canvasStackRef = useRef<HTMLDivElement>(null)
  const paintCanvasRectRef = useRef<DOMRect | null>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  /** Cached UV island draw — rebuilt only on UV/selection/mesh change, not every ants tick. */
  const uvOverlayCacheRef = useRef<HTMLCanvasElement | null>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const uvDraftRef = useRef<UvDraftSnapshot | null>(null)
  const uvOverlayObjectIdRef = useRef<string | null>(null)
  const overlayDirtyRafRef = useRef(0)
  const [customW, setCustomW] = useState(64)
  const [customH, setCustomH] = useState(64)
  const [fileMessage, setFileMessage] = useState<string | null>(null)
  const [spacePan, setSpacePan] = useState(false)
  const [shapePreview, setShapePreview] = useState<{
    x0: number
    y0: number
    x1: number
    y1: number
  } | null>(null)
  const strokeRef = useRef<{ x: number; y: number }[]>([])
  /** Index into strokeRef of the last point already sent to the live paint path. */
  const strokePaintFromRef = useRef(0)
  const dragRef = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const marqueeSelectRef = useRef(false)
  const [marqueeSelect, setMarqueeSelect] = useState(false)
  const antsOffsetRef = useRef(0)
  const antsRafRef = useRef(0)
  const panDragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null)
  const toolbarDragRef = useRef<{
    startX: number
    startY: number
    origX: number
    origY: number
    maxX: number
    maxY: number
  } | null>(null)
  const editingRef = useRef(false)
  /** Recenter document in the viewport until the user pans. */
  const needsCenterRef = useRef(true)

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const drag = toolbarDragRef.current
      if (!drag) return
      const x = Math.max(0, Math.min(drag.maxX, drag.origX + event.clientX - drag.startX))
      const y = Math.max(0, Math.min(drag.maxY, drag.origY + event.clientY - drag.startY))
      store.setToolbarPos({ x, y })
    }
    const onEnd = () => {
      toolbarDragRef.current = null
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onEnd)
    window.addEventListener('pointercancel', onEnd)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onEnd)
      window.removeEventListener('pointercancel', onEnd)
    }
  }, [store.setToolbarPos])

  useEffect(() => {
    if (doc) {
      setCustomW(doc.width)
      setCustomH(doc.height)
    }
  }, [doc?.id, doc?.width, doc?.height])

  const screenToPixel = useCallback(
    (clientX: number, clientY: number, continuous = false) => {
      const canvasStack = canvasStackRef.current
      if (!canvasStack || !doc) return null
      const rect = paintCanvasRectRef.current ?? canvasStack.getBoundingClientRect()
      return pointerToDocumentPixel(
        clientX,
        clientY,
        rect,
        doc.width,
        doc.height,
        continuous
      )
    },
    [doc]
  )

  const canvasSizeRef = useRef({ w: 0, h: 0 })
  const imageDataRef = useRef<ImageData | null>(null)
  const imageDataPixelsRef = useRef<Uint8ClampedArray | null>(null)
  const docRef = useRef(doc)
  docRef.current = doc

  const paintCanvasPixels = useCallback(
    (
      pixels: Uint8ClampedArray,
      width: number,
      height: number,
      dirty: PixelDirtyRect | null = null
    ) => {
      const canvas = canvasRef.current
      if (!canvas) return
      if (canvasSizeRef.current.w !== width || canvasSizeRef.current.h !== height) {
        canvas.width = width
        canvas.height = height
        canvasSizeRef.current = { w: width, h: height }
        imageDataRef.current = null
        imageDataPixelsRef.current = null
      }
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      // Prefer wrapping the composite buffer so dirty putImageData skips a full copy.
      if (imageDataPixelsRef.current !== pixels || !imageDataRef.current) {
        imageDataRef.current = new ImageData(pixels, width, height)
        imageDataPixelsRef.current = pixels
      }
      const imageData = imageDataRef.current
      if (dirty && dirty.w > 0 && dirty.h > 0) {
        ctx.putImageData(imageData, 0, 0, dirty.x, dirty.y, dirty.w, dirty.h)
      } else {
        ctx.putImageData(imageData, 0, 0)
      }
    },
    []
  )

  // Shared composite cache: live strokes flatten immediately, then this subscriber
  // paints the 2D canvas so the stroke tracks the pointer (no RAF backlog).
  useEffect(() => {
    if (!store.open || !store.docId) return

    const drawFromCacheOrDoc = (dirty: PixelDirtyRect | null = null) => {
      const current = docRef.current
      if (!current) return
      const cached = getPixelCompositeCache(store.docId!)
      if (cached && cached.width === current.width && cached.height === current.height) {
        paintCanvasPixels(cached.pixels, current.width, current.height, dirty)
        return
      }
      // Seed the shared cache so the first live dab can dirty-rect instead of
      // uploading a mostly-empty GPU texture.
      const seeded = syncPixelDocumentComposite(
        { [current.id]: current },
        current.id,
        null
      )
      if (seeded) {
        paintCanvasPixels(seeded, current.width, current.height, null)
        return
      }
      paintCanvasPixels(compositeLayers(current), current.width, current.height, null)
    }

    drawFromCacheOrDoc(null)
    return subscribePixelCompositeCache(store.docId, drawFromCacheOrDoc)
  }, [store.open, store.docId, doc?.id, doc?.width, doc?.height, paintCanvasPixels])

  const rebuildUvOverlayCache = useCallback(() => {
    if (!store.showUvOverlay || !store.docId || !doc) {
      uvOverlayCacheRef.current = null
      return
    }
    const { objects } = useAppStore.getState()
    const mesh = resolveSelectedUvOverlayMesh(objects, objectId)
    if (!mesh) {
      uvOverlayCacheRef.current = null
      return
    }
    if (uvOverlayObjectIdRef.current && uvOverlayObjectIdRef.current !== mesh.id) {
      clearUvPaintOverlayCaches(uvOverlayObjectIdRef.current)
    }
    uvOverlayObjectIdRef.current = mesh.id

    let cache = uvOverlayCacheRef.current
    if (!cache || cache.width !== doc.width || cache.height !== doc.height) {
      cache = document.createElement('canvas')
      cache.width = doc.width
      cache.height = doc.height
      uvOverlayCacheRef.current = cache
    }
    const ctx = cache.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, doc.width, doc.height)

    const draft = uvDraftRef.current
    const uvs: readonly Uv2[] =
      draft && draft.objectId === mesh.id ? draft.uvs : mesh.uvs

    const selectedFaces =
      uvEditorSelectedFaces.length > 0
        ? uvEditorSelectedFaces
        : meshSelectionFaces && meshSelectionFaces.length > 0
          ? meshSelectionFaces
          : []

    paintUvAtlasOverlay({
      ctx,
      texW: doc.width,
      texH: doc.height,
      mesh,
      uvs,
      selectedFaces,
      // Outlines only — fills were the expensive path on dense meshes.
      drawFills: false,
    })
  }, [
    doc,
    store.showUvOverlay,
    store.docId,
    objectId,
    uvEditorSelectedFaces,
    meshSelectionFaces,
    committedOverlayUvs,
    committedOverlayFaceUvs,
  ])

  const redrawOverlay = useCallback(() => {
    const overlay = overlayRef.current
    if (!overlay || !doc) return
    if (overlay.width !== doc.width || overlay.height !== doc.height) {
      overlay.width = doc.width
      overlay.height = doc.height
    }
    const ctx = overlay.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, doc.width, doc.height)

    if (store.showUvOverlay) {
      const cache = uvOverlayCacheRef.current
      if (cache && cache.width === doc.width && cache.height === doc.height) {
        ctx.drawImage(cache, 0, 0)
      }
    }

    if (store.selection && !marqueeSelect) {
      const { x0, y0, x1, y1 } = store.selection
      drawMarchingAnts(ctx, x0, y0, x1, y1, store.zoom, antsOffsetRef.current)
    }

    if (shapePreview) {
      const { x0, y0, x1, y1 } = shapePreview
      const left = Math.min(x0, x1)
      const top = Math.min(y0, y1)
      const w = Math.abs(x1 - x0) + 1
      const h = Math.abs(y1 - y0) + 1

      if (marqueeSelect || store.tool === 'rectSelect') {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.18)'
        ctx.fillRect(0, 0, doc.width, doc.height)
        ctx.clearRect(left, top, w, h)
        drawMarchingAnts(ctx, left, top, left + w - 1, top + h - 1, store.zoom, antsOffsetRef.current)
      } else {
        ctx.strokeStyle = 'rgba(110, 203, 245, 0.95)'
        ctx.fillStyle = 'rgba(110, 203, 245, 0.2)'
        ctx.lineWidth = 1

        if (store.tool === 'line') {
          ctx.beginPath()
          ctx.moveTo(x0 + 0.5, y0 + 0.5)
          ctx.lineTo(x1 + 0.5, y1 + 0.5)
          ctx.stroke()
        } else if (store.tool === 'rectangle') {
          if (store.shapeFilled) ctx.fillRect(left, top, w, h)
          ctx.strokeRect(left + 0.5, top + 0.5, w - 1, h - 1)
        } else if (store.tool === 'ellipse') {
          const cx = (x0 + x1) / 2
          const cy = (y0 + y1) / 2
          const rx = Math.abs(x1 - x0) / 2
          const ry = Math.abs(y1 - y0) / 2
          ctx.beginPath()
          ctx.ellipse(cx + 0.5, cy + 0.5, Math.max(0.5, rx), Math.max(0.5, ry), 0, 0, Math.PI * 2)
          if (store.shapeFilled) ctx.fill()
          ctx.stroke()
        }
      }
    }
  }, [
    doc,
    shapePreview,
    store.selection,
    store.shapeFilled,
    store.tool,
    store.zoom,
    store.showUvOverlay,
    marqueeSelect,
  ])

  // Rebuild UV cache only when UV/selection topology changes — not on every ants frame.
  useEffect(() => {
    rebuildUvOverlayCache()
    redrawOverlay()
  }, [rebuildUvOverlayCache, redrawOverlay])

  // Live UV drafts (island drag in UV editor) — RAF-coalesced cache rebuild when overlay is on.
  useEffect(() => {
    if (!store.open || !store.showUvOverlay) {
      uvDraftRef.current = null
      return
    }
    return subscribeUvDraft((snapshot) => {
      uvDraftRef.current = snapshot
      if (overlayDirtyRafRef.current) return
      overlayDirtyRafRef.current = requestAnimationFrame(() => {
        overlayDirtyRafRef.current = 0
        rebuildUvOverlayCache()
        redrawOverlay()
      })
    })
  }, [store.open, store.showUvOverlay, rebuildUvOverlayCache, redrawOverlay])

  // Drop edge caches when overlay is toggled off, doc closes, or panel unmounts.
  useEffect(() => {
    if (!store.showUvOverlay || !store.open) {
      uvOverlayCacheRef.current = null
      if (uvOverlayObjectIdRef.current) {
        clearUvPaintOverlayCaches(uvOverlayObjectIdRef.current)
        uvOverlayObjectIdRef.current = null
      } else {
        clearUvPaintOverlayCaches()
      }
    }
    return () => {
      if (overlayDirtyRafRef.current) {
        cancelAnimationFrame(overlayDirtyRafRef.current)
        overlayDirtyRafRef.current = 0
      }
      uvOverlayCacheRef.current = null
      if (uvOverlayObjectIdRef.current) {
        clearUvPaintOverlayCaches(uvOverlayObjectIdRef.current)
        uvOverlayObjectIdRef.current = null
      }
    }
  }, [store.showUvOverlay, store.open, store.docId])

  // Animate marching ants while a selection (or live marquee) is visible.
  useEffect(() => {
    const active = Boolean(store.selection) || marqueeSelect
    if (!active || !store.open) {
      if (antsRafRef.current) {
        cancelAnimationFrame(antsRafRef.current)
        antsRafRef.current = 0
      }
      return
    }
    let last = performance.now()
    const tick = (now: number) => {
      const dt = now - last
      if (dt >= 32) {
        last = now
        antsOffsetRef.current = (antsOffsetRef.current + 1) % 64
        // Blit cached UV + redraw ants only — do not rebuild island geometry.
        redrawOverlay()
      }
      antsRafRef.current = requestAnimationFrame(tick)
    }
    antsRafRef.current = requestAnimationFrame(tick)
    return () => {
      if (antsRafRef.current) {
        cancelAnimationFrame(antsRafRef.current)
        antsRafRef.current = 0
      }
    }
  }, [store.selection, marqueeSelect, store.open, redrawOverlay])

  useEffect(() => {
    needsCenterRef.current = true
  }, [store.open, doc?.id, doc?.width, doc?.height, store.panel.minimized])

  const centerDocumentInViewport = useCallback(() => {
    const vp = viewportRef.current
    const current = docRef.current
    if (!vp || !current || vp.clientWidth < 8 || vp.clientHeight < 8) return false
    const { pixelEditorZoom, setPixelEditorView } = useAppStore.getState()
    const panX = Math.round((vp.clientWidth - current.width * pixelEditorZoom) / 2)
    const panY = Math.round((vp.clientHeight - current.height * pixelEditorZoom) / 2)
    setPixelEditorView(pixelEditorZoom, panX, panY)
    return true
  }, [])

  useEffect(() => {
    const vp = viewportRef.current
    if (!vp || !store.open || store.panel.minimized) return

    const tryCenter = () => {
      if (!needsCenterRef.current) return
      if (centerDocumentInViewport()) needsCenterRef.current = false
    }

    tryCenter()
    const ro = new ResizeObserver(tryCenter)
    ro.observe(vp)
    return () => ro.disconnect()
  }, [store.open, store.panel.minimized, doc?.id, doc?.width, doc?.height, centerDocumentInViewport])

  useEffect(() => {
    const el = viewportRef.current
    if (!el || !store.open) return

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const { pixelEditorZoom, pixelEditorPanX, pixelEditorPanY, setPixelEditorView } =
        useAppStore.getState()
      const delta = e.deltaY > 0 ? -1 : 1
      const next = Math.max(1, Math.min(64, pixelEditorZoom + delta))
      if (next === pixelEditorZoom) return
      const rect = el.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const scale = next / pixelEditorZoom
      const panX = mx - (mx - pixelEditorPanX) * scale
      const panY = my - (my - pixelEditorPanY) * scale
      needsCenterRef.current = false
      setPixelEditorView(next, panX, panY)
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [store.open, store.panel.minimized, doc?.id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpacePan(e.type === 'keydown')
      if (e.type !== 'keydown' || e.repeat) return
      if (!useAppStore.getState().pixelEditorOpen) return
      const target = e.target
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return
      }

      const s = useAppStore.getState()
      const mod = e.ctrlKey || e.metaKey

      if (mod && e.key.toLowerCase() === 'c') {
        e.preventDefault()
        s.copyPixelSelection()
        return
      }
      if (mod && e.key.toLowerCase() === 'x') {
        e.preventDefault()
        s.cutPixelSelection()
        return
      }
      if (mod && e.key.toLowerCase() === 'v') {
        e.preventDefault()
        s.pastePixelClipboard()
        return
      }
      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        s.setPixelEditorSelection(null)
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (s.pixelEditorSelection) {
          e.preventDefault()
          s.deletePixelSelection()
        }
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        s.setPixelEditorSelection(null)
        return
      }

      if (mod) return
      const { setPixelEditorTool } = s
      const key = e.key.toLowerCase()
      if (key === 'p') setPixelEditorTool('pencil')
      else if (key === 'h') setPixelEditorTool('paintBrush')
      else if (key === 'e') setPixelEditorTool('eraser')
      else if (key === 'i') setPixelEditorTool('eyedropper')
      else if (key === 'b') setPixelEditorTool('bucket')
      else if (key === 'l') setPixelEditorTool('line')
      else if (key === 'r') setPixelEditorTool('rectangle')
      else if (key === 'o') setPixelEditorTool('ellipse')
      else if (key === 'm') setPixelEditorTool('rectSelect')
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
    }
  }, [])

  const finishStroke = useCallback(() => {
    const pts = strokeRef.current
    const from = strokePaintFromRef.current
    if (pts.length > from) {
      const segment = pts.slice(from)
      const tool = store.tool === 'eraser' ? 'eraser' : 'pencil'
      store.paintStroke(segment, tool)
      strokePaintFromRef.current = pts.length - 1
    }
    strokeRef.current = []
    paintCanvasRectRef.current = null
    strokePaintFromRef.current = 0
    dragRef.current = null
    setShapePreview(null)
    if (editingRef.current) {
      store.commitEdit()
      editingRef.current = false
    }
  }, [store])

  const flushStrokePaint = useCallback(() => {
    const pts = strokeRef.current
    const from = strokePaintFromRef.current
    if (pts.length <= from) return
    const segment = pts.slice(from)
    const tool = store.tool === 'eraser' ? 'eraser' : 'pencil'
    store.paintStroke(segment, tool)
    strokePaintFromRef.current = pts.length - 1
  }, [store])

  const constrainShape = useCallback(
    (x0: number, y0: number, x1: number, y1: number, shiftKey: boolean) => {
      if (store.tool !== 'line' && store.tool !== 'rectangle' && store.tool !== 'ellipse') {
        return { x0, y0, x1, y1 }
      }
      return constrainPixelShape(store.tool, x0, y0, x1, y1, shiftKey)
    },
    [store.tool]
  )

  const constrainMarquee = useCallback(
    (x0: number, y0: number, x1: number, y1: number, shiftKey: boolean) => {
      if (!shiftKey) return { x0, y0, x1, y1 }
      const dx = x1 - x0
      const dy = y1 - y0
      const side = Math.max(Math.abs(dx), Math.abs(dy))
      const sx = dx < 0 ? -1 : 1
      const sy = dy < 0 ? -1 : 1
      return { x0, y0, x1: x0 + sx * side, y1: y0 + sy * side }
    },
    []
  )

  const onPointerDown = (e: React.PointerEvent) => {
    if (spacePan || e.button === 1) {
      needsCenterRef.current = false
      panDragRef.current = { x: e.clientX, y: e.clientY, panX: store.panX, panY: store.panY }
      return
    }
    // Freeze the displayed canvas bounds for the gesture. Reading layout on every
    // pointermove caused severe stalls on large documents and busy scenes.
    paintCanvasRectRef.current = canvasStackRef.current?.getBoundingClientRect() ?? null
    const p = screenToPixel(e.clientX, e.clientY)
    if (!p || !doc) return
    e.currentTarget.setPointerCapture(e.pointerId)

    // Ctrl/Cmd + left-drag: marquee selection from any tool
    if ((e.ctrlKey || e.metaKey) && e.button === 0) {
      marqueeSelectRef.current = true
      setMarqueeSelect(true)
      dragRef.current = { x0: p.x, y0: p.y, x1: p.x, y1: p.y }
      setShapePreview({ x0: p.x, y0: p.y, x1: p.x, y1: p.y })
      return
    }

    // Click outside the selection dismisses it (Adobe-style deselect).
    if (
      store.selection &&
      e.button === 0 &&
      !pointInPixelSelection(p.x, p.y, store.selection)
    ) {
      store.setSelection(null)
      // Select tool: click-outside only clears; don't start a 1px selection.
      if (store.tool === 'rectSelect') return
    }

    if (store.tool === 'eyedropper') {
      const c = store.sampleColor(p.x, p.y)
      if (c) store.commitColor(c)
      return
    }
    if (store.tool === 'bucket') {
      store.bucketFill(p.x, p.y, e.altKey)
      store.commitEdit()
      return
    }
    if (store.tool === 'rectSelect') {
      marqueeSelectRef.current = true
      setMarqueeSelect(true)
      dragRef.current = { x0: p.x, y0: p.y, x1: p.x, y1: p.y }
      setShapePreview({ x0: p.x, y0: p.y, x1: p.x, y1: p.y })
      return
    }
    if (store.tool === 'line' || store.tool === 'rectangle' || store.tool === 'ellipse') {
      store.beginEdit()
      editingRef.current = true
      dragRef.current = { x0: p.x, y0: p.y, x1: p.x, y1: p.y }
      setShapePreview({ x0: p.x, y0: p.y, x1: p.x, y1: p.y })
      return
    }
    if (isPixelFreehandPaintTool(store.tool)) {
      const continuous = store.tool === 'paintBrush'
      const paintPt = continuous
        ? screenToPixel(e.clientX, e.clientY, true) ?? p
        : p
      store.beginEdit()
      editingRef.current = true
      strokeRef.current = [paintPt]
      strokePaintFromRef.current = 0
      store.paintStroke([paintPt], store.tool === 'eraser' ? 'eraser' : 'pencil')
    }
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (panDragRef.current) {
      const d = panDragRef.current
      store.setView(
        store.zoom,
        d.panX + (e.clientX - d.x),
        d.panY + (e.clientY - d.y)
      )
      return
    }
    if (dragRef.current) {
      const p = screenToPixel(e.clientX, e.clientY)
      if (!p) return
      const next =
        marqueeSelectRef.current || store.tool === 'rectSelect'
          ? constrainMarquee(
              dragRef.current.x0,
              dragRef.current.y0,
              p.x,
              p.y,
              e.shiftKey
            )
          : constrainShape(
              dragRef.current.x0,
              dragRef.current.y0,
              p.x,
              p.y,
              e.shiftKey
            )
      dragRef.current = next
      setShapePreview(dragRef.current)
      return
    }
    if (strokeRef.current.length > 0 && isPixelFreehandPaintTool(store.tool)) {
      const continuous = store.tool === 'paintBrush'
      const native = e.nativeEvent
      const samples =
        typeof native.getCoalescedEvents === 'function'
          ? native.getCoalescedEvents()
          : [native]
      // Some browsers return an empty coalesced list, and some omit the newest
      // event. Always retain the actual React pointer sample.
      const inputSamples = samples.length > 0 ? [...samples] : [native]
      const newest = inputSamples[inputSamples.length - 1]
      if (!newest || newest.clientX !== native.clientX || newest.clientY !== native.clientY) {
        inputSamples.push(native)
      }
      for (const sample of inputSamples) {
        const p = screenToPixel(sample.clientX, sample.clientY, continuous)
        if (!p) continue
        const last = strokeRef.current[strokeRef.current.length - 1]!
        const moved = continuous
          ? Math.hypot(p.x - last.x, p.y - last.y) >= 0.2
          : last.x !== p.x || last.y !== p.y
        if (moved) strokeRef.current.push(p)
      }
      // Paint the small accumulated segment now. Canvas compositing is dirty-rect
      // only; the separate GPU scheduler still merges expensive 3D refreshes.
      flushStrokePaint()
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    if (panDragRef.current) {
      panDragRef.current = null
      paintCanvasRectRef.current = null
      return
    }
    if (dragRef.current && doc) {
      const d = dragRef.current
      const isMarquee = marqueeSelectRef.current || store.tool === 'rectSelect'
      const { x0, y0, x1, y1 } = isMarquee
        ? constrainMarquee(d.x0, d.y0, d.x1, d.y1, e.shiftKey)
        : constrainShape(d.x0, d.y0, d.x1, d.y1, e.shiftKey)

      if (isMarquee) {
        const rect = normalizeRect(x0, y0, x1, y1)
        const tiny = rect.x0 === rect.x1 && rect.y0 === rect.y1
        // Click without drag (or tiny box) clears — easy dismiss.
        if (tiny) store.setSelection(null)
        else store.setSelection({ kind: 'rect', ...rect })
      } else {
        store.paintShape(store.tool as 'line' | 'rectangle' | 'ellipse', x0, y0, x1, y1)
      }

      dragRef.current = null
      marqueeSelectRef.current = false
      setMarqueeSelect(false)
      setShapePreview(null)
      if (!isMarquee && editingRef.current) {
        store.commitEdit()
        editingRef.current = false
      }
      paintCanvasRectRef.current = null
      return
    }
    finishStroke()
  }

  const handleFileMenu = async (action: string) => {
    setFileMessage(null)
    try {
      if (action === 'new' || action === 'new-custom') {
        store.createNew(customW, customH, objectId ?? undefined)
        return
      }
      if (action === 'import') {
        const file = await pickOpenFile({
          title: 'Import image',
          filters: IMAGE_IMPORT_FILTERS,
        })
        if (file) await store.importImage(file, 'new')
        return
      }
      if (action === 'import-layer') {
        const file = await pickOpenFile({
          title: 'Import image as layer',
          filters: IMAGE_IMPORT_FILTERS,
        })
        if (file) await store.importImage(file, 'layer')
        return
      }
      if (action === 'save') {
        await store.saveDoc()
        return
      }
      if (action === 'export-png') {
        await store.exportPng()
        return
      }
      if (action === 'export-project') {
        await store.exportProject()
        return
      }
      if (action === 'import-project') {
        const file = await pickOpenFile({
          title: 'Import pixel texture project',
          filters: PIXEL_PROJECT_FILTERS,
        })
        if (file) await store.importProject(file)
        return
      }
      if (action === 'resize') {
        if (doc) store.resizeDoc(customW, customH)
        else store.createNew(customW, customH, objectId ?? undefined)
        return
      }
      if (action.startsWith('preset-')) {
        const preset = PIXEL_SIZE_PRESETS.find((p) => p.label === action.replace(/^preset-/, ''))
        if (!preset) return
        setCustomW(preset.width)
        setCustomH(preset.height)
        store.createNew(preset.width, preset.height, objectId ?? undefined)
      }
    } catch (err) {
      setFileMessage(err instanceof Error ? err.message : 'File operation failed.')
    }
  }

  const newDocOptions = useMemo(
    () => [
      { value: 'new', label: 'Blank material' },
      ...PIXEL_SIZE_PRESETS.map((p) => ({
        value: `preset-${p.label}`,
        label: `Clear Material · ${p.label}`,
      })),
      { value: 'new-custom', label: `Clear Material · Custom ${customW}×${customH}` },
    ],
    [customW, customH]
  )

  const importOptions = useMemo(
    () => [
      { value: 'import', label: 'Image as new texture…' },
      { value: 'import-layer', label: 'Image as layer…', disabled: !doc },
      { value: 'import-project', label: 'Project file…' },
    ],
    [doc]
  )

  const exportOptions = useMemo(
    () => [
      { value: 'export-png', label: 'PNG image…' },
      { value: 'export-project', label: 'Project file…' },
      { value: 'save', label: 'Save project as…' },
    ],
    []
  )

  if (!store.open) return null

  const canvasStyle = doc
    ? {
        width: doc.width * store.zoom,
        height: doc.height * store.zoom,
        transform: `translate(${store.panX}px, ${store.panY}px)`,
        imageRendering: 'pixelated' as const,
      }
    : undefined

  const paintOnModelHint =
    !canPaintOnModel && store.paintOnModel ? (
      <p className="px-hint px-hint-warn">Set material to Texture and unwrap UVs to paint on the model.</p>
    ) : canPaintOnModel && store.paintOnModel ? (
      <p className="px-hint">Painting on the 3D model — use the viewports.</p>
    ) : null

  const renderFileSection = () => (
    <section className="px-sidebar-section">
      <h3 className="px-sidebar-heading">File</h3>
      <label className="px-sidebar-field">
        <span>Texture</span>
        <select
          className="shape-kind-select side-select"
          value={store.docId ?? ''}
          onChange={(e) => {
            const id = e.target.value
            if (!id) return
            if (objectId) store.assignTexture(objectId, id)
            else store.selectDocument(id)
          }}
          disabled={sceneTextures.length === 0}
        >
          {sceneTextures.length === 0 ? (
            <option value="">No textures</option>
          ) : (
            <>
              {!store.docId && <option value="">Select…</option>}
              {sceneTextures.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </>
          )}
        </select>
      </label>
      {doc && (
        <p className="px-doc-meta">
          {doc.width}×{doc.height} · {doc.layers.length} layer{doc.layers.length === 1 ? '' : 's'} ·{' '}
          {Math.round(store.zoom * 100)}%
        </p>
      )}
      <div className="px-sidebar-menu">
        <SideButtonDropdown
          label="New"
          options={newDocOptions}
          onSelect={handleFileMenu}
          title="New blank document or canvas size"
          alwaysShowLabel
        />
        <SideButtonDropdown
          label="Import"
          options={importOptions}
          onSelect={handleFileMenu}
          title="Import image or project"
          alwaysShowLabel
        />
        <SideButtonDropdown
          label="Export"
          options={exportOptions}
          onSelect={handleFileMenu}
          title="Export PNG or project"
          disabled={!doc}
          alwaysShowLabel
        />
        <button
          type="button"
          className="side-btn side-btn-wide"
          disabled={!doc}
          title="Delete the current pixel layers and start with a completely transparent material"
          onClick={async () => {
            const confirmed = await appConfirm({
              title: 'Clear material',
              message: 'Clear the current material and replace it with a transparent canvas? You can undo this action.',
              confirmLabel: 'Clear material',
              cancelLabel: 'Cancel',
              danger: true,
            })
            if (!confirmed) return
            store.clearMaterial()
          }}
        >
          Clear Material
        </button>
      </div>
    </section>
  )

  const renderResizeSection = (compact = false) => (
    <section className={`px-size-section${compact ? ' px-size-section-compact' : ''}`}>
      {!compact && <h3 className="px-sidebar-heading">Canvas size</h3>}
      <div className="px-size-row">
        <label className="px-size-field">
          <span>W</span>
          <input
            type="number"
            min={1}
            max={512}
            value={customW}
            onChange={(e) => setCustomW(Number(e.target.value))}
            aria-label="Canvas width"
          />
        </label>
        <span className="px-size-sep" aria-hidden>
          ×
        </span>
        <label className="px-size-field">
          <span>H</span>
          <input
            type="number"
            min={1}
            max={512}
            value={customH}
            onChange={(e) => setCustomH(Number(e.target.value))}
            aria-label="Canvas height"
          />
        </label>
      </div>
      <button
        type="button"
        className="side-btn px-resize-btn"
        title="Apply custom canvas size"
        onClick={() => handleFileMenu('custom')}
      >
        Resize
      </button>
    </section>
  )

  const brushSelected = store.tool === 'paintBrush'
  const activeTool = TOOL_GROUPS.flat().find((tool) => tool.id === store.tool)

  const renderBrushSoftOption = (
    label: string,
    value: number,
    onChange: (v: number) => void
  ) => (
    <label className="px-sidebar-option">
      <span>{label}</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="px-option-value">{Math.round(value * 100)}%</span>
    </label>
  )

  const renderFloatingToolbar = (compact = false) => (
    <div
      className={`px-float-toolbar${compact ? ' px-float-toolbar-compact' : ''}`}
      role="toolbar"
      aria-label="Drawing tools"
      style={compact ? undefined : { left: store.toolbarPos.x, top: store.toolbarPos.y }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {!compact && (
        <div
          className="px-float-toolbar-handle"
          title="Drag to move tools"
          aria-label="Move tools"
          onPointerDown={(event) => {
            if (event.button !== 0) return
            event.preventDefault()
            event.stopPropagation()
            const vp = viewportRef.current
            const bar = event.currentTarget.parentElement
            if (!vp || !bar) return
            const vpRect = vp.getBoundingClientRect()
            const barRect = bar.getBoundingClientRect()
            toolbarDragRef.current = {
              startX: event.clientX,
              startY: event.clientY,
              origX: store.toolbarPos.x,
              origY: store.toolbarPos.y,
              maxX: Math.max(0, vpRect.width - barRect.width),
              maxY: Math.max(0, vpRect.height - barRect.height),
            }
            event.currentTarget.setPointerCapture(event.pointerId)
          }}
        >
          ⋮⋮
        </div>
      )}
      {TOOL_GROUPS.map((group, gi) => (
        <div key={gi} className="px-float-tool-group" role="group">
          {group.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`px-float-tool ${store.tool === t.id ? 'active' : ''}`}
              title={t.title}
              aria-label={t.title}
              aria-pressed={store.tool === t.id}
              onClick={() => store.setTool(t.id)}
            >
              <PixelToolIcon tool={t.id} />
            </button>
          ))}
        </div>
      ))}
    </div>
  )

  const renderOptionsSection = (compact: boolean) => (
    <section
      className={`px-sidebar-section${compact ? '' : ' px-sidebar-section-grow'}${
        brushSelected ? ' px-sidebar-section-brush' : ''
      }`}
    >
      <h3 className="px-sidebar-heading">Options</h3>
      <div className={`px-options-stack${brushSelected ? ' px-options-stack-brush' : ''}`}>
        <label className="px-sidebar-option">
          <span>Size</span>
          <input
            type="range"
            min={1}
            max={brushSelected ? 64 : 32}
            value={store.brushSize}
            onChange={(e) => store.setBrushSize(Number(e.target.value))}
          />
          <span className="px-option-value">{store.brushSize}px</span>
        </label>
        {brushSelected && (
          <>
            <div className="px-brush-group" aria-label="Brush tip settings">
              <div className="px-brush-group-label">Brush tip</div>
              <SideButtonDropdown
                label="Shape"
                value={store.brushShape}
                alwaysShowLabel
                title="Paint brush tip shape"
                options={PIXEL_BRUSH_SHAPES.map((b) => ({
                  value: b.id,
                  label: b.label,
                }))}
                onSelect={(value) => store.setBrushShape(value as PixelBrushShape)}
              />
            </div>
            {renderBrushSoftOption('Hardness', store.brushHardness, store.setBrushHardness)}
            {renderBrushSoftOption('Opacity', store.brushOpacity, store.setBrushOpacity)}
            {renderBrushSoftOption('Flow', store.brushFlow, store.setBrushFlow)}
          </>
        )}
        <label className="px-sidebar-option">
          <span>Fill tolerance</span>
          <input
            type="range"
            min={0}
            max={255}
            value={store.fillTolerance}
            onChange={(e) => store.setFillTolerance(Number(e.target.value))}
          />
          <span className="px-option-value">{store.fillTolerance}</span>
        </label>
      </div>
      {!compact && (
        <div className="px-options-checks">
          <label className="px-sidebar-check">
            <input
              type="checkbox"
              checked={store.paintOnModel}
              disabled={!canPaintOnModel}
              onChange={(e) => store.setPaintOnModel(e.target.checked)}
            />
            <span>Paint on model</span>
          </label>
          <label
            className="px-sidebar-check"
            title="Outline UV islands on this texture so you know where to paint"
          >
            <input
              type="checkbox"
              checked={store.showUvOverlay}
              onChange={(e) => store.setShowUvOverlay(e.target.checked)}
            />
            <span>UV overlay</span>
          </label>
          <label className="px-sidebar-check">
            <input type="checkbox" checked={store.shapeFilled} onChange={(e) => store.setShapeFilled(e.target.checked)} />
            <span>Filled shapes</span>
          </label>
          <label className="px-sidebar-check">
            <input type="checkbox" checked={store.pixelPerfect} onChange={(e) => store.setPixelPerfect(e.target.checked)} />
            <span>Pixel perfect</span>
          </label>
          <label className="px-sidebar-check">
            <input type="checkbox" checked={store.symH} onChange={(e) => store.setSymH(e.target.checked)} />
            <span>Symmetry H</span>
          </label>
          <label className="px-sidebar-check">
            <input type="checkbox" checked={store.symV} onChange={(e) => store.setSymV(e.target.checked)} />
            <span>Symmetry V</span>
          </label>
          <button
            type="button"
            className="side-btn side-btn-wide"
            title="Give every face unique, non-overlapping texture space and open the UV Editor"
            onClick={() => {
              if (objectId) store.resetPixelPaintUvLayout(objectId)
              store.setUvEditorOpen(true)
            }}
          >
            Rebuild Paint UVs
          </button>
        </div>
      )}
    </section>
  )

  const renderSidebar = () => (
    <aside className="px-sidebar">
      {renderFileSection()}
      {renderResizeSection(false)}
      {renderOptionsSection(false)}
    </aside>
  )

  const renderCompactPanel = () => (
    <aside className="px-compact-panel">
      <section className="px-compact-color">
        <PixelColorSection />
      </section>
      {renderFloatingToolbar(true)}
      {renderFileSection()}
      {renderResizeSection(true)}
      {renderOptionsSection(true)}
      {paintOnModelHint}
    </aside>
  )

  const renderColorRail = () => (
    <aside className="px-rail">
      <PixelColorSection />
      <PixelLayersPanel />
    </aside>
  )

  const renderCanvas = () => (
    <div className="px-stage">
      {paintOnModelHint}
      <header className="px-stage-head">
        <div className="px-stage-title">
          <strong>{activeTool?.label ?? 'Tool'}</strong>
          <span>{doc ? `${doc.width} × ${doc.height}px` : 'No texture open'}</span>
        </div>
        <div className="px-stage-readouts" aria-label="Canvas status">
          {store.selection && <span className="px-stage-badge">Selection active</span>}
          {store.paintOnModel && canPaintOnModel && <span className="px-stage-badge active">3D paint</span>}
          {store.showUvOverlay && <span className="px-stage-badge active">UV overlay</span>}
          <span className="px-stage-zoom">{Math.round(store.zoom * 100)}%</span>
        </div>
      </header>
      <div
        ref={viewportRef}
        className="px-viewport"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {renderFloatingToolbar()}
        {doc ? (
          <div ref={canvasStackRef} className="px-canvas-stack" style={canvasStyle}>
            <canvas ref={canvasRef} className="px-canvas" style={{ width: '100%', height: '100%' }} />
            <canvas ref={overlayRef} className="px-canvas px-overlay" style={{ width: '100%', height: '100%' }} />
          </div>
        ) : (
          <div className="px-empty-state">
            <p>No document open</p>
            <p className="muted">Use File → New to create a texture, or Import an image.</p>
          </div>
        )}
      </div>
      <footer className="px-statusbar">
        <span><kbd>Scroll</kbd> Zoom</span>
        <span><kbd>Space</kbd> Pan</span>
        <span><kbd>Ctrl</kbd> + drag Select</span>
        <span><kbd>I</kbd> Pick</span>
        <span><kbd>B</kbd> Fill</span>
        {fileMessage ? (
          <span className="muted px-status-message">{fileMessage}</span>
        ) : (
          <span className="px-status-message">Pencil P · Eraser E · Line L · Shapes R/O</span>
        )}
      </footer>
    </div>
  )

  const handlePanelStateChange = useCallback(
    (panel: typeof store.panel) => {
      const prev = store.panel
      if (panel.minimized && !prev.minimized) {
        store.setPanel({
          ...panel,
          expandedWidth: prev.width,
          expandedHeight: prev.height,
          width: 236,
        })
        if (canPaintOnModel) store.setPaintOnModel(true)
        return
      }
      if (!panel.minimized && prev.minimized) {
        store.setPanel({
          ...panel,
          width: prev.expandedWidth ?? panel.width,
          height: prev.expandedHeight ?? panel.height,
        })
        return
      }
      store.setPanel(panel)
    },
    [canPaintOnModel, store]
  )

  const compactLayout = <div className="px-editor px-editor-compact">{renderCompactPanel()}</div>

  const fullLayout = (
    <div className="px-editor">
      {renderSidebar()}
      {renderCanvas()}
      {renderColorRail()}
    </div>
  )

  return (
    <FloatingPanel
      title="Pixel Editor"
      open={store.open}
      state={store.panel}
      minWidth={720}
      minHeight={480}
      minimizedContent={compactLayout}
      onClose={store.toggle}
      onStateChange={handlePanelStateChange}
    >
      {fullLayout}
    </FloatingPanel>
  )
}
