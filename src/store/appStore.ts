import { create } from 'zustand'
import { HalfEdgeMesh, type ObjectTransform, type SceneObject } from '../mesh/HalfEdgeMesh'
import { simplifyMesh } from '../mesh/simplification'
import { punchHoleAlongLine } from '../mesh/boolean'
import { applySculpt, type SculptTool } from '../sculpt/sculptTools'
import { strokeToMesh, isHoleLineStroke } from '../stroke/strokeToMesh'
import {
  snapSketchStrokeClosed,
  isSketchNearClose,
  prepareSketchStroke,
} from '../stroke/sketchDoodle'
import { isSketchDoodleObject, regenerateSketchObject, createSketchSource } from '../stroke/sketchSource'
import { attachVectorSource, isVectorDoodleObject, regenerateVectorObject } from '../vector/vectorSource'
import { cloneTransform, ensureTransform, localPointFromWorld, prepareSceneObject, selectionWorldCenter, worldDeltaToLocal } from '../mesh/objectTransform'
import { ensurePositiveVolume } from '../mesh/meshWinding'
import {
  applyObjectTransformModal,
  type ObjectTransformModalOp,
} from '../mesh/objectTransformModal'
import type { Vec3 } from '../utils/math'
import { planeToWorld3D } from '../utils/screenToWorld'
import { vectorPathToMesh } from '../vector/vectorPathToMesh'
import { emptyVectorDocument, type VectorDocument, type VectorPath, type VectorAnchor } from '../vector/types'
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
import type { ShapeKind } from '../vector/types'
import { categoryForActiveTool, type ToolRingEntry } from '../tools/toolRingConfig'
import { vectorShapeToObject } from '../mesh/lowPolyPrimitives'
import {
  clampRoundness,
  clampRoundedBoxSubdivisions,
  type RoundedBoxParams,
} from '../mesh/roundedBox'
import { generateId, type Vec2 } from '../utils/math'
import {
  emptyMeshSelection,
  edgeKey,
  getAffectedVertices,
  meshSelectionWorldCenter,
  selectionHasComponents,
  translateVertexPositions,
  type MeshComponentSelection,
} from '../mesh/meshSelection'
import { collectUniqueEdges } from '../mesh/meshTopology'
import { collectFacesToDelete, deleteFacesFromObject } from '../mesh/meshDelete'
import {
  expandFaceToPlanarRegion,
  expandFacesToPlanarRegions,
  invalidateFaceGroupCache,
} from '../mesh/faceGroups'
import {
  applyMeshModalOp,
  cloneSceneObject,
  extrudeValueFromScreenDelta,
  modalValueFromMouseDelta,
  modalValueFromWheel,
  type MeshModalOpKind,
} from '../mesh/meshOps'
import {
  allVertexIndices,
  applySelectionPlaneTransform,
  type SelectionPlaneTransformOp,
  viewScreenAxes,
} from '../mesh/selectionPlaneTransform'
import type { MeshPickHit } from '../select/meshPick'
import {
  type NudgeDirection,
  type ViewMoveBasis,
  viewNudgeDelta,
} from '../utils/viewNavigation'
import type { ViewportDisplayMode } from '../rendering/viewportDisplay'
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
import {
  canExtrudeHeightInView,
  isOrthoView,
  type Axis,
} from '../primitives/viewAxes'
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
import type { UvSnapMode } from '../uv/uvSnap'
import { unwrapSelectedFaces, type UvUnwrapMethod } from '../uv/uvUnwrap'
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
  paintStrokeOnDocument,
  patchPixelLayer,
  pixelEditorInitialState,
  reorderPixelLayer,
  sampleColorFromDocument,
  syncPixelDocumentGpu,
  resyncAllPixelDocuments,
} from '../pixel/pixelEditorSlice'
import { resizePixelDocument as resizePixelDoc } from '../pixel/pixelDocument'
import type { PixelBlendMode, PixelSelection, PixelTool } from '../pixel/pixelTypes'
import { compositeLayers } from '../pixel/compositeLayers'
import { exportCompositeToPngBlob } from '../pixel/pixelTools'
import { serializePixelDocument, parsePixelDocumentFile } from '../pixel/pixelDocumentIO'
import {
  DEFAULT_PROJECT_FILENAME,
  saveProjectFile,
  parseProjectFile,
  snapshotFromProjectFile,
} from '../io/projectIO'
import { exportFilenameForPixelDocument } from '../io/materialTextureExport'
import { downloadBlob, downloadJSON, PIXEL_PROJECT_FILTERS, PROJECT_FILE_FILTERS } from '../io/download'
import { pickOpenFile } from '../io/fileDialogs'
import {
  TEXTURE_PROJECT_SUFFIX,
} from '../app/branding'
import { resolveEffectiveMaterial, ensureObjectMaterial, resolveColorCornersForSelection } from '../material/materials'
import type { CustomPalette, GradientDirection, GradientHandle2D, HarmonyScheme, MaterialMode, Rgba4 } from '../material/materialTypes'
import { numberToRgba4, rgba4ToHex, rgba4ToNumber } from '../material/materialTypes'
import { rgba4Equal } from '../material/colorObject'
import { PRESET_PALETTES, generateHarmonyPalette, savePixelPenPalettes } from '../material/palettes'
import {
  assignUvMappingForMode,
  collectUvIndicesForFaces,
  ensureObjectUVs,
  resolveUvMappingMode,
  setUvPoints,
  type UvMappingMode,
} from '../uv/uvObject'
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
import type { Uv2 } from '../uv/uvTypes'
import { cloneUv2 } from '../uv/uvTypes'
import {
  SceneHistoryStack,
  captureSceneSnapshot,
  sanitizeSceneSnapshot,
  type SceneSnapshot,
} from '../history/sceneHistory'
import { releaseTextureUrl, reconcilePixelDocumentCache } from '../rendering/textureCache'
import {
  collectActiveBlobUrls,
  collectActivePixelDocIds,
  reconcileBlobUrls,
} from '../rendering/blobUrlLifecycle'
import { importSceneFromFile } from '../io/sceneImport'
import {
  DEFAULT_IMAGE_WORLD_WIDTH,
  DEFAULT_REFERENCE_WIDTH,
  type BillboardImage,
  type ImageDropMode,
  type ReferenceImage,
} from '../images/imageDropTypes'
import { applyTheme } from '../theme/applyTheme'
import { getTheme, hexToNumber } from '../theme/themes'
import { readStoredThemeId } from '../theme/bootstrapTheme'
import { type ThemeId } from '../theme/themes'
import { loadImageFile } from '../images/loadImageFile'

const THEME_STORAGE_KEY = 'lpo-theme'
const BOOT_THEME_ID = readStoredThemeId()
const BOOT_ACCENT = hexToNumber(getTheme(BOOT_THEME_ID).css['--accent'])
import { createTexturedPlaneObject } from '../images/createTexturedPlane'
import { mirrorSceneObject, mirrorWorldPoint, type SymmetryAxis } from '../symmetry/symmetry'
import {
  autoFinalizeCount,
  commitPolyDrawFace,
  flipFacesWinding,
} from '../polyDraw/polyDrawCommit'
import { appendFaceFromVertexIndices } from '../mesh/meshEdit'
import {
  findEdgeLoop,
  flipSelectionNormals,
  insertEdgeLoop,
  isValidLoopSeed,
  mergeVertices,
  subdivideObject,
} from '../mesh/meshTopologyOps'
import {
  clampSubdLevels,
  subdivideSurfaceLevels,
} from '../mesh/subdivisionSurface'
import {
  enforceSceneObjectPolyBudget,
  importVertexCap,
  maxRoundedBoxSubdivisionsForBudget,
  maxSubdLevelsForBudget,
} from '../mesh/meshPolyBudget'
import { knifeCutObject } from '../mesh/meshKnife'
import { knifeSegmentLongEnough } from '../mesh/knifeUtils'

function withoutObjectTexture(
  objectTextures: Record<string, UvTextureInfo>,
  objectId: string
): Record<string, UvTextureInfo> {
  if (!objectTextures[objectId]) return objectTextures
  const next = { ...objectTextures }
  delete next[objectId]
  return next
}

const textureLoadGeneration = new Map<string, number>()

export type UvEditorMode = 'points' | 'faces'

export interface UvTextureInfo {
  url: string
  name: string
  width: number
  height: number
}

export type PrimitiveKind = PrimitiveBoxType

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

export interface ExtrudeDragAnchor {
  clientX: number
  clientY: number
  baseAmount: number
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

export type { SymmetryAxis } from '../symmetry/symmetry'
export type { ImageDropMode, ReferenceImage, BillboardImage } from '../images/imageDropTypes'
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
import type { ViewType, OrthoViewType, SelectableViewType, ViewportSlotIndex } from '../scene/viewTypes'
import { DEFAULT_VIEWPORT_SLOT_VIEWS } from '../scene/viewTypes'
export type ToolCategory =
  | 'draw'
  | 'create'
  | 'vector'
  | 'sculpt'
  | 'select'
  | 'transform'
  | 'mesh'
  | 'boolean'
export type StrokeMode = 'outline' | 'centerline' | 'blob'
export type DrawInputMode = 'regular' | 'vector-pen'
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

export type PolyDrawMode = 'triangle' | 'quad' | 'poly'

export type PolyDrawPointSnap =
  | { kind: 'mesh'; objectId: string; vertexIndex: number }
  | { kind: 'draft'; draftIndex: number }

export interface PolyDrawDraftPoint {
  world: Vec3
  snap?: PolyDrawPointSnap
}

export interface PolyDrawDraft {
  points: PolyDrawDraftPoint[]
  view: ViewType
  previewWorld: Vec3 | null
  snapHighlight: { world: Vec3; isDraft?: boolean } | null
}

export interface LastPolyDrawFace {
  objectId: string
  faceStartIndex: number
  faceCount: number
}

export interface LoopCutDraft {
  objectId: string
  seedEdge: string
  loopEdges: string[]
  t: number
}

export interface KnifeDraft {
  objectId: string | null
  start: Vec3 | null
  end: Vec3 | null
  /** Completed cut lines this session (world space, for overlay). */
  committed: Array<{ start: Vec3; end: Vec3 }>
  view: ViewType
}

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
  /** Perspective footprint on ground plane */
  worldCornerA?: Vec3
  worldCornerB?: Vec3
  groundY?: number
  scrollHeight?: number
}

export type SelectionMode = 'object' | 'vertex' | 'edge' | 'face'

export interface HistoryEntry {
  snapshot: SceneSnapshot
  label?: string
}

// Re-export for consumers
export type { SceneSnapshot } from '../history/sceneHistory'

export interface VectorPenDraft {
  anchors: VectorAnchor[]
  view: ViewType
  previewPoint: { x: number; y: number } | null
  pendingAnchorIndex: number | null
  continuePathId: string | null
  closeTargetActive: boolean
}

export interface AppState {
  objects: SceneObject[]
  selectedObjectId: string | null
  selectionObjectIds: string[]
  activeView: ViewType
  maximizedView: ViewType | null
  viewportSlotViews: ViewType[]
  viewportColSplit: number
  viewportRowSplit: number
  sidePanelWidth: number
  activeTool: ActiveTool
  toolCategory: ToolCategory
  selectionMode: SelectionMode
  meshSelection: MeshComponentSelection | null
  meshHover: MeshPickHit | null
  meshModal: MeshModalState | null
  objectTransformModal: ObjectTransformModalState | null
  viewMoveBasis: ViewMoveBasis | null
  strokeMode: StrokeMode
  drawInputMode: DrawInputMode
  autoConnectPaths: boolean
  lastPenEndpoint: { view: ViewType; position: { x: number; y: number } } | null
  lastStrokeEndpoint: { view: ViewType; position: { x: number; y: number } } | null
  lastPenClickAt: number
  sketchExtrudeMode: boolean
  penExtrudeMode: boolean
  extrudeAmount: number
  extrudeDragAnchor: ExtrudeDragAnchor | null
  showGrid: boolean

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

  polyDrawMode: PolyDrawMode
  polyDrawDraft: PolyDrawDraft | null
  polyDrawHover: { world: Vec3; snap: PolyDrawPointSnap | null } | null
  polyDrawSnapAllScene: boolean
  lastPolyDrawFace: LastPolyDrawFace | null
  lastPolyDrawClickAt: number

  loopCutDraft: LoopCutDraft | null
  knifeDraft: KnifeDraft | null

  polyBudget: number
  polyBudgetMode: 'strict' | 'adaptive'
  brushDensity: number
  brushStrength: number
  brushRadius: number
  rdpTolerance: number
  closeThreshold: number
  defaultDepth: number
  facetExaggeration: number
  showDensityHeatmap: boolean
  viewportDisplayMode: ViewportDisplayMode
  /** When true, edit overlays draw through the mesh (Blender-style X-ray). */
  viewportXRay: boolean
  /** When true, the next vertex pick merges into the sole selected vertex (M held). */
  vertexMergeModifierHeld: boolean
  themeId: ThemeId
  topologyLocked: boolean

  symmetryEnabled: boolean
  symmetryAxis: SymmetryAxis
  symmetryPlane: number
  clipboard: SceneObject[] | null

  activeColor: number
  showToolRing: boolean
  showExportDialog: boolean

  imageDropMode: ImageDropMode
  referenceImages: ReferenceImage[]
  selectedReferenceImageId: string | null
  billboardImages: BillboardImage[]
  selectedBillboardImageId: string | null

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
  /** When true, show every UV island; when false, show only selected face region(s). */
  uvEditorViewAll: boolean
  /** When true, pan/zoom to selected face(s) if they leave the viewport. */
  uvEditorAutoFit: boolean
  /** When true, face picks and moves include coplanar regions and welded UV islands. */
  uvEditorSticky: boolean
  objectTextures: Record<string, UvTextureInfo>

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
  pixelEditorColor: Rgba4
  pixelEditorPaletteId: string
  pixelEditorCustomPalettes: CustomPalette[]
  pixelDocuments: Record<string, import('../pixel/pixelTypes').PixelDocument>
  pixelTextureRevision: number
  pixelEditHistoryPending: boolean

  historyPaused: number
  canUndo: boolean
  canRedo: boolean

  currentStroke: { x: number; y: number }[]
  currentStrokeView: ViewType | null
  currentStrokePreview: { x: number; y: number } | null
  isDrawing: boolean

  pushHistory: (label?: string, options?: { force?: boolean }) => boolean
  commitHistory: (label?: string, options?: { force?: boolean }) => boolean
  captureUndoPoint: (label?: string) => boolean
  replaceHistoryHead: (label?: string) => void
  pauseHistory: () => void
  resumeHistory: () => void
  undo: () => void
  redo: () => void

  addObject: (obj: SceneObject, options?: { skipHistory?: boolean; skipSymmetry?: boolean }) => void
  updateObject: (id: string, updates: Partial<SceneObject>) => void
  removeObject: (id: string) => void
  selectObject: (id: string | null, options?: { additive?: boolean }) => void
  setSelection: (ids: string[]) => void
  /** Union object ids into the current selection (never toggles off). */
  addToObjectSelection: (ids: string[]) => void
  clearSelection: () => void
  updateObjectTransform: (id: string, transform: ObjectTransform) => void
  translateSelectionByDelta: (
    delta: Vec3,
    baseTransforms: Record<string, ObjectTransform>
  ) => void
  setViewMoveBasis: (basis: ViewMoveBasis | null) => void
  nudgeSelection: (direction: NudgeDirection, fast?: boolean) => void

  setExtrudeMode: (on: boolean) => void
  toggleExtrudeMode: () => void
  setExtrudeAmount: (amount: number) => void
  commitExtrudeDepth: () => void
  beginExtrudeDrag: (clientX: number, clientY: number) => void
  updateExtrudeFromPointer: (clientX: number, clientY: number) => void
  clearExtrudeDrag: () => void

  startVectorStroke: (point: { x: number; y: number }, view: ViewType) => void
  continueVectorStroke: (point: { x: number; y: number }) => void
  endVectorStroke: (view: ViewType) => void
  penPointerDown: (point: { x: number; y: number }, view: ViewType) => void
  penPointerMove: (point: { x: number; y: number }) => void
  penPointerUp: (point: { x: number; y: number }, options?: { altKey?: boolean }) => void
  penFinishPath: () => void
  penCancelPath: () => void
  commitPenPath: (closed: boolean) => void
  commitVectorPath: (path: VectorPath, options?: { skipHistory?: boolean }) => void
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

  setPolyDrawMode: (mode: PolyDrawMode) => void
  setPolyDrawSnapAllScene: (on: boolean) => void
  polyDrawPointerMove: (
    world: Vec3,
    snapHighlight: PolyDrawDraft['snapHighlight'],
    hoverSnap: PolyDrawPointSnap | null
  ) => void
  clearPolyDrawHover: () => void
  polyDrawClick: (
    world: Vec3,
    snap: PolyDrawPointSnap | null,
    view: ViewType
  ) => void
  polyDrawCancel: () => void
  polyDrawFinish: () => void
  flipLastPolyDrawFace: () => void
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

