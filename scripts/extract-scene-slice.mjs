import fs from 'fs'

const appPath = 'src/store/appStore.ts'
const outPath = 'src/store/sceneObjectsSlice.ts'
const lines = fs.readFileSync(appPath, 'utf8').split('\n')

const startIdx = lines.findIndex((l) => l.trim() === 'addObject: (obj, options) => {')
const meshStart = lines.findIndex((l) => l.trim() === 'createFaceFromVertexSelection: () => {')
const endIdx = meshStart >= 0 ? meshStart : lines.findIndex((l) => l.trim() === 'setPolyBudget: (budget) => set({ polyBudget: budget }),')
if (startIdx < 0 || endIdx < 0) {
  throw new Error(`markers not found: start=${startIdx} end=${endIdx}`)
}

const implLines = lines.slice(startIdx, endIdx)
const implBody = implLines
  .map((line) => (line.startsWith('  ') ? line.slice(2) : line))
  .join('\n')

const header = `import type { ObjectTransform, SceneObject } from '../mesh/HalfEdgeMesh'
import {
  cloneTransform,
  ensureTransform,
  prepareSceneObject,
  transformsEqual,
} from '../mesh/objectTransform'
import { enforceSceneObjectPolyBudget } from '../mesh/meshPolyBudget'
import { generateId } from '../utils/math'
import { cloneSceneObject } from '../mesh/meshOps'
import { mirrorSceneObject, type SymmetryAxis } from '../symmetry/symmetry'
import { invalidateFaceGroupCache } from '../mesh/faceGroups'
import { invalidateSubdivisionPreviewCache } from '../mesh/subdivisionSurface'
import type { UvTextureInfo } from './appStore'

export type { SymmetryAxis } from '../symmetry/symmetry'

export interface SceneObjectsLayoutState {
  objects: SceneObject[]
  symmetryEnabled: boolean
  symmetryAxis: SymmetryAxis
  symmetryPlane: number
  clipboard: SceneObject[] | null
}

export interface SceneObjectsLayoutActions {
  addObject: (obj: SceneObject, options?: { skipHistory?: boolean; skipSymmetry?: boolean }) => void
  updateObject: (id: string, updates: Partial<SceneObject>) => void
  removeObject: (id: string) => void
  updateObjectTransform: (id: string, transform: ObjectTransform) => void
  setSymmetryEnabled: (on: boolean) => void
  toggleSymmetry: () => void
  setSymmetryAxis: (axis: SymmetryAxis) => void
  setSymmetryPlane: (plane: number) => void
  copySelection: () => void
  pasteClipboard: () => void
}

export type SceneObjectsSlice = SceneObjectsLayoutState & SceneObjectsLayoutActions

export const sceneObjectsInitialState: SceneObjectsLayoutState = {
  objects: [],
  symmetryEnabled: false,
  symmetryAxis: 'x',
  symmetryPlane: 0,
  clipboard: null,
}

export interface SceneObjectsSliceDeps {
  reconcileBlobUrls: () => void
  purgeTextureResourcesForObjects: (
    objects: SceneObject[],
    removedIds: Set<string>,
    objectTextures: Record<string, UvTextureInfo>,
    pixelDocuments: Record<string, import('../pixel/pixelTypes').PixelDocument>
  ) => {
    objectTextures: Record<string, UvTextureInfo>
    pixelDocuments: Record<string, import('../pixel/pixelTypes').PixelDocument>
  }
  clearTextureLoadGeneration: (id: string) => void
}

type SceneStore = SceneObjectsLayoutState & {
  polyBudget: number
  symmetryEnabled: boolean
  symmetryAxis: SymmetryAxis
  symmetryPlane: number
  selectedObjectId: string | null
  selectionObjectIds: string[]
  objectTextures: Record<string, UvTextureInfo>
  pixelDocuments: Record<string, import('../pixel/pixelTypes').PixelDocument>
  commitHistory: (label?: string) => boolean
}

export function createSceneObjectsSlice<T extends SceneObjectsLayoutState>(
  set: (partial: Partial<T> | ((state: T) => Partial<T>)) => void,
  get: () => T & SceneObjectsLayoutActions,
  deps: SceneObjectsSliceDeps
): SceneObjectsLayoutActions {
  const store = () => get() as T & SceneObjectsLayoutActions & SceneStore
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
  .replace(/purgeTextureResourcesForObjects\(/g, 'deps.purgeTextureResourcesForObjects(')
  .replace(/textureLoadGeneration\.delete\(id\)/g, 'deps.clearTextureLoadGeneration(id)')}
  }
}
`

fs.writeFileSync(outPath, header)
console.log(`Wrote ${outPath} (${endIdx - startIdx} impl lines)`)
