import fs from 'fs'

const path = 'src/store/appStore.ts'
let text = fs.readFileSync(path, 'utf8')

// Extend AppState
text = text.replace(
  'export interface AppState extends ViewportSlice, HistorySlice, SelectionSlice, CadMeshToolsSlice, StrokeSlice, VectorToolsSlice, ToolActivationSlice {',
  'export interface AppState extends ViewportSlice, HistorySlice, SelectionSlice, CadMeshToolsSlice, StrokeSlice, VectorToolsSlice, ToolActivationSlice, SceneObjectsSlice {'
)

// Remove scene state from AppState interface
text = text.replace(
  /export interface AppState extends[\s\S]*?\{\s*objects: SceneObject\[\]\r?\n\r?\n/,
  (m) => m.replace(/\s*objects: SceneObject\[\]\r?\n\r?\n/, '\n')
)

text = text.replace(
  /  symmetryEnabled: boolean\r?\n  symmetryAxis: SymmetryAxis\r?\n  symmetryPlane: number\r?\n  clipboard: SceneObject\[\] \| null\r?\n\r?\n/,
  ''
)

// Remove scene action declarations
text = text.replace(
  /  addObject: \(obj: SceneObject, options\?: \{ skipHistory\?: boolean; skipSymmetry\?: boolean \}\) => void\r?\n  updateObject: \(id: string, updates: Partial<SceneObject>\) => void\r?\n  removeObject: \(id: string\) => void\r?\n  updateObjectTransform: \(id: string, transform: ObjectTransform\) => void\r?\n\r?\n/,
  ''
)

text = text.replace(
  /  setSymmetryEnabled: \(on: boolean\) => void\r?\n  toggleSymmetry: \(\) => void\r?\n  setSymmetryAxis: \(axis: SymmetryAxis\) => void\r?\n  setSymmetryPlane: \(plane: number\) => void\r?\n  copySelection: \(\) => void\r?\n  pasteClipboard: \(\) => void\r?\n\r?\n/,
  ''
)

// Add import
if (!text.includes('sceneObjectsSlice')) {
  text = text.replace(
    "} from './toolActivationSlice'\nexport type { StrokeMode",
    `} from './toolActivationSlice'
import {
  createSceneObjectsSlice,
  sceneObjectsInitialState,
  type SceneObjectsSlice,
} from './sceneObjectsSlice'
export type { StrokeMode`
  )
}

// Wire slice in create()
text = text.replace(
  `  ...createToolActivationSlice<AppState>(set, get),

  objects: [],
  polyBudget: 128,`,
  `  ...createToolActivationSlice<AppState>(set, get),
  ...sceneObjectsInitialState,
  ...createSceneObjectsSlice<AppState>(set, get, {
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

  polyBudget: 128,`
)

// Remove symmetry initial state from create()
text = text.replace(
  /  symmetryEnabled: false,\r?\n  symmetryAxis: 'x',\r?\n  symmetryPlane: 0,\r?\n  clipboard: null,\r?\n\r?\n/,
  ''
)

// Remove implementation block (addObject through pasteClipboard, stop before mesh edit)
const lines = text.split('\n')
const startIdx = lines.findIndex((l) => l.trim() === 'addObject: (obj, options) => {')
const meshStart = lines.findIndex((l) => l.trim() === 'createFaceFromVertexSelection: () => {')
const endIdx =
  meshStart >= 0
    ? meshStart
    : lines.findIndex((l) => l.trim() === 'setPolyBudget: (budget) => set({ polyBudget: budget }),')
if (startIdx >= 0 && endIdx > startIdx) {
  lines.splice(startIdx, endIdx - startIdx)
  text = lines.join('\n')
}

fs.writeFileSync(path, text)
console.log('Wired sceneObjectsSlice into appStore.ts')
