import fs from 'fs'

const path = 'src/components/QuadViewport.tsx'
let lines = fs.readFileSync(path, 'utf8').split('\n')

const idxDrawTools = lines.findIndex((l) => l.startsWith('const DRAW_TOOLS:'))
const idxViewMove = lines.findIndex((l) => l.startsWith('function ViewMoveBasisSync'))
const idxPickPixel = lines.findIndex((l) => l.startsWith('function pickPixelOnTexturedMesh'))
const idxQuadViewport = lines.findIndex((l) => l.startsWith('export function QuadViewport'))
const idxLastSculpt = lines.findIndex((l) => l.trim() === 'const lastSculptRef = useRef(0)')
const idxInteractionDom = lines.findIndex((l) => l.trim() === 'const [interactionDom, setInteractionDom] = useState<HTMLElement | null>(null)')
const idxPointerInteraction = lines.findIndex((l) => l.trim() === 'const pointerInteractionRef = useRef(false)')
const idxBeginPointer = lines.findIndex((l) => l.trim() === 'const beginPointerInteraction = useCallback(() => {')
const idxEndPointerBlock = lines.findIndex((l, i) => i > idxBeginPointer && l.trim() === '}, [])') 
const idxSchedule = lines.findIndex((l) => l.trim() === 'const scheduleMeshHoverPick = useCallback(')
const idxSelectedObj = lines.findIndex((l) => l.trim().startsWith('const selectedObj = objects.find'))

console.log({
  idxDrawTools,
  idxViewMove,
  idxPickPixel,
  idxQuadViewport,
  idxLastSculpt,
  idxInteractionDom,
  idxPointerInteraction,
  idxBeginPointer,
  idxEndPointerBlock,
  idxSchedule,
  idxSelectedObj,
  total: lines.length,
})

if ([idxDrawTools, idxViewMove, idxSchedule, idxSelectedObj].some((i) => i < 0)) {
  throw new Error('Could not find required markers')
}

const hookCall = `  const {
    marqueeRect,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerLeave,
    handleDragOver,
    handleDrop,
    perspectivePrimitiveScrollHeight,
    roundedBoxParamWheel,
  } = useViewportPointerHandlers({
    view,
    onActivate,
    layoutVisible,
    containerRef,
    cameraRef,
  })
`

// Remove top-level interaction utils (DRAW_TOOLS through beginCameraPlaneDrag)
lines.splice(idxDrawTools, idxViewMove - idxDrawTools)

// Re-find pickPixel after splice
const idxPickPixel2 = lines.findIndex((l) => l.startsWith('function pickPixelOnTexturedMesh'))
const idxQuadViewport2 = lines.findIndex((l) => l.startsWith('export function QuadViewport'))
if (idxPickPixel2 >= 0 && idxPickPixel2 < idxQuadViewport2) {
  lines.splice(idxPickPixel2, idxQuadViewport2 - idxPickPixel2)
}

// Re-find indices in component
const idxLastSculpt2 = lines.findIndex((l) => l.trim() === 'const lastSculptRef = useRef(0)')
const idxInteractionDom2 = lines.findIndex((l) => l.trim() === 'const [interactionDom, setInteractionDom] = useState<HTMLElement | null>(null)')
const idxPointerInteraction2 = lines.findIndex((l) => l.trim() === 'const pointerInteractionRef = useRef(false)')
const idxBeginPointer2 = lines.findIndex((l) => l.trim() === 'const beginPointerInteraction = useCallback(() => {')
const idxEndPointer2 = lines.findIndex((l, i) => i > idxBeginPointer2 && l.trim() === '}, [])')
const idxSchedule2 = lines.findIndex((l) => l.trim() === 'const scheduleMeshHoverPick = useCallback(')
const idxSelectedObj2 = lines.findIndex((l) => l.trim().startsWith('const selectedObj = objects.find'))

// Remove handler refs (lastSculpt through marqueeRect state)
lines.splice(idxLastSculpt2, idxInteractionDom2 - idxLastSculpt2)

// Re-find
const idxPointerInteraction3 = lines.findIndex((l) => l.trim() === 'const pointerInteractionRef = useRef(false)')
const idxBeginPointer3 = lines.findIndex((l) => l.trim() === 'const beginPointerInteraction = useCallback(() => {')
const idxEndPointer3 = lines.findIndex((l, i) => i > idxBeginPointer3 && l.trim() === '}, [])')
const idxSchedule3 = lines.findIndex((l) => l.trim() === 'const scheduleMeshHoverPick = useCallback(')
const idxSelectedObj3 = lines.findIndex((l) => l.trim().startsWith('const selectedObj = objects.find'))

// Remove pointer interaction helpers
if (idxPointerInteraction3 >= 0 && idxEndPointer3 > idxPointerInteraction3) {
  lines.splice(idxPointerInteraction3, idxEndPointer3 - idxPointerInteraction3 + 1)
}

// Re-find schedule and selectedObj
const idxSchedule4 = lines.findIndex((l) => l.trim() === 'const scheduleMeshHoverPick = useCallback(')
const idxSelectedObj4 = lines.findIndex((l) => l.trim().startsWith('const selectedObj = objects.find'))

// Remove handler block, insert hook call
lines.splice(idxSchedule4, idxSelectedObj4 - idxSchedule4, hookCall)

