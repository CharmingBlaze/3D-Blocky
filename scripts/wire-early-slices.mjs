import fs from 'fs'

const path = 'src/store/appStore.ts'
let text = fs.readFileSync(path, 'utf8')

// --- imports ---
if (!text.includes("from './viewportSlice'")) {
  text = text.replace(
    `} from '../mesh/meshPolyBudget'
import { knifeCutObject } from '../mesh/meshKnife'`,
    `} from '../mesh/meshPolyBudget'
import { knifeCutObject } from '../mesh/meshKnife'
import {
  createViewportSlice,
  viewportLayoutInitialState,
  type ViewportSlice,
} from './viewportSlice'
import {
  allHistorySnapshots,
  createHistorySlice,
  historyLayoutInitialState,
  resetSceneHistory,
  snapshotFromState,
  syncHistoryFlags,
  type HistorySlice,
} from './historySlice'
import {
  createSelectionSlice,
  selectionLayoutInitialState,
  type SelectionSlice,
} from './selectionSlice'
import {
  cadMeshToolsInitialState,
  createCadMeshToolsSlice,
  type CadMeshToolsSlice,
} from './cadMeshToolsSlice'
import {
  clearStrokeDraftState,
  createStrokeSlice,
  strokeLayoutInitialState,
  type StrokeSlice,
} from './strokeSlice'`
  )
}

// --- re-exports ---
if (!text.includes("from './selectionSlice'")) {
  text = text.replace(
    /export type \{ UvEditorMode, UvTextureInfo \} from '\.\/uvEditorSlice'/,
    `export type { UvEditorMode, UvTextureInfo } from './uvEditorSlice'
export type { SelectionMode } from './selectionSlice'
export type {
  StrokeMode,
  DrawInputMode,
  ExtrudeDragAnchor,
} from './strokeSlice'
export type {
  PolyDrawMode,
  PolyDrawPointSnap,
  PolyDrawDraftPoint,
  PolyDrawDraft,
  LastPolyDrawFace,
  LoopCutDraft,
  KnifeDraft,
} from './cadMeshToolsSlice'`
  )
  if (!text.includes("from './selectionSlice'")) {
    text = text.replace(
      /export type UvEditorMode = 'points' \| 'faces'/,
      `export type { UvEditorMode, UvTextureInfo } from './uvEditorSlice'
export type { SelectionMode } from './selectionSlice'
export type {
  StrokeMode,
  DrawInputMode,
  ExtrudeDragAnchor,
} from './strokeSlice'
export type {
  PolyDrawMode,
  PolyDrawPointSnap,
  PolyDrawDraftPoint,
  PolyDrawDraft,
  LastPolyDrawFace,
  LoopCutDraft,
  KnifeDraft,
} from './cadMeshToolsSlice'
export type UvEditorMode = 'points' | 'faces'`
    )
    text = text.replace(
      /export type UvEditorMode = 'points' \| 'faces'\r?\n\r?\nexport interface UvTextureInfo \{[\s\S]*?\}\r?\n/,
      ''
    )
  }
}

// --- remove duplicate type defs ---
text = text.replace(/export type StrokeMode = 'outline' \| 'centerline' \| 'blob'\r?\n/, '')
text = text.replace(/export type DrawInputMode = 'regular' \| 'vector-pen'\r?\n/, '')
text = text.replace(
  /export interface ExtrudeDragAnchor \{[\s\S]*?\}\r?\n\r?\n/,
  ''
)
text = text.replace(/export type PolyDrawMode = 'triangle' \| 'quad' \| 'poly'\r?\n\r?\n/, '')
text = text.replace(
  /export type PolyDrawPointSnap =[\s\S]*?export interface KnifeDraft \{[\s\S]*?\}\r?\n\r?\n/,
  ''
)
text = text.replace(/export type SelectionMode = 'object' \| 'vertex' \| 'edge' \| 'face'\r?\n\r?\n/, '')

// --- AppState extends ---
if (text.includes('export interface AppState extends UvEditorSlice {')) {
  text = text.replace(
    'export interface AppState extends UvEditorSlice {',
    'export interface AppState extends ViewportSlice, HistorySlice, SelectionSlice, CadMeshToolsSlice, StrokeSlice, UvEditorSlice {'
  )
} else {
  text = text.replace(
    'export interface AppState {',
    'export interface AppState extends ViewportSlice, HistorySlice, SelectionSlice, CadMeshToolsSlice, StrokeSlice, UvEditorSlice {'
  )
}