  loopCutBegin: (objectId: string, seedEdge: string) => void
  loopCutSetT: (t: number) => void
  loopCutAdjustWheel: (deltaY: number) => void
  loopCutCommit: () => void
  loopCutCancel: () => void

  knifePointerDown: (objectId: string, world: Vec3, view: ViewType) => void
  knifePointerMove: (world: Vec3) => void
  knifeCommit: (viewForward: Vec3) => void
  knifeCancel: () => void

  setActiveView: (view: ViewType) => void
  setViewportSlotView: (index: ViewportSlotIndex, view: SelectableViewType) => void
  toggleMaximizedView: () => void
  setViewportColSplit: (ratio: number) => void
  setViewportRowSplit: (ratio: number) => void
  setSidePanelWidth: (width: number) => void
  setActiveTool: (tool: ActiveTool) => void
  activateToolRingEntry: (category: ToolCategory, entry: ToolRingEntry) => boolean
  activateSelectTool: () => void
  setToolCategory: (cat: ToolCategory) => void
  setSelectionMode: (mode: SelectionMode) => void
  applyMeshPick: (hit: MeshPickHit, additive?: boolean) => void
  applyMeshMarqueePick: (
    objectId: string,
    components: { vertices: number[]; edges: string[]; faces: number[] },
    additive?: boolean
  ) => void
  setMeshHover: (hit: MeshPickHit | null) => void
  clearMeshSelection: () => void
  selectAllInMode: () => void
  deselectAllInMode: () => void
  deleteSelection: () => void
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
  translateMeshSelection: (deltaWorld: Vec3, basePositions: Record<number, Vec3>) => void
  setStrokeMode: (mode: StrokeMode) => void
  setDrawInputMode: (mode: DrawInputMode) => void
  setAutoConnectPaths: (on: boolean) => void
  toggleAutoConnectPaths: () => void
  setShowGrid: (show: boolean) => void
  setSelectionSmoothShading: (smooth: boolean) => void
  toggleSmoothShading: () => void
  shadeSmoothSelected: () => void
  shadeFlatSelected: () => void

  setSymmetryEnabled: (on: boolean) => void
  toggleSymmetry: () => void
  setSymmetryAxis: (axis: SymmetryAxis) => void
  setSymmetryPlane: (plane: number) => void
  copySelection: () => void
  pasteClipboard: () => void

  setPolyBudget: (budget: number) => void
  setBrushDensity: (density: number) => void
  setBrushStrength: (strength: number) => void
  setBrushRadius: (radius: number) => void
  setActiveColor: (color: number) => void
  setFacetExaggeration: (value: number) => void
  setShowDensityHeatmap: (show: boolean) => void
  setViewportDisplayMode: (mode: ViewportDisplayMode) => void
  setViewportXRay: (enabled: boolean) => void
  setThemeId: (id: ThemeId) => void
  toggleTopologyLock: () => void
  setShowToolRing: (show: boolean) => void
  setShowExportDialog: (show: boolean) => void
  importSceneFile: (file: File) => Promise<number>
  requestProjectLoad: () => void
  loadProjectFromDialog: () => Promise<boolean>
  newProject: () => void
  saveProject: () => Promise<boolean>
  loadProjectFile: (file: File) => Promise<void>

  setImageDropMode: (mode: ImageDropMode) => void
  dropImageInView: (
    view: ViewType,
    file: File,
    world: Vec3,
    referenceNorm: { x: number; y: number }
  ) => Promise<void>
  selectReferenceImage: (id: string | null) => void
  updateReferenceImage: (id: string, patch: Partial<ReferenceImage>) => void
  commitReferenceImageEdit: () => void
  removeReferenceImage: (id: string) => void
  selectBillboardImage: (id: string | null) => void
  updateBillboardImage: (id: string, patch: Partial<BillboardImage>) => void
  commitBillboardImageEdit: () => void
  removeBillboardImage: (id: string) => void
  deleteSelectedImageDrop: () => void

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
  setPixelEditorTool: (tool: PixelTool) => void
  setPixelEditorBrushSize: (size: number) => void
  setPixelEditorPixelPerfect: (on: boolean) => void
  setPixelEditorSymmetryH: (on: boolean) => void
  setPixelEditorSymmetryV: (on: boolean) => void
  setPixelEditorPaintOnModel: (on: boolean) => void
  setPixelEditorShapeFilled: (on: boolean) => void
  setPixelEditorView: (zoom: number, panX: number, panY: number) => void
  setPixelEditorFillTolerance: (t: number) => void
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
  savePixelDocument: () => Promise<void>
  exportPixelDocumentPng: () => void
  exportPixelDocumentProject: () => void
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
  paintPixelStroke: (points: { x: number; y: number }[], tool?: 'pencil' | 'eraser') => void
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

  startStroke: (point: { x: number; y: number }, view: ViewType) => void
  continueStroke: (point: { x: number; y: number }) => void
  setStrokePreview: (point: { x: number; y: number } | null) => void
  endStroke: (view: ViewType) => void

  applySculptAt: (center: Vec3, tool: SculptTool, options?: { saveHistory?: boolean }) => void
  simplifySelected: () => void
}

const MAX_HISTORY = 50

