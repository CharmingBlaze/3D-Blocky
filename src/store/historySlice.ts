import type { SceneObject } from '../mesh/HalfEdgeMesh'
import type { MeshComponentSelection } from '../mesh/meshSelection'
import type { BillboardImage, ReferenceImage } from '../images/imageDropTypes'
import type { PixelDocument } from '../pixel/pixelTypes'
import {
  SceneHistoryStack,
  type SceneSnapshot,
  type SnapshotTextureInfo,
} from '../history/sceneHistory'

export const MAX_HISTORY_DEPTH = 50

export interface SceneSnapshotSource {
  objects: SceneObject[]
  objectTextures: Record<string, SnapshotTextureInfo>
  pixelDocuments: Record<string, PixelDocument>
  referenceImages: ReferenceImage[]
  billboardImages: BillboardImage[]
  selectedObjectId: string | null
  selectionObjectIds: string[]
  meshSelection: MeshComponentSelection | null
}

export interface HistoryLayoutState {
  historyPaused: number
  canUndo: boolean
  canRedo: boolean
}

export interface HistoryLayoutActions {
  pushHistory: (label?: string, options?: { force?: boolean }) => boolean
  commitHistory: (label?: string, options?: { force?: boolean }) => boolean
  captureUndoPoint: (label?: string) => boolean
  replaceHistoryHead: (label?: string) => void
  pauseHistory: () => void
  resumeHistory: () => void
  undo: () => void
  redo: () => void
}

export type HistorySlice = HistoryLayoutState & HistoryLayoutActions

export interface HistorySliceDeps {
  getSnapshot: () => SceneSnapshot
  restoreSnapshot: (snapshot: SceneSnapshot, options?: { resetEditors?: boolean }) => void
  reconcileResources: () => void
}

export const historyLayoutInitialState: HistoryLayoutState = {
  historyPaused: 0,
  canUndo: false,
  canRedo: false,
}

export function emptySceneSnapshot(): SceneSnapshot {
  return {
    objects: [],
    objectTextures: {},
    pixelDocuments: {},
    referenceImages: [],
    billboardImages: [],
    selectedObjectId: null,
    selectionObjectIds: [],
    meshSelection: null,
  }
}

export function snapshotFromState(state: SceneSnapshotSource): SceneSnapshot {
  return {
    objects: state.objects,
    objectTextures: state.objectTextures,
    pixelDocuments: state.pixelDocuments,
    referenceImages: state.referenceImages,
    billboardImages: state.billboardImages,
    selectedObjectId: state.selectedObjectId,
    selectionObjectIds: state.selectionObjectIds,
    meshSelection: state.meshSelection,
  }
}

const sceneHistory = new SceneHistoryStack(emptySceneSnapshot(), MAX_HISTORY_DEPTH)

export function syncHistoryFlags(): Pick<HistoryLayoutState, 'canUndo' | 'canRedo'> {
  const stats = sceneHistory.stats()
  return { canUndo: stats.canUndo, canRedo: stats.canRedo }
}

export function resetSceneHistory(snapshot: SceneSnapshot): void {
  sceneHistory.reset(snapshot)
}

export function allHistorySnapshots(): SceneSnapshot[] {
  return sceneHistory.allSnapshots()
}

export function createHistorySlice<T extends HistoryLayoutState>(
  set: (partial: Partial<T> | ((state: T) => Partial<T>)) => void,
  get: () => T & HistoryLayoutActions,
  deps: HistorySliceDeps
): HistoryLayoutActions {
  const syncFlags = () => set(syncHistoryFlags() as Partial<T>)

  return {
    pushHistory: (label, options) => get().commitHistory(label, options),

    commitHistory: (label, options) => {
      if (get().historyPaused > 0) return false
      const added = sceneHistory.push(deps.getSnapshot(), label, options)
      if (added) {
        deps.reconcileResources()
        syncFlags()
      }
      return added
    },

    captureUndoPoint: (label) => get().commitHistory(label, { force: true }),

    replaceHistoryHead: (label) => {
      sceneHistory.replaceHead(deps.getSnapshot(), label)
      deps.reconcileResources()
      syncFlags()
    },

    pauseHistory: () => set((s) => ({ historyPaused: s.historyPaused + 1 }) as Partial<T>),
    resumeHistory: () =>
      set((s) => ({ historyPaused: Math.max(0, s.historyPaused - 1) }) as Partial<T>),

    undo: () => {
      const snapshot = sceneHistory.undo()
      if (!snapshot) {
        syncFlags()
        return
      }
      deps.restoreSnapshot(snapshot)
    },

    redo: () => {
      const snapshot = sceneHistory.redo()
      if (!snapshot) {
        syncFlags()
        return
      }
      deps.restoreSnapshot(snapshot)
    },
  }
}
