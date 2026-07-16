import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
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
import { AppBrandMark } from './AppBrandMark'
import { SidePanelPrimitivesMenu, PRIMITIVE_KINDS } from './SidePanelPrimitivesMenu'
import { SidePanelVectorShapesMenu } from './SidePanelVectorShapesMenu'
import { TransformToolbarToggle } from './TransformToolbar'
import { PrimitivesToolbarToggle } from './PrimitivesToolbar'
import { activeExtrudeMode, activeLatheMode, activeLatheCaps } from '../stroke/drawExtrudeMode'
import { getLatheViewHint } from '../stroke/latheProfile'
import { SidePanelPixelEditorMenu } from './SidePanelPixelEditorMenu'
import { SideButtonDropdown } from './SideButtonDropdown'
import { resolveTargetObjectIds } from '../material/materialEditorSlice'
import { computeSelectionFitFrame } from '../viewport/fitViewports'
import { boxCenterSize } from '../primitives/primitiveBoxMath'
import { HairTextureDialog } from './HairTextureDialog'
import { listSceneTextures } from '../uv/sceneTextures'

const STROKE_MODES: { id: StrokeMode; label: string; hint: string }[] = [
  { id: 'outline', label: 'Outline', hint: 'Draw a closed outline → filled flat 3D shape' },
  { id: 'centerline', label: 'Path', hint: 'Open stroke → tube path along the stroke (quad rings)' },
  { id: 'blob', label: 'Blob', hint: 'Soft inflated volume — close the loop to fill a 3D shape' },
  {
    id: 'capsule',
    label: 'Capsule',
    hint: 'Closed loop → silhouette capsule; open stroke → bend a capsule along the path',
  },
  { id: 'ribbon', label: 'Ribbon', hint: 'Flat UV-mapped strip for straps, cloth, leaves, and decals' },
  { id: 'tapered-tube', label: 'Tapered Tube', hint: 'UV-mapped round tube tapering toward both ends' },
  {
    id: 'hair-paths',
    label: 'Hair Paths',
    hint: 'Draw a stroke → smooth hair ribbon (Pointed or Square tips); color or UV texture',
  },
  {
    id: 'hair-strips',
    label: 'Hair Strips',
    hint: 'Draw a stroke → low-poly hair cards (Pointed or Square tips); color or UV texture',
  },
  {
    id: 'hair-round',
    label: 'Rounded Hair',
    hint: 'Draw a stroke → rounded tube strand (Pointed needle tips or Square blunt ends)',
  },
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
  'mirror-knife': 'Mirror Knife',
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
  collapsible = true,
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
    hairTipStyle,
    setHairTipStyle,
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
    blobInflation,
    setBlobInflation,
    commitExtrudeDepth,
    editingSketchObjectId,
    setEditingSketchObject,
    updateSelectedSketchSource,
    commitSketchSourceEdit,
    convertSelectedSketchToMesh,
    activeShapeKind,
    setActiveShapeKind,
    activePrimitiveKind,
    setActivePrimitiveKind,
    roundedBoxRoundness,
    roundedBoxSubdivisions,
    setRoundedBoxRoundness,
    setRoundedBoxSubdivisions,
    updateSelectedPrimitiveSource,
    commitPrimitiveSourceEdit,
    convertSelectedPrimitiveToMesh,
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
    knifeDraft,
    knifeRemoveLastPoint,
    knifeApply,
    knifeCancel,
    loopCutDraft,
    loopCutCommit,
    loopCutCancel,
    imageDropMode,
    setImageDropMode,
    referenceImages,
    selectedReferenceImageId,
    updateReferenceImage,
    commitReferenceImageEdit,
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
      hairTipStyle: s.hairTipStyle,
      setHairTipStyle: s.setHairTipStyle,
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
      blobInflation: s.blobInflation,
      setBlobInflation: s.setBlobInflation,
      commitExtrudeDepth: s.commitExtrudeDepth,
      editingSketchObjectId: s.editingSketchObjectId,
      setEditingSketchObject: s.setEditingSketchObject,
      updateSelectedSketchSource: s.updateSelectedSketchSource,
      commitSketchSourceEdit: s.commitSketchSourceEdit,
      convertSelectedSketchToMesh: s.convertSelectedSketchToMesh,
      activeShapeKind: s.activeShapeKind,
      setActiveShapeKind: s.setActiveShapeKind,
      activePrimitiveKind: s.activePrimitiveKind,
      setActivePrimitiveKind: s.setActivePrimitiveKind,
      roundedBoxRoundness: s.roundedBoxRoundness,
      roundedBoxSubdivisions: s.roundedBoxSubdivisions,
      setRoundedBoxRoundness: s.setRoundedBoxRoundness,
      setRoundedBoxSubdivisions: s.setRoundedBoxSubdivisions,
      updateSelectedPrimitiveSource: s.updateSelectedPrimitiveSource,
      commitPrimitiveSourceEdit: s.commitPrimitiveSourceEdit,
      convertSelectedPrimitiveToMesh: s.convertSelectedPrimitiveToMesh,
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
      knifeDraft: s.knifeDraft,
      knifeRemoveLastPoint: s.knifeRemoveLastPoint,
      knifeApply: s.knifeApply,
      knifeCancel: s.knifeCancel,
      loopCutDraft: s.loopCutDraft,
      loopCutCommit: s.loopCutCommit,
      loopCutCancel: s.loopCutCancel,
      imageDropMode: s.imageDropMode,
      setImageDropMode: s.setImageDropMode,
      referenceImages: s.referenceImages,
      selectedReferenceImageId: s.selectedReferenceImageId,
      updateReferenceImage: s.updateReferenceImage,
      commitReferenceImageEdit: s.commitReferenceImageEdit,
      removeReferenceImage: s.removeReferenceImage,
      billboardImages: s.billboardImages,
      selectedBillboardImageId: s.selectedBillboardImageId,
      updateBillboardImage: s.updateBillboardImage,
      removeBillboardImage: s.removeBillboardImage,
    }))
  )

  const hairTextureId = useAppStore((s) => s.hairTextureId)
  const pixelDocuments = useAppStore((s) => s.pixelDocuments)
  const objectTextures = useAppStore((s) => s.objectTextures)
  const [showHairTextureDialog, setShowHairTextureDialog] = useState(false)

  const hairTextureLabel = useMemo(() => {
    if (!hairTextureId) return null
    const entry = listSceneTextures(pixelDocuments, objectTextures, objects).find(
      (t) => t.id === hairTextureId
    )
    return entry?.label ?? 'Texture'
  }, [hairTextureId, pixelDocuments, objectTextures, objects])

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
  const selectedSketchSource = selectedObj?.sketchSource ?? null
  const selectedPrimitiveSource = selectedObj?.primitiveSource ?? null
  const selectedPrimitiveSize = selectedPrimitiveSource
    ? boxCenterSize(selectedPrimitiveSource.box).size
    : null
  const selectedVectorDoodle = selectedObj?.vectorSource ?? null
  const selectedExtrudableDoodle = selectedSketchDoodle ?? selectedVectorDoodle

  const isSelectTool =
    activeTool === 'select-object' ||
    activeTool === 'select-vertex' ||
    activeTool === 'select-edge' ||
    activeTool === 'select-face'

  const isSculptTool = SCULPT_TOOLS.includes(activeTool)

  const allSelectedSmooth =
    (selectionCount > 0 || !!selectedObjectId) &&
    (selectionCount > 0 ? selectionObjectIds : selectedObjectId ? [selectedObjectId] : []).every(
      (id) => objects.find((o) => o.id === id)?.smoothShading
    )

  const allSelectedFlat =
    (selectionCount > 0 || !!selectedObjectId) &&
    (selectionCount > 0 ? selectionObjectIds : selectedObjectId ? [selectedObjectId] : []).every(
      (id) => !objects.find((o) => o.id === id)?.smoothShading
    )

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
          <AppBrandMark />
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
          <SideSection title="Workspace" order={60} columns={2}>
            <div className="side-create-label">Toolbars</div>
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

          <SideSection title="View" columns={2} order={40}>
            <div className="side-create-label">Viewport aids</div>
            <SideBtnGroup cols={2}>
              <button
                className={`side-btn ${showGrid ? 'active' : ''}`}
                onClick={() => setShowGrid(!showGrid)}
                title="Toggle grid"
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
            <div className="side-create-label">Navigation</div>
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

          <SideSection title="Appearance" order={15}>
            <div className="side-create-label">Color</div>
            <PaletteBar variant="side" />
            <div className="side-create-label">Editors</div>
            <div className="side-editor-grid">
              <button
                className={`side-btn ${uvEditorOpen ? 'active' : ''}`}
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
                className={`side-btn ${materialEditorOpen ? 'active' : ''}`}
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
            </div>
            <div className="side-create-label">Viewport display</div>
            <SideButtonDropdown
              label="View"
              value={viewportDisplayMode}
              options={VIEWPORT_DISPLAY_MODES.map((mode) => ({
                value: mode,
                label: VIEWPORT_DISPLAY_CONFIG[mode].label,
              }))}
              onSelect={(mode) => setViewportDisplayMode(mode as ViewportDisplayMode)}
              title={VIEWPORT_DISPLAY_CONFIG[viewportDisplayMode].hint}
              alwaysShowLabel
              active
            />
            {viewportDisplayMode === 'normals' && (
              <p className="side-color-hint muted">
                Green outward · red inverted · Alt+click face to flip · F flips selection
              </p>
            )}
          </SideSection>

          <SideSection title="Create" columns={2} order={10}>
            <div className="side-create-label">Mesh faces</div>
            <SideBtnGroup cols={3}>
              {POLY_DRAW_MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`side-btn ${activeTool === 'poly-draw' && polyDrawMode === m.id ? 'active' : ''}`}
                  onClick={() => setPolyDrawMode(m.id)}
                  title={`Keep drawing connected ${m.label.toLowerCase()} faces`}
                >
                  {m.label}
                </button>
              ))}
            </SideBtnGroup>
            <div className="side-create-label">Drawing options</div>
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
            <div className="side-create-label">Shape tools</div>
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
            {activeTool === 'poly-draw' && (
              <>
                <label className="side-checkbox" title="Show and snap to vertices on every scene object">
                  <input
                    type="checkbox"
                    checked={polyDrawSnapAllScene}
                    onChange={(e) => setPolyDrawSnapAllScene(e.target.checked)}
                  />
                  <span>Show &amp; snap all vertices</span>
                </label>
                <p className="side-color-hint muted">
                  {polyDrawMode === 'poly'
                    ? 'Click vertices to build a face · click the first point or press Enter to finish · stays in Poly mode.'
                    : `${polyDrawMode === 'triangle' ? 'Three' : 'Four'} clicks complete each face · snap to old vertices to grow one connected mesh · stays in ${polyDrawMode === 'triangle' ? 'Triangle' : 'Quad'} mode.`}
                </p>
              </>
            )}
            <div className="side-create-label">Drawing input</div>
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
            <div className="side-create-label">Stroke shape</div>
            <SideBtnGroup cols={4}>
              {STROKE_MODES.slice(0, 4).map((m) => (
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
            <div className="side-create-label">Hair</div>
            <SideBtnGroup cols={3}>
              {STROKE_MODES.slice(6).map((m) => (
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
            <div className="side-create-label">Sweeps</div>
            <SideBtnGroup cols={2}>
              {STROKE_MODES.slice(4, 6).map((m) => (
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
            {(strokeMode.startsWith('hair-') || strokeMode === 'ribbon' || strokeMode === 'tapered-tube') && (
              <div className="hair-draw-options">
                <div className="hair-draw-options-heading">
                  <span>Appearance</span>
                  <span className="muted">New strokes</span>
                </div>
                <button
                  type="button"
                  className={`side-btn hair-texture-btn ${hairTextureId ? 'active' : ''}`}
                  onClick={() => setShowHairTextureDialog(true)}
                  title={
                    hairTextureId
                      ? `Hair texture: ${hairTextureLabel ?? hairTextureId} — click to edit mapping and color`
                      : 'Choose a texture for hair strokes (or keep the current palette color)'
                  }
                >
                  {hairTextureId
                    ? `Texture · ${hairTextureLabel?.split(' (')[0] ?? 'On'}`
                    : 'Texture · Use current color'}
                </button>
                <div className="side-checkbox-row">
                  <label className="side-checkbox" title="Taper hair to a point at both ends">
                    <input type="radio" name="hair-tip" checked={hairTipStyle === 'pointed'} onChange={() => setHairTipStyle('pointed')} />
                    <span>Pointed tips</span>
                  </label>
                  <label className="side-checkbox" title="Keep full width/radius to blunt ends">
                    <input type="radio" name="hair-tip" checked={hairTipStyle === 'square'} onChange={() => setHairTipStyle('square')} />
                    <span>Square tips</span>
                  </label>
                </div>
                <p className="side-color-hint muted">
                  Draw in a viewport to create the stroke. Texture, mapping, and tip settings are saved on the new object.
                </p>
              </div>
            )}
            <div className="side-create-label">3D operation</div>
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
          </SideSection>

          {isSketchOrPen && (
            <SideSection title="Active tool · Stroke" order={11}>
              {selectedSketchSource && selectedObj && (
                <>
                  <div className="side-create-label">Source</div>
                  <div className="side-chips">
                    <span className="lock-indicator">Editable Sketch</span>
                  </div>
                  <SideBtnGroup cols={2}>
                    <button
                      type="button"
                      className={`side-btn ${editingSketchObjectId === selectedObj.id ? 'active' : ''}`}
                      onClick={() => setEditingSketchObject(
                        editingSketchObjectId === selectedObj.id ? null : selectedObj.id
                      )}
                    >
                      {editingSketchObjectId === selectedObj.id ? 'Hide Source' : 'Edit Sketch'}
                    </button>
                    <button
                      type="button"
                      className="side-btn"
                      onClick={convertSelectedSketchToMesh}
                      title="Bake the current result into a regular editable mesh"
                    >
                      Convert to Mesh
                    </button>
                  </SideBtnGroup>
                </>
              )}
              <div className="side-create-label side-create-label-with-action">
                <span>Shape</span>
                <button
                  type="button"
                  className="side-mini-action"
                  title="Restore shape defaults for this and future strokes"
                  onClick={() => {
                    setExtrudeAmount(16)
                    setPolyBudget(128)
                    setBrushDensity(12)
                    setBlobInflation(0.65)
                    if (selectedSketchSource) {
                      updateSelectedSketchSource({
                        extrudeDepth: 16,
                        polyBudget: 128,
                        brushDensity: 12,
                        ...(selectedSketchSource.kind === 'soft' ? { inflation: 0.65 } : {}),
                      })
                      commitSketchSourceEdit()
                    }
                  }}
                >
                  Default
                </button>
              </div>
              <SideSlider
                label="Extrude depth"
                value={selectedSketchSource?.extrudeDepth ?? extrudeAmount}
                display={String(Math.round(selectedSketchSource?.extrudeDepth ?? extrudeAmount))}
                min={-256}
                max={256}
                step={1}
                onChange={(value) => {
                  setExtrudeAmount(value)
                  if (selectedSketchSource) updateSelectedSketchSource({ extrudeDepth: value })
                }}
                onCommit={
                  selectedSketchSource
                    ? commitSketchSourceEdit
                    : selectedExtrudableDoodle
                      ? commitExtrudeDepth
                      : undefined
                }
              />
              {selectedExtrudableDoodle && (
                <p className="side-color-hint muted">
                  Adjust depth for the selected doodle in real time.
                </p>
              )}
              {((selectedSketchSource?.kind === 'soft' && selectedSketchSource.isClosed) ||
                (!selectedSketchSource && strokeMode === 'blob')) && (
                <SideSlider
                  label="Inflation"
                  value={selectedSketchSource?.inflation ?? blobInflation}
                  display={`${Math.round((selectedSketchSource?.inflation ?? blobInflation) * 100)}%`}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={(value) => {
                    setBlobInflation(value)
                    if (selectedSketchSource) updateSelectedSketchSource({ inflation: value })
                  }}
                  onCommit={selectedSketchSource ? commitSketchSourceEdit : undefined}
                />
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
                value={selectedSketchSource?.polyBudget ?? polyBudget}
                display={String(selectedSketchSource?.polyBudget ?? polyBudget)}
                min={24}
                max={selectedSketchSource ? 512 : 256}
                step={4}
                warn={!!overBudget}
                onChange={(value) => {
                  setPolyBudget(value)
                  if (selectedSketchSource) updateSelectedSketchSource({ polyBudget: value })
                }}
                onCommit={selectedSketchSource ? commitSketchSourceEdit : undefined}
              />
              <SideSlider
                label={selectedSketchSource ? 'Sketch thickness' : 'Brush density'}
                value={selectedSketchSource?.brushDensity ?? brushDensity}
                display={String(selectedSketchSource?.brushDensity ?? brushDensity)}
                min={2}
                max={selectedSketchSource ? 48 : 24}
                step={1}
                onChange={(value) => {
                  setBrushDensity(value)
                  if (selectedSketchSource) updateSelectedSketchSource({ brushDensity: value })
                }}
                onCommit={selectedSketchSource ? commitSketchSourceEdit : undefined}
              />
              <p className="side-color-hint muted">
                Poly budget caps mesh complexity. Brush density sets stroke thickness and default inflate depth.
              </p>
            </SideSection>
          )}

          {selectedPrimitiveSource && selectedPrimitiveSize && (
            <SideSection title="Active tool · Primitive" order={12}>
              <div className="side-create-label">Source</div>
              <div className="side-chips">
                <span className="lock-indicator">Editable {selectedPrimitiveSource.type}</span>
              </div>
              <div className="side-create-label">Dimensions</div>
              <SideSlider
                label="Width"
                value={selectedPrimitiveSize.x}
                display={selectedPrimitiveSize.x.toFixed(1)}
                min={0.5}
                max={256}
                step={0.5}
                onChange={(value) => updateSelectedPrimitiveSource({ size: { x: value } })}
                onCommit={commitPrimitiveSourceEdit}
              />
              <SideSlider
                label="Height"
                value={selectedPrimitiveSize.y}
                display={selectedPrimitiveSize.y.toFixed(1)}
                min={0.5}
                max={256}
                step={0.5}
                onChange={(value) => updateSelectedPrimitiveSource({ size: { y: value } })}
                onCommit={commitPrimitiveSourceEdit}
              />
              <SideSlider
                label="Depth"
                value={selectedPrimitiveSize.z}
                display={selectedPrimitiveSize.z.toFixed(1)}
                min={0.5}
                max={256}
                step={0.5}
                onChange={(value) => updateSelectedPrimitiveSource({ size: { z: value } })}
                onCommit={commitPrimitiveSourceEdit}
              />
              <div className="side-create-label">Geometry</div>
              <SideSlider
                label="Detail"
                value={selectedPrimitiveSource.polyBudget}
                display={String(selectedPrimitiveSource.polyBudget)}
                min={24}
                max={512}
                step={4}
                onChange={(value) => updateSelectedPrimitiveSource({ polyBudget: value })}
                onCommit={commitPrimitiveSourceEdit}
              />
              {selectedPrimitiveSource.type === 'roundedBox' && (
                <>
                  <SideSlider
                    label="Roundness"
                    value={selectedPrimitiveSource.roundedParams?.roundness ?? 0.25}
                    display={`${Math.round((selectedPrimitiveSource.roundedParams?.roundness ?? 0.25) * 100)}%`}
                    min={0}
                    max={1}
                    step={0.05}
                    onChange={(value) => updateSelectedPrimitiveSource({ roundness: value })}
                    onCommit={commitPrimitiveSourceEdit}
                  />
                  <SideSlider
                    label="Subdivisions"
                    value={selectedPrimitiveSource.roundedParams?.subdivisions ?? 2}
                    display={String(selectedPrimitiveSource.roundedParams?.subdivisions ?? 2)}
                    min={0}
                    max={4}
                    step={1}
                    onChange={(value) => updateSelectedPrimitiveSource({ subdivisions: value })}
                    onCommit={commitPrimitiveSourceEdit}
                  />
                </>
              )}
              <div className="side-create-label">Output</div>
              <button
                type="button"
                className="side-btn"
                onClick={convertSelectedPrimitiveToMesh}
                title="Bake this primitive into a regular vertex/edge/face mesh"
              >
                Convert to Mesh
              </button>
              <p className="side-color-hint muted">
                Knife, sculpt, and topology edits automatically bake these parameters while Undo preserves the original.
              </p>
            </SideSection>
          )}

          {activeTool === 'vector-shape' && (
            <SideSection title="Active tool · Vector" order={12}>
              <div className="side-create-label">Placement</div>
              <p className="side-color-hint muted">Drag in an ortho view to place.</p>
              {activeShapeKind === 'roundedBox' && (
                <>
                  <div className="side-create-label">Geometry</div>
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
            <SideSection title="Active tool · Sculpt" order={13}>
              <div className="side-create-label">Brush</div>
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
            <div className="side-create-label">Mode</div>
            <SideBtnGroup cols={2}>
              <button
                className={`side-btn ${selectionMode === 'object' ? 'active' : ''}`}
                onClick={() => setSelectionMode('object')}
                title="Select objects (1)"
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
            <div className="side-create-label">Actions</div>
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
            <div className="side-create-label">Visibility</div>
            <button
              className={`side-btn ${viewportXRay ? 'active' : ''}`}
              onClick={() => setViewportXRay(!viewportXRay)}
              title="Toggle X-ray (Shift+X)"
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
            <div className="side-create-label">Tools</div>
            <SideBtnGroup cols={2}>
              <button
                className={`side-btn ${activeTool === 'move' ? 'active' : ''}`}
                onClick={() => setActiveTool('move')}
                title="Move (M)"
              >
                Move
              </button>
              <button
                className={`side-btn ${activeTool === 'rotate' ? 'active' : ''}`}
                onClick={() => setActiveTool('rotate')}
                title="Rotate (R)"
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
                title="Select (G) · click and drag (1 for object mode)"
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
            <div className="side-create-label">View plane</div>
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

          <SideSection title="Symmetry" order={23}>
            <div className="side-create-label">Mirror</div>
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

          <SideSection title="Geometry" columns={2} order={22}>
            <div className="side-create-label">Topology</div>
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
                title="Face mode: select one or more faces, then duplicate them with reversed normals (shared UVs) so they render from both sides"
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
                disabled={selectionCount === 0 || !!selectedObj?.topologyLocked}
                title="Knife — click points on the mesh (snaps to verts/edges); Enter confirms cut; Esc cancels; Shift = 45° (K)"
              >
                Knife
              </button>
              <button
                className={`side-btn ${activeTool === 'mirror-knife' ? 'active' : ''}`}
                onClick={() => setActiveTool('mirror-knife')}
                disabled={selectionCount === 0 || !!selectedObj?.topologyLocked}
                title="Mirror Knife — symmetrically cuts on both sides of the symmetry plane (Shift+K)"
              >
                Mirror Knife
              </button>
              <button
                className={`side-btn ${activeTool === 'loop-cut' ? 'active' : ''}`}
                onClick={() => {
                  setSelectionMode('edge')
                  setActiveTool('loop-cut')
                }}
                disabled={selectionCount === 0 || !!selectedObj?.topologyLocked}
                title="Loop cut — click edge, scroll to slide, click to confirm (Ctrl+R)"
              >
                Loop Cut
              </button>
            </SideBtnGroup>
            {(activeTool === 'knife' || activeTool === 'mirror-knife') && (
              <>
                <div className="side-create-label">{activeTool === 'mirror-knife' ? 'Mirror Knife' : 'Knife'}</div>
                <p className="side-color-hint muted">
                  Click to place points · Shift snaps edge steps and face centers · Ctrl snaps
                  to the face grid · Enter applies · Backspace removes a point
                </p>
                <SideBtnGroup cols={3}>
                  <button
                    className="side-btn"
                    onClick={knifeRemoveLastPoint}
                    disabled={!knifeDraft?.points.length}
                  >
                    Undo Point
                  </button>
                  <button
                    className="side-btn side-btn-primary"
                    onClick={() => knifeApply()}
                    disabled={!knifeDraft || knifeDraft.points.length < 2}
                  >
                    Apply
                  </button>
                  <button className="side-btn" onClick={knifeCancel} disabled={!knifeDraft}>
                    Cancel
                  </button>
                </SideBtnGroup>
              </>
            )}
            {selectionCount > 0 && !selectedObj?.topologyLocked && (
              <>
                <div className="side-create-label">Subdivision</div>
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
              <>
                <div className="side-create-label">Loop cut</div>
              <SideBtnGroup cols={2}>
                <button className="side-btn side-btn-primary" onClick={loopCutCommit}>
                  Confirm Cut
                </button>
                <button className="side-btn" onClick={loopCutCancel}>
                  Cancel
                </button>
              </SideBtnGroup>
              </>
            )}
          </SideSection>

          <SideSection title="References & images" order={50}>
            <div className="side-create-label">Placement</div>
            <p className="side-color-hint muted">
              Drag an image into empty viewport space to place it. Drop onto an existing object to texture that object instead.
            </p>
            <label
              className="side-checkbox"
              title="Selectable mesh — move, rotate, scale, UV and Pixel edit like any object"
            >
              <input
                type="radio"
                name="image-drop-mode"
                checked={imageDropMode === 'textured-plane'}
                onChange={() => setImageDropMode('textured-plane')}
              />
              <span>3D image object</span>
            </label>
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
            <label className="side-checkbox" title="Disable empty-space image placement">
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
                <div className="side-create-label">Selected reference</div>
                <SideSlider
                  label="Horizontal position"
                  value={selectedReference.x}
                  display={`${Math.round(selectedReference.x * 100)}%`}
                  min={0}
                  max={1}
                  step={0.01}
                  onChange={(v) => updateReferenceImage(selectedReference.id, { x: v })}
                />
                <SideSlider
                  label="Vertical position"
                  value={selectedReference.y}
                  display={`${Math.round(selectedReference.y * 100)}%`}
                  min={0}
                  max={1}
                  step={0.01}
                  onChange={(v) => updateReferenceImage(selectedReference.id, { y: v })}
                />
                <SideSlider
                  label="Reference size"
                  value={selectedReference.width}
                  display={`${Math.round(selectedReference.width * 100)}%`}
                  min={0.08}
                  max={1.5}
                  step={0.01}
                  onChange={(v) => updateReferenceImage(selectedReference.id, { width: v })}
                />
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
                <SideBtnGroup cols={2}>
                  <button
                    type="button"
                    className="side-btn"
                    onClick={() => {
                      updateReferenceImage(selectedReference.id, { x: 0.5, y: 0.5, width: 0.38, opacity: 0.55 })
                      commitReferenceImageEdit()
                    }}
                  >
                    Reset
                  </button>
                  <button
                    type="button"
                    className="side-btn"
                    onClick={() => removeReferenceImage(selectedReference.id)}
                  >
                    Remove
                  </button>
                </SideBtnGroup>
              </>
            )}
            {selectedBillboard && (
              <>
                <div className="side-create-label">Selected billboard</div>
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
                Creates an aspect-correct, double-sided mesh with a linked pixel document — select it, transform with W/E/R, then open UV or Pixel Editor.
              </p>
            )}
            <p className="side-color-hint muted">
              Drop on an existing object (or into the UV editor) to retexture that selection instead of creating a new object.
            </p>
          </SideSection>

          <SideSection title="Object" columns={2} order={30}>
            <div className="side-create-label">Shading & topology</div>
            <SideBtnGroup cols={2}>
              <button className="side-btn" onClick={toggleTopologyLock} title="Lock topology (L)">
                Lock
              </button>
              <button
                className={`side-btn ${allSelectedFlat ? 'active' : ''}`}
                onClick={() => setSelectionSmoothShading(false)}
                disabled={selectionCount === 0 && !selectedObjectId}
                title="Shade flat — faceted low-poly look (Blender Shade Flat)"
              >
                Shade Flat
              </button>
              <button
                className={`side-btn ${allSelectedSmooth ? 'active' : ''}`}
                onClick={() => setSelectionSmoothShading(true)}
                disabled={selectionCount === 0 && !selectedObjectId}
                title="Shade smooth — averaged vertex normals (Blender Shade Smooth)"
              >
                Shade Smooth
              </button>
              <button className="side-btn" onClick={simplifySelected}>
                Reduce
              </button>
            </SideBtnGroup>
            <div className="side-create-label">Clipboard & actions</div>
            <SideBtnGroup cols={2}>
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
              <button
                className="side-btn side-btn-danger"
                onClick={deleteSelection}
                disabled={!hasDeletableSelection}
                title="Delete selection (Del)"
              >
                Delete
              </button>
            </SideBtnGroup>
          </SideSection>

          <SideSection title="Interface" order={70}>
            <div className="side-create-label">Theme</div>
            <ThemePicker />
          </SideSection>
        </div>
      </aside>
      {showHairTextureDialog && (
        <HairTextureDialog onClose={() => setShowHairTextureDialog(false)} />
      )}
    </>
  )
}