// --- remove slice-owned state from AppState interface ---
text = text.replace(
  /  objects: SceneObject\[\]\r?\n  selectedObjectId: string \| null\r?\n  selectionObjectIds: string\[\]\r?\n  activeView: ViewType\r?\n  maximizedView: ViewType \| null\r?\n  viewportSlotViews: ViewType\[\]\r?\n  viewportColSplit: number\r?\n  viewportRowSplit: number\r?\n  sidePanelWidth: number\r?\n/,
  '  objects: SceneObject[]\n'
)
text = text.replace(
  /  selectionMode: SelectionMode\r?\n  meshSelection: MeshComponentSelection \| null\r?\n  meshHover: MeshPickHit \| null\r?\n/,
  ''
)
text = text.replace(
  /  viewMoveBasis: ViewMoveBasis \| null\r?\n  strokeMode: StrokeMode\r?\n  drawInputMode: DrawInputMode\r?\n  autoConnectPaths: boolean\r?\n  lastPenEndpoint:[\s\S]*?  showGrid: boolean\r?\n\r?\n/,
  ''
)
text = text.replace(
  /  polyDrawMode: PolyDrawMode\r?\n  polyDrawDraft: PolyDrawDraft \| null\r?\n  polyDrawHover:[\s\S]*?  knifeDraft: KnifeDraft \| null\r?\n\r?\n/,
  ''
)
text = text.replace(
  /  showDensityHeatmap: boolean\r?\n  viewportDisplayMode: ViewportDisplayMode\r?\n  \/\*\* When true, edit overlays draw through the mesh \(Blender-style X-ray\)\. \*\/\r?\n  viewportXRay: boolean\r?\n/,
  '  showDensityHeatmap: boolean\n'
)
text = text.replace(
  /  historyPaused: number\r?\n  canUndo: boolean\r?\n  canRedo: boolean\r?\n\r?\n  currentStroke:[\s\S]*?  isDrawing: boolean\r?\n\r?\n/,
  ''
)

// --- remove slice action declarations from AppState (before material/uv pixel sections) ---
text = text.replace(
  /  pushHistory:[\s\S]*?  redo: \(\) => void\r?\n\r?\n/,
  ''
)
text = text.replace(
  /  selectObject:[\s\S]*?  nudgeSelection: \(direction: NudgeDirection, fast\?: boolean\) => void\r?\n\r?\n/,
  ''
)
text = text.replace(
  /  setExtrudeMode:[\s\S]*?  clearExtrudeDrag: \(\) => void\r?\n\r?\n/,
  ''
)
text = text.replace(
  /  setPolyDrawMode:[\s\S]*?  knifeCancel: \(\) => void\r?\n\r?\n/,
  ''
)
text = text.replace(
  /  setActiveView: \(view: ViewType\) => void\r?\n  setViewportSlotView:[\s\S]*?  setViewportXRay: \(enabled: boolean\) => void\r?\n/,
  ''
)
text = text.replace(
  /  setSelectionMode: \(mode: SelectionMode\) => void\r?\n  applyMeshPick:[\s\S]*?  shadeFlatSelected: \(\) => void\r?\n/,
  ''
)
text = text.replace(
  /  setViewMoveBasis: \(basis: ViewMoveBasis \| null\) => void\r?\n/,
  ''
)
text = text.replace(
  /  setStrokeMode: \(mode: StrokeMode\) => void\r?\n  setDrawInputMode: \(mode: DrawInputMode\) => void\r?\n  setAutoConnectPaths: \(on: boolean\) => void\r?\n  toggleAutoConnectPaths: \(\) => void\r?\n/,
  ''
)
text = text.replace(
  /  setShowGrid: \(show: boolean\) => void\r?\n/,
  ''
)
text = text.replace(
  /  setViewportDisplayMode: \(mode: ViewportDisplayMode\) => void\r?\n  setViewportXRay: \(enabled: boolean\) => void\r?\n/,
  ''
)
text = text.replace(
  /  startStroke: \(point: \{ x: number; y: number \}, view: ViewType\) => void\r?\n  continueStroke: \(point: \{ x: number; y: number \}\) => void\r?\n  setStrokePreview: \(point: \{ x: number; y: number \} \| null\) => void\r?\n  endStroke: \(view: ViewType\) => void\r?\n\r?\n/,
  ''
)

