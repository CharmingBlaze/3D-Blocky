import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  useAppStore,
  type ActiveTool,
  type StrokeMode,
  type PrimitiveKind,
  type SymmetryAxis,
  type PolyDrawMode,
} from '../store/appStore'
import { selectionHasComponents } from '../mesh/meshSelection'
import {
  VIEWPORT_DISPLAY_CONFIG,
  VIEWPORT_DISPLAY_MODES,
  type ViewportDisplayMode,
} from '../rendering/viewportDisplay'
import { PaletteBar } from './PaletteBar'
import { ThemePicker } from './ThemeBar'
import { SidePanelFileMenu } from './SidePanelFileMenu'
import { SidePanelPrimitivesMenu, PRIMITIVE_KINDS } from './SidePanelPrimitivesMenu'
import { SidePanelVectorShapesMenu } from './SidePanelVectorShapesMenu'
import { TransformToolbarToggle } from './TransformToolbar'
import { PrimitivesToolbarToggle } from './PrimitivesToolbar'
import { activeExtrudeMode, activeLatheMode, activeLatheCaps } from '../stroke/drawExtrudeMode'
import { getLatheViewHint } from '../stroke/latheProfile'
import { SidePanelPixelEditorMenu } from './SidePanelPixelEditorMenu'
import { resolveTargetObjectIds } from '../material/materialEditorSlice'
import { computeSelectionFitFrame } from '../viewport/fitViewports'

const STROKE_MODES: { id: StrokeMode; label: string; hint: string }[] = [
  { id: 'outline', label: 'Outline', hint: 'Paint 3D soft doodle — close the loop to inflate a 3D shape' },
  { id: 'centerline', label: 'Path', hint: 'Open stroke → rounded tube path' },
  { id: 'blob', label: 'Blob', hint: 'Low-poly faceted volume (alternative doodle style)' },
]

const SCULPT_TOOLS: ActiveTool[] = ['push', 'pull', 'inflate', 'deflate', 'relax', 'pinch']

const TOOL_LABELS: Record<string, string> = {
  draw: 'Sketch',
  push: 'Push',
  pull: 'Pull',
  inflate: 'Inflate',
  deflate: 'Deflate',
  relax: 'Smooth',
  pinch: 'Pinch',
  'select-object': 'Select · Object',
  move: 'Move',
  rotate: 'Rotate',
  scale: 'Scale',
  'vector-pen': 'Vector · Pen',
  'vector-shape': 'Vector · Shape',
  'primitive-box': 'Draw · Primitive',
  'poly-draw': 'Draw · Poly',
  'boolean-hole': 'Hole · draw line',
  knife: 'Knife',
  'loop-cut': 'Loop Cut',
}

const POLY_DRAW_MODES: { id: PolyDrawMode; label: string }[] = [
  { id: 'triangle', label: 'Triangle' },
  { id: 'quad', label: 'Quad' },
  { id: 'poly', label: 'Poly' },
]

function SideBtnGroup({
  cols,
  children,
}: {
  cols: 2 | 3 | 4
  children: ReactNode
}) {
  return <div className={`side-btn-group cols-${cols}`}>{children}</div>
}

function SideSection({
  title,
  children,
  columns = 1,
  order = 0,
  collapsible = false,
  defaultCollapsed = false,
}: {
  title: string
  children: ReactNode
  columns?: 1 | 2
  /** Visual workflow order without coupling the panel's source layout to its presentation. */
  order?: number
  collapsible?: boolean
  defaultCollapsed?: boolean
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const contentId = useId()
  return (
    <section className="side-section" style={{ order }}>
      {collapsible ? (
        <button
          type="button"
          className="side-section-title side-section-toggle"
          onClick={() => setCollapsed((value) => !value)}
          aria-expanded={!collapsed}
          aria-controls={contentId}
        >
          <span>{title}</span>
          <span className="side-section-chevron" aria-hidden>
            {collapsed ? '▸' : '▾'}
          </span>
        </button>
      ) : (
        <h2 className="side-section-title">{title}</h2>
      )}
      <div
        id={contentId}
        hidden={collapsed}
        className={`side-section-body${columns === 2 ? ' side-section-cols-2' : ''}`}
      >
        {children}
      </div>
    </section>
  )
}

function SideSlider({
  label,
  value,
  display,
  min,
  max,
  step,
  warn,
  onChange,
  onCommit,
}: {
  label: string
  value: number
  display: string
  min: number
  max: number
  step: number
  warn?: boolean
  onChange: (v: number) => void
  onCommit?: () => void
}) {
  return (
    <div className="side-slider">
      <div className="side-slider-header">
        <label>{label}</label>
        <span className={`side-slider-value ${warn ? 'warn' : ''}`}>{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={() => onCommit?.()}
      />
    </div>
  )
}

function PanelResizeHandle({ onResize, width }: { onResize: (width: number) => void; width: number }) {
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const listenersRef = useRef<{ onMove: (ev: PointerEvent) => void; onUp: () => void } | null>(
    null
  )

  useEffect(() => {
    return () => {
      const listeners = listenersRef.current
      if (!listeners) return
      window.removeEventListener('pointermove', listeners.onMove)
      window.removeEventListener('pointerup', listeners.onUp)
      window.removeEventListener('pointercancel', listeners.onUp)
      listenersRef.current = null
      dragRef.current = null
    }
  }, [])

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      dragRef.current = {
        startX: e.clientX,
        startWidth: useAppStore.getState().sidePanelWidth,
      }

      const onMove = (ev: PointerEvent) => {
        if (!dragRef.current) return
        const delta = dragRef.current.startX - ev.clientX
        onResize(dragRef.current.startWidth + delta)
      }

      const onUp = () => {
        dragRef.current = null
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
        listenersRef.current = null
      }

      listenersRef.current = { onMove, onUp }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    [onResize]
  )

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 48 : 16
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      onResize(width + step)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      onResize(width - step)
    } else if (e.key === 'Home') {
      e.preventDefault()
      onResize(176)
    } else if (e.key === 'End') {
      e.preventDefault()
      onResize(420)
    }
  }

  return (
    <div
      className="side-panel-resizer"
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize side panel"
      aria-valuemin={176}
      aria-valuemax={420}
      aria-valuenow={width}
      tabIndex={0}
    />
  )
}

