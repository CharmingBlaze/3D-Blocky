import fs from 'fs'

const appPath = 'src/store/appStore.ts'
const outPath = 'src/store/toolActivationSlice.ts'
const lines = fs.readFileSync(appPath, 'utf8').split('\n')

const startIdx = lines.findIndex((l) => l.trim() === 'setActiveTool: (tool) => {')
const endIdx = lines.findIndex((l) => l.trim() === 'setPolyBudget: (budget) => set({ polyBudget: budget }),')
if (startIdx < 0 || endIdx < 0) {
  throw new Error(`markers not found: start=${startIdx} end=${endIdx}`)
}

const implLines = lines.slice(startIdx, endIdx)
const implBody = implLines
  .map((line) => (line.startsWith('  ') ? line.slice(2) : line))
  .join('\n')

const header = `import type { ObjectTransform, SceneObject } from '../mesh/HalfEdgeMesh'
import { cloneTransform, ensureTransform, selectionWorldCenter } from '../mesh/objectTransform'
import {
  applyObjectTransformModal,
  type ObjectTransformModalOp,
} from '../mesh/objectTransformModal'
import type { Vec3 } from '../utils/math'
import { categoryForActiveTool, type ToolRingEntry } from '../tools/toolRingConfig'
import {
  meshSelectionWorldCenter,
  selectionHasComponents,
  type MeshComponentSelection,
} from '../mesh/meshSelection'
import {
  applyMeshModalOp,
  cloneSceneObject,
  modalValueFromMouseDelta,
  modalValueFromWheel,
  type MeshModalOpKind,
} from '../mesh/meshOps'
import { clearStrokeDraftState, type DrawInputMode } from './strokeSlice'
import { clearVectorDraftState } from './vectorToolsSlice'
import type { SelectionMode } from './selectionSlice'

export type ToolCategory =
  | 'draw'
  | 'create'
  | 'vector'
  | 'sculpt'
  | 'select'
  | 'transform'
  | 'mesh'
  | 'boolean'

export type ActiveTool =
  | 'draw'
  | 'push'
  | 'pull'
  | 'inflate'
  | 'deflate'
  | 'relax'
  | 'pinch'
  | 'select-object'
  | 'move'
  | 'rotate'
  | 'scale'
  | 'select-vertex'
  | 'select-edge'
  | 'select-face'
  | 'boolean-hole'
  | 'simplify'
  | 'vector-pen'
  | 'vector-shape'
  | 'primitive-box'
  | 'poly-draw'
  | 'knife'
  | 'loop-cut'

export type MeshModalOp = MeshModalOpKind

export interface MeshModalState {
  op: MeshModalOp
  objectId: string
  baseObject: SceneObject
  selection: MeshComponentSelection
  selectionMode: SelectionMode
  value: number
  startClientX: number
  startClientY: number
  pivotWorld: Vec3
}

export interface ObjectTransformModalState {
  op: ObjectTransformModalOp
  objectIds: string[]
  baseTransforms: Record<string, ObjectTransform>
  pivotWorld: Vec3
  value: number
  startClientX: number
  startClientY: number
}

export interface ToolActivationLayoutState {
  activeTool: ActiveTool
  toolCategory: ToolCategory
  meshModal: MeshModalState | null
  objectTransformModal: ObjectTransformModalState | null
}

export interface ToolActivationLayoutActions {
  setActiveTool: (tool: ActiveTool) => void
  activateToolRingEntry: (category: ToolCategory, entry: ToolRingEntry) => boolean
  activateSelectTool: () => void
  setToolCategory: (cat: ToolCategory) => void
  beginMeshModal: (op: MeshModalOp, clientX: number, clientY: number) => void
  updateMeshModalFromPointer: (clientX: number, clientY: number) => void
  adjustMeshModalWheel: (deltaY: number) => void
  confirmMeshModal: () => void
  cancelMeshModal: () => void
  applyMeshModalPreview: () => void
  beginObjectTransformModal: (op: ObjectTransformModalOp, clientX: number, clientY: number) => void
  updateObjectTransformModalFromPointer: (clientX: number, clientY: number) => void
  adjustObjectTransformModalWheel: (deltaY: number) => void
  confirmObjectTransformModal: () => void
  cancelObjectTransformModal: () => void
  applyObjectTransformModalPreview: () => void
}

export type ToolActivationSlice = ToolActivationLayoutState & ToolActivationLayoutActions

export const toolActivationInitialState: ToolActivationLayoutState = {
  activeTool: 'draw',
  toolCategory: 'draw',
  meshModal: null,
  objectTransformModal: null,
}

type ToolStore = ToolActivationLayoutState & {
  drawInputMode: DrawInputMode
  selectionObjectIds: string[]
  selectedObjectId: string | null
  selectionMode: SelectionMode
  meshSelection: MeshComponentSelection | null
  objects: SceneObject[]
  showExportDialog: boolean
  penCancelPath: () => void
  polyDrawCancel: () => void
  clearPolyDrawHover: () => void
  knifeCancel: () => void
  loopCutCancel: () => void
  setSelectionMode: (mode: SelectionMode) => void
  setActivePrimitiveKind: (kind: import('./vectorToolsSlice').PrimitiveKind | null) => void
  setActiveShapeKind: (kind: import('../vector/types').ShapeKind) => void
  setPolyDrawMode: (mode: import('./cadMeshToolsSlice').PolyDrawMode) => void
  setDrawInputMode: (mode: DrawInputMode) => void
  simplifySelected: () => void
  subdivideSelected: () => void
  flipSelectedNormals: () => void
  toggleSubDSelected: () => void
  setSelectionSmoothShading: (smooth: boolean) => void
  toggleUvEditor: () => void
  toggleTopologyLock: () => void
  copySelection: () => void
  pasteClipboard: () => void
  deleteSelection: () => void
  updateObject: (id: string, updates: Partial<SceneObject>) => void
  captureUndoPoint: (label?: string) => void
  replaceHistoryHead: (label?: string) => void
  pauseHistory: () => void
  undo: () => void
  resumeHistory: () => void
}

export function createToolActivationSlice<T extends ToolActivationLayoutState>(
  set: (partial: Partial<T> | ((state: T) => Partial<T>)) => void,
  get: () => T & ToolActivationLayoutActions
): ToolActivationLayoutActions {
  const store = () => get() as T & ToolActivationLayoutActions & ToolStore
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