// --- helpers: use history slice exports ---
text = text.replace(/const MAX_HISTORY = 50\r?\n\r?\nfunction emptySceneSnapshot\(\): SceneSnapshot \{[\s\S]*?\}\r?\n\r?\n/, '')
text = text.replace(
  /function snapshotFromState\(state: Pick<\r?\n  AppState,[\s\S]*?\): SceneSnapshot \{[\s\S]*?\}\r?\n\r?\n/,
  ''
)
text = text.replace(
  /  const historySnapshots = sceneHistory\.allSnapshots\(\)/,
  '  const historySnapshots = allHistorySnapshots()'
)
text = text.replace(
  /const sceneHistory = new SceneHistoryStack\(emptySceneSnapshot\(\), MAX_HISTORY\)\r?\n\r?\nfunction syncHistoryFlags\(\) \{[\s\S]*?\}\r?\n\r?\n/,
  ''
)
text = text.replace(
  /function colorFromSelection\(objects: SceneObject\[\], id: string \| null\): number \| undefined \{[\s\S]*?\}\r?\n\r?\n/,
  ''
)

// closeEditors / restoreSceneToStore stroke reset
text = text.replace(
  /    currentStroke: \[\],\r?\n    currentStrokeView: null,\r?\n    currentStrokePreview: null,\r?\n    isDrawing: false,/g,
  '    ...clearStrokeDraftState(),'
)

// --- wire slices in create() ---
const createStart = `export const useAppStore = create<AppState>((set, get) => ({
  ...viewportLayoutInitialState,
  ...createViewportSlice<AppState>(set),

  ...historyLayoutInitialState,
  ...createHistorySlice<AppState>(set, get, {
    getSnapshot: () => snapshotFromState(get()),
    restoreSnapshot: (snapshot, options) => restoreSceneToStore(set, get, snapshot, options),
    reconcileResources: () => reconcileAppBlobUrls(get),
  }),

  ...selectionLayoutInitialState,
  ...createSelectionSlice<AppState>(set, get, {
    reconcileBlobUrls: () => reconcileAppBlobUrls(get),
    purgeTextureResourcesForObjects: (objects, removedIds, objectTextures, pixelDocuments) =>
      purgeTextureResourcesForObjects(
        objects,
        removedIds,
        objectTextures as Record<string, UvTextureInfo>,
        pixelDocuments
      ),
    clearTextureLoadGeneration: (id) => textureLoadGeneration.delete(id),
  }),

  ...cadMeshToolsInitialState,
  ...createCadMeshToolsSlice<AppState>(set, get),

  ...strokeLayoutInitialState,
  ...createStrokeSlice<AppState>(set, get),

  objects: [],`

