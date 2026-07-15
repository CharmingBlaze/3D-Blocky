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
import type { HairTipStyle, StrokeMode } from '../store/strokeSlice'

export { PROJECT_FILE_EXTENSION, DEFAULT_PROJECT_FILENAME, LEGACY_PROJECT_FILE_EXTENSION } from '../app/branding'

/** Current on-disk project schema. v1 files still load. */
export const PROJECT_FILE_VERSION = 2 as const

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

function validateProjectObject(value: unknown, index: number): void {
  if (!isRecord(value)) throw new Error(`Invalid project file: object ${index + 1} is malformed.`)
  if (typeof value.id !== 'string' || value.id.length === 0) {
    throw new Error(`Invalid project file: object ${index + 1} has no valid id.`)
  }
  if (!Array.isArray(value.positions) || !Array.isArray(value.faces)) {
    throw new Error(`Invalid project file: object "${value.id}" has invalid mesh data.`)
  }
  const positions = value.positions
  const faces = value.faces
  for (const position of positions) {
    if (
      !isRecord(position) ||
      !Number.isFinite(position.x) ||
      !Number.isFinite(position.y) ||
      !Number.isFinite(position.z)
    ) {
      throw new Error(`Invalid project file: object "${value.id}" contains an invalid vertex.`)
    }
  }
  for (const face of faces) {
    if (
      !Array.isArray(face) ||
      face.length < 3 ||
      face.some(
        (vertexIndex) =>
          !Number.isInteger(vertexIndex) || vertexIndex < 0 || vertexIndex >= positions.length
      )
    ) {
      throw new Error(`Invalid project file: object "${value.id}" contains an invalid face.`)
    }
  }
  if (value.faceColors !== undefined && !Array.isArray(value.faceColors)) {
    throw new Error(`Invalid project file: object "${value.id}" has invalid face colors.`)
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
  parsed.objects.forEach(validateProjectObject)
  if (parsed.objectTextures !== undefined && !isRecord(parsed.objectTextures)) {
    throw new Error('Invalid project file: invalid texture data.')
  }
  for (const key of ['pixelDocuments', 'referenceImages', 'billboardImages'] as const) {
    if (parsed[key] !== undefined && !Array.isArray(parsed[key])) {
      throw new Error(`Invalid project file: invalid ${key}.`)
    }
  }
  if (parsed.selectionObjectIds !== undefined && !Array.isArray(parsed.selectionObjectIds)) {
    throw new Error('Invalid project file: invalid object selection.')
  }
  return parsed as unknown as SerializedProjectFile
}

export async function snapshotFromProjectFile(file: SerializedProjectFile): Promise<SceneSnapshot> {
  const objectTextures: Record<string, SnapshotTextureInfo> = {}
  for (const [id, info] of Object.entries(file.objectTextures ?? {})) {
    objectTextures[id] = {
      name: info.name,
      width: info.width,
      height: info.height,
      url: info.dataUrl ? await dataUrlToBlobUrl(info.dataUrl) : '',
    }
  }

  const pixelDocuments: SceneSnapshot['pixelDocuments'] = {}
  for (const doc of file.pixelDocuments ?? []) {
    const restored = deserializePixelDocument(doc)
    pixelDocuments[restored.id] = restored
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
