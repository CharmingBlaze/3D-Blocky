import { HalfEdgeMesh, type SceneObject } from '../mesh/HalfEdgeMesh'
import { simplifyMesh } from '../mesh/simplification'
import { applySculpt, type SculptTool } from '../sculpt/sculptTools'
import type { Vec3 } from '../utils/math'
import {
  paintColorOnObjects,
  resolveTargetObjectIds,
} from '../material/materialEditorSlice'
import {
  ensureObjectMaterial,
  resolveColorCornersForSelection,
} from '../material/materials'
import { numberToRgba4, rgba4ToNumber } from '../material/materialTypes'
import { rgba4Equal } from '../material/colorObject'
import type { Rgba4 } from '../material/materialTypes'
import { applyTheme } from '../theme/applyTheme'
import { getThemeMaterialColor, getThemeMaterialHex, type ThemeId } from '../theme/themes'
import { readStoredThemeId } from '../theme/bootstrapTheme'
import { hexToRgba4 } from '../material/materialTypes'
import { mirrorWorldPoint } from '../symmetry/symmetry'
import { invalidateFaceGroupCache } from '../mesh/faceGroups'
import type { MeshComponentSelection } from '../mesh/meshSelection'
import type { SelectionMode } from './selectionSlice'

const THEME_STORAGE_KEY = 'lpo-theme'
const BOOT_THEME_ID = readStoredThemeId()
const BOOT_MATERIAL = getThemeMaterialColor(BOOT_THEME_ID)

function objectNeedsRecolor(obj: SceneObject, color: number, rgba: Rgba4): boolean {
  const mat = ensureObjectMaterial(obj).material!
  if (mat.mode === 'texture') return true
  if (obj.color !== color) return true
  if (obj.cornerColors?.length) {
    return obj.cornerColors.some((c) => !rgba4Equal(c, rgba))
  }
  return obj.faceColors.some((fc) => fc !== color)
}

export interface SceneSettingsLayoutState {
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
  themeId: ThemeId
  activeColor: number
  /** Prefer double-sided materials on newly drawn objects (mutually exclusive with single-sided UI). */
  drawDoubleSided: boolean
  showToolRing: boolean
  showExportDialog: boolean
}

export interface SceneSettingsLayoutActions {
  setPolyBudget: (budget: number) => void
  setBrushDensity: (density: number) => void
  setBrushStrength: (strength: number) => void
  setBrushRadius: (radius: number) => void
  setActiveColor: (color: number) => void
  setDrawDoubleSided: (on: boolean) => void
  setFacetExaggeration: (value: number) => void
  setShowDensityHeatmap: (show: boolean) => void
  setThemeId: (id: ThemeId) => void
  toggleTopologyLock: () => void
  setShowToolRing: (show: boolean) => void
  setShowExportDialog: (show: boolean) => void
  applySculptAt: (center: Vec3, tool: SculptTool, options?: { saveHistory?: boolean }) => void
  simplifySelected: () => void
}

export type SceneSettingsSlice = SceneSettingsLayoutState & SceneSettingsLayoutActions

export const sceneSettingsInitialState: SceneSettingsLayoutState = {
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
  themeId: BOOT_THEME_ID,
  activeColor: BOOT_MATERIAL,
  drawDoubleSided: false,
  showToolRing: false,
  showExportDialog: false,
}

type SettingsStore = SceneSettingsLayoutState & {
  meshSelection: MeshComponentSelection | null
  selectionMode: SelectionMode
  objects: SceneObject[]
  selectedObjectId: string | null
  selectionObjectIds: string[]
  symmetryEnabled: boolean
  symmetryAxis: import('../symmetry/symmetry').SymmetryAxis
  symmetryPlane: number
  updateObject: (id: string, updates: Partial<SceneObject>) => void
  commitHistory: (label?: string) => boolean
}