if (text.includes('...createStrokeSlice<AppState>(set, get),')) {
  console.log('Early slices already wired in create()')
} else if (text.includes('...uvEditorInitialState,')) {
  text = text.replace(
    /export const useAppStore = create<AppState>\(\(set, get\) => \(\{[\s\S]*?\.\.\.uvEditorInitialState,/,
    `${createStart}
  activeTool: 'draw',
  toolCategory: 'draw',
  meshModal: null,
  objectTransformModal: null,
  lastPenEndpoint: null,
  lastPenClickAt: 0,

  vectorDocument: emptyVectorDocument(),
  vectorDraft: [],
  vectorDraftView: null,
  vectorIsDrawing: false,
  vectorPenDraft: null,
  activeShapeKind: 'sphere',
  activePrimitiveKind: null,
  roundedBoxRoundness: 0.25,
  roundedBoxSubdivisions: 1,
  primitiveBoxDraft: null,

  polyBudget: 128,
  polyBudgetMode: 'strict',
  brushDensity: 12,
  brushStrength: 0.5,
  brushRadius: 30,
  rdpTolerance: 2,
  closeThreshold: 8,
  defaultDepth: 0,
  facetExaggeration: 0,
  showDensityHeatmap: false,
  themeId: BOOT_THEME_ID,
  topologyLocked: false,

  activeColor: BOOT_ACCENT,
  showToolRing: false,
  showExportDialog: false,

  imageDropMode: 'off',
  referenceImages: [],
  selectedReferenceImageId: null,
  billboardImages: [],
  selectedBillboardImageId: null,

  ...uvEditorInitialState,`
  )
} else {
  throw new Error('Could not find create() anchor for early slice wiring')
}

text = text.replace(
  /  showDensityHeatmap: false,\r?\n  viewportDisplayMode: 'model',\r?\n  viewportXRay: false,\r?\n  vertexMergeModifierHeld: false,/,
  '  showDensityHeatmap: false,\n  vertexMergeModifierHeld: false,'
)

text = text.replace(
  /  pixelEditHistoryPending: false,\r?\n\r?\n  historyPaused: 0,\r?\n  canUndo: false,\r?\n  canRedo: false,\r?\n\r?\n  currentStroke: \[\],\r?\n  currentStrokeView: null,\r?\n  currentStrokePreview: null,\r?\n  isDrawing: false,\r?\n\r?\n/,
  '  pixelEditHistoryPending: false,\n\n'
)

// --- remove duplicate method implementations ---
const lines = text.split('\n')

function removeMethod(methodPrefix) {
  const startIdx = lines.findIndex((l) => l.trim().startsWith(methodPrefix))
  if (startIdx < 0) return false
  let endIdx = startIdx + 1
  while (endIdx < lines.length) {
    const line = lines[endIdx]
    if (/^  [a-zA-Z_$]/.test(line) || /^  \.\.\./.test(line)) break
    endIdx++
  }
  lines.splice(startIdx, endIdx - startIdx)
  return true
}

const methodsToRemove = [
  'pushHistory:',
  'commitHistory:',
  'captureUndoPoint:',
  'replaceHistoryHead:',
  'pauseHistory:',
  'resumeHistory:',
  'undo:',
  'redo:',
  'selectObject:',
  'setSelection:',
  'addToObjectSelection:',
  'clearSelection:',
  'translateSelectionByDelta:',
  'nudgeSelection:',
  'setViewMoveBasis:',
  'setExtrudeMode:',
  'toggleExtrudeMode:',
  'setExtrudeAmount:',
  'commitExtrudeDepth:',
  'beginExtrudeDrag:',
  'updateExtrudeFromPointer:',
  'clearExtrudeDrag:',
  'setPolyDrawMode:',
  'setPolyDrawSnapAllScene:',
  'polyDrawPointerMove:',
  'clearPolyDrawHover:',
  'polyDrawClick:',
  'polyDrawCancel:',
  'polyDrawFinish:',
  'flipLastPolyDrawFace:',
  'loopCutBegin:',
  'loopCutSetT:',
  'loopCutAdjustWheel:',
  'loopCutCommit:',
  'loopCutCancel:',
  'knifePointerDown:',
  'knifePointerMove:',
  'knifeCommit:',
  'knifeCancel:',
  'setActiveView:',
  'setViewportSlotView:',
  'toggleMaximizedView:',
  'setViewportColSplit:',
  'setViewportRowSplit:',
  'setSidePanelWidth:',
  'setSelectionMode:',
  'applyMeshPick:',
  'applyMeshMarqueePick:',
  'clearMeshSelection:',
  'selectAllInMode:',
  'deselectAllInMode:',
  'deleteSelection:',
  'setMeshHover:',
  'translateMeshSelection:',
  'setStrokeMode:',
  'setDrawInputMode:',
  'setAutoConnectPaths:',
  'toggleAutoConnectPaths:',
  'setShowGrid:',
  'setSelectionSmoothShading:',
  'toggleSmoothShading:',
  'shadeSmoothSelected:',
  'shadeFlatSelected:',
  'setViewportDisplayMode:',
  'setViewportXRay:',
  'startStroke:',
  'continueStroke:',
  'setStrokePreview:',
  'endStroke:',
]

for (const m of methodsToRemove) {
  removeMethod(m)
}

text = lines.join('\n')
text = text.replace(/sceneHistory\.reset\(/g, 'resetSceneHistory(')

fs.writeFileSync(path, text)
console.log('Wired early slices into appStore.ts')
