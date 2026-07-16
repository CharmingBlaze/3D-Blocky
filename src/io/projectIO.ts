import type { BillboardImage, ReferenceImage } from '../images/imageDropTypes'
import type { SceneSnapshot, SnapshotTextureInfo } from '../history/sceneHistory'
import { applySceneSnapshot } from '../history/sceneHistory'
import {
  deserializePixelDocument,
  serializePixelDocument,
  type SerializedPixelDocument,
} from '../pixel/pixelDocumentIO'
import { downloadJSON, PROJECT_FILE_FILTERS } from './download'
import {
  APP_PROJECT_FORMAT,
  BLOCKY_PROJECT_FORMAT,
  DEFAULT_PROJECT_FILENAME,
  LEGACY_PROJECT_FORMAT,
} from '../app/branding'
import type { HairUvTransform } from '../stroke/hairUvTransform'
import {
  DEFAULT_HAIR_UV_TRANSFORM,
  normalizeHairUvTransform,
} from '../stroke/hairUvTransform'
import type { HairTextureSettings } from '../stroke/hairTextureSettings'
import { DEFAULT_HAIR_TEXTURE_SETTINGS } from '../stroke/hairTextureSettings'
import type { HairTipStyle, StrokeMode, SweepCapStyle } from '../store/strokeSlice'
import type { PathDistributionMode, PathOutput, PathProfile } from '../mesh/pathOutputs'
import { validateMeshStructure } from '../mesh/meshInvariants'

export { PROJECT_FILE_EXTENSION, DEFAULT_PROJECT_FILENAME, LEGACY_PROJECT_FILE_EXTENSION } from '../app/branding'

/** Current on-disk project schema. v1 files still load. */
export const PROJECT_FILE_VERSION = 2 as const
export const MAX_PROJECT_FILE_CHARACTERS = 256 * 1024 * 1024
export const MAX_PROJECT_OBJECTS = 10_000

export interface ProjectHairState {
  textureId: string | null
  uvTransform: HairUvTransform
  textureSettings: HairTextureSettings
  tipStyle: HairTipStyle
}

export interface ProjectStrokeState {
  strokeMode: StrokeMode
  blobInflation: number
  extrudeAmount: number
  sketchExtrudeMode: boolean
  penExtrudeMode: boolean
  latheRadialSegments: number
  latheProfileRings: number
  latheSmoothing: number
  pathStartCap: SweepCapStyle
  pathEndCap: SweepCapStyle
  pathRadialSegments: number
  pathRadiusScale: number
  ribbonStartTip: HairTipStyle
  ribbonEndTip: HairTipStyle
  ribbonTaper: number
  ribbonWidthScale: number
  ribbonFlat: boolean
  pathOutput: PathOutput
  pathStartScale: number
  pathEndScale: number
  pathTwist: number
  pathSpacing: number
  pathOffset: number
  pathProfile: PathProfile
  pathProfileWidth: number
  pathProfileHeight: number
  pathChainAlternating: boolean
  pathCardCrossed: boolean
  pathDistributionMode: PathDistributionMode
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
}

export interface ProjectSceneSettingsState {
  polyBudget: number
  brushDensity: number
  drawDoubleSided: boolean
  closeThreshold: number
  defaultDepth: number
  activeColor: number
}

/** Optional preferences restored on Open (v2+). Absent on legacy v1 files. */
export interface ProjectPreferences {
  hair?: ProjectHairState
  stroke?: ProjectStrokeState
  sceneSettings?: ProjectSceneSettingsState
}

export interface SerializedProjectFile {
  version: 1 | typeof PROJECT_FILE_VERSION
  format: typeof APP_PROJECT_FORMAT | typeof BLOCKY_PROJECT_FORMAT | typeof LEGACY_PROJECT_FORMAT
  savedAt: string
  objects: SceneSnapshot['objects']
  objectTextures: Record<
    string,
    {
      name: string
      width: number
      height: number
      dataUrl: string | null
    }
  >
  pixelDocuments: SerializedPixelDocument[]
  referenceImages: Array<
    Omit<ReferenceImage, 'url'> & {
      dataUrl: string
    }
  >
  billboardImages: Array<
    Omit<BillboardImage, 'url'> & {
      dataUrl: string
    }
  >
  selectedObjectId: string | null
  selectionObjectIds: string[]
  meshSelection: SceneSnapshot['meshSelection']
  /** v2+: hair tool binding (active texture, UV map, tip style). */
  hair?: ProjectHairState
  /** v2+: stroke tool defaults that affect new doodles. */
  stroke?: ProjectStrokeState
  /** v2+: global sculpt/draw scene settings. */
  sceneSettings?: ProjectSceneSettingsState
}

