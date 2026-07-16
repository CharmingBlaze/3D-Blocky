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
  pixelDocRevisions: Record<string, number>
  hairTextureId: string | null
  hairUvTransform: HairUvTransform
  hairTextureSettings: HairTextureSettings
  hairTipStyle: HairTipStyle
  strokeMode: StrokeMode
  blobInflation: number
  extrudeAmount: number
  sketchExtrudeMode: boolean
  penExtrudeMode: boolean
  latheRadialSegments: number
  latheProfileRings: number
  latheSmoothing: number
  pathStartCap: import('./strokeSlice').SweepCapStyle
  pathEndCap: import('./strokeSlice').SweepCapStyle
  pathRadialSegments: number
  pathRadiusScale: number
  ribbonStartTip: HairTipStyle
  ribbonEndTip: HairTipStyle
  ribbonTaper: number
  ribbonWidthScale: number
  ribbonFlat: boolean
  pathOutput: import('../mesh/pathOutputs').PathOutput
  pathStartScale: number
  pathEndScale: number
  pathTwist: number
  pathSpacing: number
  pathOffset: number
  pathProfile: import('../mesh/pathOutputs').PathProfile
  pathProfileWidth: number
  pathProfileHeight: number
  pathChainAlternating: boolean
  pathCardCrossed: boolean
  pathDistributionMode: import('../mesh/pathOutputs').PathDistributionMode
  pathCount: number
  pathStartPadding: number
  pathEndPadding: number
  pathRandomScale: number
  pathRotation: number
  pathRandomRotation: number
  pathAlternateRotation: boolean
  pathMirrorAlternate: boolean
  pathSeed: number
  pathKeepInstances: boolean
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
      latheRadialSegments: state.latheRadialSegments,
      latheProfileRings: state.latheProfileRings,
      latheSmoothing: state.latheSmoothing,
      pathStartCap: state.pathStartCap,
      pathEndCap: state.pathEndCap,
      pathRadialSegments: state.pathRadialSegments,
      pathRadiusScale: state.pathRadiusScale,
      ribbonStartTip: state.ribbonStartTip,
      ribbonEndTip: state.ribbonEndTip,
      ribbonTaper: state.ribbonTaper,
      ribbonWidthScale: state.ribbonWidthScale,
      ribbonFlat: state.ribbonFlat,
      pathOutput: state.pathOutput, pathStartScale: state.pathStartScale, pathEndScale: state.pathEndScale,
      pathTwist: state.pathTwist, pathSpacing: state.pathSpacing, pathOffset: state.pathOffset, pathProfile: state.pathProfile,
      pathProfileWidth: state.pathProfileWidth, pathProfileHeight: state.pathProfileHeight,
      pathChainAlternating: state.pathChainAlternating, pathCardCrossed: state.pathCardCrossed,
      pathDistributionMode: state.pathDistributionMode, pathCount: state.pathCount, pathStartPadding: state.pathStartPadding, pathEndPadding: state.pathEndPadding,
      pathRandomScale: state.pathRandomScale, pathRotation: state.pathRotation, pathRandomRotation: state.pathRandomRotation,
      pathAlternateRotation: state.pathAlternateRotation, pathMirrorAlternate: state.pathMirrorAlternate, pathSeed: state.pathSeed, pathKeepInstances: state.pathKeepInstances,
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
    latheRadialSegments: strokeLayoutInitialState.latheRadialSegments,
    latheProfileRings: strokeLayoutInitialState.latheProfileRings,
    latheSmoothing: strokeLayoutInitialState.latheSmoothing,
    pathStartCap: strokeLayoutInitialState.pathStartCap,
    pathEndCap: strokeLayoutInitialState.pathEndCap,
    pathRadialSegments: strokeLayoutInitialState.pathRadialSegments,
    pathRadiusScale: strokeLayoutInitialState.pathRadiusScale,
    ribbonStartTip: strokeLayoutInitialState.ribbonStartTip,
    ribbonEndTip: strokeLayoutInitialState.ribbonEndTip,
    ribbonTaper: strokeLayoutInitialState.ribbonTaper,
    ribbonWidthScale: strokeLayoutInitialState.ribbonWidthScale,
    ribbonFlat: strokeLayoutInitialState.ribbonFlat,
    pathOutput: strokeLayoutInitialState.pathOutput,
    pathStartScale: strokeLayoutInitialState.pathStartScale,
    pathEndScale: strokeLayoutInitialState.pathEndScale,
    pathTwist: strokeLayoutInitialState.pathTwist,
    pathSpacing: strokeLayoutInitialState.pathSpacing,
    pathOffset: strokeLayoutInitialState.pathOffset,
    pathProfile: strokeLayoutInitialState.pathProfile,
    pathProfileWidth: strokeLayoutInitialState.pathProfileWidth,
    pathProfileHeight: strokeLayoutInitialState.pathProfileHeight,
    pathChainAlternating: strokeLayoutInitialState.pathChainAlternating,
    pathCardCrossed: strokeLayoutInitialState.pathCardCrossed,
    pathDistributionMode: strokeLayoutInitialState.pathDistributionMode,
    pathCount: strokeLayoutInitialState.pathCount,
    pathStartPadding: strokeLayoutInitialState.pathStartPadding,
    pathEndPadding: strokeLayoutInitialState.pathEndPadding,
    pathRandomScale: strokeLayoutInitialState.pathRandomScale,
    pathRotation: strokeLayoutInitialState.pathRotation,
    pathRandomRotation: strokeLayoutInitialState.pathRandomRotation,
    pathAlternateRotation: strokeLayoutInitialState.pathAlternateRotation,
    pathMirrorAlternate: strokeLayoutInitialState.pathMirrorAlternate,
    pathSeed: strokeLayoutInitialState.pathSeed,
    pathKeepInstances: strokeLayoutInitialState.pathKeepInstances,
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
    extra.latheRadialSegments = preferences.stroke.latheRadialSegments
    extra.latheProfileRings = preferences.stroke.latheProfileRings
    extra.latheSmoothing = preferences.stroke.latheSmoothing
    extra.pathStartCap = preferences.stroke.pathStartCap
    extra.pathEndCap = preferences.stroke.pathEndCap
    extra.pathRadialSegments = preferences.stroke.pathRadialSegments
    extra.pathRadiusScale = preferences.stroke.pathRadiusScale
    extra.ribbonStartTip = preferences.stroke.ribbonStartTip
    extra.ribbonEndTip = preferences.stroke.ribbonEndTip
    extra.ribbonTaper = preferences.stroke.ribbonTaper
    extra.ribbonWidthScale = preferences.stroke.ribbonWidthScale
    extra.ribbonFlat = preferences.stroke.ribbonFlat
    extra.pathOutput = preferences.stroke.pathOutput
    extra.pathStartScale = preferences.stroke.pathStartScale
    extra.pathEndScale = preferences.stroke.pathEndScale
    extra.pathTwist = preferences.stroke.pathTwist
    extra.pathSpacing = preferences.stroke.pathSpacing
    extra.pathOffset = preferences.stroke.pathOffset
    extra.pathProfile = preferences.stroke.pathProfile
    extra.pathProfileWidth = preferences.stroke.pathProfileWidth
    extra.pathProfileHeight = preferences.stroke.pathProfileHeight
    extra.pathChainAlternating = preferences.stroke.pathChainAlternating
    extra.pathCardCrossed = preferences.stroke.pathCardCrossed
    extra.pathDistributionMode = preferences.stroke.pathDistributionMode
    extra.pathCount = preferences.stroke.pathCount
    extra.pathStartPadding = preferences.stroke.pathStartPadding
    extra.pathEndPadding = preferences.stroke.pathEndPadding
    extra.pathRandomScale = preferences.stroke.pathRandomScale
    extra.pathRotation = preferences.stroke.pathRotation
    extra.pathRandomRotation = preferences.stroke.pathRandomRotation
    extra.pathAlternateRotation = preferences.stroke.pathAlternateRotation
    extra.pathMirrorAlternate = preferences.stroke.pathMirrorAlternate
    extra.pathSeed = preferences.stroke.pathSeed
    extra.pathKeepInstances = preferences.stroke.pathKeepInstances
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
        const pixelDocRevisions: Record<string, number> = { ...st.pixelDocRevisions }
        for (const id of Object.keys(st.pixelDocuments)) {
          pixelDocRevisions[id] = (pixelDocRevisions[id] ?? 0) + 1
        }
        return {
          pixelTextureRevision: st.pixelTextureRevision + 1,
          pixelDocRevisions,
        }
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
