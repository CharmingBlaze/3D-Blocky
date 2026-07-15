import { create } from 'zustand'
import { HalfEdgeMesh, type SceneObject } from '../mesh/HalfEdgeMesh'
import { ensurePositiveVolume } from '../mesh/meshWinding'
import { invalidateFaceGroupCache } from '../mesh/faceGroups'
import { invalidateSubdivisionPreviewCache } from '../mesh/subdivisionSurface'
import { clearSculptSession } from '../sculpt/sculptSessionCache'
import { rebuildObjectIndex } from './objectIndex'
import type { FloatingPanelState } from '../components/FloatingPanel'
import {
  applyGradientOnObjects,
  createHarmonyCustomPalette,
  gradientHandlesForDirection,
  gradientLineFromEditorState,
  materialEditorInitialState,
  paintColorOnObjects,
  persistCustomPalettes,
  resolveTargetObjectIds,
  rgbaToActiveColorNumber,
  setObjectMaterialMode,
  syncEditorColorFromSelection,
  updateObjectMaterialSettings,
} from '../material/materialEditorSlice'
import {
  registerPixelDocument,
  addPixelLayer,
  applyShapeToDocument,
  bucketFillDocument,
  createBlankDocumentForObject,
  deletePixelLayer,
  duplicatePixelLayer,
  importImageAsLayer,
  importImageAsNewDocument,
  mergeLayerDown,
  paintAtPixel,
  paintSoftBrushStrokeOnDocument,
  paintStrokeOnDocument,
  patchPixelLayer,
  pixelEditorInitialState,
  reorderPixelLayer,
  resetSoftBrushStroke,
  sampleColorFromDocument,
  syncPixelDocumentGpu,
  flushPixelDocumentGpuSync,
  resyncAllPixelDocuments,
} from '../pixel/pixelEditorSlice'
import {
  clearSelectionOnDocument,
  copySelectionToClipboard,
  cutSelectionOnDocument,
  pasteClipboardOnDocument,
} from '../pixel/pixelClipboard'
import { resizePixelDocument as resizePixelDoc } from '../pixel/pixelDocument'
import type { PixelBlendMode, PixelSelection, PixelTool } from '../pixel/pixelTypes'
import type { PixelBrushShape } from '../pixel/pixelBrushTypes'
import { compositeLayers } from '../pixel/compositeLayers'
import { exportCompositeToPngBlob } from '../pixel/pixelTools'
import { serializePixelDocument, parsePixelDocumentFile } from '../pixel/pixelDocumentIO'
import { exportFilenameForPixelDocument } from '../io/materialTextureExport'
import { releasePixelDocumentTexture } from '../rendering/textureCache'
import { clearPixelCompositeCache } from '../pixel/pixelCompositeCache'
import { downloadBlob, downloadJSON, PIXEL_PROJECT_FILTERS } from '../io/download'
import { TEXTURE_PROJECT_SUFFIX } from '../app/branding'
import { resolveEffectiveMaterial, ensureObjectMaterial } from '../material/materials'
import type { CustomPalette, GradientDirection, GradientHandle2D, HarmonyScheme, MaterialMode, Rgba4 } from '../material/materialTypes'
import { rgba4ToHex } from '../material/materialTypes'
import { PRESET_PALETTES, generateHarmonyPalette, savePixelPenPalettes, loadCustomPalettes, loadPixelPenPalettes } from '../material/palettes'
import { assignUvMappingForMode, ensureObjectUVs } from '../uv/uvObject'
import { sanitizeSceneSnapshot, type SceneSnapshot } from '../history/sceneHistory'
import { reconcilePixelDocumentCache } from '../rendering/textureCache'
import {
  collectActiveBlobUrls,
  collectActivePixelDocIds,
  reconcileBlobUrls,
} from '../rendering/blobUrlLifecycle'
import type { BillboardImage, ReferenceImage } from '../images/imageDropTypes'
import { generateId } from '../utils/math'
import {
  createUvEditorSlice,
  uvEditorInitialState,
  type UvEditorSlice,
  type UvTextureInfo,
} from './uvEditorSlice'
import {
  createViewportSlice,
  viewportLayoutInitialState,
  type ViewportSlice,
} from './viewportSlice'
import {
  allHistorySnapshots,
  createHistorySlice,
  historyLayoutInitialState,
  resetSceneHistory,
  snapshotFromState,
  syncHistoryFlags,
  type HistorySlice,
} from './historySlice'
import {
  createSelectionSlice,
  selectionLayoutInitialState,
  type SelectionSlice,
} from './selectionSlice'
import {
  cadMeshToolsInitialState,
  createCadMeshToolsSlice,
  type CadMeshToolsSlice,
} from './cadMeshToolsSlice'
import {
  clearStrokeDraftState,
  createStrokeSlice,
  strokeLayoutInitialState,
  type StrokeSlice,
} from './strokeSlice'
import {
  clearVectorDraftState,
  createVectorToolsSlice,
  vectorToolsInitialState,
  type VectorToolsSlice,
} from './vectorToolsSlice'
import {
  createToolActivationSlice,
  toolActivationInitialState,
  type ToolActivationSlice,
} from './toolActivationSlice'
import {
  createSceneObjectsSlice,
  sceneObjectsInitialState,
  type SceneObjectsSlice,
} from './sceneObjectsSlice'
import {
  createMeshEditSlice,
  meshEditInitialState,
  type MeshEditSlice,
} from './meshEditSlice'
import {
  createSceneSettingsSlice,
  sceneSettingsInitialState,
  type SceneSettingsSlice,
} from './sceneSettingsSlice'
import {
  createProjectIoSlice,
  type ProjectIoSlice,
} from './projectIoSlice'
import {
  createImageDropSlice,
  imageDropInitialState,
  type ImageDropSlice,
} from './imageDropSlice'

const textureLoadGeneration = new Map<string, number>()

export type { UvEditorMode, UvTextureInfo } from './uvEditorSlice'
export type { SelectionMode } from './selectionSlice'
export type { ToolCategory, ActiveTool, MeshModalOp, MeshModalState, ObjectTransformModalState } from './toolActivationSlice'
export type { PrimitiveKind, PrimitiveBoxDraft, VectorPenDraft } from './vectorToolsSlice'
export type {
  StrokeMode,
  DrawInputMode,
  ExtrudeDragAnchor,
} from './strokeSlice'
export type {
  PolyDrawMode,
  PolyDrawPointSnap,
  PolyDrawDraftPoint,
  PolyDrawDraft,
  LastPolyDrawFace,
  LoopCutDraft,
  KnifeDraft,
  BendDraft,
} from './cadMeshToolsSlice'

export type { SymmetryAxis } from '../symmetry/symmetry'
export type { ImageDropMode, ReferenceImage, BillboardImage } from './imageDropSlice'
export type { ThemeId } from '../theme/themes'
export type {
  ViewType,
  OrthoViewType,
  ViewportSlotIndex,
} from '../scene/viewTypes'
export {
  DEFAULT_VIEWPORT_SLOT_VIEWS,
  normalizeViewType,
  isOrthoView,
} from '../scene/viewTypes'

export interface HistoryEntry {
  snapshot: SceneSnapshot
  label?: string
}

// Re-export for consumers
export type { SceneSnapshot } from '../history/sceneHistory'

export interface AppState extends ViewportSlice, HistorySlice, SelectionSlice, CadMeshToolsSlice, StrokeSlice, VectorToolsSlice, ToolActivationSlice, SceneObjectsSlice, MeshEditSlice, SceneSettingsSlice, UvEditorSlice, ProjectIoSlice, ImageDropSlice {
  materialEditorOpen: boolean
  materialEditorPanel: FloatingPanelState
  materialEditorColor: Rgba4
  materialEditorPaletteId: string
  materialEditorCustomPalettes: CustomPalette[]
  materialEditorEyedropperActive: boolean
  materialEditorGradientDirection: GradientDirection
  materialEditorGradientStart: GradientHandle2D
  materialEditorGradientEnd: GradientHandle2D
  materialEditorGradientActiveStop: 0 | 1
  materialEditorGradientStops: Rgba4[]
  materialEditorApplyToSelection: boolean
  materialPaintHistoryPending: boolean

