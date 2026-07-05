import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { FloatingPanel } from './FloatingPanel'
import { PixelColorSection } from './material/PixelColorSection'
import { useAppStore } from '../store/appStore'
import { compositeLayers } from '../pixel/compositeLayers'
import type { PixelBlendMode, PixelTool } from '../pixel/pixelTypes'
import { PIXEL_SIZE_PRESETS } from '../pixel/pixelTypes'
import { resolveEffectiveMaterial } from '../material/materials'
import { pickOpenFile } from '../io/fileDialogs'
import { IMAGE_IMPORT_FILTERS, PIXEL_PROJECT_FILTERS } from '../io/download'

const TOOLS: { id: PixelTool; label: string; title: string }[] = [
  { id: 'pencil', label: 'Pencil', title: 'Pencil (P)' },
  { id: 'eraser', label: 'Eraser', title: 'Eraser (E)' },
  { id: 'line', label: 'Line', title: 'Line (L)' },
  { id: 'rectangle', label: 'Rectangle', title: 'Rectangle (R)' },
  { id: 'ellipse', label: 'Ellipse', title: 'Ellipse (O)' },
  { id: 'bucket', label: 'Bucket', title: 'Bucket fill (B)' },
  { id: 'rectSelect', label: 'Select', title: 'Rectangle select' },
  { id: 'eyedropper', label: 'Eyedropper', title: 'Eyedropper (I)' },
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

  const doc = store.docId ? store.docs[store.docId] : null
  const objectId = store.selectedObjectId ?? store.selectionObjectIds[0] ?? null
  const obj = useAppStore((s) => (objectId ? s.objects.find((o) => o.id === objectId) : null))
  const mat = obj ? resolveEffectiveMaterial(obj) : null
  const canPaintOnModel = Boolean(
    mat?.mode === 'texture' && store.docId && mat.textureId === store.docId
  )

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const [customW, setCustomW] = useState(64)
  const [customH, setCustomH] = useState(64)
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

  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !doc) return
    canvas.width = doc.width
    canvas.height = doc.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const composite = compositeLayers(doc)
    const imageData = new ImageData(new Uint8ClampedArray(composite), doc.width, doc.height)
    ctx.putImageData(imageData, 0, 0)
  }, [doc])

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
    redraw()
  }, [redraw])

  useEffect(() => {
    redrawOverlay()
  }, [redrawOverlay])

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault()
      const delta = e.deltaY > 0 ? -1 : 1
      const next = Math.max(1, Math.min(64, store.zoom + delta))
      store.setView(next, store.panX, store.panY)
    },
    [store]
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpacePan(e.type === 'keydown')
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
      if (!shiftKey) return { x0, y0, x1, y1 }
      if (store.tool === 'line') {
        if (Math.abs(x1 - x0) > Math.abs(y1 - y0)) return { x0, y0, x1, y1: y0 }
        return { x0, y0, x1: x0, y1 }
      }
      const side = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))
      return {
        x0,
        y0,
        x1: x0 + Math.sign(x1 - x0 || 1) * side,
        y1: y0 + Math.sign(y1 - y0 || 1) * side,
      }
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
      store.beginEdit()
      editingRef.current = true
      store.bucketFill(p.x, p.y, e.altKey)
      finishStroke()
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
    if (action === 'save') {
      await store.saveDoc()
      return
    }
    if (action === 'export-png') {
      await store.exportPng()
      return
    }
    if (action === 'export-project') {
      store.exportProject()
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
      const preset = PIXEL_SIZE_PRESETS.find((p) => p.label === action.slice(7))
      if (!preset) return
      setCustomW(preset.width)
      setCustomH(preset.height)
      if (doc) store.resizeDoc(preset.width, preset.height)
      else store.createNew(preset.width, preset.height, objectId ?? undefined)
    }
  }

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

  return (
    <FloatingPanel
      title="Pixel Editor"
      open={store.open}
      state={store.panel}
      minWidth={560}
      minHeight={480}
      onClose={store.toggle}
      onStateChange={store.setPanel}
    >
      <div className="px-editor">
        <div className="px-toolbar">
          <select
            className="shape-kind-select side-select px-menu-select"
            value={store.tool}
            onChange={(e) => store.setTool(e.target.value as PixelTool)}
            title="Drawing tool"
          >
            {TOOLS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>

          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`px-tool-btn ${store.tool === t.id ? 'active' : ''}`}
              title={t.title}
              onClick={() => store.setTool(t.id)}
            >
              {t.label.charAt(0)}
            </button>
          ))}

          <label className="px-toggle" title="Pixel-perfect freehand">
            <input type="checkbox" checked={store.pixelPerfect} onChange={(e) => store.setPixelPerfect(e.target.checked)} />
            PxPerfect
          </label>
          <label className="px-toggle" title="Horizontal symmetry">
            <input type="checkbox" checked={store.symH} onChange={(e) => store.setSymH(e.target.checked)} />
            Sym H
          </label>
          <label className="px-toggle" title="Vertical symmetry">
            <input type="checkbox" checked={store.symV} onChange={(e) => store.setSymV(e.target.checked)} />
            Sym V
          </label>
          <label className="px-field">
            Brush
            <input
              type="number"
              min={1}
              max={32}
              value={store.brushSize}
              onChange={(e) => store.setBrushSize(Number(e.target.value))}
            />
          </label>
          <label className="px-field" title="Bucket fill color tolerance">
            Tolerance
            <input
              type="number"
              min={0}
              max={255}
              value={store.fillTolerance}
              onChange={(e) => store.setFillTolerance(Number(e.target.value))}
            />
          </label>
          <label className="px-toggle" title="Paint on 3D model surface">
            <input
              type="checkbox"
              checked={store.paintOnModel}
              disabled={!canPaintOnModel}
              onChange={(e) => store.setPaintOnModel(e.target.checked)}
            />
            Paint on Model
          </label>
          <label className="px-toggle" title="Filled shapes">
            <input type="checkbox" checked={store.shapeFilled} onChange={(e) => store.setShapeFilled(e.target.checked)} />
            Fill
          </label>
          <button
            type="button"
            className="side-btn"
            title="Open UV Editor / Auto UV"
            onClick={() => {
              store.setUvEditorOpen(true)
              if (objectId) store.unwrapSelectedUvFaces('auto')
            }}
          >
            Unwrap
          </button>
        </div>

        <div className="px-main">
          <div className="px-canvas-wrap">
            <div className="px-file-bar">
              <select
                className="shape-kind-select side-select px-doc-menu"
                value=""
                onChange={(e) => {
                  handleFileMenu(e.target.value)
                  e.target.value = ''
                }}
                title="New, import, save, export, and canvas size"
              >
                <option value="">Document…</option>
                <option value="new">New</option>
                <option value="import">Import image…</option>
                <option value="import-project">Import project…</option>
                <option value="save">Save project</option>
                <option value="export-png">Export PNG</option>
                <option value="export-project">Export project</option>
                <optgroup label="Canvas size">
                  {PIXEL_SIZE_PRESETS.map((p) => (
                    <option key={p.label} value={`preset-${p.label}`}>
                      {p.label}
                    </option>
                  ))}
                  <option value="resize">Custom ({customW}×{customH})</option>
                </optgroup>
              </select>
              <label className="px-field">
                W
                <input type="number" min={1} max={512} value={customW} onChange={(e) => setCustomW(Number(e.target.value))} />
              </label>
              <label className="px-field">
                H
                <input type="number" min={1} max={512} value={customH} onChange={(e) => setCustomH(Number(e.target.value))} />
              </label>
              {doc && (
                <span className="side-color-hint muted">
                  {doc.width}×{doc.height} · {doc.layers.length} layer{doc.layers.length === 1 ? '' : 's'}
                </span>
              )}
            </div>
            {!canPaintOnModel && store.paintOnModel && (
              <p className="side-color-hint warn">Switch material to Texture mode and unwrap UVs to paint on the model.</p>
            )}
            <div
              ref={viewportRef}
              className="px-viewport"
              onWheel={onWheel}
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
                <p className="side-color-hint muted">Use Document → New or pick a canvas size to begin.</p>
              )}
            </div>
            <p className="side-color-hint muted">
              Scroll zoom · Space+drag pan · Shift constrains shapes · Alt+click bucket = global fill
            </p>
          </div>

          <aside className="px-side">
            <PixelColorSection />
            <div className="px-layers">
              <div className="px-layers-head">
                <span>Layers</span>
                <button type="button" className="side-btn" onClick={store.addLayer} disabled={!doc}>+</button>
              </div>
              {layerList}
            </div>
          </aside>
        </div>
      </div>
    </FloatingPanel>
  )
}
