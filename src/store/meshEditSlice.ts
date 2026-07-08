import type { SceneObject } from '../mesh/HalfEdgeMesh'
import { appendFaceFromVertexIndices } from '../mesh/meshEdit'
import {
  flipSelectionNormals,
  makeSelectionDoubleSided,
  makeSelectionOutward,
  mergeVertices,
  subdivideObject,
} from '../mesh/meshTopologyOps'
import {
  clampSubdLevels,
  subdivideSurfaceLevels,
} from '../mesh/subdivisionSurface'
import {
  enforceSceneObjectPolyBudget,
} from '../mesh/meshPolyBudget'
import {
  getAffectedVertices,
  selectionHasComponents,
  type MeshComponentSelection,
} from '../mesh/meshSelection'
import {
  allVertexIndices,
  applySelectionPlaneTransform,
  viewScreenAxes,
  type SelectionPlaneTransformOp,
} from '../mesh/selectionPlaneTransform'
import type { SelectionMode } from './selectionSlice'
import type { ViewType } from '../scene/viewTypes'
import type { ViewMoveBasis } from '../utils/viewNavigation'

export interface MeshEditLayoutState {
  vertexMergeModifierHeld: boolean
}

export interface MeshEditLayoutActions {
  createFaceFromVertexSelection: () => void
  mergeSelectedVertices: (indices?: number[]) => void
  setVertexMergeModifierHeld: (held: boolean) => void
  flipSelectedNormals: () => void
  recalculateOutwardNormals: () => void
  makeSelectedDoubleSided: () => void
  transformSelectionInViewPlane: (op: SelectionPlaneTransformOp) => void
  subdivideSelected: () => void
  toggleSubDSelected: () => void
  setSubDLevelsSelected: (levels: number) => void
  adjustSubDLevelsSelected: (delta: number) => void
  applySubDSelected: () => void
}

export type MeshEditSlice = MeshEditLayoutState & MeshEditLayoutActions

export const meshEditInitialState: MeshEditLayoutState = {
  vertexMergeModifierHeld: false,
}

type MeshStore = MeshEditLayoutState & {
  meshSelection: MeshComponentSelection | null
  selectionMode: SelectionMode
  activeColor: number
  objects: SceneObject[]
  activeView: ViewType
  viewMoveBasis: ViewMoveBasis | null
  selectionObjectIds: string[]
  selectedObjectId: string | null
  polyBudget: number
  updateObject: (id: string, updates: Partial<SceneObject>) => void
  commitHistory: (label?: string) => boolean
}

