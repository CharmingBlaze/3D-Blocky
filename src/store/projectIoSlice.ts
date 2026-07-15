import type { SceneObject } from '../mesh/HalfEdgeMesh'
import { prepareSceneObject } from '../mesh/objectTransform'
import {
  enforceSceneObjectPolyBudget,
  importVertexCap,
} from '../mesh/meshPolyBudget'
import {
  DEFAULT_PROJECT_FILENAME,
  saveProjectFile,
  loadProjectFromText,
  type ProjectPreferences,
} from '../io/projectIO'
import { pickOpenFile } from '../io/fileDialogs'
import { PROJECT_FILE_FILTERS } from '../io/download'
import { importSceneFromFile } from '../io/sceneImport'
import { confirmDiscardProject } from '../ui/appConfirm'
import type { SceneSnapshot } from '../history/sceneHistory'
import type {
  BillboardImage,
  ReferenceImage,
} from '../images/imageDropTypes'
import type { MeshComponentSelection } from '../mesh/meshSelection'
import type { HairUvTransform } from '../stroke/hairUvTransform'
import { DEFAULT_HAIR_UV_TRANSFORM } from '../stroke/hairUvTransform'
import type { HairTextureSettings } from '../stroke/hairTextureSettings'
import { DEFAULT_HAIR_TEXTURE_SETTINGS } from '../stroke/hairTextureSettings'
import type { HairTipStyle, StrokeMode } from './strokeSlice'
import { strokeLayoutInitialState } from './strokeSlice'
import { sceneSettingsInitialState } from './sceneSettingsSlice'

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
    options?: { resetEditors?: boolean; extra?: object; retainTextureIds?: Iterable<string> }
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
  brushDensity: number
  drawDoubleSided: boolean
  closeThreshold: number
  defaultDepth: number
  activeColor: number
  selectedObjectId: string | null
  selectionObjectIds: string[]
  meshSelection: MeshComponentSelection | null
  pixelTextureRevision: number
  hairTextureId: string | null
  hairUvTransform: HairUvTransform
  hairTextureSettings: HairTextureSettings
  hairTipStyle: HairTipStyle
  strokeMode: StrokeMode
  blobInflation: number
  extrudeAmount: number
  sketchExtrudeMode: boolean
  penExtrudeMode: boolean
  commitHistory: (label?: string) => boolean
}

export function collectProjectPreferences(state: ProjectStore): ProjectPreferences {
  return {
    hair: {
      textureId: state.hairTextureId,
      uvTransform: { ...state.hairUvTransform },
      textureSettings: { ...state.hairTextureSettings },
      tipStyle: state.hairTipStyle,
    },
    stroke: {
      strokeMode: state.strokeMode,
      blobInflation: state.blobInflation,
      extrudeAmount: state.extrudeAmount,
      sketchExtrudeMode: state.sketchExtrudeMode,
      penExtrudeMode: state.penExtrudeMode,
    },
    sceneSettings: {
      polyBudget: state.polyBudget,
      brushDensity: state.brushDensity,
      drawDoubleSided: state.drawDoubleSided,
      closeThreshold: state.closeThreshold,
      defaultDepth: state.defaultDepth,
      activeColor: state.activeColor,
    },
  }
}

/** Defaults applied on Open so v1 files (and missing sections) do not leak prior-session tool state. */
export function defaultProjectPreferencesPartial(): Record<string, unknown> {
  return {
    hairTextureId: null,
    hairUvTransform: { ...DEFAULT_HAIR_UV_TRANSFORM },
    hairTextureSettings: { ...DEFAULT_HAIR_TEXTURE_SETTINGS },
    hairTipStyle: 'pointed' as HairTipStyle,
    strokeMode: strokeLayoutInitialState.strokeMode,
    blobInflation: strokeLayoutInitialState.blobInflation,
    extrudeAmount: strokeLayoutInitialState.extrudeAmount,
    sketchExtrudeMode: strokeLayoutInitialState.sketchExtrudeMode,
    penExtrudeMode: strokeLayoutInitialState.penExtrudeMode,
    polyBudget: sceneSettingsInitialState.polyBudget,
    brushDensity: sceneSettingsInitialState.brushDensity,
    drawDoubleSided: sceneSettingsInitialState.drawDoubleSided,
    closeThreshold: sceneSettingsInitialState.closeThreshold,
    defaultDepth: sceneSettingsInitialState.defaultDepth,
    activeColor: sceneSettingsInitialState.activeColor,
  }
}

/** Map loaded project preferences into store fields. Always starts from defaults. */
export function projectPreferencesToStorePartial(
  preferences: ProjectPreferences
): Record<string, unknown> {
  const extra: Record<string, unknown> = { ...defaultProjectPreferencesPartial() }
  if (preferences.hair) {
    extra.hairTextureId = preferences.hair.textureId
    extra.hairUvTransform = { ...preferences.hair.uvTransform }
    extra.hairTextureSettings = { ...preferences.hair.textureSettings }
    extra.hairTipStyle = preferences.hair.tipStyle
  }
  if (preferences.stroke) {
    extra.strokeMode = preferences.stroke.strokeMode
    extra.blobInflation = preferences.stroke.blobInflation
    extra.extrudeAmount = preferences.stroke.extrudeAmount
    extra.sketchExtrudeMode = preferences.stroke.sketchExtrudeMode
    extra.penExtrudeMode = preferences.stroke.penExtrudeMode
  }
  if (preferences.sceneSettings) {
    extra.polyBudget = preferences.sceneSettings.polyBudget
    extra.brushDensity = preferences.sceneSettings.brushDensity
    extra.drawDoubleSided = preferences.sceneSettings.drawDoubleSided
    extra.closeThreshold = preferences.sceneSettings.closeThreshold
    extra.defaultDepth = preferences.sceneSettings.defaultDepth
    extra.activeColor = preferences.sceneSettings.activeColor
  }
  return extra
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
      if (hasContent && !(await confirmDiscardProject())) {
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
      window.location.reload()
    },

    saveProject: async () => {
      const state = store()
      return saveProjectFile(
        deps.getSnapshot(),
        DEFAULT_PROJECT_FILENAME,
        collectProjectPreferences(state)
      )
    },

    loadProjectFile: async (file) => {
      try {
        const text = await file.text()
        const { snapshot, preferences } = await loadProjectFromText(text)
        const retainTextureIds = preferences.hair?.textureId ? [preferences.hair.textureId] : []
        deps.resetHistory(snapshot)
        deps.restoreScene(snapshot, {
          resetEditors: true,
          retainTextureIds,
          extra: projectPreferencesToStorePartial(preferences),
        })
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
