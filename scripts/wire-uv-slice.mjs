import fs from 'fs'

const path = 'src/store/appStore.ts'
let text = fs.readFileSync(path, 'utf8')

if (!text.includes('createUvEditorSlice')) {
  text = text.replace(
    "import { invalidateSubdivisionPreviewCache } from '../mesh/subdivisionSurface'",
    `import { invalidateSubdivisionPreviewCache } from '../mesh/subdivisionSurface'
import {
  createUvEditorSlice,
  uvEditorInitialState,
  type UvEditorSlice,
} from './uvEditorSlice'`
  )
}

text = text.replace(
  `export type UvEditorMode = 'points' | 'faces'

export interface UvTextureInfo {
  url: string
  name: string
  width: number
  height: number
}`,
  "export type { UvEditorMode, UvTextureInfo } from './uvEditorSlice'"
)

text = text.replace(
  'export interface AppState {',
  'export interface AppState extends UvEditorSlice {'
)

text = text.replace(
  /  uvEditorOpen: boolean\r?\n  uvEditorPanel: FloatingPanelState\r?\n  uvEditorGridDivisions: number\r?\n  uvEditorSnap: boolean\r?\n  uvEditorSnapMode: UvSnapMode\r?\n  uvEditorSmartUvAngle: number\r?\n  uvEditorMode: UvEditorMode\r?\n  uvEditorSelectedPoints: number\[\]\r?\n  uvEditorSelectedFaces: number\[\]\r?\n  uvEditorZoom: number\r?\n  uvEditorPanX: number\r?\n  uvEditorPanY: number\r?\n  uvEditorShowGrid: boolean\r?\n  uvEditorTilePreview: boolean\r?\n  \/\*\* When true, show every UV island; when false, show only selected face region\(s\). \*\/\r?\n  uvEditorViewAll: boolean\r?\n  \/\*\* When true, pan\/zoom to selected face\(s\) if they leave the viewport. \*\/\r?\n  uvEditorAutoFit: boolean\r?\n  \/\*\* When true, face picks and moves include coplanar regions and welded UV islands. \*\/\r?\n  uvEditorSticky: boolean\r?\n  objectTextures: Record<string, UvTextureInfo>\r?\n\r?\n/,
  ''
)

text = text.replace(
  /  setUvEditorOpen: \(open: boolean\) => void\r?\n  toggleUvEditor: \(\) => void\r?\n  setUvEditorPanel: \(panel: FloatingPanelState\) => void\r?\n  setUvEditorGridDivisions: \(n: number\) => void\r?\n  setUvEditorSnap: \(on: boolean\) => void\r?\n  setUvEditorSnapMode: \(mode: UvSnapMode\) => void\r?\n  setUvEditorSmartUvAngle: \(deg: number\) => void\r?\n  unwrapSelectedUvFaces: \(method: UvUnwrapMethod\) => void\r?\n  setUvEditorMode: \(mode: UvEditorMode\) => void\r?\n  setUvEditorSelectedPoints: \(indices: number\[\]\) => void\r?\n  setUvEditorSelectedFaces: \(indices: number\[\]\) => void\r?\n  selectUvFaces: \(objectId: string, faceIndices: number\[\], options\?: \{ additive\?: boolean \}\) => void\r?\n  setUvEditorView: \(zoom: number, panX: number, panY: number\) => void\r?\n  setUvEditorShowGrid: \(on: boolean\) => void\r?\n  setUvEditorTilePreview: \(on: boolean\) => void\r?\n  setUvEditorViewAll: \(on: boolean\) => void\r?\n  setUvEditorAutoFit: \(on: boolean\) => void\r?\n  setUvEditorSticky: \(on: boolean\) => void\r?\n  setObjectUvMappingMode: \(objectId: string, mode: UvMappingMode\) => void\r?\n  loadObjectTexture: \(objectId: string, file: File\) => Promise<void>\r?\n  assignObjectTextureDocument: \(objectId: string, docId: string, options\?: \{ skipHistory\?: boolean \}\) => void\r?\n  setObjectUvPoint: \(objectId: string, uvIndex: number, u: number, v: number, saveHistory\?: boolean\) => void\r?\n  setObjectUvPoints: \(\r?\n    objectId: string,\r?\n    updates: Array<\{ uvIndex: number; u: number; v: number \}>,\r?\n    saveHistory\?: boolean\r?\n  \) => void\r?\n  transformSelectedUvIslands: \(\r?\n    op:\r?\n      \| 'flipH'\r?\n      \| 'flipV'\r?\n      \| 'rotateCW'\r?\n      \| 'rotateCCW'\r?\n      \| 'fit'\r?\n      \| 'autoUv'\r?\n      \| \{ translate: \[number, number\] \}\r?\n      \| \{ rotate: number \}\r?\n      \| \{ scale: \[number, number\] \}\r?\n      \| \{ position: \[number, number\]; size: \[number, number\]; rotation: number \}\r?\n  \) => void\r?\n  getFaceUVs: \(objectId: string, faceIndex: number\) => Uv2\[\]\r?\n\r?\n/,
  ''
)