export function createMeshEditSlice<T extends MeshEditLayoutState>(
  set: (partial: Partial<T> | ((state: T) => Partial<T>)) => void,
  get: () => T & MeshEditLayoutActions
): MeshEditLayoutActions {
  const store = () => get() as T & MeshEditLayoutActions & MeshStore
  const setPartial = (partial: object | ((state: T) => object)) => {
    if (typeof partial === 'function') {
      set((state) => partial(state) as Partial<T>)
    } else {
      set(partial as unknown as Partial<T>)
    }
  }

  return {
    createFaceFromVertexSelection: () => {
      const { meshSelection, objects, selectionMode, activeColor } = store()
      if (selectionMode !== 'vertex' || !meshSelection) return

      const verts = meshSelection.vertices
      if (verts.length !== 3 && verts.length !== 4) return

      const obj = objects.find((o) => o.id === meshSelection.objectId)
      if (!obj || obj.topologyLocked) return

      const result = appendFaceFromVertexIndices(obj, verts, activeColor)
      if (!result) return

      store().updateObject(obj.id, {
        positions: result.object.positions,
        faces: result.object.faces,
        faceColors: result.object.faceColors,
        faceGroups: result.object.faceGroups,
      })

      const newFaces = Array.from(
        { length: result.newFaceCount },
        (_, i) => result.newFaceStartIndex + i
      )
      setPartial({
        meshSelection: {
          objectId: obj.id,
          vertices: [],
          edges: [],
          faces: newFaces,
        },
      })
      store().commitHistory('Create face')
    },

    mergeSelectedVertices: (indices) => {
      const { meshSelection, objects, selectionMode } = store()
      if (selectionMode !== 'vertex' || !meshSelection) return

      const verts = indices ?? meshSelection.vertices
      if (verts.length < 2) return

      const obj = objects.find((o) => o.id === meshSelection.objectId)
      if (!obj || obj.topologyLocked) return

      const result = mergeVertices(obj, verts)
      if (!result) return

      store().updateObject(obj.id, {
        positions: result.object.positions,
        faces: result.object.faces,
        faceColors: result.object.faceColors,
        faceGroups: result.object.faceGroups,
        faceUvIndices: result.object.faceUvIndices,
      })
      setPartial({
        meshSelection: {
          objectId: obj.id,
          vertices: [result.mergedVertexIndex],
          edges: [],
          faces: [],
        },
        vertexMergeModifierHeld: false,
      })
      store().commitHistory('Merge vertices')
    },

    setVertexMergeModifierHeld: (held) => setPartial({ vertexMergeModifierHeld: held }),

    flipSelectedNormals: () => {
      const { meshSelection, objects, selectionMode } = store()
      if (!meshSelection || selectionMode === 'object') return
      const obj = objects.find((o) => o.id === meshSelection.objectId)
      if (!obj || obj.topologyLocked) return
      const flipped = flipSelectionNormals(obj, meshSelection, selectionMode)
      store().updateObject(obj.id, { faces: flipped.faces, faceUvIndices: flipped.faceUvIndices })
      store().commitHistory('Flip normals')
    },

    recalculateOutwardNormals: () => {
      const { meshSelection, objects, selectionMode, selectedObjectId } = store()
      const targetId =
        selectionMode !== 'object' && meshSelection && selectionHasComponents(meshSelection)
          ? meshSelection.objectId
          : selectedObjectId

      if (!targetId) return
      const obj = objects.find((o) => o.id === targetId)
      if (!obj || obj.topologyLocked) return

      const updated = makeSelectionOutward(
        obj,
        selectionMode !== 'object' && meshSelection && selectionHasComponents(meshSelection)
          ? meshSelection
          : null,
        selectionMode
      )

      store().updateObject(obj.id, {
        faces: updated.faces,
        faceUvIndices: updated.faceUvIndices,
      })
      store().commitHistory('Recalculate outward normals')
    },

    makeSelectedDoubleSided: () => {
      const { meshSelection, objects, selectionMode } = store()
      if (!meshSelection || selectionMode === 'object') return
      const obj = objects.find((o) => o.id === meshSelection.objectId)
      if (!obj || obj.topologyLocked) return
      const updated = makeSelectionDoubleSided(obj, meshSelection, selectionMode)
      store().updateObject(obj.id, {
        faces: updated.faces,
        faceUvIndices: updated.faceUvIndices,
        faceColors: updated.faceColors,
        faceGroups: updated.faceGroups,
      })
      store().commitHistory('Make double sided')
    },

    transformSelectionInViewPlane: (op) => {
      const {
        activeView,
        viewMoveBasis,
        meshSelection,
        objects,
        selectionObjectIds,
        selectedObjectId,
      } = store()

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
        store().updateObject(obj.id, { positions: updated.positions, faces: updated.faces })
        store().commitHistory(historyLabel)
        return
      }

      const ids =
        selectionObjectIds.length > 0
          ? selectionObjectIds
          : selectedObjectId
            ? [selectedObjectId]
            : []
      if (ids.length === 0) return

      setPartial((s) => {
        const st = s as unknown as MeshStore
        return {
          objects: st.objects.map((o) => {
            if (!ids.includes(o.id) || o.topologyLocked) return o
            const verts = allVertexIndices(o)
            const updated = applySelectionPlaneTransform(o, verts, op, axes)
            return { ...o, positions: updated.positions, faces: updated.faces }
          }),
        }
      })
      store().commitHistory(historyLabel)
    },

    subdivideSelected: () => {
      const { meshSelection, objects, selectionMode, selectedObjectId } = store()
      const objectId = meshSelection?.objectId ?? selectedObjectId
      if (!objectId) return
      const obj = objects.find((o) => o.id === objectId)
      if (!obj || obj.topologyLocked) return
      const subdivided = subdivideObject(obj, meshSelection, selectionMode)
      store().updateObject(obj.id, {
        positions: subdivided.positions,
        faces: subdivided.faces,
        faceColors: subdivided.faceColors,
        faceGroups: subdivided.faceGroups,
      })
      store().commitHistory('Subdivide')
    },

    toggleSubDSelected: () => {
      const { selectionObjectIds, selectedObjectId } = store()
      const ids =
        selectionObjectIds.length > 0
          ? selectionObjectIds
          : selectedObjectId
            ? [selectedObjectId]
            : []
      if (ids.length === 0) return
      setPartial({
        objects: store().objects.map((o) => {
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
      store().commitHistory('Toggle SubD')
    },

    setSubDLevelsSelected: (levels) => {
      const { selectionObjectIds, selectedObjectId } = store()
      const ids =
        selectionObjectIds.length > 0
          ? selectionObjectIds
          : selectedObjectId
            ? [selectedObjectId]
            : []
      if (ids.length === 0) return
      const clamped = clampSubdLevels(levels)
      setPartial({
        objects: store().objects.map((o) => {
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
      const { selectionObjectIds, selectedObjectId } = store()
      const ids =
        selectionObjectIds.length > 0
          ? selectionObjectIds
          : selectedObjectId
            ? [selectedObjectId]
            : []
      if (ids.length === 0) return
      setPartial({
        objects: store().objects.map((o) => {
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
      store().commitHistory(delta > 0 ? 'SubD level up' : 'SubD level down')
    },

    applySubDSelected: () => {
      const { selectionObjectIds, selectedObjectId, polyBudget } = store()
      const ids =
        selectionObjectIds.length > 0
          ? selectionObjectIds
          : selectedObjectId
            ? [selectedObjectId]
            : []
      if (ids.length === 0) return
      setPartial({
        objects: store().objects.map((o) => {
          if (!ids.includes(o.id) || o.topologyLocked) return o
          const requested = o.subdEnabled ? (o.subdLevels ?? 0) : 0
          if (requested <= 0) return o
          const budget = o.polyBudget ?? polyBudget
          const baked = subdivideSurfaceLevels(o, requested)
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
      store().commitHistory('Apply SubD')
    },

  }
}
