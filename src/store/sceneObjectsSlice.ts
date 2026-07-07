import type { ObjectTransform, SceneObject } from '../mesh/HalfEdgeMesh'
import {
  cloneTransform,
  ensureTransform,
  prepareSceneObject,
  transformsEqual,
} from '../mesh/objectTransform'
import { enforceSceneObjectPolyBudget } from '../mesh/meshPolyBudget'
import { generateId } from '../utils/math'
import { cloneSceneObject } from '../mesh/meshOps'
import { mirrorSceneObject, type SymmetryAxis } from '../symmetry/symmetry'
import { invalidateFaceGroupCache } from '../mesh/faceGroups'
import { invalidateSubdivisionPreviewCache } from '../mesh/subdivisionSurface'
import type { UvTextureInfo } from './appStore'

export type { SymmetryAxis } from '../symmetry/symmetry'

export interface SceneObjectsLayoutState {
  objects: SceneObject[]
  symmetryEnabled: boolean
  symmetryAxis: SymmetryAxis
  symmetryPlane: number
  clipboard: SceneObject[] | null
}

export interface SceneObjectsLayoutActions {
  addObject: (obj: SceneObject, options?: { skipHistory?: boolean; skipSymmetry?: boolean }) => void
  updateObject: (id: string, updates: Partial<SceneObject>) => void
  removeObject: (id: string) => void
  updateObjectTransform: (id: string, transform: ObjectTransform) => void
  updateSelectionObjectTransforms: (transforms: Record<string, ObjectTransform>) => void
  setSymmetryEnabled: (on: boolean) => void
  toggleSymmetry: () => void
  setSymmetryAxis: (axis: SymmetryAxis) => void
  setSymmetryPlane: (plane: number) => void
  copySelection: () => void
  pasteClipboard: () => void
}

export type SceneObjectsSlice = SceneObjectsLayoutState & SceneObjectsLayoutActions

export const sceneObjectsInitialState: SceneObjectsLayoutState = {
  objects: [],
  symmetryEnabled: false,
  symmetryAxis: 'x',
  symmetryPlane: 0,
  clipboard: null,
}

export interface SceneObjectsSliceDeps {
  reconcileBlobUrls: () => void
  purgeTextureResourcesForObjects: (
    objects: SceneObject[],
    removedIds: Set<string>,
    objectTextures: Record<string, UvTextureInfo>,
    pixelDocuments: Record<string, import('../pixel/pixelTypes').PixelDocument>
  ) => {
    objectTextures: Record<string, UvTextureInfo>
    pixelDocuments: Record<string, import('../pixel/pixelTypes').PixelDocument>
  }
  clearTextureLoadGeneration: (id: string) => void
}

type SceneStore = SceneObjectsLayoutState & {
  polyBudget: number
  symmetryEnabled: boolean
  symmetryAxis: SymmetryAxis
  symmetryPlane: number
  selectedObjectId: string | null
  selectionObjectIds: string[]
  objectTextures: Record<string, UvTextureInfo>
  pixelDocuments: Record<string, import('../pixel/pixelTypes').PixelDocument>
  commitHistory: (label?: string) => boolean
}

export function createSceneObjectsSlice<T extends SceneObjectsLayoutState>(
  set: (partial: Partial<T> | ((state: T) => Partial<T>)) => void,
  get: () => T & SceneObjectsLayoutActions,
  deps: SceneObjectsSliceDeps
): SceneObjectsLayoutActions {
  const store = () => get() as T & SceneObjectsLayoutActions & SceneStore
  const setPartial = (partial: object | ((state: T) => object)) => {
    if (typeof partial === 'function') {
      set((state) => partial(state) as Partial<T>)
    } else {
      set(partial as unknown as Partial<T>)
    }
  }

  return {
    addObject: (obj, options) => {
      const { symmetryEnabled, symmetryAxis, symmetryPlane, polyBudget } = store()
      const budget = obj.polyBudget ?? polyBudget
      const prepared = enforceSceneObjectPolyBudget(prepareSceneObject(obj), budget)
      const batch = [prepared]
      if (symmetryEnabled && !options?.skipSymmetry) {
        batch.push(mirrorSceneObject(prepared, symmetryAxis, symmetryPlane))
      }
      setPartial((s) => {
        const st = s as unknown as SceneStore
        return {
          objects: [...st.objects, ...batch],
          selectedObjectId: batch[0].id,
          selectionObjectIds: batch.map((b) => b.id),
        }
      })
      if (!options?.skipHistory) store().commitHistory('Add object')
    },

    updateObject: (id, updates) => {
      if (updates.faces || updates.positions || updates.faceGroups) invalidateFaceGroupCache(id)
      setPartial((s) => ({
        objects: s.objects.map((o) => (o.id === id ? { ...o, ...updates } : o)),
      }))
    },

    removeObject: (id) => {
      setPartial((s) => {
        const st = s as unknown as SceneStore
        const removed = new Set([id])
        const { objectTextures, pixelDocuments } = deps.purgeTextureResourcesForObjects(
          st.objects,
          removed,
          st.objectTextures,
          st.pixelDocuments
        )
        return {
          objects: st.objects.filter((o) => o.id !== id),
          selectedObjectId: st.selectedObjectId === id ? null : st.selectedObjectId,
          selectionObjectIds: st.selectionObjectIds.filter((oid) => oid !== id),
          objectTextures,
          pixelDocuments,
        }
      })
      deps.clearTextureLoadGeneration(id)
      invalidateFaceGroupCache(id)
      invalidateSubdivisionPreviewCache(id)
      deps.reconcileBlobUrls()
      store().commitHistory('Delete object')
    },

    updateObjectTransform: (id, transform) => {
      setPartial((s) => ({
        objects: s.objects.map((o) => {
          if (o.id !== id) return o
          const current = ensureTransform(o)
          if (transformsEqual(current, transform)) return o
          return { ...o, transform: cloneTransform(transform) }
        }),
      }))
    },

    updateSelectionObjectTransforms: (transforms) => {
      setPartial((s) => ({
        objects: s.objects.map((o) => {
          const next = transforms[o.id]
          if (!next) return o
          const current = ensureTransform(o)
          if (transformsEqual(current, next)) return o
          return { ...o, transform: cloneTransform(next) }
        }),
      }))
    },

    setSymmetryEnabled: (on) => setPartial({ symmetryEnabled: on }),
    toggleSymmetry: () => setPartial((s) => ({ symmetryEnabled: !s.symmetryEnabled })),
    setSymmetryAxis: (axis) => setPartial({ symmetryAxis: axis }),
    setSymmetryPlane: (plane) =>
      setPartial({ symmetryPlane: Number.isFinite(plane) ? plane : 0 }),

    copySelection: () => {
      const { selectionObjectIds, objects } = store()
      if (selectionObjectIds.length === 0) return
      const copied = selectionObjectIds
        .map((id) => objects.find((o) => o.id === id))
        .filter((o): o is SceneObject => o != null)
        .map((o) => cloneSceneObject(o))
      setPartial({ clipboard: copied })
    },

    pasteClipboard: () => {
      const { clipboard } = store()
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
      setPartial((s) => {
        const st = s as unknown as SceneStore
        return {
          objects: [...st.objects, ...pasted],
          selectedObjectId: pasted[pasted.length - 1]?.id ?? null,
          selectionObjectIds: pasted.map((p) => p.id),
        }
      })
      store().commitHistory('Paste')
    },

  }
}
