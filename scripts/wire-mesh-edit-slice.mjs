import fs from 'fs'

const path = 'src/store/appStore.ts'
let text = fs.readFileSync(path, 'utf8')

text = text.replace(
  'export interface AppState extends ViewportSlice, HistorySlice, SelectionSlice, CadMeshToolsSlice, StrokeSlice, VectorToolsSlice, ToolActivationSlice, SceneObjectsSlice {',
  'export interface AppState extends ViewportSlice, HistorySlice, SelectionSlice, CadMeshToolsSlice, StrokeSlice, VectorToolsSlice, ToolActivationSlice, SceneObjectsSlice, MeshEditSlice {'
)

text = text.replace(
  /  showDensityHeatmap: boolean\r?\n  \/\*\* When true, the next vertex pick merges into the sole selected vertex \(M held\)\. \*\/\r?\n  vertexMergeModifierHeld: boolean\r?\n/,
  '  showDensityHeatmap: boolean\n'
)

text = text.replace(
  /  createFaceFromVertexSelection: \(\) => void\r?\n  mergeSelectedVertices: \(indices\?: number\[\]\) => void\r?\n  setVertexMergeModifierHeld: \(held: boolean\) => void\r?\n  flipSelectedNormals: \(\) => void\r?\n  transformSelectionInViewPlane: \(op: SelectionPlaneTransformOp\) => void\r?\n  subdivideSelected: \(\) => void\r?\n  toggleSubDSelected: \(\) => void\r?\n  setSubDLevelsSelected: \(levels: number\) => void\r?\n  adjustSubDLevelsSelected: \(delta: number\) => void\r?\n  applySubDSelected: \(\) => void\r?\n\r?\n/,
  ''
)

if (!text.includes('meshEditSlice')) {
  text = text.replace(
    "} from './sceneObjectsSlice'\nexport type { StrokeMode",
    `} from './sceneObjectsSlice'
import {
  createMeshEditSlice,
  meshEditInitialState,
  type MeshEditSlice,
} from './meshEditSlice'
export type { StrokeMode`
  )
}

text = text.replace(
  `    clearTextureLoadGeneration: (id) => textureLoadGeneration.delete(id),
  }),

  polyBudget: 128,`,
  `    clearTextureLoadGeneration: (id) => textureLoadGeneration.delete(id),
  }),
  ...meshEditInitialState,
  ...createMeshEditSlice<AppState>(set, get),

  polyBudget: 128,`
)

text = text.replace(
  /  showDensityHeatmap: false,\r?\n  vertexMergeModifierHeld: false,\r?\n  themeId:/,
  '  showDensityHeatmap: false,\n  themeId:'
)

const lines = text.split('\n')
const startIdx = lines.findIndex((l) => l.trim() === 'createFaceFromVertexSelection: () => {')
const endIdx = lines.findIndex((l) => l.trim() === 'setPolyBudget: (budget) => set({ polyBudget: budget }),')
if (startIdx >= 0 && endIdx > startIdx) {
  lines.splice(startIdx, endIdx - startIdx)
  text = lines.join('\n')
}

fs.writeFileSync(path, text)
console.log('Wired meshEditSlice into appStore.ts')