const newImports = `import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { useRef, useCallback, useState, useLayoutEffect, useEffect } from 'react'
import { MOUSE, Vector3 } from 'three'
import type * as THREE from 'three'
import { popViewportInteraction, pushViewportInteraction, useViewportInteractionActive } from '../rendering/viewportFrameLoop'

const _viewMoveRight = new Vector3()
const _viewMoveUp = new Vector3()
const _viewMoveForward = new Vector3()
import { useShallow } from 'zustand/react/shallow'
import { ObjectNode } from './ObjectNode'
import { MeshSelectionGizmo } from './MeshSelectionGizmo'
import { PrimitiveBoxCanvas } from './PrimitiveBoxCanvas'
import { PolyDrawVisuals } from './PolyDrawVisuals'
import { KnifeVisuals } from './KnifeVisuals'
import { LoopCutVisuals } from './LoopCutVisuals'
import { DrawVertexOverlay } from './DrawVertexOverlay'
import { StrokeCanvas } from './StrokeCanvas'
import { VectorCanvas } from './VectorCanvas'
import { MarqueeOverlay } from './MarqueeOverlay'
import { SymmetryPlaneOverlay } from './SymmetryPlaneOverlay'
import { SymmetryPlaneVisual } from './SymmetryPlaneVisual'
import { ReferenceImageOverlay } from './ReferenceImageOverlay'
import { BillboardImages } from './BillboardImages'
import { ViewportRenderContext, requestViewportFrame, useViewportRender } from './ViewportRenderContext'
import { ViewportDomContext } from './ViewportDomContext'
import { ViewportPointerPolicy } from './ViewportPointerPolicy'
import { ViewportGrid } from './ViewportGrid'
import { ViewportLighting } from './ViewportLighting'
import { WebGLContextHandler } from './WebGLContextHandler'
import { useAppStore, type ViewType } from '../store/appStore'
import { getViewportBackground } from '../theme/themes'
import { selectionHasComponents } from '../mesh/meshSelection'
import type { ViewportSlotIndex } from '../scene/viewTypes'
import type { SelectableViewType } from '../scene/viewTypes'
import { getCameraSetup } from '../scene/viewTypes'
import { ViewportViewPicker } from './ViewportViewPicker'
import { useViewportPointerHandlers } from '../hooks/useViewportPointerHandlers'
import {
  MESH_EDIT_TOOLS,
  MESH_SELECT_TOOLS,
  SCULPT_TOOLS,
  TRANSFORM_GIZMO_TOOLS,
  VECTOR_TOOLS,
  isComponentSelectionMode,
} from '../viewport/viewportInteractionUtils'
`

// Replace imports block (line 0 through blank before ViewMoveBasisSync or DRAW_TOOLS was)
const idxViewMoveFinal = lines.findIndex((l) => l.startsWith('function ViewMoveBasisSync'))
const oldHeader = lines.slice(0, idxViewMoveFinal).join('\n')
if (!oldHeader.includes('function ViewMoveBasisSync') && idxViewMoveFinal > 0) {
  lines.splice(0, idxViewMoveFinal, ...newImports.trimEnd().split('\n'))
}

// Trim store destructuring - replace the big block manually via regex on full text
let text = lines.join('\n')

const renderStoreBlock = `  const {
    objects,
    selectedObjectId,
    selectionObjectIds,
    activeView,
    activeTool,
    selectionMode,
    meshSelection,
    facetExaggeration,
    showDensityHeatmap,
    viewportDisplayMode,
    themeId,
    showGrid,
    defaultDepth,
    primitiveBoxDraft,
    activePrimitiveKind,
    roundedBoxRoundness,
    roundedBoxSubdivisions,
    vectorIsDrawing,
    imageDropMode,
    selectedBillboardImageId,
    billboardImages,
    setActiveView,
    setViewportSlotView,
    pixelTextureRevision,
  } = useAppStore(
    useShallow((s) => ({
      objects: s.objects,
      selectedObjectId: s.selectedObjectId,
      selectionObjectIds: s.selectionObjectIds,
      activeView: s.activeView,
      activeTool: s.activeTool,
      selectionMode: s.selectionMode,
      meshSelection: s.meshSelection,
      facetExaggeration: s.facetExaggeration,
      showDensityHeatmap: s.showDensityHeatmap,
      viewportDisplayMode: s.viewportDisplayMode,
      themeId: s.themeId,
      showGrid: s.showGrid,
      defaultDepth: s.defaultDepth,
      primitiveBoxDraft: s.primitiveBoxDraft,
      activePrimitiveKind: s.activePrimitiveKind,
      roundedBoxRoundness: s.roundedBoxRoundness,
      roundedBoxSubdivisions: s.roundedBoxSubdivisions,
      vectorIsDrawing: s.vectorIsDrawing,
      imageDropMode: s.imageDropMode,
      selectedBillboardImageId: s.selectedBillboardImageId,
      billboardImages: s.billboardImages,
      setActiveView: s.setActiveView,
      setViewportSlotView: s.setViewportSlotView,
      pixelTextureRevision: s.pixelTextureRevision,
    }))
  )`

text = text.replace(
  /  const \{\n    objects,\n    selectedObjectId,[\s\S]*?pixelTextureRevision,\n    \}\)\)\n  \)/,
  renderStoreBlock
)

fs.writeFileSync(path, text)
console.log('Wired hook into QuadViewport.tsx')