export function SidePanel() {
  const {
    activeTool,
    setActiveTool,
    activateSelectTool,
    selectionMode,
    setSelectionMode,
    selectAllInMode,
    deselectAllInMode,
    strokeMode,
    setStrokeMode,
    drawInputMode,
    setDrawInputMode,
    autoConnectPaths,
    setAutoConnectPaths,
    smoothDrawing,
    setSmoothDrawing,
    drawDoubleSided,
    setDrawDoubleSided,
    sketchExtrudeMode,
    penExtrudeMode,
    sketchLatheMode,
    penLatheMode,
    sketchLatheCaps,
    penLatheCaps,
    toggleExtrudeMode,
    toggleLatheMode,
    setLatheCaps,
    extrudeAmount,
    setExtrudeAmount,
    commitExtrudeDepth,
    activeShapeKind,
    setActiveShapeKind,
    activePrimitiveKind,
    setActivePrimitiveKind,
    roundedBoxRoundness,
    roundedBoxSubdivisions,
    setRoundedBoxRoundness,
    setRoundedBoxSubdivisions,
    showGrid,
    setShowGrid,
    showDensityHeatmap,
    setShowDensityHeatmap,
    viewportDisplayMode,
    setViewportDisplayMode,
    viewportXRay,
    setViewportXRay,
    requestViewportFit,
    setSelectionSmoothShading,
    toggleTopologyLock,
    simplifySelected,
    deleteSelection,
    setShowToolRing,
    uvEditorOpen,
    uvEditorPanel,
    toggleUvEditor,
    materialEditorOpen,
    materialEditorPanel,
    toggleMaterialEditor,
    togglePixelEditor,
    openPixelEditor,
    pixelEditorOpen,
    pixelEditorPanel,
    polyBudget,
    setPolyBudget,
    brushDensity,
    setBrushDensity,
    brushStrength,
    setBrushStrength,
    facetExaggeration,
    setFacetExaggeration,
    selectedObjectId,
    selectionObjectIds,
    meshSelection,
    objects,
    activeView,
    viewMoveBasis,
    sidePanelWidth,
    setSidePanelWidth,
    showSidePanel,
    canUndo,
    canRedo,
    undo,
    redo,
    symmetryEnabled,
    setSymmetryEnabled,
    symmetryAxis,
    setSymmetryAxis,
    symmetryPlane,
    setSymmetryPlane,
    copySelection,
    pasteClipboard,
    clipboard,
    polyDrawMode,
    setPolyDrawMode,
    polyDrawSnapAllScene,
    setPolyDrawSnapAllScene,
    flipSelectedNormals,
    recalculateOutwardNormals,
    makeSelectedDoubleSided,
    transformSelectionInViewPlane,
    subdivideSelected,
    toggleSubDSelected,
    setSubDLevelsSelected,
    applySubDSelected,
    loopCutDraft,
    loopCutCommit,
    loopCutCancel,
    imageDropMode,
    setImageDropMode,
    referenceImages,
    selectedReferenceImageId,
    updateReferenceImage,
    removeReferenceImage,
    billboardImages,
    selectedBillboardImageId,
    updateBillboardImage,
    removeBillboardImage,
  } = useAppStore(
    useShallow((s) => ({
      activeTool: s.activeTool,
      setActiveTool: s.setActiveTool,
      activateSelectTool: s.activateSelectTool,
      selectionMode: s.selectionMode,
      setSelectionMode: s.setSelectionMode,
      selectAllInMode: s.selectAllInMode,
      deselectAllInMode: s.deselectAllInMode,
      strokeMode: s.strokeMode,
      setStrokeMode: s.setStrokeMode,
      drawInputMode: s.drawInputMode,
      setDrawInputMode: s.setDrawInputMode,
      autoConnectPaths: s.autoConnectPaths,
      setAutoConnectPaths: s.setAutoConnectPaths,
      smoothDrawing: s.smoothDrawing,
      setSmoothDrawing: s.setSmoothDrawing,
      drawDoubleSided: s.drawDoubleSided,
      setDrawDoubleSided: s.setDrawDoubleSided,
      sketchExtrudeMode: s.sketchExtrudeMode,
      penExtrudeMode: s.penExtrudeMode,
      sketchLatheMode: s.sketchLatheMode,
      penLatheMode: s.penLatheMode,
      sketchLatheCaps: s.sketchLatheCaps,
      penLatheCaps: s.penLatheCaps,
      toggleExtrudeMode: s.toggleExtrudeMode,
      toggleLatheMode: s.toggleLatheMode,
      setLatheCaps: s.setLatheCaps,
      extrudeAmount: s.extrudeAmount,
      setExtrudeAmount: s.setExtrudeAmount,
      commitExtrudeDepth: s.commitExtrudeDepth,
      activeShapeKind: s.activeShapeKind,
      setActiveShapeKind: s.setActiveShapeKind,
      activePrimitiveKind: s.activePrimitiveKind,
      setActivePrimitiveKind: s.setActivePrimitiveKind,
      roundedBoxRoundness: s.roundedBoxRoundness,
      roundedBoxSubdivisions: s.roundedBoxSubdivisions,
      setRoundedBoxRoundness: s.setRoundedBoxRoundness,
      setRoundedBoxSubdivisions: s.setRoundedBoxSubdivisions,
      showGrid: s.showGrid,
      setShowGrid: s.setShowGrid,
      showDensityHeatmap: s.showDensityHeatmap,
      setShowDensityHeatmap: s.setShowDensityHeatmap,
      viewportDisplayMode: s.viewportDisplayMode,
      setViewportDisplayMode: s.setViewportDisplayMode,
      viewportXRay: s.viewportXRay,
      setViewportXRay: s.setViewportXRay,
      requestViewportFit: s.requestViewportFit,
      setSelectionSmoothShading: s.setSelectionSmoothShading,
      toggleTopologyLock: s.toggleTopologyLock,
      simplifySelected: s.simplifySelected,
      deleteSelection: s.deleteSelection,
      setShowToolRing: s.setShowToolRing,
      uvEditorOpen: s.uvEditorOpen,
      uvEditorPanel: s.uvEditorPanel,
      toggleUvEditor: s.toggleUvEditor,
      materialEditorOpen: s.materialEditorOpen,
      materialEditorPanel: s.materialEditorPanel,
      toggleMaterialEditor: s.toggleMaterialEditor,
      togglePixelEditor: s.togglePixelEditor,
      openPixelEditor: s.openPixelEditor,
      pixelEditorOpen: s.pixelEditorOpen,
      pixelEditorPanel: s.pixelEditorPanel,
      polyBudget: s.polyBudget,
      setPolyBudget: s.setPolyBudget,
      brushDensity: s.brushDensity,
      setBrushDensity: s.setBrushDensity,
      brushStrength: s.brushStrength,
      setBrushStrength: s.setBrushStrength,
      facetExaggeration: s.facetExaggeration,
      setFacetExaggeration: s.setFacetExaggeration,
      selectedObjectId: s.selectedObjectId,
      selectionObjectIds: s.selectionObjectIds,
      meshSelection: s.meshSelection,
      objects: s.objects,
      activeView: s.activeView,
      viewMoveBasis: s.viewMoveBasis,
      sidePanelWidth: s.sidePanelWidth,
      setSidePanelWidth: s.setSidePanelWidth,
      showSidePanel: s.showSidePanel,
      canUndo: s.canUndo,
      canRedo: s.canRedo,
      undo: s.undo,
      redo: s.redo,
      symmetryEnabled: s.symmetryEnabled,
      setSymmetryEnabled: s.setSymmetryEnabled,
      symmetryAxis: s.symmetryAxis,
      setSymmetryAxis: s.setSymmetryAxis,
      symmetryPlane: s.symmetryPlane,
      setSymmetryPlane: s.setSymmetryPlane,
      copySelection: s.copySelection,
      pasteClipboard: s.pasteClipboard,
      clipboard: s.clipboard,
      polyDrawMode: s.polyDrawMode,
      setPolyDrawMode: s.setPolyDrawMode,
      polyDrawSnapAllScene: s.polyDrawSnapAllScene,
      setPolyDrawSnapAllScene: s.setPolyDrawSnapAllScene,
      flipSelectedNormals: s.flipSelectedNormals,
      recalculateOutwardNormals: s.recalculateOutwardNormals,
      makeSelectedDoubleSided: s.makeSelectedDoubleSided,
      transformSelectionInViewPlane: s.transformSelectionInViewPlane,
      subdivideSelected: s.subdivideSelected,
      toggleSubDSelected: s.toggleSubDSelected,
      setSubDLevelsSelected: s.setSubDLevelsSelected,
      applySubDSelected: s.applySubDSelected,
      loopCutDraft: s.loopCutDraft,
      loopCutCommit: s.loopCutCommit,
      loopCutCancel: s.loopCutCancel,
      imageDropMode: s.imageDropMode,
      setImageDropMode: s.setImageDropMode,
      referenceImages: s.referenceImages,
      selectedReferenceImageId: s.selectedReferenceImageId,
      updateReferenceImage: s.updateReferenceImage,
      removeReferenceImage: s.removeReferenceImage,
      billboardImages: s.billboardImages,
      selectedBillboardImageId: s.selectedBillboardImageId,
      updateBillboardImage: s.updateBillboardImage,
      removeBillboardImage: s.removeBillboardImage,
    }))
  )

  const selectedReference = referenceImages.find((r) => r.id === selectedReferenceImageId)
  const selectedBillboard = billboardImages.find((b) => b.id === selectedBillboardImageId)

  const selectedObj = objects.find((o) => o.id === selectedObjectId)
  const selectionCount = selectionObjectIds.length
  const overBudget = selectedObj && selectedObj.positions.length > polyBudget
  const isSketchOrPen =
    drawInputMode === 'regular' ||
    drawInputMode === 'vector-pen' ||
    activeTool === 'draw' ||
    activeTool === 'vector-pen'

  const activeExtrudeOn = activeExtrudeMode({ drawInputMode, sketchExtrudeMode, penExtrudeMode })
  const activeLatheOn = activeLatheMode({
    drawInputMode,
    sketchExtrudeMode,
    penExtrudeMode,
    sketchLatheMode,
    penLatheMode,
    sketchLatheCaps,
    penLatheCaps,
  })
  const activeLatheCapsOn = activeLatheCaps({
    drawInputMode,
    sketchExtrudeMode,
    penExtrudeMode,
    sketchLatheMode,
    penLatheMode,
    sketchLatheCaps,
    penLatheCaps,
  })

  const selectedSketchDoodle =
    selectedObj?.sketchSource?.isClosed ? selectedObj.sketchSource : null
  const selectedVectorDoodle = selectedObj?.vectorSource ?? null
  const selectedExtrudableDoodle = selectedSketchDoodle ?? selectedVectorDoodle

  const isSelectTool =
    activeTool === 'select-object' ||
    activeTool === 'select-vertex' ||
    activeTool === 'select-edge' ||
    activeTool === 'select-face'

  const isSculptTool = SCULPT_TOOLS.includes(activeTool)

  const allSelectedSmooth =
    selectionCount > 0 &&
    selectionObjectIds.every((id) => objects.find((o) => o.id === id)?.smoothShading)

  const allSelectedFlat =
    selectionCount > 0 &&
    selectionObjectIds.every((id) => !objects.find((o) => o.id === id)?.smoothShading)

  const selectedSubDActive =
    selectionCount > 0 &&
    selectionObjectIds.some((id) => objects.find((o) => o.id === id)?.subdEnabled)

  const selectedSubDLevel =
    selectionCount === 1 && selectedObjectId
      ? (objects.find((o) => o.id === selectedObjectId)?.subdLevels ?? 0)
      : selectedSubDActive
        ? Math.max(
            ...selectionObjectIds.map((id) => objects.find((o) => o.id === id)?.subdLevels ?? 0)
          )
        : 0

  const hasDeletableSelection =
    selectionCount > 0 ||
    (selectionMode !== 'object' && selectionHasComponents(meshSelection))

  const componentTargetId =
    meshSelection?.objectId ?? selectedObjectId ?? selectionObjectIds[0] ?? null
  const componentTarget = componentTargetId
    ? objects.find((o) => o.id === componentTargetId)
    : undefined

  const canSelectAllInMode =
    selectionMode === 'object'
      ? objects.length > 0
      : !!(componentTarget ?? objects.length > 0)

  const canDeselectAllInMode =
    selectionMode === 'object'
      ? selectionCount > 0
      : selectionHasComponents(meshSelection)

  const canFitViews = resolveTargetObjectIds(selectedObjectId, selectionObjectIds).some((id) => {
    const obj = objects.find((o) => o.id === id)
    return !!obj && obj.positions.length > 0
  })

  const handleFitViews = useCallback(() => {
    const ids = resolveTargetObjectIds(selectedObjectId, selectionObjectIds)
    const frame = computeSelectionFitFrame(objects, ids)
    if (!frame) return
    requestViewportFit(frame)
  }, [selectedObjectId, selectionObjectIds, objects, requestViewportFit])

  const canPlaneTransform = (() => {
    if (activeView === 'perspective' && !viewMoveBasis) return false
    if (selectionHasComponents(meshSelection)) {
      const obj = objects.find((o) => o.id === meshSelection!.objectId)
      return !!obj && !obj.topologyLocked
    }
    const ids =
      selectionObjectIds.length > 0
        ? selectionObjectIds
        : selectedObjectId
          ? [selectedObjectId]
          : []
    return ids.some((id) => {
      const obj = objects.find((o) => o.id === id)
      return obj && !obj.topologyLocked
    })
  })()

  const selectAllTitle =
    selectionMode === 'object'
      ? 'Select all objects'
      : selectionMode === 'vertex'
        ? 'Select all vertices on the active object'
        : selectionMode === 'edge'
          ? 'Select all edges on the active object'
          : 'Select all faces on the active object'

  const deselectAllTitle =
    selectionMode === 'object'
      ? 'Deselect all objects'
      : selectionMode === 'vertex'
        ? 'Deselect all vertices'
        : selectionMode === 'edge'
          ? 'Deselect all edges'
          : 'Deselect all faces'

  const activeLabel =
    activeTool === 'primitive-box' && activePrimitiveKind
      ? `Draw · ${PRIMITIVE_KINDS.find((p) => p.id === activePrimitiveKind)?.label ?? activePrimitiveKind}`
      : activeTool === 'vector-shape'
      ? 'Vector · Shape'
      : drawInputMode === 'vector-pen'
        ? 'Vector · Pen'
        : TOOL_LABELS[activeTool] ?? activeTool

  const handleShapeKindChange = (kind: typeof activeShapeKind) => {
    setActiveShapeKind(kind)
  }

  const handlePrimitiveKindChange = (kind: PrimitiveKind) => {
    setActivePrimitiveKind(kind)
  }

  if (!showSidePanel) return null

  return (
    <>
      <PanelResizeHandle onResize={setSidePanelWidth} width={sidePanelWidth} />
      <aside className="side-panel" style={{ width: sidePanelWidth }}>
        <div className="side-panel-header">
          <SidePanelFileMenu />
          <span className={`tool-badge ${activeTool}`}>{activeLabel}</span>
          <div className="side-history-actions">
            <button
              type="button"
              className="side-history-btn"
              disabled={!canUndo}
              onClick={() => undo()}
              title="Undo (Ctrl+Z)"
            >
              Undo
            </button>
            <button
              type="button"
              className="side-history-btn"
              disabled={!canRedo}
              onClick={() => redo()}
              title="Redo (Ctrl+Y)"
            >
              Redo
            </button>
          </div>
        </div>

        <div className="side-panel-scroll themed-scroll">
          <SideSection title="Quick start" order={24} columns={2}>
            <button
              className="side-btn side-btn-wide"
              onClick={() => setShowToolRing(true)}
              title="Open tool ring (Tab to toggle)"
            >
              Tools (Tab)
            </button>
            <TransformToolbarToggle />
            <PrimitivesToolbarToggle />
          </SideSection>

          <SideSection title="View" columns={2} order={70}>
            <select
              className="shape-kind-select side-select"
              value={viewportDisplayMode}
              onChange={(e) =>
                setViewportDisplayMode(e.target.value as ViewportDisplayMode)
              }
              title={VIEWPORT_DISPLAY_CONFIG[viewportDisplayMode].hint}
            >
              {VIEWPORT_DISPLAY_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {VIEWPORT_DISPLAY_CONFIG[mode].label}
                </option>
              ))}
            </select>
            <p className="side-color-hint muted">
              {VIEWPORT_DISPLAY_CONFIG[viewportDisplayMode].hint}
            </p>
            <SideBtnGroup cols={2}>
              <button
                className={`side-btn ${showGrid ? 'active' : ''}`}
                onClick={() => setShowGrid(!showGrid)}
                title="Toggle grid (G)"
              >
                Grid
              </button>
              <button
                className={`side-btn ${showDensityHeatmap ? 'active' : ''}`}
                onClick={() => setShowDensityHeatmap(!showDensityHeatmap)}
              >
                Heatmap
              </button>
            </SideBtnGroup>
            <button
              type="button"
              className="side-btn side-btn-wide"
              disabled={!canFitViews}
              onClick={handleFitViews}
              title="Reset all viewports to their default orientation and fit them to the selected object(s)"
            >
              Reset & Fit
            </button>
          </SideSection>

          <SideSection title="Color" order={15}>
            <PaletteBar variant="side" />
            <SidePanelPixelEditorMenu
              open={pixelEditorOpen}
              minimized={pixelEditorPanel.minimized}
              canPaintOnModel={selectionCount > 0 || !!selectedObjectId}
              onOpen={() => openPixelEditor()}
              onClose={togglePixelEditor}
              onPaintOnModel={() => openPixelEditor({ paintOnModel: true })}
              onNewDocument={(width, height) => openPixelEditor({ width, height })}
              onShowCanvas={togglePixelEditor}
            />
            <button
              className={`side-btn side-btn-wide ${uvEditorOpen ? 'active' : ''}`}
              onClick={toggleUvEditor}
              disabled={selectionCount === 0 && !selectedObjectId}
              title={
                uvEditorOpen && uvEditorPanel.minimized
                  ? 'Restore UV Editor'
                  : 'UV Editor — edit texture coordinates for selected object'
              }
            >
              UV Editor{uvEditorOpen && uvEditorPanel.minimized ? ' ▾' : ''}
            </button>
            <button
              className={`side-btn side-btn-wide ${materialEditorOpen ? 'active' : ''}`}
              onClick={toggleMaterialEditor}
              disabled={selectionCount === 0 && !selectedObjectId}
              title={
                materialEditorOpen && materialEditorPanel.minimized
                  ? 'Restore Material Editor'
                  : 'Material Editor — colors, palettes, gradients'
              }
            >
              Material Editor{materialEditorOpen && materialEditorPanel.minimized ? ' ▾' : ''}
            </button>
          </SideSection>

          <SideSection title="Create" columns={2} order={10}>
            <SideBtnGroup cols={2}>
              <button
                className={`side-btn ${drawInputMode === 'regular' ? 'active' : ''}`}
                onClick={() => setDrawInputMode('regular')}
                title="Freehand sketch (D)"
              >
                Sketch
              </button>
              <button
                className={`side-btn ${drawInputMode === 'vector-pen' ? 'active' : ''}`}
                onClick={() => setDrawInputMode('vector-pen')}
                title="Illustrator-style pen (V)"
              >
                Vector Pen
              </button>
            </SideBtnGroup>
            {drawInputMode === 'vector-pen' && (
              <p className="side-color-hint muted">
                Click to add points · drag for curves · click first point to close · edit
                anchors/handles · Enter or double-click commits to 3D · Esc cancels
              </p>
            )}
            <div className="side-checkbox-row">
              <label className="side-checkbox" title="Snap to path endpoints">
                <input
                  type="checkbox"
                  checked={autoConnectPaths}
                  onChange={(e) => setAutoConnectPaths(e.target.checked)}
                />
                <span>Auto-connect</span>
              </label>
              <label
                className="side-checkbox"
                title="Steady freehand drawing — softens mouse jitter for smoother sketch strokes"
              >
                <input
                  type="checkbox"
                  checked={smoothDrawing}
                  onChange={(e) => setSmoothDrawing(e.target.checked)}
                />
                <span>Smooth draw</span>
              </label>
            </div>
            <div className="side-checkbox-row">
              <label
                className="side-checkbox"
                title="Only the front of faces is visible (back faces are culled)"
              >
                <input
                  type="checkbox"
                  checked={!drawDoubleSided}
                  onChange={() => setDrawDoubleSided(false)}
                />
                <span>Single-sided</span>
              </label>
              <label
                className="side-checkbox"
                title="Both sides of faces are visible — good for thin planes and open shells"
              >
                <input
                  type="checkbox"
                  checked={drawDoubleSided}
                  onChange={() => setDrawDoubleSided(true)}
                />
                <span>Double-sided</span>
              </label>
            </div>
            <div className="side-shape-menus">
              <SidePanelPrimitivesMenu
                activePrimitiveKind={activePrimitiveKind}
                primitiveToolActive={activeTool === 'primitive-box'}
                onSelect={handlePrimitiveKindChange}
              />
              <SidePanelVectorShapesMenu
                activeShapeKind={activeShapeKind}
                vectorShapeToolActive={activeTool === 'vector-shape'}
                onSelect={handleShapeKindChange}
              />
            </div>
            <SideBtnGroup cols={3}>
              {POLY_DRAW_MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`side-btn ${activeTool === 'poly-draw' && polyDrawMode === m.id ? 'active' : ''}`}
                  onClick={() => setPolyDrawMode(m.id)}
                  title={`Poly draw · ${m.label}`}
                >
                  {m.label}
                </button>
              ))}
            </SideBtnGroup>
            {activeTool === 'poly-draw' && (
              <>
                <label className="side-checkbox" title="Snap to vertices on all scene objects">
                  <input
                    type="checkbox"
                    checked={polyDrawSnapAllScene}
                    onChange={(e) => setPolyDrawSnapAllScene(e.target.checked)}
                  />
                  <span>Snap all objects</span>
                </label>
                <p className="side-color-hint muted">
                  Click points in any view. Snap to vertices to weld faces. Enter or close loop to finish poly. F flips last face normal. Esc cancels.
                </p>
              </>
            )}
            <SideBtnGroup cols={3}>
              {STROKE_MODES.map((m) => (
                <button
                  key={m.id}
                  className={`side-btn ${strokeMode === m.id && !activeExtrudeOn && !activeLatheOn ? 'active' : ''}`}
                  onClick={() => setStrokeMode(m.id)}
                  title={m.hint}
                >
                  {m.label}
                </button>
              ))}
            </SideBtnGroup>
            <SideBtnGroup cols={2}>
              <button
                type="button"
                className={`side-btn ${activeExtrudeOn ? 'active' : ''}`}
                onClick={toggleExtrudeMode}
                title={
                  drawInputMode === 'vector-pen'
                    ? 'Extrude vector pen strokes into 3D capsule doodles'
                    : 'Extrude sketch strokes into 3D capsule doodles'
                }
              >
                Extrude
              </button>
              <button
                type="button"
                className={`side-btn ${activeLatheOn ? 'active' : ''}`}
                onClick={toggleLatheMode}
                title={
                  drawInputMode === 'vector-pen'
                    ? 'Revolve vector pen profile — shape follows the orthographic view you draw in'
                    : 'Revolve sketch profile — shape follows the orthographic view you draw in'
                }
              >
                Lathe
              </button>
            </SideBtnGroup>
            {activeLatheOn && (
              <>
                <label className="side-checkbox" title="Add flat caps at the top and bottom of the lathe">
                  <input
                    type="checkbox"
                    checked={activeLatheCapsOn}
                    onChange={(e) => setLatheCaps(e.target.checked)}
                  />
                  <span>Top &amp; bottom caps</span>
                </label>
                <p className="side-color-hint muted">{getLatheViewHint(activeView)}</p>
              </>
            )}
            {selectedObj?.topologyLocked && (
              <div className="side-chips">
                <span className="lock-indicator">Locked</span>
              </div>
            )}
            {strokeMode === 'blob' && (
              <SideSlider
                label="Stylize"
                value={facetExaggeration}
                display={`${(facetExaggeration * 100).toFixed(0)}%`}
                min={0}
                max={1}
                step={0.05}
                onChange={setFacetExaggeration}
              />
            )}
          </SideSection>

          {isSketchOrPen && (
            <SideSection title="Stroke" order={11} collapsible>
              <SideSlider
                label="Extrude depth"
                value={extrudeAmount}
                display={String(Math.round(extrudeAmount))}
                min={-64}
                max={64}
                step={1}
                onChange={setExtrudeAmount}
                onCommit={selectedExtrudableDoodle ? commitExtrudeDepth : undefined}
              />
              {selectedExtrudableDoodle && (
                <p className="side-color-hint muted">
                  Adjust depth for the selected doodle in real time.
                </p>
              )}
              {activeExtrudeOn && !selectedExtrudableDoodle && drawInputMode === 'regular' && (
                <p className="side-color-hint muted">
                  Drag up or right to extrude farther; left or down extrudes the opposite way.
                </p>
              )}
              {activeExtrudeOn && !selectedExtrudableDoodle && drawInputMode === 'vector-pen' && (
                <p className="side-color-hint muted">
                  Set extrude depth with the slider; drawing will not change it.
                </p>
              )}
              <SideSlider
                label="Poly budget"
                value={polyBudget}
                display={String(polyBudget)}
                min={24}
                max={256}
                step={4}
                warn={!!overBudget}
                onChange={setPolyBudget}
              />
              <SideSlider
                label="Brush density"
                value={brushDensity}
                display={String(brushDensity)}
                min={4}
                max={24}
                step={1}
                onChange={setBrushDensity}
              />
              <p className="side-color-hint muted">
                Poly budget caps mesh complexity. Brush density sets stroke thickness and default inflate depth.
              </p>
            </SideSection>
          )}

          {activeTool === 'vector-shape' && (
            <SideSection title="Vector" order={12}>
              <p className="side-color-hint muted">Drag in an ortho view to place.</p>
              {activeShapeKind === 'roundedBox' && (
                <>
                  <SideSlider
                    label="Roundness"
                    value={roundedBoxRoundness}
                    display={`${Math.round(roundedBoxRoundness * 100)}%`}
                    min={0}
                    max={1}
                    step={0.05}
                    onChange={setRoundedBoxRoundness}
                  />
                  <SideSlider
                    label="Subdivisions"
                    value={roundedBoxSubdivisions}
                    display={String(roundedBoxSubdivisions)}
                    min={0}
                    max={3}
                    step={1}
                    onChange={setRoundedBoxSubdivisions}
                  />
                  <p className="side-color-hint muted">
                    Scroll while dragging: subdivisions · Shift+scroll: roundness.
                  </p>
                </>
              )}
            </SideSection>
          )}

          {isSculptTool && (
            <SideSection title="Sculpt" order={13}>
              <SideSlider
                label="Brush strength"
                value={brushStrength}
                display={brushStrength.toFixed(1)}
                min={0.1}
                max={1}
                step={0.1}
                onChange={setBrushStrength}
              />
              <p className="side-color-hint muted">
                Drag on a mesh to sculpt. Hold Shift for alternate sculpt mode.
              </p>
            </SideSection>
          )}

          <SideSection title="Selection" columns={2} order={20}>
            <SideBtnGroup cols={2}>
              <button
                className={`side-btn ${selectionMode === 'object' ? 'active' : ''}`}
                onClick={() => setSelectionMode('object')}
                title="Select objects (1 or Q)"
              >
                Object
              </button>
              <button
                className={`side-btn ${selectionMode === 'vertex' ? 'active' : ''}`}
                onClick={() => setSelectionMode('vertex')}
                title="Select vertices (2)"
              >
                Vertex
              </button>
              <button
                className={`side-btn ${selectionMode === 'edge' ? 'active' : ''}`}
                onClick={() => setSelectionMode('edge')}
                title="Select edges (3)"
              >
                Edge
              </button>
              <button
                className={`side-btn ${selectionMode === 'face' ? 'active' : ''}`}
                onClick={() => setSelectionMode('face')}
                title="Select faces (4)"
              >
                Face
              </button>
            </SideBtnGroup>
            <SideBtnGroup cols={2}>
              <button
                type="button"
                className="side-btn"
                onClick={selectAllInMode}
                disabled={!canSelectAllInMode}
                title={selectAllTitle}
              >
                Select all
              </button>
              <button
                type="button"
                className="side-btn"
                onClick={deselectAllInMode}
                disabled={!canDeselectAllInMode}
                title={deselectAllTitle}
              >
                Deselect all
              </button>
            </SideBtnGroup>
            <button
              className={`side-btn ${viewportXRay ? 'active' : ''}`}
              onClick={() => setViewportXRay(!viewportXRay)}
              title="Toggle X-ray (X)"
            >
              X-ray
            </button>
            {selectionMode === 'vertex' && (
              <p className="side-color-hint muted">
                Click to select vertices · drag to move · Shift+click to add/remove. F: face from selection. M: merge · hold M and click a second vertex.
              </p>
            )}
            {selectionMode === 'face' && (
              <p className="side-color-hint muted">
                Select faces and pick a color from the palette to recolor them.
              </p>
            )}
          </SideSection>

          <SideSection title="Transform" columns={2} order={21}>
            <SideBtnGroup cols={2}>
              <button
                className={`side-btn ${activeTool === 'move' ? 'active' : ''}`}
                onClick={() => setActiveTool('move')}
                title="Move (W)"
              >
                Move
              </button>
              <button
                className={`side-btn ${activeTool === 'rotate' ? 'active' : ''}`}
                onClick={() => setActiveTool('rotate')}
                title="Rotate (R — drag mouse after pressing)"
              >
                Rotate
              </button>
              <button
                className={`side-btn ${activeTool === 'scale' ? 'active' : ''}`}
                onClick={() => setActiveTool('scale')}
                title="Scale (S — drag mouse after pressing)"
              >
                Scale
              </button>
              <button
                className={`side-btn ${activeTool === 'bend' ? 'active' : ''}`}
                onClick={() => setActiveTool('bend')}
                disabled={selectionCount === 0 && !selectedObjectId}
                title="Bend — click-drag axis on object, drag vertically to angle, double-click to apply, Esc to cancel"
              >
                Bend
              </button>
              <button
                className={`side-btn ${isSelectTool ? 'active' : ''}`}
                onClick={activateSelectTool}
                title="Select · click and drag (Q for object mode)"
              >
                Select
              </button>
            </SideBtnGroup>
            {activeTool === 'bend' && (
              <p className="side-color-hint muted">
                Click and drag on the object to place the bend axis. Drag vertically to set the angle.
                Double-click to apply · Esc to cancel.
              </p>
            )}
            <SideBtnGroup cols={3}>
              <button
                type="button"
                className="side-btn"
                disabled={!canPlaneTransform}
                onClick={() => transformSelectionInViewPlane('flipH')}
                title="Flip selection horizontally in the active viewport"
              >
                Flip H
              </button>
              <button
                type="button"
                className="side-btn"
                disabled={!canPlaneTransform}
                onClick={() => transformSelectionInViewPlane('flipV')}
                title="Flip selection vertically in the active viewport"
              >
                Flip V
              </button>
              <button
                type="button"
                className="side-btn"
                disabled={!canPlaneTransform}
                onClick={() => transformSelectionInViewPlane('rotate90')}
                title="Rotate selection 90° clockwise in the active viewport"
              >
                Rot 90°
              </button>
            </SideBtnGroup>
          </SideSection>

          <SideSection title="Symmetry" order={23} collapsible defaultCollapsed>
            <label className="side-checkbox" title="Mirror new geometry and sculpt strokes (Blockbench-style)">
              <input
                type="checkbox"
                checked={symmetryEnabled}
                onChange={(e) => setSymmetryEnabled(e.target.checked)}
              />
              <span>Mirror</span>
            </label>
            <SideBtnGroup cols={3}>
              {(['x', 'y', 'z'] as SymmetryAxis[]).map((axis) => (
                <button
                  key={axis}
                  type="button"
                  className={`side-btn ${symmetryAxis === axis ? 'active' : ''}`}
                  disabled={!symmetryEnabled}
                  onClick={() => setSymmetryAxis(axis)}
                  title={`Mirror across ${axis.toUpperCase()} axis`}
                >
                  {axis.toUpperCase()}
                </button>
              ))}
            </SideBtnGroup>
            <SideSlider
              label="Plane"
              value={symmetryPlane}
              display={symmetryPlane.toFixed(1)}
              min={-256}
              max={256}
              step={1}
              onChange={setSymmetryPlane}
            />
            <p className="side-color-hint muted">
              Drag the dashed line in ortho views to move the mirror plane.
            </p>
          </SideSection>

          <SideSection title="Mesh editing" columns={2} order={22} collapsible defaultCollapsed>
            <SideBtnGroup cols={2}>
              <button
                className="side-btn"
                onClick={flipSelectedNormals}
                disabled={
                  selectionMode === 'object' ||
                  !selectionHasComponents(meshSelection) ||
                  !!selectedObj?.topologyLocked
                }
                title="Flip normals on selected faces (F when not creating from vertices)"
              >
                Flip Normals
              </button>
              <button
                className="side-btn"
                onClick={recalculateOutwardNormals}
                disabled={!selectedObj || !!selectedObj.topologyLocked}
                title="Recalculate winding order to make selected faces (or all faces if nothing selected) face outward"
              >
                Recalc Outward
              </button>
              <button
                className="side-btn"
                onClick={makeSelectedDoubleSided}
                disabled={
                  selectionMode === 'object' ||
                  !selectionHasComponents(meshSelection) ||
                  !!selectedObj?.topologyLocked
                }
                title="Duplicate selected faces with reversed normals and identical UV coordinates to make them double-sided"
              >
                Double Sided
              </button>
              <button
                className="side-btn"
                onClick={subdivideSelected}
                disabled={selectionCount === 0 || !!selectedObj?.topologyLocked}
                title="Subdivide selected faces — edit-mode topology split (not SubD smooth)"
              >
                Subdivide
              </button>
              <button
                className={`side-btn ${selectedSubDActive ? 'active' : ''}`}
                onClick={toggleSubDSelected}
                disabled={selectionCount === 0 || !!selectedObj?.topologyLocked}
                title="Subdivision Surface preview — Catmull-Clark smooth (Ctrl+2 / Ctrl+Shift+2 levels)"
              >
                SubD
              </button>
              <button
                className={`side-btn ${activeTool === 'knife' ? 'active' : ''}`}
                onClick={() => setActiveTool('knife')}
                disabled={selectionCount === 0}
                title="Knife — drag a cut line on mesh; snaps to verts/edges; Shift = 45° (K)"
              >
                Knife
              </button>
              <button
                className={`side-btn ${activeTool === 'loop-cut' ? 'active' : ''}`}
                onClick={() => {
                  setSelectionMode('edge')
                  setActiveTool('loop-cut')
                }}
                disabled={selectionCount === 0}
                title="Loop cut — click edge, scroll to slide, click to confirm (Ctrl+R)"
              >
                Loop Cut
              </button>
            </SideBtnGroup>
            {selectionCount > 0 && !selectedObj?.topologyLocked && (
              <>
                <SideSlider
                  label="SubD viewport"
                  value={selectedSubDLevel}
                  display={String(selectedSubDLevel)}
                  min={0}
                  max={3}
                  step={1}
                  onChange={setSubDLevelsSelected}
                />
                <SideBtnGroup cols={2}>
                  <button
                    className="side-btn"
                    onClick={applySubDSelected}
                    disabled={!selectedSubDActive || selectedSubDLevel <= 0}
                    title="Apply subdivision — bake smooth mesh to geometry (like Blender modifier Apply)"
                  >
                    Apply SubD
                  </button>
                  <button
                    className="side-btn"
                    onClick={() => setSubDLevelsSelected(0)}
                    disabled={!selectedSubDActive}
                    title="Disable subdivision preview"
                  >
                    Clear SubD
                  </button>
                </SideBtnGroup>
              </>
            )}
            {loopCutDraft && (
              <SideBtnGroup cols={2}>
                <button className="side-btn side-btn-primary" onClick={loopCutCommit}>
                  Confirm Cut
                </button>
                <button className="side-btn" onClick={loopCutCancel}>
                  Cancel
                </button>
              </SideBtnGroup>
            )}
          </SideSection>

          <SideSection title="References & images" order={40} collapsible defaultCollapsed>
            <p className="side-color-hint muted">
              Pick one mode, then drag an image into any viewport.
            </p>
            <label className="side-checkbox" title="2D overlay — drag to move, corner handle to resize">
              <input
                type="radio"
                name="image-drop-mode"
                checked={imageDropMode === 'reference'}
                onChange={() => setImageDropMode('reference')}
              />
              <span>Reference images</span>
            </label>
            <label className="side-checkbox" title="3D image that always faces the camera">
              <input
                type="radio"
                name="image-drop-mode"
                checked={imageDropMode === 'billboard'}
                onChange={() => setImageDropMode('billboard')}
              />
              <span>3D Billboard</span>
            </label>
            <label className="side-checkbox" title="3D textured quad in the scene">
              <input
                type="radio"
                name="image-drop-mode"
                checked={imageDropMode === 'textured-plane'}
                onChange={() => setImageDropMode('textured-plane')}
              />
              <span>3D Textured plane</span>
            </label>
            <label className="side-checkbox" title="Disable image drag-and-drop">
              <input
                type="radio"
                name="image-drop-mode"
                checked={imageDropMode === 'off'}
                onChange={() => setImageDropMode('off')}
              />
              <span>Off</span>
            </label>
            {selectedReference && (
              <>
                <SideSlider
                  label="Reference opacity"
                  value={selectedReference.opacity}
                  display={`${Math.round(selectedReference.opacity * 100)}%`}
                  min={0.1}
                  max={1}
                  step={0.05}
                  onChange={(v) => updateReferenceImage(selectedReference.id, { opacity: v })}
                />
                <p className="side-color-hint muted">
                  Select tool (Q) to move · drag corner handle to resize · Delete to remove.
                </p>
                <button
                  type="button"
                  className="side-btn side-btn-wide"
                  onClick={() => removeReferenceImage(selectedReference.id)}
                >
                  Remove reference
                </button>
              </>
            )}
            {selectedBillboard && (
              <>
                <SideSlider
                  label="Billboard opacity"
                  value={selectedBillboard.opacity}
                  display={`${Math.round(selectedBillboard.opacity * 100)}%`}
                  min={0.1}
                  max={1}
                  step={0.05}
                  onChange={(v) => updateBillboardImage(selectedBillboard.id, { opacity: v })}
                />
                <p className="side-color-hint muted">
                  Select tool (Q) or Move/Rotate/Scale (W/E/R) gizmos · Delete to remove.
                </p>
                <button
                  type="button"
                  className="side-btn side-btn-wide"
                  onClick={() => removeBillboardImage(selectedBillboard.id)}
                >
                  Remove billboard
                </button>
              </>
            )}
            {imageDropMode === 'textured-plane' && (
              <p className="side-color-hint muted">
                Drops a textured mesh you can move like any object.
              </p>
            )}
          </SideSection>

          <SideSection title="Object actions" columns={2} order={30} collapsible defaultCollapsed>
            <SideBtnGroup cols={2}>
              <button className="side-btn" onClick={toggleTopologyLock} title="Lock topology (L)">
                Lock
              </button>
              <button
                className={`side-btn ${allSelectedFlat ? 'active' : ''}`}
                onClick={() => setSelectionSmoothShading(false)}
                disabled={selectionCount === 0}
                title="Shade flat — faceted low-poly look (Blender Shade Flat)"
              >
                Shade Flat
              </button>
              <button
                className={`side-btn ${allSelectedSmooth ? 'active' : ''}`}
                onClick={() => setSelectionSmoothShading(true)}
                disabled={selectionCount === 0}
                title="Shade smooth — averaged vertex normals (Blender Shade Smooth)"
              >
                Shade Smooth
              </button>
              <button className="side-btn" onClick={simplifySelected}>
                Reduce
              </button>
              <button
                className="side-btn"
                onClick={deleteSelection}
                disabled={!hasDeletableSelection}
                title="Delete selection (Del)"
              >
                Delete
              </button>
              <button
                className="side-btn"
                onClick={copySelection}
                disabled={selectionCount === 0}
                title="Copy selection (Ctrl+C)"
              >
                Copy
              </button>
              <button
                className="side-btn"
                onClick={pasteClipboard}
                disabled={!clipboard?.length}
                title="Paste (Ctrl+V)"
              >
                Paste
              </button>
            </SideBtnGroup>
          </SideSection>

          <SideSection title="Theme" order={60} collapsible defaultCollapsed>
            <ThemePicker />
          </SideSection>
        </div>
      </aside>
    </>
  )
}
