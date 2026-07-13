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
import { clearSculptSession } from '../sculpt/sculptSessionCache'
import { stampDrawMaterial } from '../material/materialEditorSlice'
import { rebuildObjectIndex, getObjectIndex } from './objectIndex'
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
  drawDoubleSided: boolean
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
      const { symmetryEnabled, symmetryAxis, symmetryPlane, polyBudget, drawDoubleSided } = store()
      const budget = obj.polyBudget ?? polyBudget
      const stamped = stampDrawMaterial(obj, drawDoubleSided)
      const prepared = enforceSceneObjectPolyBudget(prepareSceneObject(stamped), budget)
      const batch = [prepared]
      if (symmetryEnabled && !options?.skipSymmetry) {
        batch.push(mirrorSceneObject(prepared, symmetryAxis, symmetryPlane))
      }
      setPartial((s) => {
        const st = s as unknown as SceneStore
        const objects = [...st.objects, ...batch]
        rebuildObjectIndex(objects)
        return {
          objects,
          selectedObjectId: batch[0].id,
          selectionObjectIds: batch.map((b) => b.id),
        }
      })
      if (!options?.skipHistory) store().commitHistory('Add object')
    },

    updateObject: (id, updates) => {
      const topologyChanged = Boolean(
        updates.faces ||
        updates.positions ||
        updates.faceGroups
      )
      if (
        topologyChanged ||
        updates.subdEnabled !== undefined ||
        updates.subdLevels !== undefined
      ) {
        invalidateFaceGroupCache(id)
        invalidateSubdivisionPreviewCache(id)
        clearSculptSession(id)
      }
      setPartial((s) => {
        const proceduralReset = topologyChanged
          ? { sketchSource: undefined, vectorSource: undefined, primitiveSource: undefined }
          : {}
        const index = getObjectIndex(id)
        if (index === undefined) {
          const objects = s.objects.map((o) => (o.id === id ? { ...o, ...proceduralReset, ...updates } : o))
          rebuildObjectIndex(objects)
          return { objects }
        }
        const current = s.objects[index]
        if (!current || current.id !== id) {
          const objects = s.objects.map((o) => (o.id === id ? { ...o, ...proceduralReset, ...updates } : o))
          rebuildObjectIndex(objects)
          return { objects }
        }
        const objects = s.objects.slice()
        objects[index] = { ...current, ...proceduralReset, ...updates }
        return { objects }
      })
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
        const objects = st.objects.filter((o) => o.id !== id)
        rebuildObjectIndex(objects)
        return {
          objects,
          selectedObjectId: st.selectedObjectId === id ? null : st.selectedObjectId,
          selectionObjectIds: st.selectionObjectIds.filter((oid) => oid !== id),
          objectTextures,
          pixelDocuments,
        }
      })
      deps.clearTextureLoadGeneration(id)
      invalidateFaceGroupCache(id)
      invalidateSubdivisionPreviewCache(id)
      clearSculptSession(id)
      deps.reconcileBlobUrls()
      store().commitHistory('Delete object')
    },

    updateObjectTransform: (id, transform) => {
      setPartial((s) => {
        let index = getObjectIndex(id)
        if (index === undefined || s.objects[index]?.id !== id) {
          rebuildObjectIndex(s.objects)
          index = getObjectIndex(id)
        }
        if (index === undefined) return {}
        const current = s.objects[index]!
        const curTr = ensureTransform(current)
        if (transformsEqual(curTr, transform)) return {}
        const objects = s.objects.slice()
        objects[index] = { ...current, transform: cloneTransform(transform) }
        return { objects }
      })
    },

    updateSelectionObjectTransforms: (transforms) => {
      setPartial((s) => {
        const ids = Object.keys(transforms)
        if (ids.length === 0) return {}
        let objects = s.objects
        let changed = false
        for (const id of ids) {
          const next = transforms[id]
          if (!next) continue
          let index = getObjectIndex(id)
          if (index === undefined || objects[index]?.id !== id) {
            rebuildObjectIndex(objects)
            index = getObjectIndex(id)
          }
          if (index === undefined) continue
          const current = objects[index]!
          const curTr = ensureTransform(current)
          if (transformsEqual(curTr, next)) continue
          if (!changed) {
            objects = objects.slice()
            changed = true
          }
          objects[index] = { ...current, transform: cloneTransform(next) }
        }
        return changed ? { objects } : {}
      })
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
        const objects = [...st.objects, ...pasted]
        rebuildObjectIndex(objects)
        return {
          objects,
          selectedObjectId: pasted[pasted.length - 1]?.id ?? null,
          selectionObjectIds: pasted.map((p) => p.id),
        }
      })
      store().commitHistory('Paste')
    },

  }
}
