import fs from 'fs'

const appPath = 'src/store/appStore.ts'
const outPath = 'src/store/uvEditorSlice.ts'
const lines = fs.readFileSync(appPath, 'utf8').split('\n')

const block1Start = lines.findIndex((l) => l.trim() === 'setUvEditorOpen: (open) => {')
const block1End = lines.findIndex((l) => l.trim() === 'toggleMaterialEditor: () => {')
const block2Start = lines.findIndex((l) => l.trim() === 'setObjectUvMappingMode: (objectId, mode) => {')
const block2End = lines.findIndex((l) => l.trim() === 'unwrapSelectedUvFaces: (method) => {')
if (block1Start < 0 || block1End < 0 || block2Start < 0 || block2End < 0) {
  throw new Error(`markers: ${block1Start} ${block1End} ${block2Start} ${block2End}`)
}

let block2EndLine = block2End
while (block2EndLine < lines.length && lines[block2EndLine].trim() !== '},') {
  block2EndLine++
}
block2EndLine++

const sliceLines = [
  ...lines.slice(block1Start, block1End),
  '',
  ...lines.slice(block2Start, block2EndLine),
]

const implBody = sliceLines
  .map((line) => (line.startsWith('  ') ? line.slice(2) : line))
  .join('\n')

const header = `import type { FloatingPanelState } from '../components/FloatingPanel'
import type { UvSnapMode } from '../uv/uvSnap'
import { unwrapSelectedFaces, type UvUnwrapMethod } from '../uv/uvUnwrap'
import { expandFacesToPlanarRegions } from '../mesh/faceGroups'
import { ensureObjectUVs, assignUvMappingForMode, resolveUvMappingMode, setUvPoints, type UvMappingMode } from '../uv/uvObject'
import {
  flipUVsHorizontal,
  flipUVsVertical,
  fitUVsToUnitSquare,
  rotateUVs90,
  rotateUVsBy,
  scaleUVsFromCenter,
  translateUVs,
  uvBoundsFromIndices,
  uvBoundsCenter,
} from '../uv/uvEditing'
import { collectUvIndicesForFaces } from '../uv/uvObject'
import type { Uv2 } from '../uv/uvTypes'
import { cloneUv2 } from '../uv/uvTypes'
import { setObjectMaterialMode } from '../material/materialEditorSlice'
import { importImageAsNewDocument } from '../pixel/pixelEditorSlice'
import { releaseTextureUrl } from '../rendering/textureCache'
import { ensureObjectMaterial, resolveEffectiveMaterial } from '../material/materials'
import type { SceneObject } from '../mesh/HalfEdgeMesh'
import type { MeshComponentSelection } from '../mesh/meshSelection'
import type { SelectionMode } from './selectionSlice'
import type { ActiveTool, ToolCategory } from './toolActivationSlice'
export type UvEditorMode = 'points' | 'faces'

export interface UvTextureInfo {
  url: string
  name: string
  width: number
  height: number
}

export interface UvEditorLayoutState {
  uvEditorOpen: boolean
  uvEditorPanel: FloatingPanelState
  uvEditorGridDivisions: number
  uvEditorSnap: boolean
  uvEditorSnapMode: UvSnapMode
  uvEditorSmartUvAngle: number
  uvEditorMode: UvEditorMode
  uvEditorSelectedPoints: number[]
  uvEditorSelectedFaces: number[]
  uvEditorZoom: number
  uvEditorPanX: number
  uvEditorPanY: number
  uvEditorShowGrid: boolean
  uvEditorTilePreview: boolean
  uvEditorViewAll: boolean
  uvEditorAutoFit: boolean
  uvEditorSticky: boolean
  objectTextures: Record<string, UvTextureInfo>
}

export interface UvEditorLayoutActions {
  setUvEditorOpen: (open: boolean) => void
  toggleUvEditor: () => void
  setUvEditorPanel: (panel: FloatingPanelState) => void
  setUvEditorGridDivisions: (n: number) => void
  setUvEditorSnap: (on: boolean) => void
  setUvEditorSnapMode: (mode: UvSnapMode) => void
  setUvEditorSmartUvAngle: (deg: number) => void
  unwrapSelectedUvFaces: (method: UvUnwrapMethod) => void
  setUvEditorMode: (mode: UvEditorMode) => void
  setUvEditorSelectedPoints: (indices: number[]) => void
  setUvEditorSelectedFaces: (indices: number[]) => void
  selectUvFaces: (objectId: string, faceIndices: number[], options?: { additive?: boolean }) => void
  setUvEditorView: (zoom: number, panX: number, panY: number) => void
  setUvEditorShowGrid: (on: boolean) => void
  setUvEditorTilePreview: (on: boolean) => void
  setUvEditorViewAll: (on: boolean) => void
  setUvEditorAutoFit: (on: boolean) => void
  setUvEditorSticky: (on: boolean) => void
  setObjectUvMappingMode: (objectId: string, mode: UvMappingMode) => void
  loadObjectTexture: (objectId: string, file: File) => Promise<void>
  assignObjectTextureDocument: (objectId: string, docId: string, options?: { skipHistory?: boolean }) => void
  setObjectUvPoint: (objectId: string, uvIndex: number, u: number, v: number, saveHistory?: boolean) => void
  setObjectUvPoints: (
    objectId: string,
    updates: Array<{ uvIndex: number; u: number; v: number }>,
    saveHistory?: boolean
  ) => void
  transformSelectedUvIslands: (
    op:
      | 'flipH'
      | 'flipV'
      | 'rotateCW'
      | 'rotateCCW'
      | 'fit'
      | 'autoUv'
      | { translate: [number, number] }
      | { rotate: number }
      | { scale: [number, number] }
      | { position: [number, number]; size: [number, number]; rotation: number }
  ) => void
  getFaceUVs: (objectId: string, faceIndex: number) => Uv2[]
}

export type UvEditorSlice = UvEditorLayoutState & UvEditorLayoutActions

export const uvEditorInitialState: UvEditorLayoutState = {
  uvEditorOpen: false,
  uvEditorPanel: { x: 80, y: 80, width: 520, height: 560, minimized: false },
  uvEditorGridDivisions: 16,
  uvEditorSnap: false,
  uvEditorSnapMode: 'vertex',
  uvEditorSmartUvAngle: 66,
  uvEditorMode: 'faces',
  uvEditorSelectedPoints: [],
  uvEditorSelectedFaces: [],
  uvEditorZoom: 1,
  uvEditorPanX: 24,
  uvEditorPanY: 24,
  uvEditorShowGrid: true,
  uvEditorTilePreview: false,
  uvEditorViewAll: false,
  uvEditorAutoFit: true,
  uvEditorSticky: false,
  objectTextures: {},
}

export interface UvEditorSliceDeps {
  reconcileBlobUrls: () => void
  bumpTextureLoadGeneration: (objectId: string) => number
  currentTextureLoadGeneration: (objectId: string) => number | undefined
}

type UvStore = UvEditorLayoutState & {
  objects: SceneObject[]
  selectedObjectId: string | null
  selectionObjectIds: string[]
  meshSelection: MeshComponentSelection | null
  selectionMode: SelectionMode
  activeTool: ActiveTool
  toolCategory: ToolCategory
  pixelDocuments: Record<string, import('../pixel/pixelTypes').PixelDocument>
  pixelEditorDocId: string | null
  pixelTextureRevision: number
  updateObject: (id: string, updates: Partial<SceneObject>) => void
  commitHistory: (label?: string) => boolean
}

export function createUvEditorSlice<T extends UvEditorLayoutState>(
  set: (partial: Partial<T> | ((state: T) => Partial<T>)) => void,
  get: () => T & UvEditorLayoutActions,
  deps: UvEditorSliceDeps
): UvEditorLayoutActions {
  const store = () => get() as T & UvEditorLayoutActions & UvStore
  const setPartial = (partial: object | ((state: T) => object)) => {
    if (typeof partial === 'function') {
      set((state) => partial(state) as Partial<T>)
    } else {
      set(partial as unknown as Partial<T>)
    }
  }

  return {
${implBody
  .split('\n')
  .map((l) => (l ? '    ' + l : l))
  .join('\n')
  .replace(/\bget\(\)/g, 'store()')
  .replace(/reconcileAppBlobUrls\(get\)/g, 'deps.reconcileBlobUrls()')
  .replace(/textureLoadGeneration\.get\(objectId\)/g, 'deps.currentTextureLoadGeneration(objectId)')
  .replace(
    /const generation = \(textureLoadGeneration\.get\(objectId\) \?\? 0\) \+ 1\n      textureLoadGeneration\.set\(objectId, generation\)/,
    'const generation = deps.bumpTextureLoadGeneration(objectId)'
  )}
  }
}
`

fs.writeFileSync(outPath, header)
console.log(`Wrote ${outPath} (${sliceLines.length} impl lines)`)