  pixelEditorOpen: boolean
  pixelEditorPanel: FloatingPanelState
  pixelEditorDocId: string | null
  pixelEditorTool: PixelTool
  pixelEditorBrushSize: number
  pixelEditorBrushShape: PixelBrushShape
  pixelEditorBrushHardness: number
  pixelEditorBrushOpacity: number
  pixelEditorBrushFlow: number
  pixelEditorPixelPerfect: boolean
  pixelEditorSymmetryH: boolean
  pixelEditorSymmetryV: boolean
  pixelEditorPaintOnModel: boolean
  pixelEditorShapeFilled: boolean
  pixelEditorZoom: number
  pixelEditorPanX: number
  pixelEditorPanY: number
  pixelEditorSelection: PixelSelection | null
  pixelEditorFillTolerance: number
  pixelEditorToolbarPosition: { x: number; y: number }
  pixelEditorColor: Rgba4
  pixelEditorPaletteId: string
  pixelEditorCustomPalettes: CustomPalette[]
  pixelDocuments: Record<string, import('../pixel/pixelTypes').PixelDocument>
  pixelTextureRevision: number
  pixelEditHistoryPending: boolean

  toggleMaterialEditor: () => void
  setMaterialEditorPanel: (panel: FloatingPanelState) => void
  setMaterialEditorColorLive: (color: Rgba4) => void
  commitMaterialEditorColor: (color: Rgba4) => void
  setMaterialEditorPaletteId: (id: string) => void
  addCustomPaletteSwatch: () => void
  removeCustomPaletteSwatch: (index: number) => void
  createCustomPalette: () => void
  renameCustomPalette: (id: string, name: string) => void
  deleteCustomPalette: (id: string) => void
  generateMaterialHarmonyPalette: (scheme: HarmonyScheme) => void
  setMaterialEditorEyedropperActive: (on: boolean) => void
  setMaterialEditorGradientDirection: (dir: GradientDirection) => void
  setMaterialEditorGradientHandle: (index: 0 | 1, handle: GradientHandle2D) => void
  setMaterialEditorGradientActiveStop: (index: 0 | 1) => void
  beginMaterialEditorGradientDrag: () => void
  commitMaterialEditorGradientDrag: () => void
  setMaterialEditorGradientStop: (index: number, color: Rgba4) => void
  previewMaterialEditorGradient: () => void
  applyMaterialEditorGradient: () => void
  setMaterialEditorApplyToSelection: (on: boolean) => void
  setMaterialEditorMode: (mode: MaterialMode) => void
  setMaterialOpacity: (opacity: number) => void
  setMaterialDoubleSided: (doubleSided: boolean) => void

  togglePixelEditor: () => void
  openPixelEditor: (opts?: {
    width?: number
    height?: number
    paintOnModel?: boolean
    linkObjectId?: string | null
  }) => void
  setPixelEditorPanel: (panel: FloatingPanelState) => void
  setPixelEditorSelection: (selection: PixelSelection | null) => void
  copyPixelSelection: () => boolean
  cutPixelSelection: () => boolean
  pastePixelClipboard: () => boolean
  deletePixelSelection: () => boolean
  setPixelEditorTool: (tool: PixelTool) => void
  setPixelEditorBrushSize: (size: number) => void
  setPixelEditorBrushShape: (shape: PixelBrushShape) => void
  setPixelEditorBrushHardness: (hardness: number) => void
  setPixelEditorBrushOpacity: (opacity: number) => void
  setPixelEditorBrushFlow: (flow: number) => void
  setPixelEditorPixelPerfect: (on: boolean) => void
  setPixelEditorSymmetryH: (on: boolean) => void
  setPixelEditorSymmetryV: (on: boolean) => void
  setPixelEditorPaintOnModel: (on: boolean) => void
  setPixelEditorShapeFilled: (on: boolean) => void
  setPixelEditorView: (zoom: number, panX: number, panY: number) => void
  setPixelEditorFillTolerance: (t: number) => void
  setPixelEditorToolbarPosition: (pos: { x: number; y: number }) => void
  setPixelEditorActiveLayer: (layerId: string) => void
  setPixelEditorColorLive: (color: Rgba4) => void
  commitPixelEditorColor: (color: Rgba4) => void
  setPixelEditorPaletteId: (id: string) => void
  addPixelEditorPaletteSwatch: () => void
  generatePixelHarmonyPalette: (scheme: HarmonyScheme) => void
  beginPixelEdit: () => void
  commitPixelEdit: () => void
  createNewPixelDocument: (width: number, height: number, linkObjectId?: string) => void
  resizeOpenPixelDocument: (width: number, height: number) => void
  importPixelImage: (file: File, mode: 'new' | 'layer') => Promise<void>
  /** Import an image as a project texture and set it as the active hair texture. */
  importHairTextureImage: (file: File) => Promise<string>
  savePixelDocument: () => Promise<void>
  exportPixelDocumentPng: () => Promise<void>
  exportPixelDocumentProject: () => Promise<void>
  importPixelDocumentProject: (file: File) => Promise<void>
  selectPixelEditorDocument: (docId: string) => void
  addPixelEditorLayer: () => void
  deletePixelEditorLayer: (layerId: string) => void
  duplicatePixelEditorLayer: (layerId: string) => void
  mergePixelEditorLayerDown: (layerId: string) => void
  reorderPixelEditorLayer: (layerId: string, toIndex: number) => void
  patchPixelEditorLayer: (
    layerId: string,
    patch: Partial<{ name: string; visible: boolean; opacity: number; blendMode: PixelBlendMode }>
  ) => void
  paintPixelStroke: (points: { x: number; y: number }[], tool?: 'pencil' | 'eraser', options?: { round?: boolean }) => void
  paintPixelShape: (
    tool: 'line' | 'rectangle' | 'ellipse',
    x0: number,
    y0: number,
    x1: number,
    y1: number
  ) => void
  bucketFillPixel: (x: number, y: number, global: boolean) => void
  bucketFillPixelAt: (docId: string, x: number, y: number, global: boolean) => void
  samplePixelColor: (x: number, y: number) => Rgba4 | null
  samplePixelColorAt: (docId: string, x: number, y: number) => Rgba4 | null
  paintOnModelPixel: (docId: string, x: number, y: number) => void
  paintOnModelStroke: (docId: string, points: { x: number; y: number }[]) => void
  paintOnModelEyedropper: (docId: string, x: number, y: number) => void
  paintOnModelBucket: (docId: string, x: number, y: number, global: boolean) => void
  paintOnModelShape: (
    docId: string,
    tool: 'line' | 'rectangle' | 'ellipse',
    x0: number,
    y0: number,
    x1: number,
    y1: number
  ) => void
  ensureTextureDocumentForObject: (objectId: string) => string | null
}

function reconcileAppBlobUrls(getState: () => AppState): void {
  const current = snapshotFromState(getState())
  const historySnapshots = allHistorySnapshots()
  reconcileBlobUrls(collectActiveBlobUrls(current, historySnapshots))
  reconcilePixelDocumentCache(collectActivePixelDocIds(current, historySnapshots))
}

