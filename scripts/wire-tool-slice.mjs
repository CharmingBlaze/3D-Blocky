import fs from 'fs'

const path = 'src/store/appStore.ts'
let text = fs.readFileSync(path, 'utf8')

// Remove MeshModal types from appStore (re-exported from slice)
text = text.replace(
  /export type MeshModalOp = MeshModalOpKind\r?\n\r?\nexport interface MeshModalState \{[\s\S]*?\}\r?\n\r?\nexport interface ObjectTransformModalState \{[\s\S]*?\}\r?\n\r?\n/,
  ''
)

// Remove ToolCategory and ActiveTool from appStore
text = text.replace(
  /export type ToolCategory =[\s\S]*?  \| 'loop-cut'\r?\n\r?\n/,
  ''
)

// Extend AppState
text = text.replace(
  'export interface AppState extends ViewportSlice, HistorySlice, SelectionSlice, CadMeshToolsSlice, StrokeSlice, VectorToolsSlice {',
  'export interface AppState extends ViewportSlice, HistorySlice, SelectionSlice, CadMeshToolsSlice, StrokeSlice, VectorToolsSlice, ToolActivationSlice {'
)

// Remove tool state from AppState interface
text = text.replace(
  /  objects: SceneObject\[\]\r?\n  activeTool: ActiveTool\r?\n  toolCategory: ToolCategory\r?\n  meshModal: MeshModalState \| null\r?\n  objectTransformModal: ObjectTransformModalState \| null\r?\n\r?\n/,
  '  objects: SceneObject[]\n\n'
)

// Remove tool action declarations
text = text.replace(
  /  setActiveTool: \(tool: ActiveTool\) => void\r?\n  activateToolRingEntry:[\s\S]*?  applyObjectTransformModalPreview: \(\) => void\r?\n\r?\n/,
  ''
)

// Add import for tool slice (after vectorToolsSlice import block)
if (!text.includes('toolActivationSlice')) {
  text = text.replace(
    "} from './vectorToolsSlice'\nexport type { StrokeMode",
    `} from './vectorToolsSlice'
import {
  createToolActivationSlice,
  toolActivationInitialState,
  type ToolActivationSlice,
} from './toolActivationSlice'
export type { StrokeMode`
  )
}

// Re-exports
text = text.replace(
  "export type { SelectionMode } from './selectionSlice'",
  `export type { SelectionMode } from './selectionSlice'
export type { ToolCategory, ActiveTool, MeshModalOp, MeshModalState, ObjectTransformModalState } from './toolActivationSlice'`
)

// Wire slice in create()
text = text.replace(
  `  ...createVectorToolsSlice<AppState>(set, get, {
    reconcileBlobUrls: () => reconcileAppBlobUrls(get),
  }),

  objects: [],
  activeTool: 'draw',
  toolCategory: 'draw',
  meshModal: null,
  objectTransformModal: null,`,
  `  ...createVectorToolsSlice<AppState>(set, get, {
    reconcileBlobUrls: () => reconcileAppBlobUrls(get),
  }),
  ...toolActivationInitialState,
  ...createToolActivationSlice<AppState>(set, get),

  objects: [],`
)

// Remove implementation block
const lines = text.split('\n')
const startIdx = lines.findIndex((l) => l.trim() === 'setActiveTool: (tool) => {')
const endIdx = lines.findIndex((l) => l.trim() === 'setPolyBudget: (budget) => set({ polyBudget: budget }),')
if (startIdx >= 0 && endIdx > startIdx) {
  lines.splice(startIdx, endIdx - startIdx)
  text = lines.join('\n')
}

fs.writeFileSync(path, text)
console.log('Wired toolActivationSlice into appStore.ts')
