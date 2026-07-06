import fs from 'fs'

const appPath = 'src/store/appStore.ts'
const outPath = 'src/store/vectorToolsSlice.ts'
const lines = fs.readFileSync(appPath, 'utf8').split('\n')

const startIdx = lines.findIndex((l) => l.trim() === 'startVectorStroke: (point, view) =>')
const endIdx = lines.findIndex((l) => l.trim() === 'createFaceFromVertexSelection: () => {')
if (startIdx < 0 || endIdx < 0) {
  throw new Error(`markers not found: start=${startIdx} end=${endIdx}`)
}

const implLines = lines.slice(startIdx, endIdx)
const implBody = implLines
  .map((line) => (line.startsWith('  ') ? line.slice(2) : line))
  .join('\n')
  .replace(/^(\w+): /gm, '$1: ')

const header = `import { attachVectorSource } from '../vector/vectorSource'
import { vectorPathToMesh } from '../vector/vectorPathToMesh'
import { emptyVectorDocument, type VectorDocument, type VectorPath, type VectorAnchor, type ShapeKind } from '../vector/types'
import {
  findNearestPathEndpoint,
  snapPointToEndpoint,
  cloneAnchors,
} from '../vector/autoConnect'
import {
  createAnchor,
  finalizePendingAnchor,
  applySmoothHandles,
  isNearPoint,
} from '../vector/penTool'
import { vectorShapeToObject } from '../mesh/lowPolyPrimitives'
import {
  clampRoundness,
  clampRoundedBoxSubdivisions,
  type RoundedBoxParams,
} from '../mesh/roundedBox'
import { generateId, type Vec2, type Vec3 } from '../utils/math'
import type { PrimitiveBoxType } from '../primitives/primitivesBox'
import {
  baseBoxFromPlaneCorners,
  baseBoxFromGroundCorners,
  extrudeFlatBoxToHeight,
  extrudeBoxOnHeightAxis,
  flattenBoxOnHeightAxis,
  startPerspectivePrimitiveBoxSession,
  startPrimitiveBoxSession,
  type WorldBox,
} from '../primitives/primitiveBoxMath'
import { primitiveBoxToSceneObject } from '../primitives/primitiveBoxCommit'
import { canExtrudeHeightInView, isOrthoView, type Axis } from '../primitives/viewAxes'
import { maxRoundedBoxSubdivisionsForBudget } from '../mesh/meshPolyBudget'
import type { ViewType, OrthoViewType } from '../scene/viewTypes'
import type { UvTextureInfo } from './appStore'
import { clearStrokeDraftState } from './strokeSlice'

export type PrimitiveKind = PrimitiveBoxType
export type PrimitiveBoxPhase = 'drawingBase' | 'drawingHeight' | 'scrollHeight'

export interface PrimitiveBoxDraft {
  phase: PrimitiveBoxPhase
  baseView: ViewType
  heightAxis: Axis
  box: WorldBox
  baseBoxLocked: WorldBox
  baseCornerA: Vec2
  baseCornerB: Vec2
  heightCornerA: Vec2 | null
  heightCornerB: Vec2 | null
  heightView: OrthoViewType | null
  worldCornerA?: Vec3
  worldCornerB?: Vec3
  groundY?: number
  scrollHeight?: number
}

export interface VectorPenDraft {
  anchors: VectorAnchor[]
  view: ViewType
  previewPoint: { x: number; y: number } | null
  pendingAnchorIndex: number | null
  continuePathId: string | null
  closeTargetActive: boolean
}

export interface VectorToolsLayoutState {
  lastPenEndpoint: { view: ViewType; position: { x: number; y: number } } | null
  lastPenClickAt: number
  vectorDocument: VectorDocument
  vectorDraft: { x: number; y: number }[]
  vectorDraftView: ViewType | null
  vectorIsDrawing: boolean
  vectorPenDraft: VectorPenDraft | null
  activeShapeKind: ShapeKind
  activePrimitiveKind: PrimitiveKind | null
  roundedBoxRoundness: number
  roundedBoxSubdivisions: number
  primitiveBoxDraft: PrimitiveBoxDraft | null
}

export interface VectorToolsLayoutActions {
  startVectorStroke: (point: { x: number; y: number }, view: ViewType) => void
  continueVectorStroke: (point: { x: number; y: number }) => void
  endVectorStroke: (view: ViewType) => void
  penPointerDown: (point: { x: number; y: number }, view: ViewType) => void
  penPointerMove: (point: { x: number; y: number }) => void
  penPointerUp: (point: { x: number; y: number }, options?: { altKey?: boolean }) => void
  penFinishPath: () => void
  penCancelPath: () => void
  commitPenPath: (closed: boolean) => void
  commitVectorPath: (path: VectorPath, options?: { skipHistory?: boolean; skipSymmetry?: boolean }) => void
  commitVectorShape: (
    kind: ShapeKind,
    a: { x: number; y: number },
    b: { x: number; y: number },
    view: ViewType
  ) => void
  setActiveShapeKind: (kind: ShapeKind) => void
  setActivePrimitiveKind: (kind: PrimitiveKind | null) => void
  setRoundedBoxRoundness: (value: number) => void
  setRoundedBoxSubdivisions: (value: number) => void
  adjustRoundedBoxWheel: (deltaY: number, shiftKey: boolean) => boolean
  cancelPrimitiveBoxDraft: () => void
  primitiveBoxPointerDown: (
    point: Vec2,
    view: ViewType,
    shiftKey: boolean,
    worldPoint?: Vec3
  ) => void
  primitiveBoxPointerMove: (
    point: Vec2,
    view: ViewType,
    shiftKey: boolean,
    worldPoint?: Vec3
  ) => void
  primitiveBoxPointerUp: (point: Vec2, view: ViewType, shiftKey: boolean, worldPoint?: Vec3) => void
  adjustPrimitiveBoxWheel: (deltaY: number) => void
  commitPrimitiveBox: () => void
}

export type VectorToolsSlice = VectorToolsLayoutState & VectorToolsLayoutActions

export const vectorToolsInitialState: VectorToolsLayoutState = {
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
}

export function clearVectorDraftState(): Pick<
  VectorToolsLayoutState,
  | 'vectorDraft'
  | 'vectorDraftView'
  | 'vectorIsDrawing'
  | 'vectorPenDraft'
  | 'primitiveBoxDraft'
> {
  return {
    vectorDraft: [],
    vectorDraftView: null,
    vectorIsDrawing: false,
    vectorPenDraft: null,
    primitiveBoxDraft: null,
  }
}

function withoutObjectTexture(
  objectTextures: Record<string, UvTextureInfo>,
  objectId: string
): Record<string, UvTextureInfo> {
  if (!objectTextures[objectId]) return objectTextures
  const next = { ...objectTextures }
  delete next[objectId]
  return next
}

export interface VectorToolsSliceDeps {
  reconcileBlobUrls: () => void
}

type VectorStore = VectorToolsLayoutState & {
  addObject: (
    obj: import('../mesh/HalfEdgeMesh').SceneObject,
    options?: { skipHistory?: boolean; skipSymmetry?: boolean }
  ) => void
  commitHistory: (label?: string) => boolean
  clearExtrudeDrag: () => void
  autoConnectPaths: boolean
  closeThreshold: number
  polyBudget: number
  brushDensity: number
  strokeMode: import('./strokeSlice').StrokeMode
  rdpTolerance: number
  defaultDepth: number
  facetExaggeration: number
  penExtrudeMode: boolean
  extrudeAmount: number
  activeColor: number
  activeTool: string
  toolCategory: string
  objects: import('../mesh/HalfEdgeMesh').SceneObject[]
  objectTextures: Record<string, UvTextureInfo>
}

export function createVectorToolsSlice<T extends VectorToolsLayoutState>(
  set: (partial: Partial<T> | ((state: T) => Partial<T>)) => void,
  get: () => T & VectorToolsLayoutActions,
  deps: VectorToolsSliceDeps
): VectorToolsLayoutActions {
  const store = () => get() as T & VectorToolsLayoutActions & VectorStore
  const patch = (partial: object) => partial as unknown as Partial<T>

  return {
${implBody
  .split('\n')
  .map((l) => (l ? '    ' + l : l))
  .join('\n')
  .replace(/reconcileAppBlobUrls\(get\)/g, 'deps.reconcileBlobUrls()')}
  }
}
`

fs.writeFileSync(outPath, header)
console.log(`Wrote ${outPath} (${endIdx - startIdx} impl lines)`)
