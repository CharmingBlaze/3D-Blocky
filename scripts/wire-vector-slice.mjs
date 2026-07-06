import fs from 'fs'

const path = 'src/store/appStore.ts'
let text = fs.readFileSync(path, 'utf8')

// Remove duplicate type defs (re-exported from vectorToolsSlice)
text = text.replace(
  /export type PrimitiveKind = PrimitiveBoxType\r?\n\r?\n/,
  ''
)
text = text.replace(
  /export type PrimitiveBoxPhase = 'drawingBase' \| 'drawingHeight' \| 'scrollHeight'\r?\n\r?\nexport interface PrimitiveBoxDraft \{[\s\S]*?\}\r?\n\r?\n/,
  ''
)
text = text.replace(
  /export interface VectorPenDraft \{[\s\S]*?\}\r?\n\r?\n/,
  ''
)

// Extend AppState
text = text.replace(
  'export interface AppState extends ViewportSlice, HistorySlice, SelectionSlice, CadMeshToolsSlice, StrokeSlice {',
  'export interface AppState extends ViewportSlice, HistorySlice, SelectionSlice, CadMeshToolsSlice, StrokeSlice, VectorToolsSlice {'
)

// Remove vector state from AppState interface
text = text.replace(
  /  objectTransformModal: ObjectTransformModalState \| null\r?\n  lastPenEndpoint:[\s\S]*?  primitiveBoxDraft: PrimitiveBoxDraft \| null\r?\n\r?\n/,
  '  objectTransformModal: ObjectTransformModalState | null\n\n'
)

// Remove vector action declarations from AppState
text = text.replace(
  /  updateObjectTransform: \(id: string, transform: ObjectTransform\) => void\r?\n\r?\n  startVectorStroke:[\s\S]*?  commitPrimitiveBox: \(\) => void\r?\n\r?\n/,
  '  updateObjectTransform: (id: string, transform: ObjectTransform) => void\n\n'
)

// Wire slice in create()
text = text.replace(
  '  ...createStrokeSlice<AppState>(set, get),\n\n  objects: []',
  `  ...createStrokeSlice<AppState>(set, get),
  ...vectorToolsInitialState,
  ...createVectorToolsSlice<AppState>(set, get, {
    reconcileBlobUrls: () => reconcileAppBlobUrls(get),
  }),

  objects: []`
)

// Remove vector initial state from create()
text = text.replace(
  /  lastPenEndpoint: null,\r?\n  lastPenClickAt: 0,\r?\n\r?\n  vectorDocument: emptyVectorDocument\(\),\r?\n  vectorDraft: \[\],\r?\n  vectorDraftView: null,\r?\n  vectorIsDrawing: false,\r?\n  vectorPenDraft: null,\r?\n  activeShapeKind: 'sphere',\r?\n  activePrimitiveKind: null,\r?\n  roundedBoxRoundness: 0\.25,\r?\n  roundedBoxSubdivisions: 1,\r?\n  primitiveBoxDraft: null,\r?\n\r?\n/,
  ''
)

// Remove implementation block
const lines = text.split('\n')
const startIdx = lines.findIndex((l) => l.trim() === 'startVectorStroke: (point, view) =>')
const endIdx = lines.findIndex((l) => l.trim() === 'createFaceFromVertexSelection: () => {')
if (startIdx >= 0 && endIdx > startIdx) {
  lines.splice(startIdx, endIdx - startIdx)
  text = lines.join('\n')
}

// closeEditors - use clearVectorDraftState
text = text.replace(
  /\.\.\.clearStrokeDraftState\(\),\r?\n    vectorDraft: \[\],\r?\n    vectorDraftView: null,\r?\n    vectorIsDrawing: false,\r?\n    vectorPenDraft: null,\r?\n    primitiveBoxDraft: null,/,
  '...clearStrokeDraftState(),\n    ...clearVectorDraftState(),'
)

// restoreSceneToStore vector reset
text = text.replace(
  /\.\.\.clearStrokeDraftState\(\),\r?\n    vectorDraft: \[\],\r?\n    vectorDraftView: null,\r?\n    vectorIsDrawing: false,\r?\n    vectorPenDraft: null,\r?\n    primitiveBoxDraft: null,\r?\n    polyDrawDraft:/,
  '...clearStrokeDraftState(),\n    ...clearVectorDraftState(),\n    polyDrawDraft:'
)

fs.writeFileSync(path, text)
console.log('Wired vectorToolsSlice into appStore.ts')