function emptySceneSnapshot(): SceneSnapshot {
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

function snapshotFromState(state: Pick<
  AppState,
  | 'objects'
  | 'objectTextures'
  | 'pixelDocuments'
  | 'referenceImages'
  | 'billboardImages'
  | 'selectedObjectId'
  | 'selectionObjectIds'
  | 'meshSelection'
>): SceneSnapshot {
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

function reconcileAppBlobUrls(getState: () => AppState): void {
  const current = snapshotFromState(getState())
  const historySnapshots = sceneHistory.allSnapshots()
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
    currentStroke: [],
    currentStrokeView: null,
    currentStrokePreview: null,
    isDrawing: false,
    vectorDraft: [],
    vectorDraftView: null,
    vectorIsDrawing: false,
    vectorPenDraft: null,
    primitiveBoxDraft: null,
    polyDrawDraft: null,
    loopCutDraft: null,
    knifeDraft: null,
  }
}

function restoreSceneToStore(
  set: (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void,
  get: () => AppState,
  snapshot: SceneSnapshot,
  options?: { resetEditors?: boolean; extra?: Partial<AppState> }
): void {
  invalidateFaceGroupCache()
  const restored = sanitizeSceneSnapshot(snapshot)
  const imageSelection = sanitizeImageSelectionIds(
    restored.referenceImages,
    restored.billboardImages,
    get().selectedReferenceImageId,
    get().selectedBillboardImageId
  )
  set({
    objects: restored.objects,
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
    currentStroke: [],
    currentStrokeView: null,
    currentStrokePreview: null,
    isDrawing: false,
    vectorDraft: [],
    vectorDraftView: null,
    vectorIsDrawing: false,
    vectorPenDraft: null,
    primitiveBoxDraft: null,
    polyDrawDraft: null,
    loopCutDraft: null,
    knifeDraft: null,
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
    }
  }
  return { objectTextures: nextTextures, pixelDocuments: nextDocs }
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

const sceneHistory = new SceneHistoryStack(emptySceneSnapshot(), MAX_HISTORY)

function syncHistoryFlags() {
  const stats = sceneHistory.stats()
  return { canUndo: stats.canUndo, canRedo: stats.canRedo }
}

function objectNeedsRecolor(obj: SceneObject, color: number, rgba: Rgba4): boolean {
  const mat = ensureObjectMaterial(obj).material!
  if (mat.mode === 'texture') return true
  if (obj.color !== color) return true
  if (obj.cornerColors?.length) {
    return obj.cornerColors.some((c) => !rgba4Equal(c, rgba))
  }
  return obj.faceColors.some((fc) => fc !== color)
}

function colorFromSelection(objects: SceneObject[], id: string | null): number | undefined {
  if (!id) return undefined
  return objects.find((o) => o.id === id)?.color
}

export const useAppStore = create<AppState>((set, get) => ({
  objects: [],
  selectedObjectId: null,
  selectionObjectIds: [],
  activeView: 'front',
  maximizedView: null,
  viewportSlotViews: [...DEFAULT_VIEWPORT_SLOT_VIEWS],
  viewportColSplit: 0.5,
  viewportRowSplit: 0.5,
  sidePanelWidth: 240,
  activeTool: 'draw',
  toolCategory: 'draw',
  selectionMode: 'object',
  meshSelection: null,
  meshHover: null,
  meshModal: null,
  objectTransformModal: null,
  viewMoveBasis: null,
  strokeMode: 'outline',
  drawInputMode: 'regular',
  autoConnectPaths: true,
  lastPenEndpoint: null,
  lastStrokeEndpoint: null,
  lastPenClickAt: 0,
  sketchExtrudeMode: false,
  penExtrudeMode: false,
  extrudeAmount: 16,
  extrudeDragAnchor: null,
  showGrid: true,

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

  polyDrawMode: 'quad',
  polyDrawDraft: null,
  polyDrawHover: null,
  polyDrawSnapAllScene: true,
  lastPolyDrawFace: null,
  lastPolyDrawClickAt: 0,

  loopCutDraft: null,
  knifeDraft: null,

  polyBudget: 128,
  polyBudgetMode: 'strict',
  brushDensity: 12,
  brushStrength: 0.5,
  brushRadius: 30,
  rdpTolerance: 2,
  closeThreshold: 8,
  defaultDepth: 0,
  facetExaggeration: 0,
  showDensityHeatmap: false,
  viewportDisplayMode: 'model',
  viewportXRay: false,
  vertexMergeModifierHeld: false,
  themeId: BOOT_THEME_ID,
  topologyLocked: false,

  symmetryEnabled: false,
  symmetryAxis: 'x',
  symmetryPlane: 0,
  clipboard: null,

  activeColor: BOOT_ACCENT,
  showToolRing: false,
  showExportDialog: false,

  imageDropMode: 'off',
  referenceImages: [],
  selectedReferenceImageId: null,
  billboardImages: [],
  selectedBillboardImageId: null,

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

  ...materialEditorInitialState,
  ...pixelEditorInitialState,
  pixelEditHistoryPending: false,

  historyPaused: 0,
  canUndo: false,
  canRedo: false,

  currentStroke: [],
  currentStrokeView: null,
  currentStrokePreview: null,
  isDrawing: false,

  pushHistory: (label, options) => get().commitHistory(label, options),

  commitHistory: (label, options) => {
    if (get().historyPaused > 0) return false
    const added = sceneHistory.push(
      captureSceneSnapshot(snapshotFromState(get())),
      label,
      options
    )
    if (added) {
      reconcileAppBlobUrls(get)
      set(syncHistoryFlags())
    }
    return added
  },

  captureUndoPoint: (label) => get().commitHistory(label, { force: true }),

  replaceHistoryHead: (label) => {
    sceneHistory.replaceHead(captureSceneSnapshot(snapshotFromState(get())), label)
    reconcileAppBlobUrls(get)
    set(syncHistoryFlags())
  },

  pauseHistory: () => set((s) => ({ historyPaused: s.historyPaused + 1 })),
  resumeHistory: () =>
    set((s) => ({ historyPaused: Math.max(0, s.historyPaused - 1) })),

  undo: () => {
    const snapshot = sceneHistory.undo()
    if (!snapshot) {
      set(syncHistoryFlags())
      return
    }
    restoreSceneToStore(set, get, snapshot)
  },

  redo: () => {
    const snapshot = sceneHistory.redo()
    if (!snapshot) {
      set(syncHistoryFlags())
      return
    }
    restoreSceneToStore(set, get, snapshot)
  },

  addObject: (obj, options) => {
    const { symmetryEnabled, symmetryAxis, symmetryPlane, polyBudget } = get()
    const budget = obj.polyBudget ?? polyBudget
    const prepared = enforceSceneObjectPolyBudget(prepareSceneObject(obj), budget)
    const batch = [prepared]
    if (symmetryEnabled && !options?.skipSymmetry) {
      batch.push(mirrorSceneObject(prepared, symmetryAxis, symmetryPlane))
    }
    set((s) => ({
      objects: [...s.objects, ...batch],
      selectedObjectId: batch[0].id,
      selectionObjectIds: batch.map((b) => b.id),
    }))
    if (!options?.skipHistory) get().commitHistory('Add object')
  },

  updateObject: (id, updates) => {
    if (updates.faces || updates.positions || updates.faceGroups) invalidateFaceGroupCache(id)
    set((s) => ({
      objects: s.objects.map((o) => (o.id === id ? { ...o, ...updates } : o)),
    }))
  },

  removeObject: (id) => {
    set((s) => {
      const removed = new Set([id])
      const { objectTextures, pixelDocuments } = purgeTextureResourcesForObjects(
        s.objects,
        removed,
        s.objectTextures,
        s.pixelDocuments
      )
      return {
        objects: s.objects.filter((o) => o.id !== id),
        selectedObjectId: s.selectedObjectId === id ? null : s.selectedObjectId,
        selectionObjectIds: s.selectionObjectIds.filter((oid) => oid !== id),
        objectTextures,
        pixelDocuments,
      }
    })
    textureLoadGeneration.delete(id)
    invalidateFaceGroupCache(id)
    reconcileAppBlobUrls(get)
    get().commitHistory('Delete object')
  },

  selectObject: (id, options) => {
    if (!id) {
      set({
        selectedObjectId: null,
        selectionObjectIds: [],
        meshSelection: null,
        selectedReferenceImageId: null,
        selectedBillboardImageId: null,
      })
      return
    }
    if (options?.additive) {
      set((s) => {
        const has = s.selectionObjectIds.includes(id)
        const next = has
          ? s.selectionObjectIds.filter((oid) => oid !== id)
          : [...s.selectionObjectIds, id]
        const primaryId = next.length ? next[next.length - 1] : null
        const nextColor = colorFromSelection(s.objects, primaryId)
        return {
          selectionObjectIds: next,
          selectedObjectId: primaryId,
          selectedReferenceImageId: null,
          selectedBillboardImageId: null,
          ...(nextColor !== undefined ? { activeColor: nextColor } : {}),
        }
      })
    } else {
      const color = colorFromSelection(get().objects, id)
      const prevMesh = get().meshSelection
      const obj = get().objects.find((o) => o.id === id)
      const extrudeSync =
        isSketchDoodleObject(obj) && obj.sketchSource.isClosed
          ? { extrudeAmount: obj.sketchSource.extrudeDepth }
          : isVectorDoodleObject(obj)
            ? { extrudeAmount: obj.vectorSource.extrudeDepth }
            : {}
      set({
        selectedObjectId: id,
        selectionObjectIds: [id],
        selectedReferenceImageId: null,
        selectedBillboardImageId: null,
        ...(color !== undefined ? { activeColor: color } : {}),
        meshSelection: prevMesh?.objectId === id ? prevMesh : null,
        ...extrudeSync,
      })
    }
  },

  setSelection: (ids) => {
    const primaryId = ids.length ? ids[ids.length - 1] : null
    const color = colorFromSelection(get().objects, primaryId)
    const obj = primaryId ? get().objects.find((o) => o.id === primaryId) : undefined
    const extrudeSync =
      isSketchDoodleObject(obj) && obj.sketchSource.isClosed
        ? { extrudeAmount: obj.sketchSource.extrudeDepth }
        : isVectorDoodleObject(obj)
          ? { extrudeAmount: obj.vectorSource.extrudeDepth }
          : {}
    set({
      selectionObjectIds: ids,
      selectedObjectId: primaryId,
      ...(color !== undefined ? { activeColor: color } : {}),
      ...extrudeSync,
    })
  },

  addToObjectSelection: (ids) => {
    if (ids.length === 0) return
    set((s) => {
      const next = [...new Set([...s.selectionObjectIds, ...ids])]
      const primaryId = next.length ? next[next.length - 1]! : null
      const nextColor = colorFromSelection(s.objects, primaryId)
      return {
        selectionObjectIds: next,
        selectedObjectId: primaryId,
        selectedReferenceImageId: null,
        selectedBillboardImageId: null,
        ...(nextColor !== undefined ? { activeColor: nextColor } : {}),
      }
    })
  },

  clearSelection: () => set({ selectedObjectId: null, selectionObjectIds: [], meshSelection: null }),

  updateObjectTransform: (id, transform) => {
    set((s) => ({
      objects: s.objects.map((o) =>
        o.id === id ? { ...o, transform: cloneTransform(transform) } : o
      ),
    }))
  },

  translateSelectionByDelta: (delta, baseTransforms) => {
    set((s) => ({
      objects: s.objects.map((o) => {
        const base = baseTransforms[o.id]
        if (!base) return o
        return {
          ...o,
          transform: {
            ...base,
            position: {
              x: base.position.x + delta.x,
              y: base.position.y + delta.y,
              z: base.position.z + delta.z,
            },
            rotation: { ...base.rotation },
            scale: { ...base.scale },
          },
        }
      }),
    }))
  },

  setViewMoveBasis: (basis) =>
    set((s) => {
      const prev = s.viewMoveBasis
      if (prev === basis) return s
      if (!prev || !basis) return { viewMoveBasis: basis }
      if (
        prev.right.x === basis.right.x &&
        prev.right.y === basis.right.y &&
        prev.right.z === basis.right.z &&
        prev.up.x === basis.up.x &&
        prev.up.y === basis.up.y &&
        prev.up.z === basis.up.z
      ) {
        return s
      }
      return { viewMoveBasis: basis }
    }),

  nudgeSelection: (direction, fast = false) => {
    const { activeView, selectionObjectIds, meshSelection, objects, viewMoveBasis } = get()
    const step = fast ? 8 : 2
    const delta = viewNudgeDelta(activeView, direction, step, viewMoveBasis)

    if (delta.x === 0 && delta.y === 0 && delta.z === 0) return

    if (selectionHasComponents(meshSelection)) {
      const obj = objects.find((o) => o.id === meshSelection!.objectId)
      if (!obj || obj.topologyLocked) return

      const verts = getAffectedVertices(meshSelection!, obj)
      const localDelta = worldDeltaToLocal(obj, delta)
      set((s) => ({
        objects: s.objects.map((o) => {
          if (o.id !== obj.id) return o
          return {
            ...o,
            positions: o.positions.map((p, i) =>
              verts.has(i)
                ? {
                    x: p.x + localDelta.x,
                    y: p.y + localDelta.y,
                    z: p.z + localDelta.z,
                  }
                : p
            ),
          }
        }),
      }))
      invalidateFaceGroupCache(obj.id)
      get().commitHistory('Nudge selection')
      return
    }

    if (selectionObjectIds.length === 0) return

    set((s) => ({
      objects: s.objects.map((o) => {
        if (!selectionObjectIds.includes(o.id)) return o
        const tr = ensureTransform(o)
        return {
          ...o,
          transform: {
            ...tr,
            position: {
              x: tr.position.x + delta.x,
              y: tr.position.y + delta.y,
              z: tr.position.z + delta.z,
            },
          },
        }
      }),
    }))
    get().commitHistory('Nudge selection')
  },

  setExtrudeMode: (on) =>
    set((s) =>
      s.drawInputMode === 'vector-pen'
        ? { penExtrudeMode: on }
        : { sketchExtrudeMode: on }
    ),
  toggleExtrudeMode: () =>
    set((s) =>
      s.drawInputMode === 'vector-pen'
        ? { penExtrudeMode: !s.penExtrudeMode }
        : { sketchExtrudeMode: !s.sketchExtrudeMode }
    ),
  setExtrudeAmount: (amount) => {
    const state = get()
    const { selectedObjectId, selectionObjectIds, objects } = state
    if (selectionObjectIds.length === 1 && selectedObjectId) {
      const obj = objects.find((o) => o.id === selectedObjectId)
      if (isSketchDoodleObject(obj) && obj.sketchSource.isClosed) {
        const updated = regenerateSketchObject(obj, amount)
        if (updated) {
          set({
            extrudeAmount: amount,
            objects: objects.map((o) => (o.id === obj.id ? updated : o)),
          })
          return
        }
      }
      if (isVectorDoodleObject(obj)) {
        const updated = regenerateVectorObject(obj, amount)
        if (updated) {
          set({
            extrudeAmount: amount,
            objects: objects.map((o) => (o.id === obj.id ? updated : o)),
          })
          return
        }
      }
    }
    set({ extrudeAmount: amount })
  },

  commitExtrudeDepth: () => {
    get().pushHistory('Extrude depth')
  },

  beginExtrudeDrag: (clientX, clientY) => {
    const state = get()
    const extrudeOn =
      state.drawInputMode === 'vector-pen' ? state.penExtrudeMode : state.sketchExtrudeMode
    if (!extrudeOn) return
    set({
      extrudeDragAnchor: {
        clientX,
        clientY,
        baseAmount: get().extrudeAmount,
      },
    })
  },

  updateExtrudeFromPointer: (clientX, clientY) => {
    const { extrudeDragAnchor, drawInputMode, sketchExtrudeMode, penExtrudeMode } = get()
    const extrudeOn = drawInputMode === 'vector-pen' ? penExtrudeMode : sketchExtrudeMode
    if (!extrudeOn || !extrudeDragAnchor) return
    const dx = clientX - extrudeDragAnchor.clientX
    const dy = extrudeDragAnchor.clientY - clientY
    get().setExtrudeAmount(
      extrudeDragAnchor.baseAmount + extrudeValueFromScreenDelta(dx, dy, 0.15)
    )
  },

  clearExtrudeDrag: () => set({ extrudeDragAnchor: null }),

  startVectorStroke: (point, view) =>
    set({ vectorDraft: [point], vectorIsDrawing: true, vectorDraftView: view }),

  continueVectorStroke: (point) =>
    set((s) => {
      if (!s.vectorIsDrawing || s.vectorDraft.length === 0) return s
      if (s.activeTool !== 'vector-shape') return s

      return { vectorDraft: [s.vectorDraft[0], point] }
    }),

  penPointerDown: (point, view) => {
    const {
      vectorPenDraft,
      closeThreshold,
      commitPenPath,
      autoConnectPaths,
      vectorDocument,
      lastPenEndpoint,
      lastPenClickAt,
    } = get()

    const now = performance.now()
    if (vectorPenDraft?.view === view && now - lastPenClickAt < 320) {
      get().penFinishPath()
      set({ lastPenClickAt: 0 })
      return
    }
    set({ lastPenClickAt: now })

    let pt = { ...point }
    const draft = vectorPenDraft?.view === view ? vectorPenDraft : null

    if (draft && draft.anchors.length >= 3 && draft.pendingAnchorIndex === null) {
      const first = draft.anchors[0].position
      if (isNearPoint(pt, first, closeThreshold * 1.5)) {
        commitPenPath(true)
        return
      }
    }

    if (!draft) {
      let anchors = [createAnchor(pt, generateId())]
      let continuePathId: string | null = null

      if (autoConnectPaths) {
        const hit = findNearestPathEndpoint(
          pt,
          view,
          vectorDocument.paths,
          closeThreshold * 1.5
        )
        if (hit) {
          pt = snapPointToEndpoint(pt, hit)
          if (
            !hit.path.closed &&
            hit.isStart &&
            hit.path.anchors.length >= 3 &&
            isNearPoint(pt, hit.path.anchors[0].position, closeThreshold * 1.5)
          ) {
            set({
              vectorPenDraft: {
                anchors: cloneAnchors(hit.path),
                view,
                previewPoint: pt,
                pendingAnchorIndex: null,
                continuePathId: hit.pathId,
                closeTargetActive: false,
              },
            })
            get().commitPenPath(true)
            return
          }
          if (!hit.path.closed && hit.isEnd && hit.path.anchors.length >= 1) {
            anchors = cloneAnchors(hit.path)
            anchors[anchors.length - 1] = {
              ...anchors[anchors.length - 1],
              position: { ...pt },
            }
            continuePathId = hit.pathId
          } else if (hit.isEnd || hit.isStart) {
            anchors = [createAnchor(pt, generateId())]
          }
        } else if (
          lastPenEndpoint?.view === view &&
          isNearPoint(pt, lastPenEndpoint.position, closeThreshold * 1.5)
        ) {
          pt = { ...lastPenEndpoint.position }
          anchors = [createAnchor(pt, generateId())]
        }
      }

      set({
        vectorPenDraft: {
          anchors,
          view,
          previewPoint: pt,
          pendingAnchorIndex: null,
          continuePathId,
          closeTargetActive: false,
        },
      })
      return
    }

    if (draft.pendingAnchorIndex !== null) return

    if (autoConnectPaths) {
      const hit = findNearestPathEndpoint(
        pt,
        view,
        vectorDocument.paths.filter((p) => p.id !== draft.continuePathId),
        closeThreshold * 1.5
      )
      if (hit) pt = snapPointToEndpoint(pt, hit)
    }

    const anchors = draft.anchors.map((a) => ({
      ...a,
      position: { ...a.position },
      inHandle: a.inHandle ? { ...a.inHandle } : null,
      outHandle: a.outHandle ? { ...a.outHandle } : null,
    }))
    const newIndex = anchors.length
    anchors.push(createAnchor(pt, generateId()))

    set({
      vectorPenDraft: {
        ...draft,
        anchors,
        previewPoint: pt,
        pendingAnchorIndex: newIndex,
        closeTargetActive: false,
      },
    })
  },

  penPointerMove: (point) => {
    const { vectorPenDraft, closeThreshold } = get()
    if (!vectorPenDraft) return

    const closeTargetActive =
      vectorPenDraft.anchors.length >= 3 &&
      vectorPenDraft.pendingAnchorIndex === null &&
      isNearPoint(point, vectorPenDraft.anchors[0].position, closeThreshold * 1.5)

    const anchors = vectorPenDraft.anchors.map((a) => ({
      ...a,
      position: { ...a.position },
      inHandle: a.inHandle ? { ...a.inHandle } : null,
      outHandle: a.outHandle ? { ...a.outHandle } : null,
    }))

    if (vectorPenDraft.pendingAnchorIndex !== null) {
      applySmoothHandles(anchors, vectorPenDraft.pendingAnchorIndex, point)
    }

    set({
      vectorPenDraft: {
        ...vectorPenDraft,
        anchors,
        previewPoint: point,
        closeTargetActive,
      },
    })
  },

  penPointerUp: (point, options) => {
    const { vectorPenDraft } = get()
    if (!vectorPenDraft || vectorPenDraft.pendingAnchorIndex === null) {
      if (vectorPenDraft) {
        set({ vectorPenDraft: { ...vectorPenDraft, previewPoint: point } })
      }
      return
    }

    const anchors = vectorPenDraft.anchors.map((a) => ({
      ...a,
      position: { ...a.position },
      inHandle: a.inHandle ? { ...a.inHandle } : null,
      outHandle: a.outHandle ? { ...a.outHandle } : null,
    }))

    finalizePendingAnchor(
      anchors,
      vectorPenDraft.pendingAnchorIndex,
      point,
      options?.altKey
    )

    set({
      vectorPenDraft: {
        ...vectorPenDraft,
        anchors,
        previewPoint: point,
        pendingAnchorIndex: null,
      },
    })
  },

  penFinishPath: () => {
    const { vectorPenDraft, closeThreshold } = get()
    if (!vectorPenDraft) return

    let closed = false
    if (vectorPenDraft.anchors.length >= 3 && vectorPenDraft.pendingAnchorIndex === null) {
      const first = vectorPenDraft.anchors[0].position
      const last = vectorPenDraft.anchors[vectorPenDraft.anchors.length - 1].position
      closed =
        vectorPenDraft.closeTargetActive ||
        isNearPoint(first, last, closeThreshold * 3)
    }

    get().commitPenPath(closed)
  },

  penCancelPath: () => {
    get().clearExtrudeDrag()
    set({ vectorPenDraft: null })
  },

  commitPenPath: (closed: boolean) => {
    const { vectorPenDraft, activeColor, commitVectorPath } = get()
    if (!vectorPenDraft) return
    if (vectorPenDraft.pendingAnchorIndex !== null) return

    const minAnchors = closed ? 3 : 2
    if (vectorPenDraft.anchors.length < minAnchors) {
      set({ vectorPenDraft: null })
      return
    }

    const continuePathId = vectorPenDraft.continuePathId
    const prev = continuePathId
      ? get().vectorDocument.paths.find((p) => p.id === continuePathId)
      : null

    const path: VectorPath = {
      id: continuePathId ?? generateId(),
      anchors: vectorPenDraft.anchors.map((a) => ({
        ...a,
        position: { ...a.position },
        inHandle: a.inHandle ? { ...a.inHandle } : null,
        outHandle: a.outHandle ? { ...a.outHandle } : null,
      })),
      closed,
      view: vectorPenDraft.view,
      color: activeColor,
      source: 'pen',
    }

    const lastAnchor = path.anchors[path.anchors.length - 1].position

    if (continuePathId) {
      set((s) => ({
        vectorPenDraft: null,
        objects: prev?.objectId
          ? s.objects.filter((o) => o.id !== prev.objectId)
          : s.objects,
        objectTextures: prev?.objectId
          ? withoutObjectTexture(s.objectTextures, prev.objectId)
          : s.objectTextures,
        vectorDocument: {
          ...s.vectorDocument,
          paths: s.vectorDocument.paths.filter((p) => p.id !== continuePathId),
        },
      }))
      reconcileAppBlobUrls(get)
    } else {
      set({ vectorPenDraft: null })
    }

    commitVectorPath(path, { skipHistory: !!continuePathId })
    if (continuePathId) get().commitHistory('Connect pen path')

    get().clearExtrudeDrag()
    set({
      lastPenEndpoint: { view: path.view, position: { ...lastAnchor } },
    })
  },

  endVectorStroke: (view) => {
    const {
      vectorDraft,
      vectorDraftView,
      activeTool,
      activeShapeKind,
      commitVectorShape,
    } = get()

    if (vectorDraft.length < 2 || view === 'perspective') {
      set({ vectorDraft: [], vectorIsDrawing: false, vectorDraftView: null })
      return
    }

    if (activeTool !== 'vector-shape') {
      set({ vectorDraft: [], vectorIsDrawing: false, vectorDraftView: null })
      return
    }

    if (vectorDraftView !== null && vectorDraftView !== view) {
      return
    }

    if (activeTool === 'vector-shape') {
      const a = vectorDraft[0]
      const b = vectorDraft[vectorDraft.length - 1]
      const span = Math.hypot(b.x - a.x, b.y - a.y)
      if (span < 3) {
        set({ vectorDraft: [], vectorIsDrawing: false, vectorDraftView: null })
        return
      }

      commitVectorShape(activeShapeKind, a, b, view)
    }

    set({ vectorDraft: [], vectorIsDrawing: false, vectorDraftView: null })
  },

  commitVectorPath: (path, options?: { skipHistory?: boolean; skipSymmetry?: boolean }) => {
    const {
      polyBudget,
      brushDensity,
      strokeMode,
      rdpTolerance,
      closeThreshold,
      defaultDepth,
      facetExaggeration,
      penExtrudeMode,
      extrudeAmount,
    } = get()

    const obj = vectorPathToMesh(path, {
      view: path.view,
      polyBudget,
      brushDensity,
      strokeMode,
      rdpTolerance,
      closeThreshold,
      defaultDepth,
      color: path.color,
      stylize: facetExaggeration,
      extrudeMode: penExtrudeMode,
      extrudeAmount,
    })

    const pathWithObject = { ...path, objectId: obj?.id }

    const objToAdd =
      obj && path.source === 'pen'
        ? attachVectorSource(obj, {
            path: pathWithObject,
            strokeMode: penExtrudeMode ? 'outline' : strokeMode,
            extrudeMode: penExtrudeMode,
            brushDensity,
            rdpTolerance,
            closeThreshold,
            defaultDepth,
            stylize: facetExaggeration,
            extrudeDepth: extrudeAmount,
          })
        : obj

    if (objToAdd) {
      get().addObject(objToAdd, { skipHistory: options?.skipHistory, skipSymmetry: options?.skipSymmetry })
    }

    set((s) => ({
      vectorDocument: {
        ...s.vectorDocument,
        paths: [...s.vectorDocument.paths, pathWithObject],
      },
    }))
  },

  commitVectorShape: (kind, a, b, view) => {
    const {
      polyBudget,
      defaultDepth,
      activeColor,
      roundedBoxRoundness,
      roundedBoxSubdivisions,
    } = get()
    const obj = vectorShapeToObject(kind, a, b, {
      view,
      depth: defaultDepth,
      polyBudget,
      color: activeColor,
      ...(kind === 'roundedBox'
        ? {
            roundedBoxParams: {
              roundness: roundedBoxRoundness,
              subdivisions: roundedBoxSubdivisions,
            } satisfies RoundedBoxParams,
          }
        : {}),
    })
    if (obj) get().addObject(obj)
  },

  setActiveShapeKind: (kind) => {
    get().penCancelPath()
    set({
      activeShapeKind: kind,
      activeTool: 'vector-shape',
      toolCategory: 'vector',
      activePrimitiveKind: null,
      primitiveBoxDraft: null,
      vectorDraft: [],
      vectorIsDrawing: false,
      vectorDraftView: null,
      vectorPenDraft: null,
      currentStroke: [],
      isDrawing: false,
      currentStrokeView: null,
      currentStrokePreview: null,
    })
  },

  setActivePrimitiveKind: (kind) => {
    get().penCancelPath()
    set({
      activePrimitiveKind: kind,
      activeTool: kind ? 'primitive-box' : 'draw',
      toolCategory: 'draw',
      primitiveBoxDraft: null,
      vectorDraft: [],
      vectorIsDrawing: false,
      vectorDraftView: null,
      vectorPenDraft: null,
      currentStroke: [],
      isDrawing: false,
      currentStrokeView: null,
    })
  },

  setRoundedBoxRoundness: (value) =>
    set({ roundedBoxRoundness: clampRoundness(value) }),

  setRoundedBoxSubdivisions: (value) =>
    set({
      roundedBoxSubdivisions: Math.min(
        clampRoundedBoxSubdivisions(value),
        maxRoundedBoxSubdivisionsForBudget(get().polyBudget)
      ),
    }),

  adjustRoundedBoxWheel: (deltaY, shiftKey) => {
    const {
      activeTool,
      activePrimitiveKind,
      activeShapeKind,
      primitiveBoxDraft,
      vectorIsDrawing,
    } = get()

    const primitiveRounded =
      activeTool === 'primitive-box' &&
      activePrimitiveKind === 'roundedBox' &&
      primitiveBoxDraft != null
    const vectorRounded =
      activeTool === 'vector-shape' && activeShapeKind === 'roundedBox' && vectorIsDrawing

    if (!primitiveRounded && !vectorRounded) return false

    if (
      primitiveRounded &&
      primitiveBoxDraft!.phase === 'scrollHeight' &&
      primitiveBoxDraft!.baseView === 'perspective' &&
      !shiftKey
    ) {
      return false
    }

    if (shiftKey) {
      const step = deltaY > 0 ? -0.05 : 0.05
      set({ roundedBoxRoundness: clampRoundness(get().roundedBoxRoundness + step) })
    } else {
      const step = deltaY > 0 ? -1 : 1
      set({
        roundedBoxSubdivisions: clampRoundedBoxSubdivisions(
          get().roundedBoxSubdivisions + step
        ),
      })
    }
    return true
  },

  cancelPrimitiveBoxDraft: () => set({ primitiveBoxDraft: null }),

  primitiveBoxPointerDown: (point, view, _shiftKey, worldPoint) => {
    const { activePrimitiveKind, primitiveBoxDraft, defaultDepth } = get()
    if (!activePrimitiveKind) return

    if (view === 'perspective') {
      if (!worldPoint) return

      if (
        primitiveBoxDraft?.phase === 'scrollHeight' &&
        primitiveBoxDraft.baseView === 'perspective'
      ) {
        return
      }

      const session = startPerspectivePrimitiveBoxSession(worldPoint, defaultDepth)
      set({
        primitiveBoxDraft: {
          phase: 'drawingBase',
          baseView: 'perspective',
          heightAxis: session.heightAxis,
          box: session.box,
          baseBoxLocked: session.box,
          baseCornerA: { x: 0, y: 0 },
          baseCornerB: { x: 0, y: 0 },
          heightCornerA: null,
          heightCornerB: null,
          heightView: null,
          worldCornerA: session.worldCornerA,
          worldCornerB: session.worldCornerB,
          groundY: session.groundY,
        },
      })
      return
    }

    if (!isOrthoView(view)) return

    if (
      primitiveBoxDraft?.phase === 'drawingHeight' &&
      isOrthoView(primitiveBoxDraft.baseView) &&
      view === primitiveBoxDraft.baseView
    ) {
      const session = startPrimitiveBoxSession(view, point, defaultDepth)
      if (!session) return
      set({
        primitiveBoxDraft: {
          phase: 'drawingBase',
          baseView: session.baseView,
          heightAxis: session.heightAxis,
          box: session.box,
          baseBoxLocked: session.box,
          baseCornerA: session.cornerA,
          baseCornerB: session.cornerB,
          heightCornerA: null,
          heightCornerB: null,
          heightView: null,
        },
      })
      return
    }

    if (
      primitiveBoxDraft?.phase === 'drawingHeight' &&
      isOrthoView(primitiveBoxDraft.baseView) &&
      canExtrudeHeightInView(primitiveBoxDraft.baseView, view, primitiveBoxDraft.heightAxis)
    ) {
      set({
        primitiveBoxDraft: {
          ...primitiveBoxDraft,
          heightCornerA: { ...point },
          heightCornerB: { ...point },
          heightView: view,
        },
      })
      return
    }

    const session = startPrimitiveBoxSession(view, point, defaultDepth)
    if (!session) return
    set({
      primitiveBoxDraft: {
        phase: 'drawingBase',
        baseView: session.baseView,
        heightAxis: session.heightAxis,
        box: session.box,
        baseBoxLocked: session.box,
        baseCornerA: session.cornerA,
        baseCornerB: session.cornerB,
        heightCornerA: null,
        heightCornerB: null,
        heightView: null,
      },
    })
  },

  primitiveBoxPointerMove: (point, view, shiftKey, worldPoint) => {
    const { primitiveBoxDraft, defaultDepth } = get()
    if (!primitiveBoxDraft) return

    if (view === 'perspective' && primitiveBoxDraft.baseView === 'perspective') {
      if (
        primitiveBoxDraft.phase !== 'drawingBase' ||
        !worldPoint ||
        !primitiveBoxDraft.worldCornerA ||
        primitiveBoxDraft.groundY === undefined
      ) {
        return
      }
      const groundY = primitiveBoxDraft.groundY
      const cornerB: Vec3 = { x: worldPoint.x, y: groundY, z: worldPoint.z }
      const box = baseBoxFromGroundCorners(
        primitiveBoxDraft.worldCornerA,
        cornerB,
        groundY,
        shiftKey
      )
      set({
        primitiveBoxDraft: {
          ...primitiveBoxDraft,
          worldCornerB: cornerB,
          box,
        },
      })
      return
    }

    if (!isOrthoView(view)) return

    if (
      primitiveBoxDraft.phase === 'drawingBase' &&
      isOrthoView(primitiveBoxDraft.baseView) &&
      view === primitiveBoxDraft.baseView
    ) {
      const box = baseBoxFromPlaneCorners(
        primitiveBoxDraft.baseView,
        primitiveBoxDraft.baseCornerA,
        point,
        defaultDepth,
        shiftKey
      )
      set({
        primitiveBoxDraft: {
          ...primitiveBoxDraft,
          baseCornerB: { ...point },
          box,
        },
      })
      return
    }

    if (
      primitiveBoxDraft.phase === 'drawingHeight' &&
      primitiveBoxDraft.heightCornerA &&
      primitiveBoxDraft.heightView === view &&
      isOrthoView(primitiveBoxDraft.baseView) &&
      canExtrudeHeightInView(primitiveBoxDraft.baseView, view, primitiveBoxDraft.heightAxis)
    ) {
      const box = extrudeBoxOnHeightAxis(
        flattenBoxOnHeightAxis(primitiveBoxDraft.baseBoxLocked, primitiveBoxDraft.heightAxis),
        primitiveBoxDraft.heightAxis,
        view,
        primitiveBoxDraft.heightCornerA,
        point,
        defaultDepth,
        shiftKey
      )
      set({
        primitiveBoxDraft: {
          ...primitiveBoxDraft,
          heightCornerB: { ...point },
          box,
        },
      })
    }
  },

  primitiveBoxPointerUp: (point, view, shiftKey, worldPoint) => {
    const { primitiveBoxDraft, defaultDepth, activePrimitiveKind } = get()
    if (!primitiveBoxDraft || !activePrimitiveKind) return

    if (view === 'perspective' && primitiveBoxDraft.baseView === 'perspective') {
      if (
        primitiveBoxDraft.phase !== 'drawingBase' ||
        !worldPoint ||
        !primitiveBoxDraft.worldCornerA ||
        primitiveBoxDraft.groundY === undefined
      ) {
        return
      }
      const groundY = primitiveBoxDraft.groundY
      const cornerB: Vec3 = { x: worldPoint.x, y: groundY, z: worldPoint.z }
      const footprint = baseBoxFromGroundCorners(
        primitiveBoxDraft.worldCornerA,
        cornerB,
        groundY,
        shiftKey
      )
      const locked = flattenBoxOnHeightAxis(footprint, primitiveBoxDraft.heightAxis)
      const initialHeight = 4
      set({
        primitiveBoxDraft: {
          ...primitiveBoxDraft,
          phase: 'scrollHeight',
          worldCornerB: cornerB,
          baseBoxLocked: locked,
          scrollHeight: initialHeight,
          box: extrudeFlatBoxToHeight(locked, primitiveBoxDraft.heightAxis, initialHeight),
        },
      })
      return
    }

    if (!isOrthoView(view)) return

    if (
      primitiveBoxDraft.phase === 'drawingBase' &&
      isOrthoView(primitiveBoxDraft.baseView) &&
      view === primitiveBoxDraft.baseView
    ) {
      const box = baseBoxFromPlaneCorners(
        primitiveBoxDraft.baseView,
        primitiveBoxDraft.baseCornerA,
        point,
        defaultDepth,
        shiftKey
      )
      const locked = flattenBoxOnHeightAxis(box, primitiveBoxDraft.heightAxis)
      set({
        primitiveBoxDraft: {
          ...primitiveBoxDraft,
          phase: 'drawingHeight',
          baseCornerB: { ...point },
          box: locked,
          baseBoxLocked: locked,
          heightCornerA: null,
          heightCornerB: null,
          heightView: null,
        },
      })
      return
    }

    if (
      primitiveBoxDraft.phase === 'drawingHeight' &&
      primitiveBoxDraft.heightCornerA &&
      primitiveBoxDraft.heightView === view &&
      isOrthoView(primitiveBoxDraft.baseView) &&
      canExtrudeHeightInView(primitiveBoxDraft.baseView, view, primitiveBoxDraft.heightAxis)
    ) {
      const box = extrudeBoxOnHeightAxis(
        flattenBoxOnHeightAxis(primitiveBoxDraft.baseBoxLocked, primitiveBoxDraft.heightAxis),
        primitiveBoxDraft.heightAxis,
        view,
        primitiveBoxDraft.heightCornerA,
        point,
        defaultDepth,
        shiftKey
      )
      set({
        primitiveBoxDraft: {
          ...primitiveBoxDraft,
          heightCornerB: { ...point },
          box,
        },
      })
      get().commitPrimitiveBox()
    }
  },

  adjustPrimitiveBoxWheel: (deltaY) => {
    const { primitiveBoxDraft } = get()
    if (
      !primitiveBoxDraft ||
      primitiveBoxDraft.phase !== 'scrollHeight' ||
      primitiveBoxDraft.baseView !== 'perspective'
    ) {
      return
    }

    const step = deltaY > 0 ? -2 : 2
    const prev = primitiveBoxDraft.scrollHeight ?? 4
    const next = Math.max(0.5, prev + step)
    set({
      primitiveBoxDraft: {
        ...primitiveBoxDraft,
        scrollHeight: next,
        box: extrudeFlatBoxToHeight(
          primitiveBoxDraft.baseBoxLocked,
          primitiveBoxDraft.heightAxis,
          next
        ),
      },
    })
  },

  commitPrimitiveBox: () => {
    const {
      activePrimitiveKind,
      primitiveBoxDraft,
      activeColor,
      polyBudget,
      roundedBoxRoundness,
      roundedBoxSubdivisions,
    } = get()
    if (!activePrimitiveKind || !primitiveBoxDraft) return

    const roundedParams: RoundedBoxParams | undefined =
      activePrimitiveKind === 'roundedBox'
        ? { roundness: roundedBoxRoundness, subdivisions: roundedBoxSubdivisions }
        : undefined

    const obj = primitiveBoxToSceneObject(
      activePrimitiveKind,
      primitiveBoxDraft.box,
      primitiveBoxDraft.heightAxis,
      activeColor,
      polyBudget,
      roundedParams
    )

    if (obj) {
      get().addObject(obj)
    }

    set({ primitiveBoxDraft: null })
  },

  setPolyDrawMode: (mode) => {
    set({
      polyDrawMode: mode,
      activeTool: 'poly-draw',
      polyDrawDraft: null,
      polyDrawHover: null,
      toolCategory: 'draw',
    })
  },

  setPolyDrawSnapAllScene: (on) => set({ polyDrawSnapAllScene: on }),

  polyDrawPointerMove: (world, snapHighlight, hoverSnap) => {
    const { polyDrawDraft } = get()
    set({
      polyDrawHover: { world: { ...world }, snap: hoverSnap },
      ...(polyDrawDraft
        ? {
            polyDrawDraft: {
              ...polyDrawDraft,
              previewWorld: world,
              snapHighlight,
            },
          }
        : {}),
    })
  },

  clearPolyDrawHover: () => set({ polyDrawHover: null }),

  polyDrawClick: (world, snap, view) => {
    const { polyDrawDraft, polyDrawMode } = get()
    const now = performance.now()

    const draft: PolyDrawDraft = polyDrawDraft ?? {
      points: [],
      view,
      previewWorld: null,
      snapHighlight: null,
    }

    const newPoint: PolyDrawDraftPoint = {
      world: { ...world },
      snap: snap ?? undefined,
    }

    const nextPoints = [...draft.points, newPoint]
    const closingPoly =
      polyDrawMode === 'poly' &&
      snap?.kind === 'draft' &&
      snap.draftIndex === 0 &&
      draft.points.length >= 3

    if (closingPoly) {
      set({
        polyDrawDraft: { ...draft, points: draft.points, view },
      })
      get().polyDrawFinish()
      return
    }

    const autoCount = autoFinalizeCount(polyDrawMode)
    const shouldAutoFinish = autoCount !== null && nextPoints.length >= autoCount

    set({
      polyDrawDraft: {
        ...draft,
        points: shouldAutoFinish ? nextPoints : nextPoints,
        view,
        previewWorld: world,
        snapHighlight: null,
      },
      lastPolyDrawClickAt: now,
    })

    if (shouldAutoFinish) {
      get().polyDrawFinish()
    }
  },

  polyDrawCancel: () => set({ polyDrawDraft: null, polyDrawHover: null }),

  polyDrawFinish: () => {
    const { polyDrawDraft, polyDrawMode, objects, activeColor, symmetryEnabled, symmetryAxis, symmetryPlane } =
      get()
    if (!polyDrawDraft || polyDrawDraft.points.length < 3) {
      set({ polyDrawDraft: null })
      return
    }
    if (polyDrawMode === 'quad' && polyDrawDraft.points.length < 4) return
    if (polyDrawMode === 'triangle' && polyDrawDraft.points.length < 3) return

    const result = commitPolyDrawFace(polyDrawDraft.points, objects, {
      mode: polyDrawMode,
      color: activeColor,
    })

    if (!result) {
      set({ polyDrawDraft: null })
      return
    }

    const isNewObject = result.removedIds.length === 0 && !objects.some((o) => o.id === result.primaryId)
    let nextObjects = result.objects

    if (symmetryEnabled && isNewObject) {
      const primary = nextObjects.find((o) => o.id === result.primaryId)
      if (primary) {
        const mirrored = mirrorSceneObject(primary, symmetryAxis, symmetryPlane)
        nextObjects = [...nextObjects, mirrored]
        set({
          objects: nextObjects,
          selectedObjectId: result.primaryId,
          selectionObjectIds: [result.primaryId, mirrored.id],
          polyDrawDraft: null,
          lastPolyDrawFace: {
            objectId: result.primaryId,
            faceStartIndex: result.newFaceStartIndex,
            faceCount: result.newFaceCount,
          },
        })
        get().commitHistory('Poly draw')
        return
      }
    }

    set({
      objects: nextObjects,
      selectedObjectId: result.primaryId,
      selectionObjectIds: [result.primaryId],
      polyDrawDraft: null,
      lastPolyDrawFace: {
        objectId: result.primaryId,
        faceStartIndex: result.newFaceStartIndex,
        faceCount: result.newFaceCount,
      },
    })
    get().commitHistory('Poly draw')
  },

  flipLastPolyDrawFace: () => {
    const { lastPolyDrawFace, objects } = get()
    if (!lastPolyDrawFace) return
    const obj = objects.find((o) => o.id === lastPolyDrawFace.objectId)
    if (!obj) return
    const flipped = flipFacesWinding(
      obj,
      lastPolyDrawFace.faceStartIndex,
      lastPolyDrawFace.faceCount
    )
    get().updateObject(obj.id, { faces: flipped.faces })
    get().commitHistory('Flip face')
  },

  createFaceFromVertexSelection: () => {
    const { meshSelection, objects, selectionMode, activeColor } = get()
    if (selectionMode !== 'vertex' || !meshSelection) return

    const verts = meshSelection.vertices
    if (verts.length !== 3 && verts.length !== 4) return

    const obj = objects.find((o) => o.id === meshSelection.objectId)
    if (!obj || obj.topologyLocked) return

    const result = appendFaceFromVertexIndices(obj, verts, activeColor)
    if (!result) return

    get().updateObject(obj.id, {
      positions: result.object.positions,
      faces: result.object.faces,
      faceColors: result.object.faceColors,
      faceGroups: result.object.faceGroups,
    })

    const newFaces = Array.from(
      { length: result.newFaceCount },
      (_, i) => result.newFaceStartIndex + i
    )
    set({
      meshSelection: {
        objectId: obj.id,
        vertices: [],
        edges: [],
        faces: newFaces,
      },
    })
    get().commitHistory('Create face')
  },

  mergeSelectedVertices: (indices) => {
    const { meshSelection, objects, selectionMode } = get()
    if (selectionMode !== 'vertex' || !meshSelection) return

    const verts = indices ?? meshSelection.vertices
    if (verts.length < 2) return

    const obj = objects.find((o) => o.id === meshSelection.objectId)
    if (!obj || obj.topologyLocked) return

    const result = mergeVertices(obj, verts)
    if (!result) return

    get().updateObject(obj.id, {
      positions: result.object.positions,
      faces: result.object.faces,
      faceColors: result.object.faceColors,
      faceGroups: result.object.faceGroups,
      faceUvIndices: result.object.faceUvIndices,
    })
    set({
      meshSelection: {
        objectId: obj.id,
        vertices: [result.mergedVertexIndex],
        edges: [],
        faces: [],
      },
      vertexMergeModifierHeld: false,
    })
    get().commitHistory('Merge vertices')
  },

  setVertexMergeModifierHeld: (held) => set({ vertexMergeModifierHeld: held }),

  flipSelectedNormals: () => {
    const { meshSelection, objects, selectionMode } = get()
    if (!meshSelection || selectionMode === 'object') return
    const obj = objects.find((o) => o.id === meshSelection.objectId)
    if (!obj || obj.topologyLocked) return
    const flipped = flipSelectionNormals(obj, meshSelection, selectionMode)
    get().updateObject(obj.id, { faces: flipped.faces })
    get().commitHistory('Flip normals')
  },

  transformSelectionInViewPlane: (op) => {
    const {
      activeView,
      viewMoveBasis,
      meshSelection,
      objects,
      selectionObjectIds,
      selectedObjectId,
    } = get()

    const axes = viewScreenAxes(activeView, viewMoveBasis)
    if (!axes) return

    const historyLabel =
      op === 'flipH'
        ? 'Flip horizontal'
        : op === 'flipV'
          ? 'Flip vertical'
          : 'Rotate 90°'

    if (selectionHasComponents(meshSelection)) {
      const obj = objects.find((o) => o.id === meshSelection!.objectId)
      if (!obj || obj.topologyLocked) return
      const verts = getAffectedVertices(meshSelection!, obj)
      const updated = applySelectionPlaneTransform(obj, verts, op, axes, meshSelection)
      get().updateObject(obj.id, { positions: updated.positions, faces: updated.faces })
      get().commitHistory(historyLabel)
      return
    }

    const ids =
      selectionObjectIds.length > 0
        ? selectionObjectIds
        : selectedObjectId
          ? [selectedObjectId]
          : []
    if (ids.length === 0) return

    set((s) => ({
      objects: s.objects.map((o) => {
        if (!ids.includes(o.id) || o.topologyLocked) return o
        const verts = allVertexIndices(o)
        const updated = applySelectionPlaneTransform(o, verts, op, axes)
        return { ...o, positions: updated.positions, faces: updated.faces }
      }),
    }))
    get().commitHistory(historyLabel)
  },

  subdivideSelected: () => {
    const { meshSelection, objects, selectionMode, selectedObjectId } = get()
    const objectId = meshSelection?.objectId ?? selectedObjectId
    if (!objectId) return
    const obj = objects.find((o) => o.id === objectId)
    if (!obj || obj.topologyLocked) return
    const subdivided = subdivideObject(obj, meshSelection, selectionMode)
    get().updateObject(obj.id, {
      positions: subdivided.positions,
      faces: subdivided.faces,
      faceColors: subdivided.faceColors,
      faceGroups: subdivided.faceGroups,
    })
    get().commitHistory('Subdivide')
  },

  toggleSubDSelected: () => {
    const { selectionObjectIds, selectedObjectId, objects } = get()
    const ids =
      selectionObjectIds.length > 0
        ? selectionObjectIds
        : selectedObjectId
          ? [selectedObjectId]
          : []
    if (ids.length === 0) return
    set({
      objects: objects.map((o) => {
        if (!ids.includes(o.id) || o.topologyLocked) return o
        const enabled = !o.subdEnabled
        return {
          ...o,
          subdEnabled: enabled,
          subdLevels: enabled ? clampSubdLevels(o.subdLevels || 1) : o.subdLevels ?? 0,
          smoothShading: enabled ? true : o.smoothShading,
        }
      }),
    })
    get().commitHistory('Toggle SubD')
  },

  setSubDLevelsSelected: (levels) => {
    const { selectionObjectIds, selectedObjectId, objects } = get()
    const ids =
      selectionObjectIds.length > 0
        ? selectionObjectIds
        : selectedObjectId
          ? [selectedObjectId]
          : []
    if (ids.length === 0) return
    const clamped = clampSubdLevels(levels)
    set({
      objects: objects.map((o) => {
        if (!ids.includes(o.id) || o.topologyLocked) return o
        return {
          ...o,
          subdLevels: clamped,
          subdEnabled: clamped > 0,
          smoothShading: clamped > 0 ? true : o.smoothShading,
        }
      }),
    })
  },

  adjustSubDLevelsSelected: (delta) => {
    const { selectionObjectIds, selectedObjectId, objects } = get()
    const ids =
      selectionObjectIds.length > 0
        ? selectionObjectIds
        : selectedObjectId
          ? [selectedObjectId]
          : []
    if (ids.length === 0) return
    set({
      objects: objects.map((o) => {
        if (!ids.includes(o.id) || o.topologyLocked) return o
        const next = clampSubdLevels((o.subdLevels ?? 0) + delta)
        return {
          ...o,
          subdLevels: next,
          subdEnabled: next > 0,
          smoothShading: next > 0 ? true : o.smoothShading,
        }
      }),
    })
    get().commitHistory(delta > 0 ? 'SubD level up' : 'SubD level down')
  },

  applySubDSelected: () => {
    const { selectionObjectIds, selectedObjectId, objects, polyBudget } = get()
    const ids =
      selectionObjectIds.length > 0
        ? selectionObjectIds
        : selectedObjectId
          ? [selectedObjectId]
          : []
    if (ids.length === 0) return
    set({
      objects: objects.map((o) => {
        if (!ids.includes(o.id) || o.topologyLocked) return o
        const requested = o.subdEnabled ? (o.subdLevels ?? 0) : 0
        if (requested <= 0) return o
        const budget = o.polyBudget ?? polyBudget
        const levels = Math.min(
          requested,
          maxSubdLevelsForBudget(budget, o.positions.length)
        )
        if (levels <= 0) return o
        const baked = subdivideSurfaceLevels(o, levels)
        return enforceSceneObjectPolyBudget(
          {
            ...baked,
            subdEnabled: false,
            subdLevels: 0,
            smoothShading: true,
          },
          budget
        )
      }),
    })
    get().commitHistory('Apply SubD')
  },

  loopCutBegin: (objectId, seedEdge) => {
    const obj = get().objects.find((o) => o.id === objectId)
    if (!obj || obj.topologyLocked) return
    if (!isValidLoopSeed(obj, seedEdge)) return
    const loopEdges = findEdgeLoop(obj, seedEdge)
    set({
      loopCutDraft: { objectId, seedEdge, loopEdges, t: 0.5 },
      activeTool: 'loop-cut',
      selectionMode: 'edge',
    })
  },

  loopCutSetT: (t) => {
    const { loopCutDraft } = get()
    if (!loopCutDraft) return
    set({ loopCutDraft: { ...loopCutDraft, t: Math.max(0.01, Math.min(0.99, t)) } })
  },

  loopCutAdjustWheel: (deltaY) => {
    const { loopCutDraft } = get()
    if (!loopCutDraft) return
    const step = deltaY > 0 ? -0.02 : 0.02
    get().loopCutSetT(loopCutDraft.t + step)
  },

  loopCutCommit: () => {
    const { loopCutDraft, objects } = get()
    if (!loopCutDraft) return
    const obj = objects.find((o) => o.id === loopCutDraft.objectId)
    if (!obj || obj.topologyLocked) {
      set({ loopCutDraft: null })
      return
    }
    const cut = insertEdgeLoop(obj, loopCutDraft.loopEdges, loopCutDraft.t)
    get().updateObject(obj.id, {
      positions: cut.positions,
      faces: cut.faces,
      faceColors: cut.faceColors,
    })
    set({ loopCutDraft: null })
    get().commitHistory('Loop cut')
  },

  loopCutCancel: () => set({ loopCutDraft: null }),

  knifePointerDown: (objectId, world, view) => {
    const prev = get().knifeDraft
    const committed =
      prev?.objectId === objectId && prev.committed?.length ? [...prev.committed] : []
    set({
      knifeDraft: {
        objectId,
        start: { ...world },
        end: null,
        committed,
        view,
      },
      activeTool: 'knife',
    })
  },

  knifePointerMove: (world) => {
    const { knifeDraft } = get()
    if (!knifeDraft?.start) return
    set({ knifeDraft: { ...knifeDraft, end: { ...world } } })
  },

  knifeCommit: (viewForward) => {
    const { knifeDraft, objects } = get()
    if (!knifeDraft?.start || !knifeDraft.end || !knifeDraft.objectId) {
      set({ knifeDraft: null })
      return
    }
    const obj = objects.find((o) => o.id === knifeDraft.objectId)
    if (!obj || obj.topologyLocked) {
      set({ knifeDraft: null })
      return
    }

    const localStart = localPointFromWorld(obj, knifeDraft.start)
    const localEnd = localPointFromWorld(obj, knifeDraft.end)
    if (!knifeSegmentLongEnough(localStart, localEnd)) {
      set({ knifeDraft: null })
      return
    }

    const localForward = worldDeltaToLocal(obj, viewForward)
    const cut = knifeCutObject(obj, localStart, localEnd, localForward)
    const committed = [
      ...(knifeDraft.committed ?? []),
      { start: { ...knifeDraft.start }, end: { ...knifeDraft.end } },
    ]
    get().updateObject(obj.id, {
      positions: cut.positions,
      faces: cut.faces,
      faceColors: cut.faceColors,
      faceGroups: cut.faceGroups,
    })
    set({
      knifeDraft: {
        objectId: knifeDraft.objectId,
        start: null,
        end: null,
        committed,
        view: knifeDraft.view,
      },
    })
    get().commitHistory('Knife cut')
  },

  knifeCancel: () => set({ knifeDraft: null }),

  setSymmetryEnabled: (on) => set({ symmetryEnabled: on }),
  toggleSymmetry: () => set((s) => ({ symmetryEnabled: !s.symmetryEnabled })),
  setSymmetryAxis: (axis) => set({ symmetryAxis: axis }),
  setSymmetryPlane: (plane) =>
    set({ symmetryPlane: Number.isFinite(plane) ? plane : 0 }),

  copySelection: () => {
    const { selectionObjectIds, objects } = get()
    if (selectionObjectIds.length === 0) return
    const copied = selectionObjectIds
      .map((id) => objects.find((o) => o.id === id))
      .filter((o): o is SceneObject => o != null)
      .map((o) => cloneSceneObject(o))
    set({ clipboard: copied })
  },

  pasteClipboard: () => {
    const { clipboard } = get()
    if (!clipboard?.length) return
    const offset = 12
    const pasted = clipboard.map((template, index) => {
      const clone = cloneSceneObject(template)
      const tr = ensureTransform(clone)
      return prepareSceneObject({
        ...clone,
        id: generateId(),
        name: `${template.name} copy`,
        transform: {
          ...tr,
          position: {
            x: tr.position.x + offset * (index + 1),
            y: tr.position.y,
            z: tr.position.z,
          },
        },
      })
    })
    set((s) => ({
      objects: [...s.objects, ...pasted],
      selectedObjectId: pasted[pasted.length - 1]?.id ?? null,
      selectionObjectIds: pasted.map((p) => p.id),
    }))
    get().commitHistory('Paste')
  },

  setActiveView: (view) => set({ activeView: view }),

  setViewportSlotView: (index, view) =>
    set((s) => {
      const viewportSlotViews = [...s.viewportSlotViews] as ViewType[]
      viewportSlotViews[index] = view
      return { viewportSlotViews }
    }),

  toggleMaximizedView: () =>
    set((s) => ({
      maximizedView: s.maximizedView ? null : s.activeView,
    })),

  setViewportColSplit: (ratio) =>
    set({ viewportColSplit: Math.min(0.82, Math.max(0.18, ratio)) }),

  setViewportRowSplit: (ratio) =>
    set({ viewportRowSplit: Math.min(0.82, Math.max(0.18, ratio)) }),

  setSidePanelWidth: (width) =>
    set({ sidePanelWidth: Math.min(420, Math.max(176, width)) }),
  setActiveTool: (tool) => {
    const drawInputMode: DrawInputMode =
      tool === 'vector-pen' ? 'vector-pen' : tool === 'draw' ? 'regular' : get().drawInputMode
    if (tool !== 'vector-pen' && tool !== 'draw') {
      get().penCancelPath()
    }
    if (tool !== 'poly-draw') {
      get().polyDrawCancel()
      get().clearPolyDrawHover()
    }
    if (tool !== 'knife') {
      get().knifeCancel()
    }
    if (tool !== 'loop-cut') {
      get().loopCutCancel()
    }
    const toolCategory = categoryForActiveTool(tool, get().toolCategory)
    set({ activeTool: tool, drawInputMode, toolCategory })
  },

  activateToolRingEntry: (category, entry) => {
    const state = get()
    const hasObjectSelection =
      state.selectionObjectIds.length > 0 || !!state.selectedObjectId

    const activateMeshEditTool = (tool: 'knife' | 'loop-cut') => {
      if (!hasObjectSelection) return false
      get().penCancelPath()
      get().polyDrawCancel()
      get().clearPolyDrawHover()
      if (tool !== 'knife') get().knifeCancel()
      if (tool !== 'loop-cut') get().loopCutCancel()
      set({
        activeTool: tool,
        toolCategory: 'mesh',
        drawInputMode: state.drawInputMode,
        ...(tool === 'loop-cut'
          ? { selectionMode: 'edge' as const }
          : {}),
      })
      return true
    }

    switch (entry.kind) {
      case 'tool': {
        if (entry.tool === 'knife' || entry.tool === 'loop-cut') {
          return activateMeshEditTool(entry.tool)
        }
        if (entry.selectionMode) {
          get().setSelectionMode(entry.selectionMode)
          if (entry.tool.startsWith('select-')) return true
        }
        get().setActiveTool(entry.tool)
        set({ toolCategory: categoryForActiveTool(entry.tool, category) })
        return true
      }
      case 'primitive': {
        get().setActivePrimitiveKind(entry.primitive)
        set({ toolCategory: category })
        return true
      }
      case 'shape': {
        get().setActiveShapeKind(entry.shape)
        set({ toolCategory: 'vector' })
        return true
      }
      case 'polyMode': {
        get().penCancelPath()
        get().setPolyDrawMode(entry.mode)
        set({ toolCategory: 'draw' })
        return true
      }
      case 'stroke': {
        get().penCancelPath()
        set({
          strokeMode: entry.mode,
          drawInputMode: 'regular',
          activeTool: 'draw',
          toolCategory: 'draw',
          activePrimitiveKind: null,
          primitiveBoxDraft: null,
          vectorDraft: [],
          vectorIsDrawing: false,
          vectorDraftView: null,
          vectorPenDraft: null,
          currentStroke: [],
          isDrawing: false,
          currentStrokeView: null,
          currentStrokePreview: null,
        })
        return true
      }
      case 'drawInput': {
        get().setDrawInputMode(entry.mode)
        set({ toolCategory: entry.mode === 'vector-pen' ? 'vector' : 'draw' })
        return true
      }
      case 'action': {
        switch (entry.id) {
          case 'extrude': {
            get().penCancelPath()
            set({
              sketchExtrudeMode: true,
              drawInputMode: 'regular',
              activeTool: 'draw',
              toolCategory: 'draw',
              activePrimitiveKind: null,
              primitiveBoxDraft: null,
              vectorDraft: [],
              vectorIsDrawing: false,
              vectorDraftView: null,
              vectorPenDraft: null,
              currentStroke: [],
              isDrawing: false,
              currentStrokeView: null,
              currentStrokePreview: null,
            })
            return true
          }
          case 'select-tool':
            get().activateSelectTool()
            return true
          case 'simplify':
            get().simplifySelected()
            return true
          case 'subdivide':
            get().subdivideSelected()
            return true
          case 'flip-normals':
            get().flipSelectedNormals()
            return true
          case 'subd':
            get().toggleSubDSelected()
            return true
          case 'shade-smooth':
            get().setSelectionSmoothShading(true)
            return true
          case 'shade-flat':
            get().setSelectionSmoothShading(false)
            return true
          case 'uv-editor':
            get().toggleUvEditor()
            return true
          case 'topology-lock':
            get().toggleTopologyLock()
            return true
          case 'export':
            set({ showExportDialog: true })
            return true
          case 'import':
            set({ showExportDialog: true })
            return true
          case 'copy':
            get().copySelection()
            return true
          case 'paste':
            get().pasteClipboard()
            return true
          case 'delete':
            get().deleteSelection()
            return true
          default:
            return false
        }
      }
      default:
        return false
    }
  },
  activateSelectTool: () => {
    const { selectionMode } = get()
    const toolByMode: Record<SelectionMode, ActiveTool> = {
      object: 'select-object',
      vertex: 'select-vertex',
      edge: 'select-edge',
      face: 'select-face',
    }
    get().penCancelPath()
    get().polyDrawCancel()
    get().knifeCancel()
    get().loopCutCancel()
    set({ activeTool: toolByMode[selectionMode], toolCategory: 'select' })
  },
  setToolCategory: (cat) => set({ toolCategory: cat }),
  setSelectionMode: (mode) => {
    const toolByMode: Record<SelectionMode, ActiveTool> = {
      object: 'select-object',
      vertex: 'select-vertex',
      edge: 'select-edge',
      face: 'select-face',
    }
    get().penCancelPath()
    set({
      selectionMode: mode,
      activeTool: toolByMode[mode],
      toolCategory: 'select',
      meshHover: null,
      vertexMergeModifierHeld: false,
      ...(mode === 'object' ? { meshSelection: null } : {}),
    })
  },

  applyMeshPick: (hit, additive = false) => {
    const { selectionMode, meshSelection, objects } = get()
    if (selectionMode === 'object') return

    const obj = objects.find((o) => o.id === hit.objectId)
    if (!obj) return

    if (!get().selectionObjectIds.includes(hit.objectId)) {
      get().selectObject(hit.objectId)
    }

    let next =
      additive && meshSelection?.objectId === hit.objectId
        ? {
            objectId: hit.objectId,
            vertices: [...meshSelection.vertices],
            edges: [...meshSelection.edges],
            faces: [...meshSelection.faces],
          }
        : emptyMeshSelection(hit.objectId)

    if (selectionMode === 'vertex' && hit.vertex !== undefined) {
      const vi = hit.vertex
      const mergeHeld = get().vertexMergeModifierHeld
      if (
        mergeHeld &&
        meshSelection?.objectId === hit.objectId &&
        meshSelection.vertices.length === 1 &&
        meshSelection.vertices[0] !== vi
      ) {
        get().mergeSelectedVertices([meshSelection.vertices[0]!, vi])
        return
      }

      const idx = next.vertices.indexOf(vi)
      if (additive) {
        if (idx >= 0) next.vertices.splice(idx, 1)
        else next.vertices.push(vi)
      } else {
        next.vertices = [vi]
        next.edges = []
        next.faces = []
      }
    } else if (selectionMode === 'edge' && hit.edge) {
      const key = edgeKey(hit.edge[0], hit.edge[1])
      const idx = next.edges.indexOf(key)
      if (additive) {
        if (idx >= 0) next.edges.splice(idx, 1)
        else next.edges.push(key)
      } else {
        next.edges = [key]
        next.vertices = []
        next.faces = []
      }
    } else if (selectionMode === 'face' && hit.face !== undefined) {
      const regionFaces = expandFaceToPlanarRegion(obj, hit.face)
      const allSelected =
        regionFaces.length > 0 && regionFaces.every((fi) => next.faces.includes(fi))
      if (additive) {
        if (allSelected) {
          const remove = new Set(regionFaces)
          next.faces = next.faces.filter((fi) => !remove.has(fi))
        } else {
          const set = new Set(next.faces)
          for (const fi of regionFaces) set.add(fi)
          next.faces = [...set]
        }
      } else {
        next.faces = regionFaces
        next.vertices = []
        next.edges = []
      }
    } else {
      return
    }

    set({
      meshSelection: selectionHasComponents(next) ? next : null,
      ...(get().uvEditorOpen && selectionMode === 'face'
        ? {
            uvEditorSelectedFaces: next.faces.length > 0 ? [...next.faces] : [],
            uvEditorSelectedPoints: [],
          }
        : {}),
    })
  },

  applyMeshMarqueePick: (objectId, components, additive = false) => {
    const { selectionMode, meshSelection } = get()
    if (selectionMode === 'object') return

    if (!get().selectionObjectIds.includes(objectId)) {
      get().selectObject(objectId)
    }

    let next: MeshComponentSelection =
      additive && meshSelection?.objectId === objectId
        ? {
            objectId,
            vertices: [...meshSelection.vertices],
            edges: [...meshSelection.edges],
            faces: [...meshSelection.faces],
          }
        : emptyMeshSelection(objectId)

    if (selectionMode === 'vertex') {
      const set = new Set(additive ? next.vertices : components.vertices)
      if (additive) for (const vi of components.vertices) set.add(vi)
      next.vertices = [...set]
    } else if (selectionMode === 'edge') {
      const set = new Set(additive ? next.edges : components.edges)
      if (additive) for (const key of components.edges) set.add(key)
      next.edges = [...set]
    } else if (selectionMode === 'face') {
      const obj = get().objects.find((o) => o.id === objectId)
      const expanded = obj
        ? expandFacesToPlanarRegions(obj, components.faces)
        : components.faces
      const set = new Set(additive ? next.faces : expanded)
      if (additive) for (const fi of expanded) set.add(fi)
      next.faces = [...set]
    } else {
      return
    }

    set({
      meshSelection: selectionHasComponents(next) ? next : null,
      ...(get().uvEditorOpen && selectionMode === 'face'
        ? {
            uvEditorSelectedFaces: next.faces.length > 0 ? [...next.faces] : [],
            uvEditorSelectedPoints: [],
          }
        : {}),
    })
  },

  clearMeshSelection: () => set({ meshSelection: null }),

  selectAllInMode: () => {
    const { selectionMode, objects, selectedObjectId, selectionObjectIds, meshSelection } = get()

    if (selectionMode === 'object') {
      if (objects.length === 0) return
      get().setSelection(objects.map((o) => o.id))
      return
    }

    const objectId =
      meshSelection?.objectId ??
      selectedObjectId ??
      selectionObjectIds[0] ??
      (objects.length > 0 ? objects[objects.length - 1]!.id : null)
    if (!objectId) return

    const obj = objects.find((o) => o.id === objectId)
    if (!obj) return

    if (!selectionObjectIds.includes(objectId)) {
      get().selectObject(objectId)
    }

    if (selectionMode === 'vertex') {
      set({
        meshSelection: {
          objectId,
          vertices: obj.positions.map((_, i) => i),
          edges: [],
          faces: [],
        },
      })
      return
    }

    if (selectionMode === 'edge') {
      set({
        meshSelection: {
          objectId,
          vertices: [],
          edges: collectUniqueEdges(obj).map(([a, b]) => edgeKey(a, b)),
          faces: [],
        },
      })
      return
    }

    set({
      meshSelection: {
        objectId,
        vertices: [],
        edges: [],
        faces: obj.faces.map((_, i) => i),
      },
    })
  },

  deselectAllInMode: () => {
    if (get().selectionMode === 'object') {
      get().clearSelection()
    } else {
      get().clearMeshSelection()
    }
  },

  deleteSelection: () => {
    const { selectionMode, selectionObjectIds, meshSelection, objects } = get()

    if (
      selectionMode !== 'object' &&
      meshSelection &&
      selectionHasComponents(meshSelection)
    ) {
      const obj = objects.find((o) => o.id === meshSelection.objectId)
      if (!obj || obj.topologyLocked) return

      const faceIndices = collectFacesToDelete(obj, meshSelection, selectionMode)
      if (faceIndices.size === 0) return

      const updated = deleteFacesFromObject(obj, faceIndices)

      if (!updated) {
        set((s) => {
          const removed = new Set([obj.id])
          const { objectTextures, pixelDocuments } = purgeTextureResourcesForObjects(
            s.objects,
            removed,
            s.objectTextures,
            s.pixelDocuments
          )
          return {
            objects: s.objects.filter((o) => o.id !== obj.id),
            selectedObjectId:
              s.selectedObjectId === obj.id ? null : s.selectedObjectId,
            selectionObjectIds: s.selectionObjectIds.filter((id) => id !== obj.id),
            objectTextures,
            pixelDocuments,
            meshSelection: null,
          }
        })
        textureLoadGeneration.delete(obj.id)
        reconcileAppBlobUrls(get)
      } else {
        set((s) => ({
          objects: s.objects.map((o) => (o.id === obj.id ? updated : o)),
          meshSelection: null,
        }))
      }
      get().commitHistory('Delete faces')
      return
    }

    if (selectionObjectIds.length === 0) return

    const ids = new Set(selectionObjectIds)
    set((s) => {
      const { objectTextures, pixelDocuments } = purgeTextureResourcesForObjects(
        s.objects,
        ids,
        s.objectTextures,
        s.pixelDocuments
      )
      for (const id of ids) {
        textureLoadGeneration.delete(id)
        invalidateFaceGroupCache(id)
      }
      return {
        objects: s.objects.filter((o) => !ids.has(o.id)),
        selectedObjectId: null,
        selectionObjectIds: [],
        meshSelection: null,
        objectTextures,
        pixelDocuments,
      }
    })
    reconcileAppBlobUrls(get)
    get().commitHistory('Delete selection')
  },

  applyMeshModalPreview: () => {
    const modal = get().meshModal
    if (!modal) return

    const result = applyMeshModalOp(
      modal.baseObject,
      modal.selection,
      modal.selectionMode,
      modal.op,
      modal.value,
      modal.pivotWorld
    )

    get().updateObject(modal.objectId, {
      positions: result.positions,
      faces: result.faces,
      faceColors: result.faceColors,
    })
  },

  beginMeshModal: (op, clientX, clientY) => {
    const { meshSelection, objects, selectionMode } = get()
    if (!meshSelection || !selectionHasComponents(meshSelection)) return
    if (get().meshModal) get().cancelMeshModal()
    if (get().objectTransformModal) get().cancelObjectTransformModal()

    const obj = objects.find((o) => o.id === meshSelection.objectId)
    if (!obj || obj.topologyLocked) return

    get().captureUndoPoint('Mesh edit')
    const pivotWorld = meshSelectionWorldCenter(obj, meshSelection)

    set({
      meshModal: {
        op,
        objectId: obj.id,
        baseObject: cloneSceneObject(obj),
        selection: {
          objectId: meshSelection.objectId,
          vertices: [...meshSelection.vertices],
          edges: [...meshSelection.edges],
          faces: [...meshSelection.faces],
        },
        selectionMode,
        value: op === 'scale' ? 1 : 0,
        startClientX: clientX,
        startClientY: clientY,
        pivotWorld,
      },
    })
    get().applyMeshModalPreview()
  },

  updateMeshModalFromPointer: (clientX, clientY) => {
    const modal = get().meshModal
    if (!modal) return

    const value = modalValueFromMouseDelta(
      modal.op,
      clientX - modal.startClientX,
      modal.startClientY - clientY
    )

    set({ meshModal: { ...modal, value } })
    get().applyMeshModalPreview()
  },

  adjustMeshModalWheel: (deltaY) => {
    const modal = get().meshModal
    if (!modal) return

    const value = modalValueFromWheel(modal.op, modal.value, deltaY)
    set({ meshModal: { ...modal, value } })
    get().applyMeshModalPreview()
  },

  confirmMeshModal: () => {
    get().replaceHistoryHead('Mesh edit')
    set({ meshModal: null })
  },

  cancelMeshModal: () => {
    if (!get().meshModal) return
    get().pauseHistory()
    get().undo()
    get().resumeHistory()
    set({ meshModal: null })
  },

  applyObjectTransformModalPreview: () => {
    const modal = get().objectTransformModal
    if (!modal) return

    set((s) => ({
      objects: s.objects.map((o) => {
        if (!modal.objectIds.includes(o.id)) return o
        const base = modal.baseTransforms[o.id]
        if (!base) return o
        return {
          ...o,
          transform: applyObjectTransformModal(
            base,
            modal.op,
            modal.value,
            modal.pivotWorld
          ),
        }
      }),
    }))
  },

  beginObjectTransformModal: (op, clientX, clientY) => {
    const { selectionObjectIds, selectionMode, objects } = get()
    if (selectionMode !== 'object' || selectionObjectIds.length === 0) return
    if (get().objectTransformModal) get().cancelObjectTransformModal()
    if (get().meshModal) get().cancelMeshModal()

    const baseTransforms: Record<string, ObjectTransform> = {}
    for (const id of selectionObjectIds) {
      const obj = objects.find((o) => o.id === id)
      if (!obj) continue
      baseTransforms[id] = cloneTransform(ensureTransform(obj))
    }
    if (Object.keys(baseTransforms).length === 0) return

    get().captureUndoPoint('Transform')
    set({
      objectTransformModal: {
        op,
        objectIds: [...selectionObjectIds],
        baseTransforms,
        pivotWorld: selectionWorldCenter(objects, selectionObjectIds),
        value: op === 'scale' ? 1 : 0,
        startClientX: clientX,
        startClientY: clientY,
      },
      activeTool: op === 'rotate' ? 'rotate' : 'scale',
      toolCategory: 'transform',
    })
    get().applyObjectTransformModalPreview()
  },

  updateObjectTransformModalFromPointer: (clientX, clientY) => {
    const modal = get().objectTransformModal
    if (!modal) return

    const value = modalValueFromMouseDelta(
      modal.op,
      clientX - modal.startClientX,
      modal.startClientY - clientY
    )

    set({ objectTransformModal: { ...modal, value } })
    get().applyObjectTransformModalPreview()
  },

  adjustObjectTransformModalWheel: (deltaY) => {
    const modal = get().objectTransformModal
    if (!modal) return

    const value = modalValueFromWheel(modal.op, modal.value, deltaY)
    set({ objectTransformModal: { ...modal, value } })
    get().applyObjectTransformModalPreview()
  },

  confirmObjectTransformModal: () => {
    get().replaceHistoryHead('Transform')
    set({ objectTransformModal: null })
  },

  cancelObjectTransformModal: () => {
    if (!get().objectTransformModal) return
    get().pauseHistory()
    get().undo()
    get().resumeHistory()
    set({ objectTransformModal: null })
  },

  setMeshHover: (hit) => set({ meshHover: hit }),

  translateMeshSelection: (deltaWorld, basePositions) => {
    const { meshSelection, objects } = get()
    if (!meshSelection) return

    const obj = objects.find((o) => o.id === meshSelection.objectId)
    if (!obj || obj.topologyLocked) return

    const verts = getAffectedVertices(meshSelection, obj)
    if (verts.size === 0) return

    const localDelta = worldDeltaToLocal(obj, deltaWorld)
    const positions = translateVertexPositions(obj, verts, basePositions, localDelta)
    get().updateObject(obj.id, { positions })
  },
  setStrokeMode: (mode) => {
    if (get().drawInputMode === 'regular') {
      set({ strokeMode: mode, drawInputMode: 'regular', activeTool: 'draw' })
    } else {
      set({ strokeMode: mode })
    }
  },

  setDrawInputMode: (mode) => {
    get().penCancelPath()
    set({
      drawInputMode: mode,
      activeTool: mode === 'regular' ? 'draw' : 'vector-pen',
      activePrimitiveKind: null,
      primitiveBoxDraft: null,
      vectorDraft: [],
      vectorIsDrawing: false,
      vectorDraftView: null,
      currentStroke: [],
      isDrawing: false,
      currentStrokeView: null,
      currentStrokePreview: null,
    })
  },

  setAutoConnectPaths: (on) => set({ autoConnectPaths: on }),
  toggleAutoConnectPaths: () => set((s) => ({ autoConnectPaths: !s.autoConnectPaths })),

  setShowGrid: (show) => set({ showGrid: show }),

  setSelectionSmoothShading: (smooth) => {
    const { selectionObjectIds, selectedObjectId, objects } = get()
    const ids =
      selectionObjectIds.length > 0
        ? selectionObjectIds
        : selectedObjectId
          ? [selectedObjectId]
          : []
    if (ids.length === 0) return

    const idSet = new Set(ids)
    const targets = ids
      .map((id) => objects.find((o) => o.id === id))
      .filter((o): o is SceneObject => o != null)
    if (targets.every((o) => o.smoothShading === smooth)) return

    set((s) => ({
      objects: s.objects.map((o) => (idSet.has(o.id) ? { ...o, smoothShading: smooth } : o)),
    }))
    get().commitHistory(smooth ? 'Shade smooth' : 'Shade flat')
  },

  toggleSmoothShading: () => {
    const { selectionObjectIds, selectedObjectId, objects } = get()
    const ids =
      selectionObjectIds.length > 0
        ? selectionObjectIds
        : selectedObjectId
          ? [selectedObjectId]
          : []
    if (ids.length === 0) return

    const targets = ids
      .map((id) => objects.find((o) => o.id === id))
      .filter((o): o is SceneObject => o != null)
    if (targets.length === 0) return

    const allSmooth = targets.every((o) => o.smoothShading)
    get().setSelectionSmoothShading(!allSmooth)
  },

  shadeSmoothSelected: () => {
    get().setSelectionSmoothShading(true)
  },

  shadeFlatSelected: () => {
    get().setSelectionSmoothShading(false)
  },

  setPolyBudget: (budget) => set({ polyBudget: budget }),
  setBrushDensity: (density) => set({ brushDensity: density }),
  setBrushStrength: (strength) => set({ brushStrength: strength }),
  setBrushRadius: (radius) => set({ brushRadius: radius }),
  setActiveColor: (color) => {
    const state = get()
    const { selectionMode, meshSelection, objects, selectedObjectId, selectionObjectIds } =
      state
    const rgba = numberToRgba4(color)
    const targetIds = resolveTargetObjectIds(selectedObjectId, selectionObjectIds)

    const hasComponentSelection =
      meshSelection != null &&
      selectionMode !== 'object' &&
      ((selectionMode === 'face' && meshSelection.faces.length > 0) ||
        (selectionMode === 'vertex' && meshSelection.vertices.length > 0) ||
        (selectionMode === 'edge' && meshSelection.edges.length > 0))

    if (hasComponentSelection) {
      const obj = objects.find((o) => o.id === meshSelection!.objectId)
      if (!obj || obj.topologyLocked) {
        set({ activeColor: color })
        return
      }

      set({ activeColor: color })
      const opacity = ensureObjectMaterial(obj).material?.opacity ?? 1
      const rgbaWithAlpha = numberToRgba4(color, opacity)
      const refs = resolveColorCornersForSelection(obj, selectionMode, meshSelection, false)
      const needsUpdate =
        ensureObjectMaterial(obj).material!.mode === 'texture' ||
        refs.some((ref) => {
          const fi = ref.faceIndex
          const ci = ref.cornerIndex
          const poolIdx = obj.faceColorIndices?.[fi]?.[ci]
          const corner =
            poolIdx !== undefined ? obj.cornerColors?.[poolIdx] : undefined
          if (corner) return !rgba4Equal(corner, rgbaWithAlpha)
          return (obj.faceColors[fi] ?? obj.color) !== color
        })

      if (!needsUpdate) return

      set({
        objects: paintColorOnObjects(
          objects,
          [obj.id],
          selectionMode,
          meshSelection,
          true,
          rgbaWithAlpha
        ).map((o) =>
          o.id === obj.id ? { ...o, color: rgba4ToNumber(rgbaWithAlpha) } : o
        ),
      })
      get().commitHistory('Recolor')
      return
    }

    if (targetIds.length === 0) {
      set({ activeColor: color })
      return
    }

    const paintIds = targetIds.filter((id) => {
      const obj = objects.find((o) => o.id === id)
      return obj && !obj.topologyLocked
    })

    set({ activeColor: color })
    if (paintIds.length === 0) return

    const needsUpdate = paintIds.some((id) => {
      const obj = objects.find((o) => o.id === id)
      return obj && objectNeedsRecolor(obj, color, rgba)
    })
    if (!needsUpdate) return

    set({
      objects: paintColorOnObjects(
        objects,
        paintIds,
        'object',
        null,
        false,
        rgba
      ).map((o) => (paintIds.includes(o.id) ? { ...o, color } : o)),
    })
    get().commitHistory('Recolor')
  },
  setFacetExaggeration: (value) => set({ facetExaggeration: value }),
  setShowDensityHeatmap: (show) => set({ showDensityHeatmap: show }),
  setViewportDisplayMode: (mode) => set({ viewportDisplayMode: mode }),
  setViewportXRay: (enabled) => set({ viewportXRay: enabled }),
  setThemeId: (id) => {
    applyTheme(id)
    try {
      localStorage.setItem(THEME_STORAGE_KEY, id)
    } catch {
      /* ignore */
    }
    const accent = hexToNumber(getTheme(id).css['--accent'])
    set({ themeId: id, activeColor: accent })
  },
  toggleTopologyLock: () => {
    const { selectedObjectId, objects } = get()
    if (!selectedObjectId) return
    const obj = objects.find((o) => o.id === selectedObjectId)
    if (!obj) return
    get().updateObject(selectedObjectId, { topologyLocked: !obj.topologyLocked })
  },
  setShowToolRing: (show) => set({ showToolRing: show }),
  setShowExportDialog: (show) => set({ showExportDialog: show }),

  requestProjectLoad: () => {
    void get().loadProjectFromDialog()
  },

  loadProjectFromDialog: async () => {
    const state = get()
    const hasContent =
      state.objects.length > 0 ||
      state.referenceImages.length > 0 ||
      state.billboardImages.length > 0 ||
      Object.keys(state.pixelDocuments).length > 0
    if (hasContent && !window.confirm('Discard the current project? Unsaved changes will be lost.')) {
      return false
    }

    const file = await pickOpenFile({
      title: 'Open project',
      filters: PROJECT_FILE_FILTERS,
    })
    if (!file) return false

    await get().loadProjectFile(file)
    return true
  },

  newProject: () => {
    const empty = emptySceneSnapshot()
    sceneHistory.reset(empty)
    restoreSceneToStore(set, get, empty, {
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
    return saveProjectFile(snapshotFromState(get()), DEFAULT_PROJECT_FILENAME)
  },

  loadProjectFile: async (file) => {
    const text = await file.text()
    const parsed = parseProjectFile(text)
    const snapshot = await snapshotFromProjectFile(parsed)
    sceneHistory.reset(snapshot)
    restoreSceneToStore(set, get, snapshot, { resetEditors: true })
  },

  importSceneFile: async (file) => {
    const imported = await importSceneFromFile(file)
    if (imported.length === 0) {
      throw new Error('No meshes found in file')
    }

    const { polyBudget } = get()
    const cap = importVertexCap(polyBudget)
    const prepared = imported.map((obj) =>
      enforceSceneObjectPolyBudget(prepareSceneObject(obj), cap)
    )
    set((s) => ({
      objects: [...s.objects, ...prepared],
      selectedObjectId: prepared[0].id,
      selectionObjectIds: prepared.map((o) => o.id),
      meshSelection: null,
    }))
    get().commitHistory('Import')
    return prepared.length
  },

  setImageDropMode: (mode) => set({ imageDropMode: mode }),

  dropImageInView: async (view, file, world, referenceNorm) => {
    const mode = get().imageDropMode
    if (mode === 'off') return

    const loaded = await loadImageFile(file)
    const aspect = loaded.width / Math.max(loaded.height, 1)

    if (mode === 'reference') {
      const id = generateId()
      set((s) => ({
        referenceImages: [
          ...s.referenceImages,
          {
            id,
            view,
            url: loaded.url,
            name: loaded.name,
            x: referenceNorm.x,
            y: referenceNorm.y,
            width: DEFAULT_REFERENCE_WIDTH,
            aspect,
            opacity: 0.55,
          },
        ],
        selectedReferenceImageId: id,
        selectedBillboardImageId: null,
      }))
      reconcileAppBlobUrls(get)
      get().commitHistory('Reference image')
      return
    }

    if (mode === 'billboard') {
      const id = generateId()
      set((s) => ({
        billboardImages: [
          ...s.billboardImages,
          {
            id,
            url: loaded.url,
            name: loaded.name,
            position: { ...world },
            rotation: { x: 0, y: 0, z: 0 },
            width: DEFAULT_IMAGE_WORLD_WIDTH,
            height: DEFAULT_IMAGE_WORLD_WIDTH / aspect,
            opacity: 0.92,
          },
        ],
        selectedBillboardImageId: id,
        selectedReferenceImageId: null,
      }))
      reconcileAppBlobUrls(get)
      get().commitHistory('Billboard image')
      return
    }

    if (mode === 'textured-plane') {
      const obj = createTexturedPlaneObject(
        loaded.name,
        view,
        world,
        DEFAULT_IMAGE_WORLD_WIDTH,
        aspect
      )
      const prepared = prepareSceneObject(obj)
      set((s) => ({
        objectTextures: {
          ...s.objectTextures,
          [prepared.id]: {
            url: loaded.url,
            name: loaded.name,
            width: loaded.width,
            height: loaded.height,
          },
        },
        selectedReferenceImageId: null,
        selectedBillboardImageId: null,
      }))
      get().addObject(prepared, { skipHistory: true, skipSymmetry: true })
      reconcileAppBlobUrls(get)
      get().commitHistory('Image plane')
    }
  },

  selectReferenceImage: (id) =>
    set({
      selectedReferenceImageId: id,
      selectedBillboardImageId: null,
      ...(id
        ? {
            selectedObjectId: null,
            selectionObjectIds: [],
            meshSelection: null,
          }
        : {}),
    }),

  updateReferenceImage: (id, patch) =>
    set((s) => ({
      referenceImages: s.referenceImages.map((img) =>
        img.id === id ? { ...img, ...patch } : img
      ),
    })),

  commitReferenceImageEdit: () => {
    if (get().referenceImages.length === 0) return
    get().commitHistory('Edit reference image')
  },

  removeReferenceImage: (id) => {
    const img = get().referenceImages.find((r) => r.id === id)
    if (!img) return
    set((s) => ({
      referenceImages: s.referenceImages.filter((r) => r.id !== id),
      selectedReferenceImageId:
        s.selectedReferenceImageId === id ? null : s.selectedReferenceImageId,
    }))
    reconcileAppBlobUrls(get)
    get().commitHistory('Remove reference image')
  },

  selectBillboardImage: (id) =>
    set({
      selectedBillboardImageId: id,
      selectedReferenceImageId: null,
      ...(id
        ? {
            selectedObjectId: null,
            selectionObjectIds: [],
            meshSelection: null,
          }
        : {}),
    }),

  updateBillboardImage: (id, patch) =>
    set((s) => ({
      billboardImages: s.billboardImages.map((bb) =>
        bb.id === id ? { ...bb, ...patch } : bb
      ),
    })),

  commitBillboardImageEdit: () => {
    if (get().billboardImages.length === 0) return
    get().commitHistory('Edit billboard')
  },

  removeBillboardImage: (id) => {
    const bb = get().billboardImages.find((b) => b.id === id)
    if (!bb) return
    set((s) => ({
      billboardImages: s.billboardImages.filter((b) => b.id !== id),
      selectedBillboardImageId:
        s.selectedBillboardImageId === id ? null : s.selectedBillboardImageId,
    }))
    reconcileAppBlobUrls(get)
    get().commitHistory('Remove billboard')
  },

  deleteSelectedImageDrop: () => {
    const { selectedReferenceImageId, selectedBillboardImageId } = get()
    if (selectedReferenceImageId) {
      get().removeReferenceImage(selectedReferenceImageId)
      return
    }
    if (selectedBillboardImageId) {
      get().removeBillboardImage(selectedBillboardImageId)
    }
  },

  setUvEditorOpen: (open) => {
    if (!open) {
      set({ uvEditorOpen: false })
      return
    }
    const state = get()
    const objectId = state.selectedObjectId ?? state.selectionObjectIds[0]
    if (objectId) {
      const obj = state.objects.find((o) => o.id === objectId)
      if (obj) get().updateObject(objectId, ensureObjectUVs(obj))
    }
    const meshFaces =
      objectId &&
      state.meshSelection?.objectId === objectId &&
      state.meshSelection.faces.length > 0
        ? (() => {
            const obj = state.objects.find((o) => o.id === objectId)
            const faces = [...state.meshSelection!.faces]
            return obj && state.uvEditorSticky
              ? expandFacesToPlanarRegions(obj, faces)
              : faces
          })()
        : []
    set({
      uvEditorOpen: true,
      uvEditorPanel: { ...state.uvEditorPanel, minimized: false },
      uvEditorMode: 'faces',
      selectionMode: 'face',
      activeTool: 'select-face',
      toolCategory: 'select',
      uvEditorSelectedPoints: [],
      uvEditorSelectedFaces: meshFaces,
      uvEditorViewAll: meshFaces.length === 0,
    })
  },
  toggleUvEditor: () => {
    const { uvEditorOpen, uvEditorPanel, selectedObjectId, selectionObjectIds } = get()
    if (!uvEditorOpen && !selectedObjectId && selectionObjectIds.length === 0) return
    if (uvEditorOpen && uvEditorPanel.minimized) {
      set({
        uvEditorPanel: { ...uvEditorPanel, minimized: false },
        uvEditorMode: 'faces',
        selectionMode: 'face',
        activeTool: 'select-face',
        toolCategory: 'select',
      })
      return
    }
    if (!uvEditorOpen) {
      get().setUvEditorOpen(true)
      return
    }
    set({ uvEditorOpen: false })
  },
  setUvEditorPanel: (panel) => set({ uvEditorPanel: panel }),
  setUvEditorGridDivisions: (n) => set({ uvEditorGridDivisions: Math.max(1, n) }),
  setUvEditorSnap: (on) => set({ uvEditorSnap: on }),
  setUvEditorSnapMode: (mode) => set({ uvEditorSnapMode: mode }),
  setUvEditorSmartUvAngle: (deg) =>
    set({ uvEditorSmartUvAngle: Math.max(1, Math.min(180, Math.round(deg))) }),
  setUvEditorMode: (mode) => set({ uvEditorMode: mode }),
  setUvEditorSelectedPoints: (indices) => set({ uvEditorSelectedPoints: indices }),
  setUvEditorSelectedFaces: (indices) => set({ uvEditorSelectedFaces: indices }),

  selectUvFaces: (objectId, faceIndices) => {
    const state = get()
    const obj = state.objects.find((o) => o.id === objectId)
    const expanded =
      state.uvEditorSticky && obj
        ? expandFacesToPlanarRegions(obj, faceIndices)
        : faceIndices
    set({
      uvEditorSelectedFaces: expanded,
      uvEditorSelectedPoints: [],
      selectionMode: 'face',
      selectedObjectId: objectId,
      selectionObjectIds: [objectId],
      meshSelection:
        expanded.length > 0
          ? { objectId, vertices: [], edges: [], faces: expanded }
          : null,
    })
  },

  setUvEditorView: (zoom, panX, panY) =>
    set({ uvEditorZoom: zoom, uvEditorPanX: panX, uvEditorPanY: panY }),
  setUvEditorShowGrid: (on) => set({ uvEditorShowGrid: on }),
  setUvEditorTilePreview: (on) => set({ uvEditorTilePreview: on }),
  setUvEditorViewAll: (on) => set({ uvEditorViewAll: on }),
  setUvEditorAutoFit: (on) => set({ uvEditorAutoFit: on }),
  setUvEditorSticky: (on) => set({ uvEditorSticky: on }),

  toggleMaterialEditor: () => {
    const {
      materialEditorOpen,
      materialEditorPanel,
      selectedObjectId,
      selectionObjectIds,
      objects,
    } = get()
    if (!materialEditorOpen && !selectedObjectId && selectionObjectIds.length === 0) return
    if (materialEditorOpen && materialEditorPanel.minimized) {
      set({ materialEditorPanel: { ...materialEditorPanel, minimized: false } })
      return
    }
    if (!materialEditorOpen) {
      const ids = resolveTargetObjectIds(selectedObjectId, selectionObjectIds)
      const synced = syncEditorColorFromSelection(objects, ids)
      set({
        materialEditorOpen: true,
        materialEditorPanel: { ...materialEditorPanel, minimized: false },
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
      objects: s.objects.map((o) =>
        idSet.has(o.id) ? setObjectMaterialMode(o, mode, o.id) : o
      ),
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
    })
  },

  setPixelEditorPanel: (panel) => set({ pixelEditorPanel: panel }),
  setPixelEditorSelection: (selection) => set({ pixelEditorSelection: selection }),
  setPixelEditorTool: (tool) => set({ pixelEditorTool: tool }),
  setPixelEditorBrushSize: (size) =>
    set({ pixelEditorBrushSize: Math.max(1, Math.min(32, Math.round(size))) }),
  setPixelEditorPixelPerfect: (on) => set({ pixelEditorPixelPerfect: on }),
  setPixelEditorSymmetryH: (on) => set({ pixelEditorSymmetryH: on }),
  setPixelEditorSymmetryV: (on) => set({ pixelEditorSymmetryV: on }),
  setPixelEditorPaintOnModel: (on) => set({ pixelEditorPaintOnModel: on }),
  setPixelEditorShapeFilled: (on) => set({ pixelEditorShapeFilled: on }),
  setPixelEditorView: (zoom, panX, panY) =>
    set({ pixelEditorZoom: zoom, pixelEditorPanX: panX, pixelEditorPanY: panY }),
  setPixelEditorFillTolerance: (t) =>
    set({ pixelEditorFillTolerance: Math.max(0, Math.min(255, Math.round(t))) }),

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

  exportPixelDocumentProject: () => {
    get().savePixelDocument()
  },

  importPixelDocumentProject: async (file) => {
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

  paintPixelStroke: (points, tool = 'pencil') => {
    const {
      pixelEditorDocId,
      pixelDocuments,
      pixelEditorColor,
      pixelEditorBrushSize,
      pixelEditorPixelPerfect,
      pixelEditorSymmetryH,
      pixelEditorSymmetryV,
    } = get()
    if (!pixelEditorDocId || points.length === 0) return
    const docs = paintStrokeOnDocument(
      pixelDocuments,
      pixelEditorDocId,
      points,
      pixelEditorColor,
      pixelEditorBrushSize,
      tool,
      pixelEditorPixelPerfect,
      pixelEditorSymmetryH,
      pixelEditorSymmetryV
    )
    set({ pixelDocuments: docs })
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
      pixelEditorSymmetryH,
      pixelEditorSymmetryV,
      pixelEditorTool,
    } = get()
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
      pixelEditorSymmetryV
    )
    set((s) => ({ pixelDocuments: docs, pixelTextureRevision: s.pixelTextureRevision + 1 }))
  },

  paintOnModelStroke: (docId, points) => {
    const {
      pixelDocuments,
      pixelEditorColor,
      pixelEditorBrushSize,
      pixelEditorPixelPerfect,
      pixelEditorSymmetryH,
      pixelEditorSymmetryV,
      pixelEditorTool,
    } = get()
    if (points.length === 0) return
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
      pixelEditorSymmetryV
    )
    set((s) => ({ pixelDocuments: docs, pixelTextureRevision: s.pixelTextureRevision + 1 }))
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

  setObjectUvMappingMode: (objectId, mode) => {
    const { objects, updateObject } = get()
    const obj = objects.find((o) => o.id === objectId)
    if (!obj || resolveUvMappingMode(obj) === mode) return
    const mapped = assignUvMappingForMode(obj, mode, mode === 'perFace')
    updateObject(objectId, {
      uvs: mapped.uvs,
      faceUvIndices: mapped.faceUvIndices,
      uvMappingMode: mode,
    })
    get().commitHistory('UV mapping mode')
  },

  loadObjectTexture: async (objectId, file) => {
    const generation = (textureLoadGeneration.get(objectId) ?? 0) + 1
    textureLoadGeneration.set(objectId, generation)
    const url = URL.createObjectURL(file)
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image()
        el.onload = () => resolve(el)
        el.onerror = () => reject(new Error('Failed to load image'))
        el.src = url
      })

      if (textureLoadGeneration.get(objectId) !== generation) {
        URL.revokeObjectURL(url)
        return
      }

      const { objects, updateObject } = get()
      const obj = objects.find((o) => o.id === objectId)
      if (!obj) {
        URL.revokeObjectURL(url)
        return
      }

      const withUvs = ensureObjectUVs(obj)
      const hadUvs = Boolean(obj.uvs?.length)

      const { docs, docId } = await importImageAsNewDocument(get().pixelDocuments, file)
      updateObject(objectId, {
        ...setObjectMaterialMode(withUvs, 'texture', docId),
        uvs: withUvs.uvs,
        faceUvIndices: withUvs.faceUvIndices,
      })

      URL.revokeObjectURL(url)
      releaseTextureUrl(url)

      set((s) => ({
        pixelDocuments: docs,
        pixelEditorDocId: docId,
        objectTextures: {
          ...s.objectTextures,
          [docId]: {
            url: '',
            name: file.name,
            width: img.naturalWidth,
            height: img.naturalHeight,
          },
        },
        pixelTextureRevision: s.pixelTextureRevision + 1,
      }))
      reconcileAppBlobUrls(get)
      if (!hadUvs) get().commitHistory('Import texture')
    } catch {
      URL.revokeObjectURL(url)
      releaseTextureUrl(url)
    }
  },

  assignObjectTextureDocument: (objectId, docId, options) => {
    const state = get()
    const obj = state.objects.find((o) => o.id === objectId)
    if (!obj) return
    const doc = state.pixelDocuments[docId]
    if (!doc) return

    const mat = resolveEffectiveMaterial(obj)
    if (mat.mode === 'texture' && (mat.textureId ?? obj.id) === docId) return

    const withUvs = ensureObjectUVs(obj)
    get().updateObject(objectId, {
      ...setObjectMaterialMode(withUvs, 'texture', docId),
      uvs: withUvs.uvs,
      faceUvIndices: withUvs.faceUvIndices,
    })

    const meta = state.objectTextures[docId]
    set((s) => ({
      pixelEditorDocId: docId,
      pixelTextureRevision: s.pixelTextureRevision + 1,
      ...(meta
        ? {}
        : {
            objectTextures: {
              ...s.objectTextures,
              [docId]: {
                url: '',
                name: doc.layers[0]?.name ?? 'Texture',
                width: doc.width,
                height: doc.height,
              },
            },
          }),
    }))
    if (!options?.skipHistory) get().commitHistory('Assign texture')
  },

  getFaceUVs: (objectId, faceIndex) => {
    const obj = get().objects.find((o) => o.id === objectId)
    if (!obj) return []
    const ensured = ensureObjectUVs(obj)
    const idx = ensured.faceUvIndices[faceIndex] ?? []
    return idx.map((i) => cloneUv2(ensured.uvs[i]))
  },

  setObjectUvPoint: (objectId, uvIndex, u, v, saveHistory = false) => {
    get().setObjectUvPoints(objectId, [{ uvIndex, u, v }], saveHistory)
  },

  setObjectUvPoints: (objectId, updates, saveHistory = false) => {
    if (updates.length === 0) return
    const { objects } = get()
    const obj = objects.find((o) => o.id === objectId)
    if (!obj) return
    const base = obj.uvs?.length ? obj : ensureObjectUVs(obj)
    const updated = setUvPoints(base, updates)
    set((s) => ({
      objects: s.objects.map((o) => (o.id === objectId ? updated : o)),
    }))
    if (saveHistory) get().commitHistory('Edit UV')
  },

  transformSelectedUvIslands: (op) => {
    const {
      objects,
      selectedObjectId,
      meshSelection,
      uvEditorSelectedPoints,
      uvEditorSelectedFaces,
    } = get()
    const objectId = selectedObjectId ?? meshSelection?.objectId
    if (!objectId) return
    const obj = objects.find((o) => o.id === objectId)
    if (!obj) return

    if (op === 'autoUv') {
      get().unwrapSelectedUvFaces('auto')
      return
    }

    let faceIndices: number[] = []
    if (uvEditorSelectedFaces.length > 0) {
      faceIndices = [...uvEditorSelectedFaces]
    } else if (meshSelection?.objectId === objectId && meshSelection.faces.length > 0) {
      faceIndices = [...meshSelection.faces]
    } else {
      faceIndices = obj.faces.map((_, i) => i)
    }

    let uvIndices =
      uvEditorSelectedPoints.length > 0
        ? [...uvEditorSelectedPoints]
        : collectUvIndicesForFaces(obj, faceIndices)
    if (uvIndices.length === 0) return

    const ensured = ensureObjectUVs(obj)
    const uvs = ensured.uvs.map(cloneUv2)

    if (op === 'flipH') flipUVsHorizontal(uvs, uvIndices)
    else if (op === 'flipV') flipUVsVertical(uvs, uvIndices)
    else if (op === 'rotateCW') rotateUVs90(uvs, uvIndices, true)
    else if (op === 'rotateCCW') rotateUVs90(uvs, uvIndices, false)
    else if (op === 'fit') fitUVsToUnitSquare(uvs, uvIndices)
    else if ('translate' in op) {
      translateUVs(uvs, uvIndices, op.translate[0], op.translate[1])
    } else if ('rotate' in op) {
      const pivot = uvBoundsCenter(uvBoundsFromIndices(uvs, uvIndices))
      rotateUVsBy(uvs, uvIndices, op.rotate, pivot)
    } else if ('scale' in op) {
      scaleUVsFromCenter(uvs, uvIndices, op.scale[0], op.scale[1])
    } else if ('position' in op) {
      const b = uvBoundsFromIndices(uvs, uvIndices)
      const targetW = op.size[0]
      const targetH = op.size[1]
      fitUVsToUnitSquare(uvs, uvIndices)
      scaleUVsFromCenter(uvs, uvIndices, targetW, targetH, { u: 0, v: 0 })
      translateUVs(
        uvs,
        uvIndices,
        op.position[0] - b.minU,
        op.position[1] - b.minV
      )
      if (Math.abs(op.rotation) > 1e-8) {
        const pivot = { u: op.position[0] + targetW / 2, v: op.position[1] + targetH / 2 }
        rotateUVsBy(uvs, uvIndices, op.rotation, pivot)
      }
    }

    set((s) => ({
      objects: s.objects.map((o) =>
        o.id === objectId ? { ...ensureObjectUVs(o), uvs, faceUvIndices: ensured.faceUvIndices } : o
      ),
    }))
    get().commitHistory('Transform UV')
  },

  unwrapSelectedUvFaces: (method) => {
    const {
      objects,
      selectedObjectId,
      meshSelection,
      uvEditorSelectedFaces,
      uvEditorSmartUvAngle,
    } = get()
    const objectId = selectedObjectId ?? meshSelection?.objectId
    if (!objectId) return
    const obj = objects.find((o) => o.id === objectId)
    if (!obj) return

    let faceIndices: number[] = []
    if (uvEditorSelectedFaces.length > 0) {
      faceIndices = [...uvEditorSelectedFaces]
    } else if (meshSelection?.objectId === objectId && meshSelection.faces.length > 0) {
      faceIndices = [...meshSelection.faces]
    } else {
      faceIndices = obj.faces.map((_, i) => i)
    }

    const ensured = ensureObjectUVs(obj)
    const { uvs, faceUvIndices, uvAutoPacked } = unwrapSelectedFaces(
      ensured as import('../uv/uvObject').SceneObjectWithUVs,
      faceIndices,
      method,
      {
        angleLimitDeg: uvEditorSmartUvAngle,
        repackAll: true,
        markPacked: method === 'auto' || faceIndices.length >= obj.faces.length,
      }
    )
    set((s) => ({
      objects: s.objects.map((o) =>
        o.id === objectId
          ? { ...o, uvs, faceUvIndices, uvAutoPacked: uvAutoPacked ?? true }
          : o
      ),
    }))
    get().commitHistory('Unwrap UV')
  },

  startStroke: (point, view) => {
    const { autoConnectPaths, lastStrokeEndpoint, closeThreshold } = get()
    let p = { ...point }
    if (
      autoConnectPaths &&
      lastStrokeEndpoint?.view === view &&
      isNearPoint(p, lastStrokeEndpoint.position, closeThreshold)
    ) {
      p = { ...lastStrokeEndpoint.position }
    }
    set({ currentStroke: [p], isDrawing: true, currentStrokeView: view, currentStrokePreview: p })
  },

  continueStroke: (point) =>
    set((s) => {
      if (!s.isDrawing) return s
      let p = point
      if (
        s.autoConnectPaths &&
        s.currentStroke.length >= 3 &&
        isSketchNearClose(s.currentStroke, point, s.closeThreshold)
      ) {
        p = { ...s.currentStroke[0] }
      }
      const last = s.currentStroke[s.currentStroke.length - 1]
      if (last && Math.hypot(p.x - last.x, p.y - last.y) < 1.5) {
        return { ...s, currentStrokePreview: p }
      }
      return {
        currentStroke: [...s.currentStroke, p],
        currentStrokePreview: p,
      }
    }),

  setStrokePreview: (point) =>
    set((s) => {
      if (
        s.autoConnectPaths &&
        s.currentStroke.length >= 3 &&
        isSketchNearClose(s.currentStroke, point, s.closeThreshold)
      ) {
        return { currentStrokePreview: { ...s.currentStroke[0] } }
      }
      return { currentStrokePreview: point }
    }),

  endStroke: (view) => {
    get().clearExtrudeDrag()
    const {
      currentStroke,
      currentStrokeView,
      polyBudget,
      brushDensity,
      rdpTolerance,
      closeThreshold,
      defaultDepth,
      activeColor,
      activeTool,
      strokeMode,
      selectedObjectId,
      objects,
      facetExaggeration,
      sketchExtrudeMode,
      extrudeAmount,
    } = get()

    if (currentStrokeView !== view || currentStroke.length < 2) {
      set({ currentStroke: [], isDrawing: false, currentStrokeView: null, currentStrokePreview: null })
      return
    }

    if (view === 'perspective') {
      set({ currentStroke: [], isDrawing: false, currentStrokeView: null, currentStrokePreview: null })
      return
    }

    const snappedStroke = snapSketchStrokeClosed(currentStroke, closeThreshold)

    const strokeInput = {
      points: snappedStroke,
      view,
      polyBudget,
      brushDensity,
      strokeMode,
      rdpTolerance,
      closeThreshold,
      defaultDepth,
      color: activeColor,
      stylize: facetExaggeration,
      extrudeMode: sketchExtrudeMode,
      extrudeAmount,
    }

    if (
      activeTool === 'boolean-hole' ||
      (activeTool === 'draw' && isHoleLineStroke(strokeInput))
    ) {
      const target = objects.find((o) => o.id === selectedObjectId) ?? objects[objects.length - 1]
      if (target) {
        const start = planeToWorld3D(currentStroke[0].x, currentStroke[0].y, view, defaultDepth)
        const end = planeToWorld3D(
          currentStroke[currentStroke.length - 1].x,
          currentStroke[currentStroke.length - 1].y,
          view,
          defaultDepth
        )
        const punched = punchHoleAlongLine(target, start, end, 8)
        if (punched) {
          set((s) => ({
            objects: s.objects.map((o) => (o.id === target.id ? punched : o)),
          }))
          get().commitHistory('Boolean hole')
        }
      }
      set({ currentStroke: [], isDrawing: false, currentStrokeView: null, currentStrokePreview: null })
      return
    }

    if (activeTool !== 'draw') {
      set({ currentStroke: [], isDrawing: false, currentStrokeView: null, currentStrokePreview: null })
      return
    }

    let obj = strokeToMesh(strokeInput)

    if (obj && sketchExtrudeMode) {
      const prepared = prepareSketchStroke(snappedStroke, closeThreshold, brushDensity)
      if (prepared) {
        obj = {
          ...obj,
          sketchSource: createSketchSource(
            prepared.relative,
            prepared.center,
            view,
            brushDensity,
            polyBudget,
            closeThreshold,
            defaultDepth,
            prepared.isClosed,
            prepared.isClosed ? 'sharp' : 'path',
            extrudeAmount
          ),
        }
      }
    }

    const lastPt = currentStroke[currentStroke.length - 1]

    if (obj) {
      get().addObject(obj)
    }

    set({
      currentStroke: [],
      isDrawing: false,
      currentStrokeView: null,
      currentStrokePreview: null,
      lastStrokeEndpoint: { view, position: { x: lastPt.x, y: lastPt.y } },
    })
  },

  applySculptAt: (center, tool, options) => {
    const { selectedObjectId, objects, brushRadius, brushStrength } = get()
    const targetId = selectedObjectId ?? objects[objects.length - 1]?.id
    if (!targetId) return

    const obj = objects.find((o) => o.id === targetId)
    if (!obj || obj.topologyLocked) return

    const mesh = HalfEdgeMesh.fromObject(obj)
    applySculpt(mesh, {
      tool,
      center,
      radius: brushRadius,
      strength: brushStrength,
      topologyLocked: obj.topologyLocked,
    })

    const { symmetryEnabled, symmetryAxis, symmetryPlane } = get()
    if (symmetryEnabled) {
      applySculpt(mesh, {
        tool,
        center: mirrorWorldPoint(center, symmetryAxis, symmetryPlane),
        radius: brushRadius,
        strength: brushStrength,
        topologyLocked: obj.topologyLocked,
      })
    }

    const updated = mesh.toObject(obj.id, obj.name, obj)
    invalidateFaceGroupCache(targetId)
    set((s) => ({
      objects: s.objects.map((o) => (o.id === targetId ? updated : o)),
    }))
    if (options?.saveHistory) get().commitHistory('Sculpt')
  },

  simplifySelected: () => {
    const { selectedObjectId, objects, polyBudget } = get()
    const targetId = selectedObjectId ?? objects[objects.length - 1]?.id
    if (!targetId) return

    const obj = objects.find((o) => o.id === targetId)
    if (!obj || obj.topologyLocked) return

    const mesh = HalfEdgeMesh.fromObject(obj)
    const simplified = simplifyMesh(mesh, Math.floor(polyBudget * 0.75))
    const updated = simplified.toObject(obj.id, obj.name, obj)
    invalidateFaceGroupCache(targetId)
    set((s) => ({
      objects: s.objects.map((o) => (o.id === targetId ? updated : o)),
    }))
    get().commitHistory('Simplify')
  },
}))

export const PALETTE = [
  0x6ecbf5, 0x7ecba1, 0xf5a66e, 0xf56e8c, 0xc56ef5,
  0xf5e66e, 0xf58c6e, 0x6ef5d4, 0x8c6ef5, 0xe6e6e6,
  0x333344, 0xff4444, 0x44ff44, 0x4444ff, 0xffaa00,
  0xffffff,
]
