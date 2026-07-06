import fs from 'fs'

const appPath = 'src/store/appStore.ts'
const outPath = 'src/store/meshEditSlice.ts'
const lines = fs.readFileSync(appPath, 'utf8').split('\n')

const startIdx = lines.findIndex((l) => l.trim() === 'createFaceFromVertexSelection: () => {')
const endIdx = lines.findIndex((l) => l.trim() === 'setPolyBudget: (budget) => set({ polyBudget: budget }),')
if (startIdx < 0 || endIdx < 0) {
  throw new Error(`markers not found: start=${startIdx} end=${endIdx}`)
}

const implLines = lines.slice(startIdx, endIdx)
const implBody = implLines
  .map((line) => (line.startsWith('  ') ? line.slice(2) : line))
  .join('\n')

const header = `import type { SceneObject } from '../mesh/HalfEdgeMesh'
import { appendFaceFromVertexIndices } from '../mesh/meshEdit'
import {
  flipSelectionNormals,
  mergeVertices,
  subdivideObject,
} from '../mesh/meshTopologyOps'
import {
  clampSubdLevels,
  subdivideSurfaceLevels,
} from '../mesh/subdivisionSurface'
import {
  enforceSceneObjectPolyBudget,
  maxSubdLevelsForBudget,
} from '../mesh/meshPolyBudget'
import {
  getAffectedVertices,
  selectionHasComponents,
  type MeshComponentSelection,
} from '../mesh/meshSelection'
import {
  allVertexIndices,
  applySelectionPlaneTransform,
  type SelectionPlaneTransformOp,
} from '../mesh/selectionPlaneTransform'
import { viewScreenAxes } from '../mesh/selectionPlaneTransform'
import type { SelectionMode } from './selectionSlice'
import type { ViewType } from '../scene/viewTypes'
import type { ViewMoveBasis } from './viewportSlice'

export interface MeshEditLayoutState {
  vertexMergeModifierHeld: boolean
}

export interface MeshEditLayoutActions {
  createFaceFromVertexSelection: () => void
  mergeSelectedVertices: (indices?: number[]) => void
  setVertexMergeModifierHeld: (held: boolean) => void
  flipSelectedNormals: () => void
  transformSelectionInViewPlane: (op: SelectionPlaneTransformOp) => void
  subdivideSelected: () => void
  toggleSubDSelected: () => void
  setSubDLevelsSelected: (levels: number) => void
  adjustSubDLevelsSelected: (delta: number) => void
  applySubDSelected: () => void
}

export type MeshEditSlice = MeshEditLayoutState & MeshEditLayoutActions

export const meshEditInitialState: MeshEditLayoutState = {
  vertexMergeModifierHeld: false,
}

type MeshStore = MeshEditLayoutState & {
  meshSelection: MeshComponentSelection | null
  selectionMode: SelectionMode
  activeColor: number
  objects: SceneObject[]
  activeView: ViewType
  viewMoveBasis: ViewMoveBasis | null
  selectionObjectIds: string[]
  selectedObjectId: string | null
  polyBudget: number
  updateObject: (id: string, updates: Partial<SceneObject>) => void
  commitHistory: (label?: string) => boolean
}

export function createMeshEditSlice<T extends MeshEditLayoutState>(
  set: (partial: Partial<T> | ((state: T) => Partial<T>)) => void,
  get: () => T & MeshEditLayoutActions
): MeshEditLayoutActions {
  const store = () => get() as T & MeshEditLayoutActions & MeshStore
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
  .replace(/\bget\(\)/g, 'store()')}
  }
}
`

fs.writeFileSync(outPath, header)
console.log(`Wrote ${outPath} (${endIdx - startIdx} impl lines)`)
