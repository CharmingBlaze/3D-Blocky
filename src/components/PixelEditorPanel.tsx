import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { FloatingPanel } from './FloatingPanel'
import { SideButtonDropdown } from './SideButtonDropdown'
import { PixelColorSection } from './material/PixelColorSection'
import { useAppStore } from '../store/appStore'
import { compositeLayers } from '../pixel/compositeLayers'
import {
  getPixelCompositeCache,
  subscribePixelCompositeCache,
} from '../pixel/pixelCompositeCache'
import type { PixelBlendMode, PixelTool } from '../pixel/pixelTypes'
import { PIXEL_SIZE_PRESETS } from '../pixel/pixelTypes'
import { resolveEffectiveMaterial } from '../material/materials'
import { pickOpenFile } from '../io/fileDialogs'
import { IMAGE_IMPORT_FILTERS, PIXEL_PROJECT_FILTERS } from '../io/download'
import { listSceneTextures } from '../uv/sceneTextures'
import { constrainPixelShape } from '../pixel/uvPaint'

const TOOLS: { id: PixelTool; label: string; title: string; glyph: string }[] = [
  { id: 'pencil', label: 'Pencil', title: 'Pencil (P)', glyph: '✎' },
  { id: 'eraser', label: 'Eraser', title: 'Eraser (E)', glyph: '◻' },
  { id: 'line', label: 'Line', title: 'Line (L)', glyph: '╱' },
  { id: 'rectangle', label: 'Rect', title: 'Rectangle (R)', glyph: '▭' },
  { id: 'ellipse', label: 'Ellipse', title: 'Ellipse (O)', glyph: '○' },
  { id: 'bucket', label: 'Bucket', title: 'Bucket fill (B)', glyph: '▣' },
  { id: 'rectSelect', label: 'Select', title: 'Rectangle select', glyph: '⬚' },
  { id: 'eyedropper', label: 'Pick', title: 'Eyedropper (I)', glyph: '⌖' },
]

const BLEND_MODES: PixelBlendMode[] = ['normal', 'multiply', 'add', 'screen']

function normalizeRect(x0: number, y0: number, x1: number, y1: number) {
  return {
    x0: Math.min(x0, x1),
    y0: Math.min(y0, y1),
    x1: Math.max(x0, x1),
    y1: Math.max(y0, y1),
  }
}