// Wire slice in create() — match unique context (after billboardImages block, before materialEditorInitialState)
text = text.replace(
  /  selectedBillboardImageId: null,\r?\n\r?\n  uvEditorOpen: false,\r?\n  uvEditorPanel: \{ x: 80, y: 80, width: 520, height: 560, minimized: false \},\r?\n  uvEditorGridDivisions: 16,\r?\n  uvEditorSnap: false,\r?\n  uvEditorSnapMode: 'vertex',\r?\n  uvEditorSmartUvAngle: 66,\r?\n  uvEditorMode: 'faces',\r?\n  uvEditorSelectedPoints: \[\],\r?\n  uvEditorSelectedFaces: \[\],\r?\n  uvEditorZoom: 1,\r?\n  uvEditorPanX: 24,\r?\n  uvEditorPanY: 24,\r?\n  uvEditorShowGrid: true,\r?\n  uvEditorTilePreview: false,\r?\n  uvEditorViewAll: false,\r?\n  uvEditorAutoFit: true,\r?\n  uvEditorSticky: false,\r?\n  objectTextures: \{\},\r?\n\r?\n  \.\.\.materialEditorInitialState,/,
  `  selectedBillboardImageId: null,

  ...uvEditorInitialState,
  ...createUvEditorSlice<AppState>(set, get, {
    reconcileBlobUrls: () => reconcileAppBlobUrls(get),
    bumpTextureLoadGeneration: (id) => {
      const g = (textureLoadGeneration.get(id) ?? 0) + 1
      textureLoadGeneration.set(id, g)
      return g
    },
    currentTextureLoadGeneration: (id) => textureLoadGeneration.get(id),
  }),

  ...materialEditorInitialState,`
)

const lines = text.split('\n')
const removeBlock = (startMarker, endBeforeMarker) => {
  const start = lines.findIndex((l) => l.trim() === startMarker)
  const end = lines.findIndex((l) => l.trim() === endBeforeMarker)
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`removeBlock failed: ${startMarker} -> ${endBeforeMarker} (${start}, ${end})`)
  }
  lines.splice(start, end - start)
}

removeBlock('setUvEditorOpen: (open) => {', 'toggleMaterialEditor: () => {')
removeBlock('setObjectUvMappingMode: (objectId, mode) => {', 'unwrapSelectedUvFaces: (method) => {')

const unwrapStart = lines.findIndex((l) => l.trim() === 'unwrapSelectedUvFaces: (method) => {')
if (unwrapStart >= 0) {
  let i = unwrapStart
  while (i < lines.length && lines[i].trim() !== '},') i++
  lines.splice(unwrapStart, i - unwrapStart + 1)
}

text = lines.join('\n')

// Drop UV-only imports if unused
text = text.replace(/\nimport type { UvSnapMode } from '\.\.\/uv\/uvSnap'\n/, '\n')
text = text.replace(/\nimport { unwrapSelectedFaces, type UvUnwrapMethod } from '\.\.\/uv\/uvUnwrap'\n/, '\n')
text = text.replace(
  /import {\n  assignUvMappingForMode,\n  collectUvIndicesForFaces,\n  ensureObjectUVs,\n  resolveUvMappingMode,\n  setUvPoints,\n  type UvMappingMode,\n} from '\.\.\/uv\/uvObject'\nimport {\n  flipUVsHorizontal,\n  flipUVsVertical,\n  fitUVsToUnitSquare,\n  rotateUVs90,\n  rotateUVsBy,\n  scaleUVsFromCenter,\n  translateUVs,\n  uvBoundsFromIndices,\n  uvBoundsCenter,\n} from '\.\.\/uv\/uvEditing'\nimport type { Uv2 } from '\.\.\/uv\/uvTypes'\nimport { cloneUv2 } from '\.\.\/uv\/uvTypes'\n/,
  "import {\n  assignUvMappingForMode,\n} from '../uv/uvObject'\n"
)

fs.writeFileSync(path, text)
console.log('Wired uvEditorSlice into monolith appStore.ts', text.split('\n').length, 'lines')