function closeEditorsForProjectSwitch(): Partial<AppState> {
  return {
    pixelEditorOpen: false,
    pixelEditorPaintOnModel: false,
    pixelEditorDocId: null,
    pixelEditorSelection: null,
    materialEditorOpen: false,
    materialEditorEyedropperActive: false,
    uvEditorOpen: false,
    uvEditorSelectedPoints: [],
    uvEditorSelectedFaces: [],
    showExportDialog: false,
    showToolRing: false,
    meshModal: null,
    objectTransformModal: null,
    meshHover: null,
    clipboard: null,
    selectedReferenceImageId: null,
    selectedBillboardImageId: null,
    ...clearStrokeDraftState(),
    ...clearVectorDraftState(),
    polyDrawDraft: null,
    loopCutDraft: null,
    knifeDraft: null,
    bendDraft: null,
  }
}

function restoreSceneToStore(
  set: (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void,
  get: () => AppState,
  snapshot: SceneSnapshot,
  options?: { resetEditors?: boolean; extra?: Partial<AppState> }
): void {
  invalidateFaceGroupCache()
  invalidateSubdivisionPreviewCache()
  clearSculptSession()
  const restored = sanitizeSceneSnapshot(snapshot)
  const objects = ensureTexturedSceneUvs(restored.objects)
  rebuildObjectIndex(objects)
  const imageSelection = sanitizeImageSelectionIds(
    restored.referenceImages,
    restored.billboardImages,
    get().selectedReferenceImageId,
    get().selectedBillboardImageId
  )
  set({
    objects,
    objectTextures: restored.objectTextures,
    pixelDocuments: restored.pixelDocuments ?? {},
    referenceImages: restored.referenceImages,
    billboardImages: restored.billboardImages,
    selectedObjectId: restored.selectedObjectId,
    selectionObjectIds: restored.selectionObjectIds,
    meshSelection: restored.meshSelection,
    ...imageSelection,
    ...syncHistoryFlags(),
    meshModal: null,
    objectTransformModal: null,
    meshHover: null,
    ...clearStrokeDraftState(),
    ...clearVectorDraftState(),
    polyDrawDraft: null,
    loopCutDraft: null,
    knifeDraft: null,
    bendDraft: null,
    ...(options?.resetEditors ? closeEditorsForProjectSwitch() : {}),
    ...options?.extra,
  })
  resyncAllPixelDocuments(restored.pixelDocuments ?? {})
  reconcileAppBlobUrls(get)
}

function textureIdsForObject(obj: SceneObject): string[] {
  const mat = resolveEffectiveMaterial(obj)
  const texId = mat.textureId ?? obj.id
  return texId === obj.id ? [obj.id] : [obj.id, texId]
}

/** Persist UVs for textured meshes during load / material mode — not from the renderer. */
function ensureTexturedObjectUvs(obj: SceneObject): SceneObject {
  const mat = resolveEffectiveMaterial(obj)
  if (mat.mode !== 'texture') return obj
  if (obj.uvs?.length && obj.faceUvIndices?.length === obj.faces.length) return obj
  return ensureObjectUVs(obj)
}

function ensureTexturedSceneUvs(objects: SceneObject[]): SceneObject[] {
  let changed = false
  const next = objects.map((obj) => {
    const ensured = ensureTexturedObjectUvs(obj)
    if (ensured !== obj) changed = true
    return ensured
  })
  return changed ? next : objects
}

function purgeTextureResourcesForObjects(
  objects: SceneObject[],
  removedIds: Set<string>,
  objectTextures: Record<string, UvTextureInfo>,
  pixelDocuments: Record<string, import('../pixel/pixelTypes').PixelDocument>
): {
  objectTextures: Record<string, UvTextureInfo>
  pixelDocuments: Record<string, import('../pixel/pixelTypes').PixelDocument>
} {
  const remaining = objects.filter((o) => !removedIds.has(o.id))
  const textureKeysToRemove = new Set<string>()
  for (const id of removedIds) {
    const obj = objects.find((o) => o.id === id)
    if (obj) {
      for (const key of textureIdsForObject(obj)) textureKeysToRemove.add(key)
    } else {
      textureKeysToRemove.add(id)
    }
  }

  const stillReferenced = new Set<string>()
  for (const obj of remaining) {
    for (const key of textureIdsForObject(obj)) stillReferenced.add(key)
  }

  let nextTextures = objectTextures
  let nextDocs = pixelDocuments
  for (const key of textureKeysToRemove) {
    if (stillReferenced.has(key)) continue
    if (nextTextures === objectTextures) nextTextures = { ...objectTextures }
    delete nextTextures[key]
    if (nextDocs[key]) {
      if (nextDocs === pixelDocuments) nextDocs = { ...pixelDocuments }
      delete nextDocs[key]
      releasePixelDocumentTexture(key)
      clearPixelCompositeCache(key)
    }
  }
  return { objectTextures: nextTextures, pixelDocuments: nextDocs }
}

let pendingTextureRevisionRaf = 0
function scheduleTextureRevisionBump(
  set: (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void
): void {
  if (pendingTextureRevisionRaf) return
  pendingTextureRevisionRaf = requestAnimationFrame(() => {
    pendingTextureRevisionRaf = 0
    set((s) => ({ pixelTextureRevision: s.pixelTextureRevision + 1 }))
  })
}

function sanitizeImageSelectionIds(
  referenceImages: ReferenceImage[],
  billboardImages: BillboardImage[],
  selectedReferenceImageId: string | null,
  selectedBillboardImageId: string | null
): {
  selectedReferenceImageId: string | null
  selectedBillboardImageId: string | null
} {
  const refIds = new Set(referenceImages.map((r) => r.id))
  const bbIds = new Set(billboardImages.map((b) => b.id))
  return {
    selectedReferenceImageId:
      selectedReferenceImageId && refIds.has(selectedReferenceImageId)
        ? selectedReferenceImageId
        : null,
    selectedBillboardImageId:
      selectedBillboardImageId && bbIds.has(selectedBillboardImageId)
        ? selectedBillboardImageId
        : null,
  }
}

export const useAppStore = create<AppState>((set, get) => ({
  ...viewportLayoutInitialState,
  ...createViewportSlice<AppState>(set),

  ...historyLayoutInitialState,
  ...createHistorySlice<AppState>(set, get, {
    getSnapshot: () => snapshotFromState(get()),
    restoreSnapshot: (snapshot, options) => restoreSceneToStore(set, get, snapshot, options),
    reconcileResources: () => reconcileAppBlobUrls(get),
  }),

  ...selectionLayoutInitialState,
  ...createSelectionSlice<AppState>(set, get, {
    reconcileBlobUrls: () => reconcileAppBlobUrls(get),
    purgeTextureResourcesForObjects: (objects, removedIds, objectTextures, pixelDocuments) =>
      purgeTextureResourcesForObjects(
        objects,
        removedIds,
        objectTextures as Record<string, UvTextureInfo>,
        pixelDocuments
      ),
    clearTextureLoadGeneration: (id) => textureLoadGeneration.delete(id),
  }),

  ...cadMeshToolsInitialState,
  ...createCadMeshToolsSlice<AppState>(set, get),

  ...strokeLayoutInitialState,
  ...createStrokeSlice<AppState>(set, get),
  ...vectorToolsInitialState,
  ...createVectorToolsSlice<AppState>(set, get, {
    reconcileBlobUrls: () => reconcileAppBlobUrls(get),
  }),
  ...toolActivationInitialState,
  ...createToolActivationSlice<AppState>(set, get),
  ...sceneObjectsInitialState,
  ...createSceneObjectsSlice<AppState>(set, get, {
    reconcileBlobUrls: () => reconcileAppBlobUrls(get),
    purgeTextureResourcesForObjects: (objects, removedIds, objectTextures, pixelDocuments) =>
      purgeTextureResourcesForObjects(
        objects,
        removedIds,
        objectTextures as Record<string, UvTextureInfo>,
        pixelDocuments
      ),
    clearTextureLoadGeneration: (id) => textureLoadGeneration.delete(id),
  }),
  ...meshEditInitialState,
  ...createMeshEditSlice<AppState>(set, get),
  ...sceneSettingsInitialState,
  ...createSceneSettingsSlice<AppState>(set, get),

  ...imageDropInitialState,
  ...createImageDropSlice<AppState>(set, get, {
    reconcileBlobUrls: () => reconcileAppBlobUrls(get),
    addObject: (obj, options) => get().addObject(obj, options),
    updateObject: (id, updates) => get().updateObject(id, updates),
  }),
  ...createProjectIoSlice<AppState>(set, get, {
    reconcileBlobUrls: () => reconcileAppBlobUrls(get),
    restoreScene: (snapshot, options) => restoreSceneToStore(set, get, snapshot, options),
    resetHistory: (snapshot) => resetSceneHistory(snapshot),
    getSnapshot: () => snapshotFromState(get()),
  }),

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

  ...materialEditorInitialState,
  ...pixelEditorInitialState,
  pixelEditHistoryPending: false,

  toggleMaterialEditor: () => {
    const {
      materialEditorOpen,
      materialEditorPanel,
      selectedObjectId,
      selectionObjectIds,
      objects,
      materialEditorCustomPalettes,
    } = get()
    if (!materialEditorOpen && !selectedObjectId && selectionObjectIds.length === 0) return
    if (materialEditorOpen && materialEditorPanel.minimized) {
      set({ materialEditorPanel: { ...materialEditorPanel, minimized: false } })
      return
    }
    if (!materialEditorOpen) {
      const ids = resolveTargetObjectIds(selectedObjectId, selectionObjectIds)
      const synced = syncEditorColorFromSelection(objects, ids)
      const palettes =
        materialEditorCustomPalettes.length > 0
          ? materialEditorCustomPalettes
          : loadCustomPalettes()
      set({
        materialEditorOpen: true,
        materialEditorPanel: { ...materialEditorPanel, minimized: false },
        materialEditorCustomPalettes: palettes,
        ...(synced ? { materialEditorColor: synced } : {}),
      })
      return
    }
    set({ materialEditorOpen: false, materialEditorEyedropperActive: false })
  },

  setMaterialEditorPanel: (panel) => set({ materialEditorPanel: panel }),

  setMaterialEditorColorLive: (color) => {
    const state = get()
    const ids = resolveTargetObjectIds(state.selectedObjectId, state.selectionObjectIds)
    if (ids.length === 0) {
      set({ materialEditorColor: color, activeColor: rgbaToActiveColorNumber(color) })
      return
    }
    if (!state.materialPaintHistoryPending) {
      set({ materialPaintHistoryPending: true })
    }
    set({
      materialEditorColor: color,
      activeColor: rgbaToActiveColorNumber(color),
      objects: paintColorOnObjects(
        state.objects,
        ids,
        state.selectionMode,
        state.meshSelection,
        state.materialEditorApplyToSelection,
        color
      ),
    })
  },

  commitMaterialEditorColor: (color) => {
    const state = get()
    const ids = resolveTargetObjectIds(state.selectedObjectId, state.selectionObjectIds)
    if (ids.length === 0) {
      set({
        materialEditorColor: color,
        activeColor: rgbaToActiveColorNumber(color),
        materialPaintHistoryPending: false,
      })
      return
    }
    set({
      materialEditorColor: color,
      activeColor: rgbaToActiveColorNumber(color),
      materialPaintHistoryPending: false,
      objects: paintColorOnObjects(
        state.objects,
        ids,
        state.selectionMode,
        state.meshSelection,
        state.materialEditorApplyToSelection,
        color
      ),
    })
    get().commitHistory('Paint material')
  },

  setMaterialEditorPaletteId: (id) => set({ materialEditorPaletteId: id }),

  addCustomPaletteSwatch: () => {
    const { materialEditorCustomPalettes, materialEditorPaletteId, materialEditorColor } = get()
    const hex = rgba4ToHex(materialEditorColor)
    const isCustom = materialEditorCustomPalettes.some((p) => p.id === materialEditorPaletteId)
    if (!isCustom) {
      let next = [...materialEditorCustomPalettes]
      if (next.length === 0) next = [{ id: 'custom-default', name: 'My Palette', colors: [] }]
      next[0] = { ...next[0]!, colors: [...next[0]!.colors, hex] }
      persistCustomPalettes(next)
      set({ materialEditorCustomPalettes: next, materialEditorPaletteId: next[0]!.id })
      return
    }
    const next = materialEditorCustomPalettes.map((p) =>
      p.id === materialEditorPaletteId ? { ...p, colors: [...p.colors, hex] } : p
    )
    persistCustomPalettes(next)
    set({ materialEditorCustomPalettes: next })
  },

  removeCustomPaletteSwatch: (index) => {
    const { materialEditorCustomPalettes, materialEditorPaletteId } = get()
    const next = materialEditorCustomPalettes.map((p) =>
      p.id === materialEditorPaletteId
        ? { ...p, colors: p.colors.filter((_, i) => i !== index) }
        : p
    )
    persistCustomPalettes(next)
    set({ materialEditorCustomPalettes: next })
  },

  createCustomPalette: () => {
    const name = window.prompt('New palette name', 'My Palette')
    if (!name) return
    const id = `custom-${Date.now()}`
    const next = [...get().materialEditorCustomPalettes, { id, name, colors: [] }]
    persistCustomPalettes(next)
    set({ materialEditorCustomPalettes: next, materialEditorPaletteId: id })
  },

  renameCustomPalette: (id, name) => {
    const next = get().materialEditorCustomPalettes.map((p) => (p.id === id ? { ...p, name } : p))
    persistCustomPalettes(next)
    set({ materialEditorCustomPalettes: next })
  },

  deleteCustomPalette: (id) => {
    const next = get().materialEditorCustomPalettes.filter((p) => p.id !== id)
    const fallback = next.length ? next : [{ id: 'custom-default', name: 'My Palette', colors: [] }]
    persistCustomPalettes(fallback)
    set({
      materialEditorCustomPalettes: fallback,
      materialEditorPaletteId: PRESET_PALETTES[0]?.id ?? 'pico8',
    })
  },

  generateMaterialHarmonyPalette: (scheme) => {
    const hex = rgba4ToHex(get().materialEditorColor)
    const { palettes, id } = createHarmonyCustomPalette(get().materialEditorCustomPalettes, hex, scheme)
    set({ materialEditorCustomPalettes: palettes, materialEditorPaletteId: id })
  },

  setMaterialEditorEyedropperActive: (on) => set({ materialEditorEyedropperActive: on }),

  setMaterialEditorGradientDirection: (dir) => {
    const [start, end] = gradientHandlesForDirection(dir)
    set({
      materialEditorGradientDirection: dir,
      materialEditorGradientStart: start,
      materialEditorGradientEnd: end,
    })
    get().previewMaterialEditorGradient()
  },

  setMaterialEditorGradientHandle: (index, handle) => {
    if (index === 0) set({ materialEditorGradientStart: { ...handle } })
    else set({ materialEditorGradientEnd: { ...handle } })
    get().previewMaterialEditorGradient()
  },

  setMaterialEditorGradientActiveStop: (index) => set({ materialEditorGradientActiveStop: index }),

  beginMaterialEditorGradientDrag: () => {
    const ids = resolveTargetObjectIds(get().selectedObjectId, get().selectionObjectIds)
    if (ids.length > 0) get().captureUndoPoint('Gradient fill')
  },

  commitMaterialEditorGradientDrag: () => {
    get().replaceHistoryHead('Gradient fill')
  },

  setMaterialEditorGradientStop: (index, color) => {
    set((s) => ({
      materialEditorGradientStops: s.materialEditorGradientStops.map((c, i) =>
        i === index ? color : c
      ),
    }))
    get().previewMaterialEditorGradient()
  },

  previewMaterialEditorGradient: () => {
    const state = get()
    const ids = resolveTargetObjectIds(state.selectedObjectId, state.selectionObjectIds)
    if (ids.length === 0) return
    const line = gradientLineFromEditorState(
      state.materialEditorGradientDirection,
      state.materialEditorGradientStart,
      state.materialEditorGradientEnd
    )
    set({
      objects: applyGradientOnObjects(
        state.objects,
        ids,
        state.selectionMode,
        state.meshSelection,
        state.materialEditorApplyToSelection,
        line,
        state.materialEditorGradientStops
      ),
      materialPaintHistoryPending: false,
    })
  },

  applyMaterialEditorGradient: () => {
    get().previewMaterialEditorGradient()
  },

  setMaterialEditorApplyToSelection: (on) => set({ materialEditorApplyToSelection: on }),

  setMaterialEditorMode: (mode) => {
    const ids = resolveTargetObjectIds(get().selectedObjectId, get().selectionObjectIds)
    if (ids.length === 0) return
    const idSet = new Set(ids)
    set((s) => ({
      objects: s.objects.map((o) => {
        if (!idSet.has(o.id)) return o
        const next = setObjectMaterialMode(o, mode, o.id)
        return mode === 'texture' ? ensureTexturedObjectUvs(next) : next
      }),
    }))
    get().commitHistory('Material mode')
    if (mode === 'vertexGradient') get().previewMaterialEditorGradient()
  },

  setMaterialOpacity: (opacity) => {
    const ids = resolveTargetObjectIds(get().selectedObjectId, get().selectionObjectIds)
    const color = get().materialEditorColor
    const rgba: Rgba4 = [color[0], color[1], color[2], opacity]
    if (ids.length === 0) {
      set({ materialEditorColor: rgba })
      return
    }
    const idSet = new Set(ids)
    set((s) => ({
      materialEditorColor: rgba,
      objects: s.objects.map((o) =>
        idSet.has(o.id) ? updateObjectMaterialSettings(o, { opacity }) : o
      ),
    }))
    get().commitHistory('Material opacity')
  },

  setMaterialDoubleSided: (doubleSided) => {
    const ids = resolveTargetObjectIds(get().selectedObjectId, get().selectionObjectIds)
    if (ids.length === 0) return
    const idSet = new Set(ids)
    set((s) => ({
      objects: s.objects.map((o) =>
        idSet.has(o.id) ? updateObjectMaterialSettings(o, { doubleSided }) : o
      ),
    }))
    get().commitHistory('Double-sided')
  },

  togglePixelEditor: () => {
    const { pixelEditorOpen, pixelEditorPanel } = get()
    if (pixelEditorOpen && pixelEditorPanel.minimized) {
      set({
        pixelEditorPanel: {
          ...pixelEditorPanel,
          minimized: false,
          width: pixelEditorPanel.expandedWidth ?? pixelEditorPanel.width,
          height: pixelEditorPanel.expandedHeight ?? pixelEditorPanel.height,
        },
      })
      return
    }
    if (!pixelEditorOpen) {
      get().openPixelEditor()
      return
    }
    set({ pixelEditorOpen: false })
  },

  openPixelEditor: (opts) => {
    const state = get()
    const objectId =
      opts?.linkObjectId ?? state.selectedObjectId ?? state.selectionObjectIds[0] ?? null
    let docId = state.pixelEditorDocId

    if (objectId) {
      docId = get().ensureTextureDocumentForObject(objectId) ?? docId
    }

    if (!docId || !state.pixelDocuments[docId]) {
      const width = opts?.width ?? 64
      const height = opts?.height ?? 64
      const id = objectId ?? generateId()
      const { docs, docId: newId } = createBlankDocumentForObject(state.pixelDocuments, id, width, height)
      docId = newId
      set((s) => ({
        pixelDocuments: docs,
        pixelEditorDocId: docId,
        objectTextures: {
          ...s.objectTextures,
          [docId!]: { url: '', name: 'Pixel texture', width, height },
        },
        pixelTextureRevision: s.pixelTextureRevision + 1,
      }))
      if (objectId) {
        const obj = get().objects.find((o) => o.id === objectId)
        if (obj) {
          get().updateObject(
            objectId,
            setObjectMaterialMode(ensureObjectMaterial(obj), 'texture', docId!)
          )
        }
      }
    }

    set({
      pixelEditorOpen: true,
      pixelEditorPanel: { ...state.pixelEditorPanel, minimized: false },
      pixelEditorDocId: docId,
      pixelEditorPaintOnModel: opts?.paintOnModel ?? true,
      pixelEditorCustomPalettes:
        state.pixelEditorCustomPalettes.length > 0
          ? state.pixelEditorCustomPalettes
          : loadPixelPenPalettes(),
    })
  },

  setPixelEditorPanel: (panel) => set({ pixelEditorPanel: panel }),
  setPixelEditorSelection: (selection) => set({ pixelEditorSelection: selection }),

  copyPixelSelection: () => {
    const { pixelEditorDocId, pixelDocuments, pixelEditorSelection } = get()
    if (!pixelEditorDocId || !pixelEditorSelection) return false
    const doc = pixelDocuments[pixelEditorDocId]
    if (!doc) return false
    return copySelectionToClipboard(doc, pixelEditorSelection)
  },

  cutPixelSelection: () => {
    const { pixelEditorDocId, pixelDocuments, pixelEditorSelection } = get()
    if (!pixelEditorDocId || !pixelEditorSelection) return false
    get().beginPixelEdit()
    const next = cutSelectionOnDocument(pixelDocuments, pixelEditorDocId, pixelEditorSelection)
    if (!next) return false
    set((s) => ({
      pixelDocuments: next,
      pixelEditorSelection: null,
      pixelTextureRevision: s.pixelTextureRevision + 1,
    }))
    get().commitPixelEdit()
    return true
  },

  pastePixelClipboard: () => {
    const { pixelEditorDocId, pixelDocuments, pixelEditorSelection } = get()
    if (!pixelEditorDocId) return false
    get().beginPixelEdit()
    const result = pasteClipboardOnDocument(
      pixelDocuments,
      pixelEditorDocId,
      pixelEditorSelection
    )
    if (!result) return false
    set((s) => ({
      pixelDocuments: result.docs,
      pixelEditorSelection: result.pasted,
      pixelTextureRevision: s.pixelTextureRevision + 1,
    }))
    get().commitPixelEdit()
    return true
  },

  deletePixelSelection: () => {
    const { pixelEditorDocId, pixelDocuments, pixelEditorSelection } = get()
    if (!pixelEditorDocId || !pixelEditorSelection) return false
    get().beginPixelEdit()
    const next = clearSelectionOnDocument(
      pixelDocuments,
      pixelEditorDocId,
      pixelEditorSelection
    )
    set((s) => ({
      pixelDocuments: next,
      pixelTextureRevision: s.pixelTextureRevision + 1,
    }))
    get().commitPixelEdit()
    return true
  },

  setPixelEditorTool: (tool) => set({ pixelEditorTool: tool }),
  setPixelEditorBrushSize: (size) =>
    set({ pixelEditorBrushSize: Math.max(1, Math.min(64, Math.round(size))) }),
  setPixelEditorBrushShape: (shape) => set({ pixelEditorBrushShape: shape }),
  setPixelEditorBrushHardness: (hardness) =>
    set({ pixelEditorBrushHardness: Math.max(0, Math.min(1, hardness)) }),
  setPixelEditorBrushOpacity: (opacity) =>
    set({ pixelEditorBrushOpacity: Math.max(0, Math.min(1, opacity)) }),
  setPixelEditorBrushFlow: (flow) =>
    set({ pixelEditorBrushFlow: Math.max(0, Math.min(1, flow)) }),
  setPixelEditorPixelPerfect: (on) => set({ pixelEditorPixelPerfect: on }),
  setPixelEditorSymmetryH: (on) => set({ pixelEditorSymmetryH: on }),
  setPixelEditorSymmetryV: (on) => set({ pixelEditorSymmetryV: on }),
  setPixelEditorPaintOnModel: (on) => set({ pixelEditorPaintOnModel: on }),
  setPixelEditorShapeFilled: (on) => set({ pixelEditorShapeFilled: on }),
  setPixelEditorView: (zoom, panX, panY) =>
    set({ pixelEditorZoom: zoom, pixelEditorPanX: panX, pixelEditorPanY: panY }),
  setPixelEditorFillTolerance: (t) =>
    set({ pixelEditorFillTolerance: Math.max(0, Math.min(255, Math.round(t))) }),
  setPixelEditorToolbarPosition: (pos) =>
    set({
      pixelEditorToolbarPosition: {
        x: Math.round(pos.x),
        y: Math.round(pos.y),
      },
    }),
  setPixelEditorColorLive: (color) => set({ pixelEditorColor: color }),

  commitPixelEditorColor: (color) => set({ pixelEditorColor: color }),

  setPixelEditorPaletteId: (id) => set({ pixelEditorPaletteId: id }),

  addPixelEditorPaletteSwatch: () => {
    const { pixelEditorCustomPalettes, pixelEditorPaletteId, pixelEditorColor } = get()
    const hex = rgba4ToHex(pixelEditorColor)
    const isCustom = pixelEditorCustomPalettes.some((p) => p.id === pixelEditorPaletteId)
    if (!isCustom) {
      let next = [...pixelEditorCustomPalettes]
      if (next.length === 0) next = [{ id: 'pixel-pen-default', name: 'Pen swatches', colors: [] }]
      next[0] = { ...next[0]!, colors: [...next[0]!.colors, hex] }
      savePixelPenPalettes(next)
      set({ pixelEditorCustomPalettes: next, pixelEditorPaletteId: next[0]!.id })
      return
    }
    const next = pixelEditorCustomPalettes.map((p) =>
      p.id === pixelEditorPaletteId ? { ...p, colors: [...p.colors, hex] } : p
    )
    savePixelPenPalettes(next)
    set({ pixelEditorCustomPalettes: next })
  },

  generatePixelHarmonyPalette: (scheme) => {
    const hex = rgba4ToHex(get().pixelEditorColor)
    const colors = generateHarmonyPalette(hex, scheme)
    const id = `pixel-pen-${Date.now()}`
    const next = [
      ...get().pixelEditorCustomPalettes,
      { id, name: `${scheme.charAt(0).toUpperCase()}${scheme.slice(1)} pen`, colors },
    ]
    savePixelPenPalettes(next)
    set({ pixelEditorCustomPalettes: next, pixelEditorPaletteId: id })
  },

  setPixelEditorActiveLayer: (layerId) => {
    const { pixelEditorDocId, pixelDocuments } = get()
    if (!pixelEditorDocId || !pixelDocuments[pixelEditorDocId]) return
    set({
      pixelDocuments: {
        ...pixelDocuments,
        [pixelEditorDocId]: { ...pixelDocuments[pixelEditorDocId], activeLayerId: layerId },
      },
    })
  },

  beginPixelEdit: () => {
    if (!get().pixelEditHistoryPending) {
      set({ pixelEditHistoryPending: true })
    }
  },

  commitPixelEdit: () => {
    const pending = get().pixelEditHistoryPending
    resetSoftBrushStroke()
    flushPixelDocumentGpuSync()
    if (pendingTextureRevisionRaf) {
      cancelAnimationFrame(pendingTextureRevisionRaf)
      pendingTextureRevisionRaf = 0
    }
    set({ pixelEditHistoryPending: false, pixelTextureRevision: get().pixelTextureRevision + 1 })
    if (pending) get().commitHistory('Pixel edit')
  },

  ensureTextureDocumentForObject: (objectId) => {
    const { objects, pixelDocuments } = get()
    const obj = objects.find((o) => o.id === objectId)
    if (!obj) return null
    const mat = resolveEffectiveMaterial(obj)
    const docId = mat.textureId ?? objectId
    if (pixelDocuments[docId]) {
      const needsUvs = !obj.uvs?.length || obj.faceUvIndices?.length !== obj.faces.length
      if (mat.mode !== 'texture' || needsUvs) {
        let next: SceneObject =
          mat.mode !== 'texture'
            ? setObjectMaterialMode(ensureObjectMaterial(obj), 'texture', docId)
            : obj
        if (needsUvs) {
          const withUvs = assignUvMappingForMode(next, 'perFace', true)
          next = {
            ...withUvs,
            ...next,
            uvs: withUvs.uvs,
            faceUvIndices: withUvs.faceUvIndices,
            uvMappingMode: 'perFace',
            uvAutoPacked: withUvs.uvAutoPacked,
          }
        }
        get().updateObject(objectId, next)
      }
      return docId
    }
    const { docs, docId: newId } = createBlankDocumentForObject(pixelDocuments, objectId)
    const withUvs = assignUvMappingForMode(obj, 'perFace', true)
    const mesh = HalfEdgeMesh.fromObject(withUvs)
    ensurePositiveVolume(mesh)
    const textured = mesh.toObject(objectId, obj.name, {
      ...withUvs,
      ...setObjectMaterialMode({ ...withUvs, material: ensureObjectMaterial(obj).material }, 'texture', newId),
      uvs: withUvs.uvs,
      faceUvIndices: withUvs.faceUvIndices,
      uvMappingMode: 'perFace',
      uvAutoPacked: withUvs.uvAutoPacked,
    })
    get().updateObject(objectId, textured)
    set((s) => ({
      pixelDocuments: docs,
      pixelEditorDocId: newId,
      objectTextures: {
        ...s.objectTextures,
        [newId]: { url: '', name: 'Pixel texture', width: 64, height: 64 },
      },
      pixelTextureRevision: s.pixelTextureRevision + 1,
    }))
    return newId
  },

  createNewPixelDocument: (width, height, linkObjectId) => {
    const id = linkObjectId ?? generateId()
    const { docs, docId } = createBlankDocumentForObject(get().pixelDocuments, id, width, height)
    set((s) => ({
      pixelDocuments: docs,
      pixelEditorDocId: docId,
      objectTextures: {
        ...s.objectTextures,
        [docId]: { url: '', name: 'Pixel texture', width, height },
      },
      pixelTextureRevision: s.pixelTextureRevision + 1,
    }))
    if (linkObjectId) {
      const obj = get().objects.find((o) => o.id === linkObjectId)
      if (obj) {
        const withUvs = assignUvMappingForMode(obj, 'perFace', true)
        const mesh = HalfEdgeMesh.fromObject(withUvs)
        ensurePositiveVolume(mesh)
        get().updateObject(linkObjectId, mesh.toObject(linkObjectId, obj.name, {
          ...withUvs,
          ...setObjectMaterialMode(ensureObjectMaterial(withUvs), 'texture', docId),
          uvs: withUvs.uvs,
          faceUvIndices: withUvs.faceUvIndices,
          uvMappingMode: 'perFace',
          uvAutoPacked: withUvs.uvAutoPacked,
        }))
      }
    }
    get().commitHistory('New pixel document')
  },

  resizeOpenPixelDocument: (width, height) => {
    const { pixelEditorDocId, pixelDocuments } = get()
    if (!pixelEditorDocId || !pixelDocuments[pixelEditorDocId]) return
    const doc = resizePixelDoc(pixelDocuments[pixelEditorDocId], width, height)
    const nextDocs = { ...pixelDocuments, [pixelEditorDocId]: doc }
    syncPixelDocumentGpu(nextDocs, pixelEditorDocId)
    set((s) => ({
      pixelDocuments: nextDocs,
      objectTextures: {
        ...s.objectTextures,
        [pixelEditorDocId]: {
          ...(s.objectTextures[pixelEditorDocId] ?? { url: '', name: 'Pixel texture' }),
          width,
          height,
        },
      },
      pixelTextureRevision: s.pixelTextureRevision + 1,
    }))
    get().commitHistory('Resize pixel canvas')
  },

  importPixelImage: async (file, mode) => {
    try {
      if (mode === 'new') {
        const { docs, docId } = await importImageAsNewDocument(get().pixelDocuments, file)
        const doc = docs[docId]
        set((s) => ({
          pixelDocuments: docs,
          pixelEditorDocId: docId,
          objectTextures: {
            ...s.objectTextures,
            [docId]: { url: '', name: file.name, width: doc.width, height: doc.height },
          },
          pixelTextureRevision: s.pixelTextureRevision + 1,
        }))
        reconcileAppBlobUrls(get)
        const objectId = get().selectedObjectId ?? get().selectionObjectIds[0]
        if (objectId) {
          get().assignObjectTextureDocument(objectId, docId, { skipHistory: true })
        }
        get().commitHistory('Import pixel image')
        return
      }
      const docId = get().pixelEditorDocId
      if (!docId) return
      const docs = await importImageAsLayer(get().pixelDocuments, docId, file)
      set((s) => ({ pixelDocuments: docs, pixelTextureRevision: s.pixelTextureRevision + 1 }))
      reconcileAppBlobUrls(get)
      get().commitHistory('Import pixel layer')
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'Unknown error'
      throw new Error(`Could not import "${file.name}": ${detail}`)
    }
  },

  importHairTextureImage: async (file) => {
    try {
      const { docs, docId } = await importImageAsNewDocument(get().pixelDocuments, file)
      const doc = docs[docId]
      if (!doc) throw new Error('Imported texture document is missing')
      set((s) => ({
        pixelDocuments: docs,
        objectTextures: {
          ...s.objectTextures,
          [docId]: { url: '', name: file.name, width: doc.width, height: doc.height },
        },
        pixelTextureRevision: s.pixelTextureRevision + 1,
        hairTextureId: docId,
      }))
      reconcileAppBlobUrls(get)
      get().commitHistory('Import hair texture')
      return docId
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'Unknown error'
      throw new Error(`Could not import hair texture "${file.name}": ${detail}`)
    }
  },

  savePixelDocument: async () => {
    const state = get()
    const docId = state.pixelEditorDocId
    if (!docId) return
    const doc = state.pixelDocuments[docId]
    if (!doc) return
    const linkedObject = state.objects.find(
      (obj) => resolveEffectiveMaterial(obj).textureId === docId || obj.id === docId
    )
    const filename = exportFilenameForPixelDocument(doc, state, linkedObject).replace(/\.png$/i, TEXTURE_PROJECT_SUFFIX)
    await downloadJSON(serializePixelDocument(doc), filename, {
      title: 'Save pixel texture project',
      filters: PIXEL_PROJECT_FILTERS,
    })
    if (get().pixelEditHistoryPending) get().commitHistory('Pixel edit')
    set({ pixelEditHistoryPending: false })
  },

  exportPixelDocumentPng: async () => {
    const state = get()
    const { pixelEditorDocId, pixelDocuments } = state
    if (!pixelEditorDocId) return
    const doc = pixelDocuments[pixelEditorDocId]
    if (!doc) return
    const linkedObject = state.objects.find(
      (obj) => resolveEffectiveMaterial(obj).textureId === pixelEditorDocId || obj.id === pixelEditorDocId
    )
    const filename = exportFilenameForPixelDocument(doc, state, linkedObject)
    const blob = await exportCompositeToPngBlob(compositeLayers(doc), doc.width, doc.height)
    await downloadBlob(blob, filename, {
      title: 'Export PNG',
      filters: [{ name: 'PNG image', extensions: ['png'] }],
    })
  },

  exportPixelDocumentProject: async () => {
    await get().savePixelDocument()
  },

  importPixelDocumentProject: async (file) => {
    try {
      const text = await file.text()
      const imported = parsePixelDocumentFile(text)
      const docId = get().pixelEditorDocId ?? imported.id
      const doc = { ...imported, id: docId }
      set((s) => ({
        pixelDocuments: registerPixelDocument(s.pixelDocuments, doc),
        pixelEditorDocId: docId,
        objectTextures: {
          ...s.objectTextures,
          [docId]: {
            url: '',
            name: file.name.replace(/\.[^.]+$/, ''),
            width: doc.width,
            height: doc.height,
          },
        },
        pixelTextureRevision: s.pixelTextureRevision + 1,
      }))
      reconcileAppBlobUrls(get)
      const objectId = get().selectedObjectId ?? get().selectionObjectIds[0]
      if (objectId) {
        get().assignObjectTextureDocument(objectId, docId, { skipHistory: true })
      }
      get().commitHistory('Import pixel project')
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'Unknown error'
      throw new Error(`Could not import "${file.name}": ${detail}`)
    }
  },

  selectPixelEditorDocument: (docId) => {
    if (!get().pixelDocuments[docId]) return
    set({ pixelEditorDocId: docId, pixelEditorSelection: null })
  },

  addPixelEditorLayer: () => {
    const docId = get().pixelEditorDocId
    if (!docId) return
    get().beginPixelEdit()
    set((s) => ({
      pixelDocuments: addPixelLayer(s.pixelDocuments, docId),
      pixelTextureRevision: s.pixelTextureRevision + 1,
    }))
  },

  deletePixelEditorLayer: (layerId) => {
    const docId = get().pixelEditorDocId
    if (!docId) return
    get().beginPixelEdit()
    set((s) => ({
      pixelDocuments: deletePixelLayer(s.pixelDocuments, docId, layerId),
      pixelTextureRevision: s.pixelTextureRevision + 1,
    }))
  },

  duplicatePixelEditorLayer: (layerId) => {
    const docId = get().pixelEditorDocId
    if (!docId) return
    get().beginPixelEdit()
    set((s) => ({
      pixelDocuments: duplicatePixelLayer(s.pixelDocuments, docId, layerId),
      pixelTextureRevision: s.pixelTextureRevision + 1,
    }))
  },

  mergePixelEditorLayerDown: (layerId) => {
    const docId = get().pixelEditorDocId
    if (!docId) return
    get().beginPixelEdit()
    set((s) => ({
      pixelDocuments: mergeLayerDown(s.pixelDocuments, docId, layerId),
      pixelTextureRevision: s.pixelTextureRevision + 1,
    }))
  },

  reorderPixelEditorLayer: (layerId, toIndex) => {
    const docId = get().pixelEditorDocId
    if (!docId) return
    get().beginPixelEdit()
    set((s) => ({
      pixelDocuments: reorderPixelLayer(s.pixelDocuments, docId, layerId, toIndex),
      pixelTextureRevision: s.pixelTextureRevision + 1,
    }))
  },

  patchPixelEditorLayer: (layerId, patch) => {
    const docId = get().pixelEditorDocId
    if (!docId) return
    get().beginPixelEdit()
    set((s) => ({
      pixelDocuments: patchPixelLayer(s.pixelDocuments, docId, layerId, patch),
      pixelTextureRevision: s.pixelTextureRevision + 1,
    }))
  },

  paintPixelStroke: (points, tool = 'pencil', options) => {
    const {
      pixelEditorDocId,
      pixelDocuments,
      pixelEditorColor,
      pixelEditorBrushSize,
      pixelEditorBrushShape,
      pixelEditorBrushHardness,
      pixelEditorBrushOpacity,
      pixelEditorBrushFlow,
      pixelEditorTool,
      pixelEditorPixelPerfect,
      pixelEditorSymmetryH,
      pixelEditorSymmetryV,
    } = get()
    if (!pixelEditorDocId || points.length === 0) return

    if (pixelEditorTool === 'paintBrush' && tool !== 'eraser') {
      const docs = paintSoftBrushStrokeOnDocument(
        pixelDocuments,
        pixelEditorDocId,
        points,
        pixelEditorColor,
        {
          size: pixelEditorBrushSize,
          hardness: pixelEditorBrushHardness,
          opacity: pixelEditorBrushOpacity,
          flow: pixelEditorBrushFlow,
          shape: pixelEditorBrushShape,
        },
        pixelEditorSymmetryH,
        pixelEditorSymmetryV,
        { sync: 'raf', restart: points.length === 1 }
      )
      set({ pixelDocuments: docs })
      scheduleTextureRevisionBump(set)
      return
    }

    // Pencil / eraser stay hard pixel tips.
    const round = options?.round ?? true
    const docs = paintStrokeOnDocument(
      pixelDocuments,
      pixelEditorDocId,
      points,
      pixelEditorColor,
      pixelEditorBrushSize,
      tool,
      pixelEditorPixelPerfect,
      pixelEditorSymmetryH,
      pixelEditorSymmetryV,
      { sync: 'raf', round }
    )
    set({ pixelDocuments: docs })
    scheduleTextureRevisionBump(set)
  },

  paintPixelShape: (tool, x0, y0, x1, y1) => {
    const {
      pixelEditorDocId,
      pixelDocuments,
      pixelEditorColor,
      pixelEditorBrushSize,
      pixelEditorShapeFilled,
      pixelEditorSymmetryH,
      pixelEditorSymmetryV,
    } = get()
    if (!pixelEditorDocId) return
    const docs = applyShapeToDocument(
      pixelDocuments,
      pixelEditorDocId,
      tool,
      x0,
      y0,
      x1,
      y1,
      pixelEditorColor,
      pixelEditorBrushSize,
      pixelEditorShapeFilled,
      pixelEditorSymmetryH,
      pixelEditorSymmetryV
    )
    set((s) => ({ pixelDocuments: docs, pixelTextureRevision: s.pixelTextureRevision + 1 }))
  },

  bucketFillPixel: (x, y, global) => {
    const { pixelEditorDocId } = get()
    if (!pixelEditorDocId) return
    get().beginPixelEdit()
    get().bucketFillPixelAt(pixelEditorDocId, x, y, global)
  },

  bucketFillPixelAt: (docId, x, y, global) => {
    const {
      pixelDocuments,
      pixelEditorColor,
      pixelEditorFillTolerance,
      pixelEditorSymmetryH,
      pixelEditorSymmetryV,
    } = get()
    if (!pixelDocuments[docId]) return
    const docs = bucketFillDocument(
      pixelDocuments,
      docId,
      x,
      y,
      pixelEditorColor,
      pixelEditorFillTolerance,
      global,
      pixelEditorSymmetryH,
      pixelEditorSymmetryV
    )
    set((s) => ({ pixelDocuments: docs, pixelTextureRevision: s.pixelTextureRevision + 1 }))
  },

  samplePixelColor: (x, y) => {
    const { pixelEditorDocId } = get()
    if (!pixelEditorDocId) return null
    return get().samplePixelColorAt(pixelEditorDocId, x, y)
  },

  samplePixelColorAt: (docId, x, y) => {
    const { pixelDocuments } = get()
    return sampleColorFromDocument(pixelDocuments, docId, x, y)
  },

  paintOnModelEyedropper: (docId, x, y) => {
    const color = get().samplePixelColorAt(docId, x, y)
    if (color) get().commitPixelEditorColor(color)
  },

  paintOnModelBucket: (docId, x, y, global) => {
    get().beginPixelEdit()
    get().bucketFillPixelAt(docId, x, y, global)
    get().commitPixelEdit()
  },

  paintOnModelPixel: (docId, x, y) => {
    const {
      pixelDocuments,
      pixelEditorColor,
      pixelEditorBrushSize,
      pixelEditorBrushShape,
      pixelEditorBrushHardness,
      pixelEditorBrushOpacity,
      pixelEditorBrushFlow,
      pixelEditorSymmetryH,
      pixelEditorSymmetryV,
      pixelEditorTool,
    } = get()
    if (pixelEditorTool === 'paintBrush') {
      const docs = paintSoftBrushStrokeOnDocument(
        pixelDocuments,
        docId,
        [{ x, y }],
        pixelEditorColor,
        {
          size: pixelEditorBrushSize,
          hardness: pixelEditorBrushHardness,
          opacity: pixelEditorBrushOpacity,
          flow: pixelEditorBrushFlow,
          shape: pixelEditorBrushShape,
        },
        pixelEditorSymmetryH,
        pixelEditorSymmetryV,
        { sync: 'raf', restart: true }
      )
      set({ pixelDocuments: docs })
      scheduleTextureRevisionBump(set)
      return
    }
    const tool = pixelEditorTool === 'eraser' ? 'eraser' : 'pencil'
    const docs = paintAtPixel(
      pixelDocuments,
      docId,
      x,
      y,
      pixelEditorColor,
      pixelEditorBrushSize,
      tool,
      pixelEditorSymmetryH,
      pixelEditorSymmetryV,
      { sync: 'raf', round: true }
    )
    set({ pixelDocuments: docs })
    scheduleTextureRevisionBump(set)
  },

  paintOnModelStroke: (docId, points) => {
    const {
      pixelDocuments,
      pixelEditorColor,
      pixelEditorBrushSize,
      pixelEditorBrushShape,
      pixelEditorBrushHardness,
      pixelEditorBrushOpacity,
      pixelEditorBrushFlow,
      pixelEditorPixelPerfect,
      pixelEditorSymmetryH,
      pixelEditorSymmetryV,
      pixelEditorTool,
    } = get()
    if (points.length === 0) return
    if (pixelEditorTool === 'paintBrush') {
      const docs = paintSoftBrushStrokeOnDocument(
        pixelDocuments,
        docId,
        points,
        pixelEditorColor,
        {
          size: pixelEditorBrushSize,
          hardness: pixelEditorBrushHardness,
          opacity: pixelEditorBrushOpacity,
          flow: pixelEditorBrushFlow,
          shape: pixelEditorBrushShape,
        },
        pixelEditorSymmetryH,
        pixelEditorSymmetryV,
        { sync: 'raf' }
      )
      set({ pixelDocuments: docs })
      scheduleTextureRevisionBump(set)
      return
    }
    const tool = pixelEditorTool === 'eraser' ? 'eraser' : 'pencil'
    const docs = paintStrokeOnDocument(
      pixelDocuments,
      docId,
      points,
      pixelEditorColor,
      pixelEditorBrushSize,
      tool,
      pixelEditorPixelPerfect,
      pixelEditorSymmetryH,
      pixelEditorSymmetryV,
      { sync: 'raf', round: true }
    )
    set({ pixelDocuments: docs })
    scheduleTextureRevisionBump(set)
  },

  paintOnModelShape: (docId, tool, x0, y0, x1, y1) => {
    const {
      pixelDocuments,
      pixelEditorColor,
      pixelEditorBrushSize,
      pixelEditorShapeFilled,
      pixelEditorSymmetryH,
      pixelEditorSymmetryV,
    } = get()
    const docs = applyShapeToDocument(
      pixelDocuments,
      docId,
      tool,
      x0,
      y0,
      x1,
      y1,
      pixelEditorColor,
      pixelEditorBrushSize,
      pixelEditorShapeFilled,
      pixelEditorSymmetryH,
      pixelEditorSymmetryV
    )
    set((s) => ({ pixelDocuments: docs, pixelTextureRevision: s.pixelTextureRevision + 1 }))
  },
}))

export { PALETTE } from '../palette/drawPalette'