export interface ProjectSerializeInput {
  snapshot: SceneSnapshot
  preferences?: ProjectPreferences
}

export interface ProjectLoadResult {
  snapshot: SceneSnapshot
  preferences: ProjectPreferences
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteVec3(value: unknown): boolean {
  return (
    isRecord(value) &&
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    Number.isFinite(value.z)
  )
}

function isImageDataUrl(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^data:image\/[a-z0-9.+-]+(?:;[^,]*)?,/i.test(value)
  )
}

function validateProjectObject(value: unknown, index: number): void {
  if (!isRecord(value)) throw new Error(`Invalid project file: object ${index + 1} is malformed.`)
  if (typeof value.id !== 'string' || value.id.length === 0) {
    throw new Error(`Invalid project file: object ${index + 1} has no valid id.`)
  }
  const meshIssues = validateMeshStructure(value)
  if (meshIssues.length > 0) {
    throw new Error(
      `Invalid project file: object "${value.id}" has invalid mesh data (${meshIssues[0]!.message})`
    )
  }
  if (
    value.faceColors !== undefined &&
    (!Array.isArray(value.faceColors) ||
      value.faceColors.some((color) => !Number.isFinite(color)))
  ) {
    throw new Error(`Invalid project file: object "${value.id}" has invalid face colors.`)
  }
  if (value.pivot !== undefined && !isFiniteVec3(value.pivot)) {
    throw new Error(`Invalid project file: object "${value.id}" has an invalid pivot.`)
  }
  if (value.transform !== undefined) {
    if (
      !isRecord(value.transform) ||
      !isFiniteVec3(value.transform.position) ||
      !isFiniteVec3(value.transform.rotation) ||
      !isFiniteVec3(value.transform.scale)
    ) {
      throw new Error(`Invalid project file: object "${value.id}" has an invalid transform.`)
    }
  }
}