export function createSceneSettingsSlice<T extends SceneSettingsLayoutState>(
  set: (partial: Partial<T> | ((state: T) => Partial<T>)) => void,
  get: () => T & SceneSettingsLayoutActions
): SceneSettingsLayoutActions {
  const store = () => get() as T & SceneSettingsLayoutActions & SettingsStore
  const setPartial = (partial: object | ((state: T) => object)) => {
    if (typeof partial === 'function') {
      set((state) => partial(state) as Partial<T>)
    } else {
      set(partial as unknown as Partial<T>)
    }
  }

  return {
    setPolyBudget: (budget) => setPartial({ polyBudget: budget }),
    setBrushDensity: (density) => setPartial({ brushDensity: density }),
    setBrushStrength: (strength) => setPartial({ brushStrength: strength }),
    setBrushRadius: (radius) => setPartial({ brushRadius: radius }),
    setActiveColor: (color) => {
      const state = store()
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
          setPartial({ activeColor: color })
          return
        }

        setPartial({ activeColor: color })
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

        setPartial((s) => {
          const st = s as unknown as SettingsStore
          return {
            objects: paintColorOnObjects(
              st.objects,
              [obj.id],
              selectionMode,
              meshSelection,
              true,
              rgbaWithAlpha
            ).map((o) =>
              o.id === obj.id ? { ...o, color: rgba4ToNumber(rgbaWithAlpha) } : o
            ),
          }
        })
        store().commitHistory('Recolor')
        return
      }

      if (targetIds.length === 0) {
        setPartial({ activeColor: color })
        return
      }

      const paintIds = targetIds.filter((id) => {
        const obj = objects.find((o) => o.id === id)
        return obj && !obj.topologyLocked
      })

      setPartial({ activeColor: color })
      if (paintIds.length === 0) return

      const needsUpdate = paintIds.some((id) => {
        const obj = objects.find((o) => o.id === id)
        return obj && objectNeedsRecolor(obj, color, rgba)
      })
      if (!needsUpdate) return

      setPartial((s) => {
        const st = s as unknown as SettingsStore
        return {
          objects: paintColorOnObjects(
            st.objects,
            paintIds,
            'object',
            null,
            false,
            rgba
          ).map((o) => (paintIds.includes(o.id) ? { ...o, color } : o)),
        }
      })
      store().commitHistory('Recolor')
    },
    setDrawDoubleSided: (on) => setPartial({ drawDoubleSided: on }),
    setFacetExaggeration: (value) => setPartial({ facetExaggeration: value }),
    setShowDensityHeatmap: (show) => setPartial({ showDensityHeatmap: show }),
    setThemeId: (id) => {
      applyTheme(id)
      try {
        localStorage.setItem(THEME_STORAGE_KEY, id)
      } catch {
        /* ignore */
      }
      const materialHex = getThemeMaterialHex(id)
      setPartial({
        themeId: id,
        activeColor: getThemeMaterialColor(id),
        materialEditorColor: hexToRgba4(materialHex),
      })
    },
    toggleTopologyLock: () => {
      const { selectedObjectId, objects } = store()
      if (!selectedObjectId) return
      const obj = objects.find((o) => o.id === selectedObjectId)
      if (!obj) return
      store().updateObject(selectedObjectId, { topologyLocked: !obj.topologyLocked })
    },
    setShowToolRing: (show) => setPartial({ showToolRing: show }),
    setShowExportDialog: (show) => setPartial({ showExportDialog: show }),

    applySculptAt: (center, tool, options) => {
      const { selectedObjectId, objects, brushRadius, brushStrength } = store()
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

      const { symmetryEnabled, symmetryAxis, symmetryPlane } = store()
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
      setPartial((s) => {
        const st = s as unknown as SettingsStore
        return {
          objects: st.objects.map((o) => (o.id === targetId ? updated : o)),
        }
      })
      if (options?.saveHistory) store().commitHistory('Sculpt')
    },

    simplifySelected: () => {
      const { selectedObjectId, objects, polyBudget } = store()
      const targetId = selectedObjectId ?? objects[objects.length - 1]?.id
      if (!targetId) return

      const obj = objects.find((o) => o.id === targetId)
      if (!obj || obj.topologyLocked) return

      const mesh = HalfEdgeMesh.fromObject(obj)
      const simplified = simplifyMesh(mesh, Math.floor(polyBudget * 0.75))
      const updated = simplified.toObject(obj.id, obj.name, obj)
      invalidateFaceGroupCache(targetId)
      setPartial((s) => {
        const st = s as unknown as SettingsStore
        return {
          objects: st.objects.map((o) => (o.id === targetId ? updated : o)),
        }
      })
      store().commitHistory('Simplify')
    },
  }
}
