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
import type { PixelTool } from '../pixel/pixelTypes'
import { PIXEL_SIZE_PRESETS } from '../pixel/pixelTypes'
import { resolveEffectiveMaterial } from '../material/materials'
import { pickOpenFile } from '../io/fileDialogs'
import { IMAGE_IMPORT_FILTERS, PIXEL_PROJECT_FILTERS } from '../io/download'
import { listSceneTextures } from '../uv/sceneTextures'
import { constrainPixelShape } from '../pixel/uvPaint'
import { PIXEL_BRUSH_SHAPES, isPixelFreehandPaintTool, type PixelBrushShape } from '../pixel/pixelBrushTypes'
import { drawMarchingAnts, pointInPixelSelection } from '../pixel/pixelMarchingAnts'

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
      docs: s.pixelDocuments,
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
      unwrapSelectedUvFaces: s.unwrapSelectedUvFaces,
    }))
  )

  const pixelDocuments = useAppStore((s) => s.pixelDocuments)
  const objectTextures = useAppStore((s) => s.objectTextures)
  const sceneObjects = useAppStore((s) => s.objects)
  const sceneTextures = useMemo(
    () => listSceneTextures(pixelDocuments, objectTextures, sceneObjects),
    [pixelDocuments, objectTextures, sceneObjects]
  )

  const doc = store.docId ? store.docs[store.docId] : null
  const objectId = store.selectedObjectId ?? store.selectionObjectIds[0] ?? null
  const obj = useAppStore((s) => (objectId ? s.objects.find((o) => o.id === objectId) : null))
  const mat = obj ? resolveEffectiveMaterial(obj) : null
  const canPaintOnModel = Boolean(
    mat?.mode === 'texture' && store.docId && (mat.textureId ?? obj?.id) === store.docId
  )

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
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
      const vp = viewportRef.current
      if (!vp || !doc) return null
      const rect = vp.getBoundingClientRect()
      const fx = (clientX - rect.left - store.panX) / store.zoom
      const fy = (clientY - rect.top - store.panY) / store.zoom
      if (fx < 0 || fy < 0 || fx >= doc.width || fy >= doc.height) return null
      if (continuous) return { x: fx, y: fy }
      return { x: Math.floor(fx), y: Math.floor(fy) }
    },
    [doc, store.panX, store.panY, store.zoom]
  )

  const canvasSizeRef = useRef({ w: 0, h: 0 })
  const docRef = useRef(doc)
  docRef.current = doc

  const paintCanvasPixels = useCallback((pixels: Uint8ClampedArray, width: number, height: number) => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (canvasSizeRef.current.w !== width || canvasSizeRef.current.h !== height) {
      canvas.width = width
      canvas.height = height
      canvasSizeRef.current = { w: width, h: height }
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0)
  }, [])

  // Shared composite cache keeps 2D canvas synced with 3D paint without double-flattening every pointer move.
  useEffect(() => {
    if (!store.open || !store.docId) return

    const drawFromCacheOrDoc = () => {
      const current = docRef.current
      if (!current) return
      const cached = getPixelCompositeCache(store.docId!)
      if (cached && cached.width === current.width && cached.height === current.height) {
        paintCanvasPixels(cached.pixels, current.width, current.height)
        return
      }
      paintCanvasPixels(compositeLayers(current), current.width, current.height)
    }

    drawFromCacheOrDoc()
    return subscribePixelCompositeCache(store.docId, drawFromCacheOrDoc)
  }, [store.open, store.docId, doc?.id, doc?.width, doc?.height, paintCanvasPixels])

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
  }, [doc, shapePreview, store.selection, store.shapeFilled, store.tool, store.zoom, marqueeSelect])

  useEffect(() => {
    redrawOverlay()
  }, [redrawOverlay])

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
    strokeRef.current = []
    dragRef.current = null
    setShapePreview(null)
    if (editingRef.current) {
      store.commitEdit()
      editingRef.current = false
    }
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
      const p = screenToPixel(e.clientX, e.clientY, continuous)
      if (!p) return
      const last = strokeRef.current[strokeRef.current.length - 1]!
      const moved = continuous
        ? Math.hypot(p.x - last.x, p.y - last.y) >= 0.2
        : last.x !== p.x || last.y !== p.y
      if (moved) {
        strokeRef.current.push(p)
        store.paintStroke([last, p], store.tool === 'eraser' ? 'eraser' : 'pencil')
      }
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    if (panDragRef.current) {
      panDragRef.current = null
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
      return
    }
    finishStroke()
  }

  const handleFileMenu = async (action: string) => {
    setFileMessage(null)
    try {
      if (action === 'new') {
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
      if (action === 'resize' || action === 'custom') {
        if (doc) store.resizeDoc(customW, customH)
        else store.createNew(customW, customH, objectId ?? undefined)
        return
      }
      if (action.startsWith('preset-')) {
        const preset = PIXEL_SIZE_PRESETS.find((p) => p.label === action.replace(/^preset-/, ''))
        if (!preset) return
        setCustomW(preset.width)
        setCustomH(preset.height)
        if (doc) store.resizeDoc(preset.width, preset.height)
        else store.createNew(preset.width, preset.height, objectId ?? undefined)
      }
    } catch (err) {
      setFileMessage(err instanceof Error ? err.message : 'File operation failed.')
    }
  }

  const newDocOptions = useMemo(
    () => [
      { value: 'new', label: 'Blank document' },
      ...PIXEL_SIZE_PRESETS.map((p) => ({
        value: `preset-${p.label}`,
        label: p.label,
      })),
      { value: 'custom', label: `Custom ${customW}×${customH}` },
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
            title="Open UV Editor and auto-unwrap"
            onClick={() => {
              store.setUvEditorOpen(true)
              if (objectId) store.unwrapSelectedUvFaces('auto')
            }}
          >
            Unwrap UVs
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
      <div
        ref={viewportRef}
        className="px-viewport"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        {renderFloatingToolbar()}
        {doc ? (
          <div className="px-canvas-stack" style={canvasStyle}>
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
        <span>
          Scroll zoom · Space pan · Ctrl+drag select · Esc/Ctrl+D deselect · Ctrl+C/X/V · Del
        </span>
        {fileMessage ? (
          <span className="muted">{fileMessage}</span>
        ) : (
          <span>I pick · B bucket · P E L R O shortcuts</span>
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
