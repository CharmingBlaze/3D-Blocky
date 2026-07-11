import type { SceneObject } from '../mesh/HalfEdgeMesh'
import type { MeshComponentSelection } from '../mesh/meshSelection'
import type { SelectionMode } from '../store/appStore'
import { expandFacesToPlanarRegions } from '../mesh/faceGroups'
import {
  applyGradient,
  applySolidColorUniquePerFace,
  ensureObjectMaterial,
  resolveColorCornersForSelection,
  setObjectMaterial,
  type GradientLineSpec,
} from './materials'
import type {
  CustomPalette,
  GradientDirection,
  GradientHandle2D,
  HarmonyScheme,
  Material,
  MaterialMode,
  Rgba4,
} from './materialTypes'
import { cloneMaterial, defaultMaterial, hexToRgba4, rgba4ToNumber } from './materialTypes'
import { gradientHandlesForDirection } from './gradientLine'
import {
  allPaletteOptions,
  generateHarmonyPalette,
  loadCustomPalettes,
  paletteColorsById,
  saveCustomPalettes,
} from './palettes'

export interface MaterialEditorState {
  materialEditorOpen: boolean
  materialEditorPanel: {
    x: number
    y: number
    width: number
    height: number
    minimized: boolean
  }
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
}

export const materialEditorInitialState: MaterialEditorState = {
  materialEditorOpen: false,
  materialEditorPanel: { x: 96, y: 96, width: 340, height: 620, minimized: false },
  materialEditorColor: hexToRgba4('#6ecbf5'),
  materialEditorPaletteId: 'pico8',
  materialEditorCustomPalettes: loadCustomPalettes(),
  materialEditorEyedropperActive: false,
  materialEditorGradientDirection: 'y',
  materialEditorGradientStart: { u: 0.5, v: 0.92 },
  materialEditorGradientEnd: { u: 0.5, v: 0.08 },
  materialEditorGradientActiveStop: 0,
  materialEditorGradientStops: [hexToRgba4('#6ecbf5'), hexToRgba4('#f5a66e')],
  materialEditorApplyToSelection: true,
  materialPaintHistoryPending: false,
}

export function resolveTargetObjectIds(
  selectedObjectId: string | null,
  selectionObjectIds: string[]
): string[] {
  if (selectionObjectIds.length > 0) return selectionObjectIds
  if (selectedObjectId) return [selectedObjectId]
  return []
}

export function paintColorOnObjects(
  objects: SceneObject[],
  targetIds: string[],
  selectionMode: SelectionMode,
  meshSelection: MeshComponentSelection | null,
  applyToSelection: boolean,
  rgba: Rgba4
): SceneObject[] {
  const idSet = new Set(targetIds)
  return objects.map((obj) => {
    if (!idSet.has(obj.id)) return obj
    const wholeObject = !applyToSelection || selectionMode === 'object'
    const refs = resolveColorCornersForSelection(obj, selectionMode, meshSelection, wholeObject)
    return applySolidColorUniquePerFace(ensureObjectMaterial(obj), refs, rgba)
  })
}

export function gradientLineFromEditorState(
  direction: GradientDirection,
  start: GradientHandle2D,
  end: GradientHandle2D
): GradientLineSpec {
  return {
    start: { ...start },
    end: { ...end },
    radial: direction === 'radial',
  }
}

export function applyGradientOnObjects(
  objects: SceneObject[],
  targetIds: string[],
  selectionMode: SelectionMode,
  meshSelection: MeshComponentSelection | null,
  applyToSelection: boolean,
  line: GradientLineSpec,
  stops: Rgba4[]
): SceneObject[] {
  const idSet = new Set(targetIds)
  return objects.map((obj) => {
    if (!idSet.has(obj.id)) return obj
    const wholeObject = !applyToSelection || selectionMode === 'object'
    const refs = resolveColorCornersForSelection(obj, selectionMode, meshSelection, wholeObject)
    return applyGradient(ensureObjectMaterial(obj), refs, line, stops)
  })
}

export { gradientHandlesForDirection }

export function updateObjectMaterialSettings(
  obj: SceneObject,
  patch: Partial<Material>
): SceneObject {
  const base = ensureObjectMaterial(obj)
  return {
    ...base,
    material: { ...base.material!, ...patch, solidColor: patch.solidColor ?? base.material!.solidColor },
  }
}

export function setObjectMaterialMode(
  obj: SceneObject,
  mode: MaterialMode,
  textureObjectId?: string
): SceneObject {
  const base = ensureObjectMaterial(obj)
  const mat = cloneMaterial(base.material!)
  mat.mode = mode
  if (mode === 'texture') {
    mat.textureId = textureObjectId ?? obj.id
  }
  return setObjectMaterial(base, 'object', mat)
}

export function syncEditorColorFromSelection(
  objects: SceneObject[],
  targetIds: string[]
): Rgba4 | null {
  const obj = objects.find((o) => targetIds.includes(o.id))
  if (!obj) return null
  const mat = ensureObjectMaterial(obj).material!
  if (mat.solidColor) return [...mat.solidColor] as Rgba4
  return [
    ((obj.color >> 16) & 255) / 255,
    ((obj.color >> 8) & 255) / 255,
    (obj.color & 255) / 255,
    mat.opacity,
  ]
}

export function persistCustomPalettes(palettes: CustomPalette[]): void {
  saveCustomPalettes(palettes)
}

export function createHarmonyCustomPalette(
  palettes: CustomPalette[],
  baseHex: string,
  scheme: HarmonyScheme
): { palettes: CustomPalette[]; id: string } {
  const colors = generateHarmonyPalette(baseHex, scheme)
  const id = `custom-${Date.now()}`
  const next = [
    ...palettes,
    { id, name: `${scheme.charAt(0).toUpperCase()}${scheme.slice(1)} harmony`, colors },
  ]
  saveCustomPalettes(next)
  return { palettes: next, id }
}

export function paletteOptionsForUi(customPalettes: CustomPalette[]) {
  return allPaletteOptions(customPalettes)
}

export function swatchesForPalette(paletteId: string, customPalettes: CustomPalette[]) {
  return paletteColorsById(paletteId, customPalettes)
}

export function rgbaToActiveColorNumber(rgba: Rgba4): number {
  return rgba4ToNumber(rgba)
}

export function faceIndicesForMaterialEdit(
  obj: SceneObject,
  selectionMode: SelectionMode,
  meshSelection: MeshComponentSelection | null,
  applyToSelection: boolean
): number[] | 'object' {
  if (!applyToSelection || selectionMode === 'object') return 'object'
  if (!meshSelection || meshSelection.objectId !== obj.id) return 'object'
  if (selectionMode === 'face' && meshSelection.faces.length > 0) {
    return expandFacesToPlanarRegions(obj, meshSelection.faces)
  }
  return 'object'
}

export function ensureNewObjectMaterial(color: number, doubleSided = false): Material {
  return { ...defaultMaterial(color), doubleSided }
}

/** Stamp the draw-sides preference onto a newly created scene object. */
export function stampDrawMaterial(obj: SceneObject, doubleSided: boolean): SceneObject {
  const base = obj.material ? cloneMaterial(obj.material) : defaultMaterial(obj.color)
  return {
    ...obj,
    material: { ...base, doubleSided },
  }
}