async function blobUrlToDataUrl(url: string): Promise<string | null> {
  if (!url) return null
  if (url.startsWith('data:')) return url
  try {
    const response = await fetch(url)
    const blob = await response.blob()
    return await new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

async function dataUrlToBlobUrl(dataUrl: string): Promise<string> {
  if (!isImageDataUrl(dataUrl)) {
    throw new Error('Invalid project file: embedded image is not an image data URL.')
  }
  const response = await fetch(dataUrl)
  const blob = await response.blob()
  return URL.createObjectURL(blob)
}

function parseHairTipStyle(value: unknown): HairTipStyle {
  return value === 'square' ? 'square' : 'pointed'
}

function parseHairPreferences(raw: unknown): ProjectHairState | undefined {
  if (!isRecord(raw)) return undefined
  const textureId =
    typeof raw.textureId === 'string' && raw.textureId.length > 0
      ? raw.textureId
      : raw.textureId === null
        ? null
        : null
  const uvTransform = normalizeHairUvTransform(
    isRecord(raw.uvTransform) ? (raw.uvTransform as Partial<HairUvTransform>) : DEFAULT_HAIR_UV_TRANSFORM
  )
  const textureSettings: HairTextureSettings = {
    ...DEFAULT_HAIR_TEXTURE_SETTINGS,
    ...(isRecord(raw.textureSettings) ? (raw.textureSettings as Partial<HairTextureSettings>) : {}),
  }
  return {
    textureId,
    uvTransform,
    textureSettings,
    tipStyle: parseHairTipStyle(raw.tipStyle),
  }
}

const STROKE_MODES: StrokeMode[] = [
  'outline',
  'centerline',
  'blob',
  'capsule',
  'ribbon',
  'tapered-tube',
  'hair-paths',
  'hair-strips',
  'hair-round',
]

function parseStrokePreferences(raw: unknown): ProjectStrokeState | undefined {
  if (!isRecord(raw)) return undefined
  const mode = typeof raw.strokeMode === 'string' && STROKE_MODES.includes(raw.strokeMode as StrokeMode)
    ? (raw.strokeMode as StrokeMode)
    : 'blob'
  return {
    strokeMode: mode,
    blobInflation: Number.isFinite(raw.blobInflation) ? Number(raw.blobInflation) : 0.65,
    extrudeAmount: Number.isFinite(raw.extrudeAmount) ? Number(raw.extrudeAmount) : 16,
    sketchExtrudeMode: Boolean(raw.sketchExtrudeMode),
    penExtrudeMode: Boolean(raw.penExtrudeMode),
    latheRadialSegments: Number.isFinite(raw.latheRadialSegments) ? Math.max(8, Math.min(64, Number(raw.latheRadialSegments))) : 24,
    latheProfileRings: Number.isFinite(raw.latheProfileRings) ? Math.max(4, Math.min(128, Number(raw.latheProfileRings))) : 48,
    latheSmoothing: Number.isFinite(raw.latheSmoothing) ? Math.max(0, Math.min(1, Number(raw.latheSmoothing))) : 0.15,
    pathStartCap: ['flat', 'round', 'pointed', 'open'].includes(String(raw.pathStartCap)) ? raw.pathStartCap as SweepCapStyle : 'flat',
    pathEndCap: ['flat', 'round', 'pointed', 'open'].includes(String(raw.pathEndCap)) ? raw.pathEndCap as SweepCapStyle : 'flat',
    pathRadialSegments: Number.isFinite(raw.pathRadialSegments) ? Math.max(3, Math.min(24, Number(raw.pathRadialSegments))) : 8,
    pathRadiusScale: Number.isFinite(raw.pathRadiusScale) ? Math.max(0.1, Math.min(4, Number(raw.pathRadiusScale))) : 1,
    ribbonStartTip: raw.ribbonStartTip === 'pointed' ? 'pointed' : 'square',
    ribbonEndTip: raw.ribbonEndTip === 'pointed' ? 'pointed' : 'square',
    ribbonTaper: Number.isFinite(raw.ribbonTaper) ? Math.max(0.05, Math.min(0.49, Number(raw.ribbonTaper))) : 0.35,
    ribbonWidthScale: Number.isFinite(raw.ribbonWidthScale) ? Math.max(0.1, Math.min(4, Number(raw.ribbonWidthScale))) : 1,
    ribbonFlat: Boolean(raw.ribbonFlat),
    pathOutput: ['tube','ribbon','chain','vine','rope','cards','object-array','profile-sweep'].includes(String(raw.pathOutput)) ? raw.pathOutput as PathOutput : 'tube',
    pathStartScale: Number.isFinite(raw.pathStartScale) ? Number(raw.pathStartScale) : 1,
    pathEndScale: Number.isFinite(raw.pathEndScale) ? Number(raw.pathEndScale) : 1,
    pathTwist: Number.isFinite(raw.pathTwist) ? Number(raw.pathTwist) : 360,
    pathSpacing: Number.isFinite(raw.pathSpacing) ? Number(raw.pathSpacing) : 16,
    pathOffset: Number.isFinite(raw.pathOffset) ? Number(raw.pathOffset) : 0,
    pathProfile: ['round','square','rectangle','rail'].includes(String(raw.pathProfile)) ? raw.pathProfile as PathProfile : 'round',
    pathProfileWidth: Number.isFinite(raw.pathProfileWidth) ? Number(raw.pathProfileWidth) : 1,
    pathProfileHeight: Number.isFinite(raw.pathProfileHeight) ? Number(raw.pathProfileHeight) : 1,
    pathChainAlternating: raw.pathChainAlternating !== false,
    pathCardCrossed: Boolean(raw.pathCardCrossed),
    pathDistributionMode: ['spacing','count','fit'].includes(String(raw.pathDistributionMode)) ? raw.pathDistributionMode as PathDistributionMode : 'spacing',
    pathCount: Number.isFinite(raw.pathCount) ? Math.max(1, Number(raw.pathCount)) : 8,
    pathStartPadding: Number.isFinite(raw.pathStartPadding) ? Math.max(0, Number(raw.pathStartPadding)) : 0,
    pathEndPadding: Number.isFinite(raw.pathEndPadding) ? Math.max(0, Number(raw.pathEndPadding)) : 0,
    pathRandomScale: Number.isFinite(raw.pathRandomScale) ? Math.max(0, Math.min(1, Number(raw.pathRandomScale))) : 0,
    pathRotation: Number.isFinite(raw.pathRotation) ? Number(raw.pathRotation) : 0,
    pathRandomRotation: Number.isFinite(raw.pathRandomRotation) ? Math.max(0, Number(raw.pathRandomRotation)) : 0,
    pathAlternateRotation: Boolean(raw.pathAlternateRotation),
    pathMirrorAlternate: Boolean(raw.pathMirrorAlternate),
    pathSeed: Number.isFinite(raw.pathSeed) ? Math.floor(Number(raw.pathSeed)) : 1,
    pathKeepInstances: raw.pathKeepInstances !== false,
  }
}

function parseSceneSettingsPreferences(raw: unknown): ProjectSceneSettingsState | undefined {
  if (!isRecord(raw)) return undefined
  return {
    polyBudget: Number.isFinite(raw.polyBudget) ? Number(raw.polyBudget) : 128,
    brushDensity: Number.isFinite(raw.brushDensity) ? Number(raw.brushDensity) : 12,
    drawDoubleSided: Boolean(raw.drawDoubleSided),
    closeThreshold: Number.isFinite(raw.closeThreshold) ? Number(raw.closeThreshold) : 8,
    defaultDepth: Number.isFinite(raw.defaultDepth) ? Number(raw.defaultDepth) : 0,
    activeColor: Number.isFinite(raw.activeColor) ? Number(raw.activeColor) : 0x6ecbf5,
  }
}

export function preferencesFromProjectFile(file: SerializedProjectFile): ProjectPreferences {
  return {
    hair: parseHairPreferences(file.hair),
    stroke: parseStrokePreferences(file.stroke),
    sceneSettings: parseSceneSettingsPreferences(file.sceneSettings),
  }
}

export async function serializeProjectFromSnapshot(
  snapshot: SceneSnapshot,
  preferences?: ProjectPreferences
): Promise<SerializedProjectFile> {
  const objectTextures: SerializedProjectFile['objectTextures'] = {}
  for (const [id, info] of Object.entries(snapshot.objectTextures)) {
    objectTextures[id] = {
      name: info.name,
      width: info.width,
      height: info.height,
      dataUrl: info.url ? await blobUrlToDataUrl(info.url) : null,
    }
  }

  const pixelDocuments = Object.values(snapshot.pixelDocuments ?? {}).map(serializePixelDocument)

  const referenceImages: SerializedProjectFile['referenceImages'] = []
  for (const img of snapshot.referenceImages) {
    const dataUrl = await blobUrlToDataUrl(img.url)
    if (!dataUrl) continue
    referenceImages.push({
      id: img.id,
      view: img.view,
      name: img.name,
      x: img.x,
      y: img.y,
      width: img.width,
      aspect: img.aspect,
      opacity: img.opacity,
      dataUrl,
    })
  }

  const billboardImages: SerializedProjectFile['billboardImages'] = []
  for (const img of snapshot.billboardImages) {
    const dataUrl = await blobUrlToDataUrl(img.url)
    if (!dataUrl) continue
    billboardImages.push({
      id: img.id,
      name: img.name,
      position: { ...img.position },
      rotation: img.rotation ? { ...img.rotation } : undefined,
      width: img.width,
      height: img.height,
      opacity: img.opacity,
      dataUrl,
    })
  }

  const file: SerializedProjectFile = {
    version: PROJECT_FILE_VERSION,
    format: APP_PROJECT_FORMAT,
    savedAt: new Date().toISOString(),
    objects: snapshot.objects,
    objectTextures,
    pixelDocuments,
    referenceImages,
    billboardImages,
    selectedObjectId: snapshot.selectedObjectId,
    selectionObjectIds: [...snapshot.selectionObjectIds],
    meshSelection: snapshot.meshSelection
      ? {
          objectId: snapshot.meshSelection.objectId,
          vertices: [...snapshot.meshSelection.vertices],
          edges: [...snapshot.meshSelection.edges],
          faces: [...snapshot.meshSelection.faces],
        }
      : null,
  }

  if (preferences?.hair) file.hair = preferences.hair
  if (preferences?.stroke) file.stroke = preferences.stroke
  if (preferences?.sceneSettings) file.sceneSettings = preferences.sceneSettings

  return file
}

export function parseProjectFile(text: string): SerializedProjectFile {
  if (text.length > MAX_PROJECT_FILE_CHARACTERS) {
    throw new Error('Invalid project file: file is too large.')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('Invalid project file: not valid JSON.')
  }
  if (!isRecord(parsed)) {
    throw new Error('Invalid project file: expected a project object.')
  }
  if (parsed.version !== 1 && parsed.version !== PROJECT_FILE_VERSION) {
    throw new Error('Unsupported project file version.')
  }
  if (
    parsed.format !== APP_PROJECT_FORMAT &&
    parsed.format !== BLOCKY_PROJECT_FORMAT &&
    parsed.format !== LEGACY_PROJECT_FORMAT
  ) {
    throw new Error('Unsupported project file format.')
  }
  if (!Array.isArray(parsed.objects)) {
    throw new Error('Invalid project file: missing objects.')
  }
  if (parsed.objects.length > MAX_PROJECT_OBJECTS) {
    throw new Error(`Invalid project file: too many objects (limit ${MAX_PROJECT_OBJECTS}).`)
  }
  parsed.objects.forEach((object, index) => {
    validateProjectObject(object, index)
    const record = object as Record<string, unknown>
    const faces = record.faces as unknown[]
    const supplied = Array.isArray(record.faceColors) ? record.faceColors : []
    const fallback = Number.isFinite(record.color) ? Number(record.color) : 0x6ecbf5
    record.faceColors = faces.map((_, faceIndex) => {
      const color = supplied[faceIndex]
      return Number.isFinite(color) ? color : fallback
    })
  })
  const objectIds = new Set<string>()
  for (const object of parsed.objects) {
    const id = (object as Record<string, unknown>).id as string
    if (objectIds.has(id)) {
      throw new Error(`Invalid project file: duplicate object id "${id}".`)
    }
    objectIds.add(id)
  }
  if (parsed.objectTextures !== undefined && !isRecord(parsed.objectTextures)) {
    throw new Error('Invalid project file: invalid texture data.')
  }
  for (const [id, info] of Object.entries(parsed.objectTextures ?? {})) {
    if (
      !isRecord(info) ||
      typeof info.name !== 'string' ||
      typeof info.width !== 'number' ||
      typeof info.height !== 'number' ||
      !Number.isFinite(info.width) ||
      !Number.isFinite(info.height) ||
      info.width <= 0 ||
      info.height <= 0 ||
      (info.dataUrl !== null && !isImageDataUrl(info.dataUrl))
    ) {
      throw new Error(`Invalid project file: invalid texture "${id}".`)
    }
  }
  for (const key of ['pixelDocuments', 'referenceImages', 'billboardImages'] as const) {
    if (parsed[key] !== undefined && !Array.isArray(parsed[key])) {
      throw new Error(`Invalid project file: invalid ${key}.`)
    }
  }
  const pixelDocumentIds = new Set<string>()
  const pixelDocumentEntries = Array.isArray(parsed.pixelDocuments) ? parsed.pixelDocuments : []
  for (const [index, document] of pixelDocumentEntries.entries()) {
    if (!isRecord(document) || typeof document.id !== 'string' || document.id.length === 0) {
      throw new Error(`Invalid project file: invalid pixel document ${index + 1}.`)
    }
    if (pixelDocumentIds.has(document.id)) {
      throw new Error(`Invalid project file: duplicate pixel document id "${document.id}".`)
    }
    pixelDocumentIds.add(document.id)
  }
  const referenceImages = Array.isArray(parsed.referenceImages)
    ? parsed.referenceImages
    : []
  for (const [index, image] of referenceImages.entries()) {
    if (
      !isRecord(image) ||
      typeof image.id !== 'string' ||
      !isImageDataUrl(image.dataUrl) ||
      !Number.isFinite(image.x) ||
      !Number.isFinite(image.y) ||
      !Number.isFinite(image.width) ||
      !Number.isFinite(image.aspect) ||
      !Number.isFinite(image.opacity)
    ) {
      throw new Error(`Invalid project file: invalid reference image ${index + 1}.`)
    }
  }
  const billboardImages = Array.isArray(parsed.billboardImages)
    ? parsed.billboardImages
    : []
  for (const [index, image] of billboardImages.entries()) {
    if (
      !isRecord(image) ||
      typeof image.id !== 'string' ||
      !isImageDataUrl(image.dataUrl) ||
      !isFiniteVec3(image.position) ||
      (image.rotation !== undefined && !isFiniteVec3(image.rotation)) ||
      !Number.isFinite(image.width) ||
      !Number.isFinite(image.height) ||
      !Number.isFinite(image.opacity)
    ) {
      throw new Error(`Invalid project file: invalid billboard image ${index + 1}.`)
    }
  }
  if (parsed.selectionObjectIds !== undefined && !Array.isArray(parsed.selectionObjectIds)) {
    throw new Error('Invalid project file: invalid object selection.')
  }
  return parsed as unknown as SerializedProjectFile
}

export async function snapshotFromProjectFile(file: SerializedProjectFile): Promise<SceneSnapshot> {
  const pixelDocuments: SceneSnapshot['pixelDocuments'] = {}
  for (const doc of file.pixelDocuments ?? []) {
    const restored = deserializePixelDocument(doc)
    pixelDocuments[restored.id] = restored
  }

  const objectTextures: Record<string, SnapshotTextureInfo> = {}
  for (const [id, info] of Object.entries(file.objectTextures ?? {})) {
    objectTextures[id] = {
      name: info.name,
      width: info.width,
      height: info.height,
      url: info.dataUrl ? await dataUrlToBlobUrl(info.dataUrl) : '',
    }
  }

  const referenceImages: ReferenceImage[] = []
  for (const img of file.referenceImages ?? []) {
    referenceImages.push({
      id: img.id,
      view: img.view,
      url: await dataUrlToBlobUrl(img.dataUrl),
      name: img.name,
      x: img.x,
      y: img.y,
      width: img.width,
      aspect: img.aspect,
      opacity: img.opacity,
    })
  }

  const billboardImages: BillboardImage[] = []
  for (const img of file.billboardImages ?? []) {
    billboardImages.push({
      id: img.id,
      url: await dataUrlToBlobUrl(img.dataUrl),
      name: img.name,
      position: { ...img.position },
      rotation: img.rotation ? { ...img.rotation } : undefined,
      width: img.width,
      height: img.height,
      opacity: img.opacity,
    })
  }

  const preferences = preferencesFromProjectFile(file)
  const retainTextureIds: string[] = []
  if (preferences.hair?.textureId) retainTextureIds.push(preferences.hair.textureId)

  return applySceneSnapshot(
    {
      objects: file.objects,
      objectTextures,
      pixelDocuments,
      referenceImages,
      billboardImages,
      selectedObjectId: file.selectedObjectId,
      selectionObjectIds: file.selectionObjectIds ?? [],
      meshSelection: file.meshSelection,
    },
    { retainTextureIds }
  )
}

export async function loadProjectFromText(text: string): Promise<ProjectLoadResult> {
  const parsed = parseProjectFile(text)
  const snapshot = await snapshotFromProjectFile(parsed)
  return {
    snapshot,
    preferences: preferencesFromProjectFile(parsed),
  }
}

export async function saveProjectFile(
  snapshot: SceneSnapshot,
  filename = DEFAULT_PROJECT_FILENAME,
  preferences?: ProjectPreferences
): Promise<boolean> {
  const project = await serializeProjectFromSnapshot(snapshot, preferences)
  return downloadJSON(project, filename, {
    title: 'Save project',
    filters: PROJECT_FILE_FILTERS,
  })
}
