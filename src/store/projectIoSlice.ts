import type { SceneObject } from '../mesh/HalfEdgeMesh'
import { prepareSceneObject } from '../mesh/objectTransform'
import {
  enforceSceneObjectPolyBudget,
  importVertexCap,
} from '../mesh/meshPolyBudget'
import {
  DEFAULT_PROJECT_FILENAME,
  saveProjectFile,
  parseProjectFile,
  snapshotFromProjectFile,
} from '../io/projectIO'
import { pickOpenFile } from '../io/fileDialogs'
import { PROJECT_FILE_FILTERS } from '../io/download'
import { importSceneFromFile } from '../io/sceneImport'
import type { SceneSnapshot } from '../history/sceneHistory'
import { emptySceneSnapshot } from './historySlice'
import type {
  BillboardImage,
  ReferenceImage,
} from '../images/imageDropTypes'
import type { MeshComponentSelection } from '../mesh/meshSelection'

export interface ProjectIoLayoutActions {
  reconcileGpuResources: () => void
  requestProjectLoad: () => void
  loadProjectFromDialog: () => Promise<boolean>
  newProject: () => void
  saveProject: () => Promise<boolean>
  loadProjectFile: (file: File) => Promise<void>
  importSceneFile: (file: File) => Promise<number>
}

export type ProjectIoSlice = ProjectIoLayoutActions

export interface ProjectIoSliceDeps {
  reconcileBlobUrls: () => void
  restoreScene: (
    snapshot: SceneSnapshot,
    options?: { resetEditors?: boolean; extra?: object }
  ) => void
  resetHistory: (snapshot: SceneSnapshot) => void
  getSnapshot: () => SceneSnapshot
}

type ProjectStore = {
  objects: SceneObject[]
  referenceImages: ReferenceImage[]
  billboardImages: BillboardImage[]
  pixelDocuments: Record<string, import('../pixel/pixelTypes').PixelDocument>
  polyBudget: number
  selectedObjectId: string | null
  selectionObjectIds: string[]
  meshSelection: MeshComponentSelection | null
  pixelTextureRevision: number
  commitHistory: (label?: string) => boolean
}

export function createProjectIoSlice<T extends object>(
  set: (partial: Partial<T> | ((state: T) => Partial<T>)) => void,
  get: () => T & ProjectIoLayoutActions,
  deps: ProjectIoSliceDeps
): ProjectIoLayoutActions {
  const store = () => get() as T & ProjectIoLayoutActions & ProjectStore
  const setPartial = (partial: object | ((state: T) => object)) => {
    if (typeof partial === 'function') {
      set((state) => partial(state) as Partial<T>)
    } else {
      set(partial as unknown as Partial<T>)
    }
  }

  return {
    reconcileGpuResources: () => {
      deps.reconcileBlobUrls()
      setPartial((s) => {
        const st = s as unknown as ProjectStore
        return { pixelTextureRevision: st.pixelTextureRevision + 1 }
      })
    },

    requestProjectLoad: () => {
      void store().loadProjectFromDialog()
    },

    loadProjectFromDialog: async () => {
      const state = store()
      const hasContent =
        state.objects.length > 0 ||
        state.referenceImages.length > 0 ||
        state.billboardImages.length > 0 ||
        Object.keys(state.pixelDocuments).length > 0
      if (
        hasContent &&
        !window.confirm('Discard the current project? Unsaved changes will be lost.')
      ) {
        return false
      }

      const file = await pickOpenFile({
        title: 'Open project',
        filters: PROJECT_FILE_FILTERS,
      })
      if (!file) return false

      await store().loadProjectFile(file)
      return true
    },

    newProject: () => {
      const empty = emptySceneSnapshot()
      deps.resetHistory(empty)
      deps.restoreScene(empty, {
        resetEditors: true,
        extra: {
          pixelDocuments: {},
          objectTextures: {},
          referenceImages: [],
          billboardImages: [],
        },
      })
    },

    saveProject: async () => {
      return saveProjectFile(deps.getSnapshot(), DEFAULT_PROJECT_FILENAME)
    },

    loadProjectFile: async (file) => {
      try {
        const text = await file.text()
        const parsed = parseProjectFile(text)
        const snapshot = await snapshotFromProjectFile(parsed)
        deps.resetHistory(snapshot)
        deps.restoreScene(snapshot, { resetEditors: true })
      } catch (err) {
        const detail = err instanceof Error ? err.message : 'Unknown error'
        throw new Error(`Could not load "${file.name}": ${detail}`)
      }
    },

    importSceneFile: async (file) => {
      const imported = await importSceneFromFile(file)
      if (imported.length === 0) {
        throw new Error('No meshes found in file')
      }

      const { polyBudget } = store()
      const cap = importVertexCap(polyBudget)
      const prepared = imported.map((obj) =>
        enforceSceneObjectPolyBudget(prepareSceneObject(obj), cap)
      )
      setPartial((s) => {
        const st = s as unknown as ProjectStore
        return {
          objects: [...st.objects, ...prepared],
          selectedObjectId: prepared[0].id,
          selectionObjectIds: prepared.map((o) => o.id),
          meshSelection: null,
        }
      })
      store().commitHistory('Import')
      return prepared.length
    },
  }
}