function strokeDocumentOutline(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.lineWidth = 1
  ctx.setLineDash([])
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.88)'
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1)
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
      pixelPerfect: s.pixelEditorPixelPerfect,
      symH: s.pixelEditorSymmetryH,
      symV: s.pixelEditorSymmetryV,
      paintOnModel: s.pixelEditorPaintOnModel,
      shapeFilled: s.pixelEditorShapeFilled,
      fillTolerance: s.pixelEditorFillTolerance,
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
      setPixelPerfect: s.setPixelEditorPixelPerfect,
      setSymH: s.setPixelEditorSymmetryH,
      setSymV: s.setPixelEditorSymmetryV,
      setPaintOnModel: s.setPixelEditorPaintOnModel,
      setShapeFilled: s.setPixelEditorShapeFilled,
      setFillTolerance: s.setPixelEditorFillTolerance,
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
      addLayer: s.addPixelEditorLayer,
      deleteLayer: s.deletePixelEditorLayer,
      duplicateLayer: s.duplicatePixelEditorLayer,
      mergeDown: s.mergePixelEditorLayerDown,
      reorderLayer: s.reorderPixelEditorLayer,
      patchLayer: s.patchPixelEditorLayer,
      setActiveLayer: s.setPixelEditorActiveLayer,
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
  const panDragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null)
  const editingRef = useRef(false)

  useEffect(() => {
    if (doc) {
      setCustomW(doc.width)
      setCustomH(doc.height)
    }
  }, [doc?.id, doc?.width, doc?.height])

  const screenToPixel = useCallback(
    (clientX: number, clientY: number) => {
      const vp = viewportRef.current
      if (!vp || !doc) return null
      const rect = vp.getBoundingClientRect()
      const x = Math.floor((clientX - rect.left - store.panX) / store.zoom)
      const y = Math.floor((clientY - rect.top - store.panY) / store.zoom)
      if (x < 0 || y < 0 || x >= doc.width || y >= doc.height) return null
      return { x, y }
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
    overlay.width = doc.width
    overlay.height = doc.height
    const ctx = overlay.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, doc.width, doc.height)

    strokeDocumentOutline(ctx, doc.width, doc.height)

    if (store.selection) {
      const { x0, y0, x1, y1 } = store.selection
      ctx.strokeStyle = 'rgba(110, 203, 245, 0.95)'
      ctx.lineWidth = 1
      ctx.setLineDash([2, 2])
      ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0 + 1, y1 - y0 + 1)
      ctx.setLineDash([])
    }

    if (shapePreview) {
      const { x0, y0, x1, y1 } = shapePreview
      ctx.strokeStyle = 'rgba(110, 203, 245, 0.95)'
      ctx.fillStyle = 'rgba(110, 203, 245, 0.2)'
      ctx.lineWidth = 1

      if (store.tool === 'line') {
        ctx.beginPath()
        ctx.moveTo(x0 + 0.5, y0 + 0.5)
        ctx.lineTo(x1 + 0.5, y1 + 0.5)
        ctx.stroke()
      } else if (store.tool === 'rectangle') {
        const left = Math.min(x0, x1)
        const top = Math.min(y0, y1)
        const w = Math.abs(x1 - x0) + 1
        const h = Math.abs(y1 - y0) + 1
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
  }, [doc, shapePreview, store.selection, store.shapeFilled, store.tool])

  useEffect(() => {
    redrawOverlay()
  }, [redrawOverlay])

  useEffect(() => {
    const el = viewportRef.current
    if (!el || !store.open) return

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const { pixelEditorZoom, pixelEditorPanX, pixelEditorPanY, setPixelEditorView } =
        useAppStore.getState()
      const delta = e.deltaY > 0 ? -1 : 1
      const next = Math.max(1, Math.min(64, pixelEditorZoom + delta))
      setPixelEditorView(next, pixelEditorPanX, pixelEditorPanY)
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
      const { setPixelEditorTool } = useAppStore.getState()
      const key = e.key.toLowerCase()
      if (key === 'p') setPixelEditorTool('pencil')
      else if (key === 'e') setPixelEditorTool('eraser')
      else if (key === 'i') setPixelEditorTool('eyedropper')
      else if (key === 'b') setPixelEditorTool('bucket')
      else if (key === 'l') setPixelEditorTool('line')
      else if (key === 'r') setPixelEditorTool('rectangle')
      else if (key === 'o') setPixelEditorTool('ellipse')
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

  const onPointerDown = (e: React.PointerEvent) => {
    if (spacePan || e.button === 1) {
      panDragRef.current = { x: e.clientX, y: e.clientY, panX: store.panX, panY: store.panY }
      return
    }
    const p = screenToPixel(e.clientX, e.clientY)
    if (!p || !doc) return
    e.currentTarget.setPointerCapture(e.pointerId)

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
    if (store.tool === 'pencil' || store.tool === 'eraser') {
      store.beginEdit()
      editingRef.current = true
      strokeRef.current = [p]
      store.paintStroke([p], store.tool)
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
    const p = screenToPixel(e.clientX, e.clientY)
    if (!p) return
    if (dragRef.current) {
      const next = constrainShape(
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
    if (strokeRef.current.length > 0 && (store.tool === 'pencil' || store.tool === 'eraser')) {
      const last = strokeRef.current[strokeRef.current.length - 1]
      if (last.x !== p.x || last.y !== p.y) {
        strokeRef.current.push(p)
        store.paintStroke([last, p], store.tool)
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
      const { x0, y0, x1, y1 } = constrainShape(d.x0, d.y0, d.x1, d.y1, e.shiftKey)

      if (store.tool === 'rectSelect') {
        const rect = normalizeRect(x0, y0, x1, y1)
        store.setSelection(
          rect.x0 === rect.x1 && rect.y0 === rect.y1
            ? { kind: 'rect', ...rect }
            : { kind: 'rect', ...rect }
        )
      } else {
        store.paintShape(store.tool as 'line' | 'rectangle' | 'ellipse', x0, y0, x1, y1)
      }

      dragRef.current = null
      setShapePreview(null)
      if (store.tool !== 'rectSelect' && editingRef.current) {
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

  const layerList = useMemo(() => {
    if (!doc) return null
    return [...doc.layers].reverse().map((layer, revIdx) => {
      const idx = doc.layers.length - 1 - revIdx
      return (
        <div
          key={layer.id}
          className={`px-layer-row ${doc.activeLayerId === layer.id ? 'active' : ''}`}
        >
          <button type="button" className="px-layer-vis" onClick={() => store.patchLayer(layer.id, { visible: !layer.visible })}>
            {layer.visible ? '👁' : '○'}
          </button>
          <button type="button" className="px-layer-name" onClick={() => store.setActiveLayer(layer.id)}>
            {layer.name}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={layer.opacity}
            onChange={(ev) => store.patchLayer(layer.id, { opacity: Number(ev.target.value) })}
          />
          <select
            className="shape-kind-select"
            value={layer.blendMode}
            onChange={(ev) => store.patchLayer(layer.id, { blendMode: ev.target.value as PixelBlendMode })}
          >
            {BLEND_MODES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <div className="px-layer-actions">
            <button type="button" title="Move up" onClick={() => store.reorderLayer(layer.id, idx + 1)}>↑</button>
            <button type="button" title="Move down" onClick={() => store.reorderLayer(layer.id, idx - 1)}>↓</button>
            <button type="button" title="Duplicate" onClick={() => store.duplicateLayer(layer.id)}>⧉</button>
            <button type="button" title="Merge down" onClick={() => store.mergeDown(layer.id)}>⬇︎M</button>
            <button type="button" title="Delete" onClick={() => store.deleteLayer(layer.id)}>✕</button>
          </div>
        </div>
      )
    })
  }, [doc, store])

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
    <div className={compact ? 'px-compact-resize' : 'px-size-row'}>
      <label className="px-sidebar-field px-sidebar-field-inline">
        <span>W</span>
        <input
          type="number"
          min={1}
          max={512}
          value={customW}
          onChange={(e) => setCustomW(Number(e.target.value))}
        />
      </label>
      <label className="px-sidebar-field px-sidebar-field-inline">
        <span>H</span>
        <input
          type="number"
          min={1}
          max={512}
          value={customH}
          onChange={(e) => setCustomH(Number(e.target.value))}
        />
      </label>
      <button
        type="button"
        className={`side-btn${compact ? ' px-resize-btn' : ''}`}
        title="Apply custom canvas size"
        onClick={() => handleFileMenu('custom')}
      >
        Resize
      </button>
    </div>
  )

  const renderToolsSection = () => (
    <section className="px-sidebar-section">
      <h3 className="px-sidebar-heading">Tools</h3>
      <div className="px-tool-list" role="toolbar" aria-label="Drawing tools">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`px-tool-item ${store.tool === t.id ? 'active' : ''}`}
            title={t.title}
            aria-pressed={store.tool === t.id}
            onClick={() => store.setTool(t.id)}
          >
            <span className="px-tool-glyph" aria-hidden>
              {t.glyph}
            </span>
            <span className="px-tool-label">{t.label}</span>
          </button>
        ))}
      </div>
    </section>
  )

  const renderOptionsSection = (compact: boolean) => (
    <section className={`px-sidebar-section${compact ? '' : ' px-sidebar-section-grow'}`}>
      <h3 className="px-sidebar-heading">Options</h3>
      <label className="px-sidebar-option">
        <span>Brush size</span>
        <input
          type="range"
          min={1}
          max={32}
          value={store.brushSize}
          onChange={(e) => store.setBrushSize(Number(e.target.value))}
        />
        <span className="px-option-value">{store.brushSize}px</span>
      </label>
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
      {!compact && (
        <>
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
        </>
      )}
    </section>
  )

  const renderSidebar = () => (
    <aside className="px-sidebar">
      {renderFileSection()}
      {renderResizeSection(false)}
      {renderToolsSection()}
      {renderOptionsSection(false)}
    </aside>
  )

  const renderCompactPanel = () => (
    <aside className="px-compact-panel">
      <section className="px-compact-color">
        <PixelColorSection />
      </section>
      {renderFileSection()}
      {renderResizeSection(true)}
      {renderToolsSection()}
      {renderOptionsSection(true)}
      {paintOnModelHint}
    </aside>
  )

  const renderColorRail = () => (
    <aside className="px-rail">
      <PixelColorSection />
      <div className="px-layers">
        <div className="px-layers-head">
          <span>Layers</span>
          <button type="button" className="side-btn" onClick={store.addLayer} disabled={!doc} title="Add layer">
            +
          </button>
        </div>
        <div className="px-layers-list">{layerList}</div>
      </div>
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
        <span>Scroll zoom · Space pan · Shift constrain · Alt bucket global</span>
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
