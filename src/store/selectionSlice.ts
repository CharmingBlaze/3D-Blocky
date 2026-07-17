import type { SceneObject, ObjectTransform } from '../mesh/HalfEdgeMesh'
import {
  ensureTransform,
  worldDeltaToLocal,
} from '../mesh/objectTransform'
import {
  collectFacesToDelete,
  deleteFacesFromObject,
} from '../mesh/meshDelete'
import {
  expandFaceToPlanarRegion,
  expandFacesToPlanarRegions,
  invalidateFaceGroupCache,
} from '../mesh/faceGroups'
import {
  emptyMeshSelection,
  edgeKey,
  getAffectedVertices,
  selectionHasComponents,
  translateVertexPositions,
  type MeshComponentSelection,
} from '../mesh/meshSelection'
import { collectUniqueEdges } from '../mesh/meshTopology'
import type { MeshPickHit } from '../select/meshPick'
import type { PixelDocument } from '../pixel/pixelTypes'
import { isSketchDoodleObject } from '../stroke/sketchSource'
import { isVectorDoodleObject } from '../vector/vectorSource'
import type { Vec3 } from '../utils/math'
import type { ViewMoveBasis, NudgeDirection } from '../utils/viewNavigation'
import { viewNudgeDelta } from '../utils/viewNavigation'
import type { ViewType } from '../scene/viewTypes'

export type SelectionMode = 'object' | 'vertex' | 'edge' | 'face'

type SelectActiveTool =
  | 'select-object'
  | 'select-vertex'
  | 'select-edge'
  | 'select-face'

export interface SelectionLayoutState {
  selectedObjectId: string | null
  selectionObjectIds: string[]
  selectionMode: SelectionMode
  meshSelection: MeshComponentSelection | null
  meshHover: MeshPickHit | null
}

export interface SelectionLayoutActions {
  selectObject: (id: string | null, options?: { additive?: boolean }) => void
  setSelection: (ids: string[]) => void
  addToObjectSelection: (ids: string[]) => void
  clearSelection: () => void
  setSelectionMode: (mode: SelectionMode) => void
  applyMeshPick: (hit: MeshPickHit, additive?: boolean) => void
  applyMeshMarqueePick: (
    objectId: string,
    components: { vertices: number[]; edges: string[]; faces: number[] },
    additive?: boolean
  ) => void
  clearMeshSelection: () => void
  selectAllInMode: () => void
  deselectAllInMode: () => void
  toggleSelectAll: () => void
  deleteSelection: () => void
  setMeshHover: (hit: MeshPickHit | null) => void
  translateMeshSelection: (deltaWorld: Vec3, basePositions: Record<number, Vec3>) => void
  translateSelectionByDelta: (
    delta: Vec3,
    baseTransforms: Record<string, ObjectTransform>
  ) => void
  nudgeSelection: (direction: NudgeDirection, fast?: boolean) => void
  setSelectionSmoothShading: (smooth: boolean) => void
  toggleSmoothShading: () => void
  shadeSmoothSelected: () => void
  shadeFlatSelected: () => void
}

export type SelectionSlice = SelectionLayoutState & SelectionLayoutActions

export const selectionLayoutInitialState: SelectionLayoutState = {
  selectedObjectId: null,
  selectionObjectIds: [],
  selectionMode: 'object',
  meshSelection: null,
  meshHover: null,
}

const SELECT_TOOL_BY_MODE: Record<SelectionMode, SelectActiveTool> = {
  object: 'select-object',
  vertex: 'select-vertex',
  edge: 'select-edge',
  face: 'select-face',
}

function colorFromSelection(objects: SceneObject[], id: string | null): number | undefined {
  if (!id) return undefined
  return objects.find((o) => o.id === id)?.color
}

/** Avoid notifying subscribers when a hover pick resolves to the same component. */
function meshHoverEquals(a: MeshPickHit | null, b: MeshPickHit | null): boolean {
  if (a === b) return true
  if (
    !a ||
    !b ||
    a.objectId !== b.objectId ||
    a.vertex !== b.vertex ||
    a.face !== b.face ||
    a.viewportSlot !== b.viewportSlot
  ) {
    return false
  }
  if (!a.edge && !b.edge) return true
  return a.edge?.[0] === b.edge?.[0] && a.edge?.[1] === b.edge?.[1]
}

function extrudeSyncForObject(obj: SceneObject | undefined): { extrudeAmount?: number } {
  if (isSketchDoodleObject(obj) && obj.sketchSource.isClosed) {
    return { extrudeAmount: obj.sketchSource.extrudeDepth }
  }
  if (isVectorDoodleObject(obj)) {
    return { extrudeAmount: obj.vectorSource.extrudeDepth }
  }
  return {}
}

export interface SelectionSliceDeps {
  reconcileBlobUrls: () => void
  purgeTextureResourcesForObjects: (
    objects: SceneObject[],
    removedIds: Set<string>,
    objectTextures: Record<string, SelectionTextureInfo>,
    pixelDocuments: Record<string, PixelDocument>
  ) => {
    objectTextures: Record<string, SelectionTextureInfo>
    pixelDocuments: Record<string, PixelDocument>
  }
  clearTextureLoadGeneration: (objectId: string) => void
}

export interface SelectionTextureInfo {
  url: string
  name: string
  width: number
  height: number
}

type SelectionStoreHost = SelectionLayoutState & {
  objects: SceneObject[]
  activeView: ViewType
  viewMoveBasis: ViewMoveBasis | null
  uvEditorOpen: boolean
  vertexMergeModifierHeld: boolean
  objectTextures: Record<string, SelectionTextureInfo>
  pixelDocuments: Record<string, PixelDocument>
  activeTool: string
  toolCategory: string
  penCancelPath: () => void
  mergeSelectedVertices: (indices: number[]) => void
  updateObject: (id: string, updates: Partial<SceneObject>) => void
  commitHistory: (label: string) => boolean
}

export function createSelectionSlice<S extends SelectionStoreHost & SelectionLayoutActions>(
  set: (partial: Partial<S> | ((state: S) => Partial<S>)) => void,
  get: () => S,
  deps: SelectionSliceDeps
): SelectionLayoutActions {
  return {
    selectObject: (id, options) => {
      if (!id) {
        set({
          selectedObjectId: null,
          selectionObjectIds: [],
          meshSelection: null,
          selectedReferenceImageId: null,
          selectedBillboardImageId: null,
        } as unknown as Partial<S>)
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
          } as unknown as Partial<S>
        })
      } else {
        const color = colorFromSelection(get().objects, id)
        const prevMesh = get().meshSelection
        const obj = get().objects.find((o) => o.id === id)
        set({
          selectedObjectId: id,
          selectionObjectIds: [id],
          selectedReferenceImageId: null,
          selectedBillboardImageId: null,
          ...(color !== undefined ? { activeColor: color } : {}),
          meshSelection: prevMesh?.objectId === id ? prevMesh : null,
          ...extrudeSyncForObject(obj),
        } as unknown as Partial<S>)
      }
    },

    setSelection: (ids) => {
      const primaryId = ids.length ? ids[ids.length - 1] : null
      const color = colorFromSelection(get().objects, primaryId)
      const obj = primaryId ? get().objects.find((o) => o.id === primaryId) : undefined
      set({
        selectionObjectIds: ids,
        selectedObjectId: primaryId,
        ...(color !== undefined ? { activeColor: color } : {}),
        ...extrudeSyncForObject(obj),
      } as unknown as Partial<S>)
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
        } as unknown as Partial<S>
      })
    },

    clearSelection: () =>
      set({ selectedObjectId: null, selectionObjectIds: [], meshSelection: null } as unknown as Partial<S>),

    setSelectionMode: (mode) => {
      get().penCancelPath()
      const { meshSelection, objects, selectionMode: previousMode } = get()
      let nextSelection = meshSelection

      // Blender-style component conversion: keep the same region editable when
      // switching Vertex/Edge/Face after operations like edge Extrude.
      if (mode !== 'object' && meshSelection && previousMode !== mode) {
        const obj = objects.find((candidate) => candidate.id === meshSelection.objectId)
        if (obj) {
          if (mode === 'vertex') {
            const verts = new Set(getAffectedVertices(meshSelection, obj))
            nextSelection = {
              objectId: meshSelection.objectId,
              vertices: [...verts],
              edges: [],
              faces: [],
            }
          } else if (mode === 'edge') {
            const edges = new Set(meshSelection.edges)
            if (previousMode === 'vertex') {
              const selected = new Set(meshSelection.vertices)
              for (const face of obj.faces) {
                for (let i = 0; i < face.length; i++) {
                  const a = face[i]!
                  const b = face[(i + 1) % face.length]!
                  if (selected.has(a) && selected.has(b)) edges.add(edgeKey(a, b))
                }
              }
            } else if (previousMode === 'face') {
              const faceSet = new Set(meshSelection.faces)
              const counts = new Map<string, number>()
              for (const fi of faceSet) {
                const face = obj.faces[fi]
                if (!face) continue
                for (let i = 0; i < face.length; i++) {
                  const key = edgeKey(face[i]!, face[(i + 1) % face.length]!)
                  counts.set(key, (counts.get(key) ?? 0) + 1)
                }
              }
              for (const [key, count] of counts) if (count === 1) edges.add(key)
            }
            nextSelection = {
              objectId: meshSelection.objectId,
              vertices: [],
              edges: [...edges],
              faces: [],
            }
          } else if (mode === 'face') {
            const faces = new Set(meshSelection.faces)
            if (previousMode === 'edge') {
              const edgeSet = new Set(meshSelection.edges)
              for (let fi = 0; fi < obj.faces.length; fi++) {
                const face = obj.faces[fi]!
                for (let i = 0; i < face.length; i++) {
                  if (edgeSet.has(edgeKey(face[i]!, face[(i + 1) % face.length]!))) {
                    faces.add(fi)
                    break
                  }
                }
              }
            } else if (previousMode === 'vertex') {
              const selected = new Set(meshSelection.vertices)
              for (let fi = 0; fi < obj.faces.length; fi++) {
                if (obj.faces[fi]!.every((vi) => selected.has(vi))) faces.add(fi)
              }
            }
            nextSelection = {
              objectId: meshSelection.objectId,
              vertices: [],
              edges: [],
              faces: [...faces],
            }
          }
          if (nextSelection && !selectionHasComponents(nextSelection)) nextSelection = null
        }
      }

      set({
        selectionMode: mode,
        activeTool: SELECT_TOOL_BY_MODE[mode],
        toolCategory: 'select',
        meshHover: null,
        vertexMergeModifierHeld: false,
        ...(mode === 'object'
          ? { meshSelection: null }
          : nextSelection !== meshSelection
            ? { meshSelection: nextSelection }
            : {}),
      } as unknown as Partial<S>)
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
            const faceSet = new Set(next.faces)
            for (const fi of regionFaces) faceSet.add(fi)
            next.faces = [...faceSet]
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
      } as unknown as Partial<S>)
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
        const vertSet = new Set(additive ? next.vertices : components.vertices)
        if (additive) for (const vi of components.vertices) vertSet.add(vi)
        next.vertices = [...vertSet]
      } else if (selectionMode === 'edge') {
        const edgeSet = new Set(additive ? next.edges : components.edges)
        if (additive) for (const key of components.edges) edgeSet.add(key)
        next.edges = [...edgeSet]
      } else if (selectionMode === 'face') {
        const obj = get().objects.find((o) => o.id === objectId)
        const expanded = obj
          ? expandFacesToPlanarRegions(obj, components.faces)
          : components.faces
        const faceSet = new Set(additive ? next.faces : expanded)
        if (additive) for (const fi of expanded) faceSet.add(fi)
        next.faces = [...faceSet]
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
      } as unknown as Partial<S>)
    },

    clearMeshSelection: () => set({ meshSelection: null } as unknown as Partial<S>),

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
        } as unknown as Partial<S>)
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
        } as unknown as Partial<S>)
        return
      }

      set({
        meshSelection: {
          objectId,
          vertices: [],
          edges: [],
          faces: obj.faces.map((_, i) => i),
        },
      } as unknown as Partial<S>)
    },

    deselectAllInMode: () => {
      if (get().selectionMode === 'object') {
        get().clearSelection()
      } else {
        get().clearMeshSelection()
      }
    },

    toggleSelectAll: () => {
      const { selectionMode, selectionObjectIds, meshSelection } = get()
      let hasSelection = false
      if (selectionMode === 'object') {
        hasSelection = selectionObjectIds.length > 0
      } else {
        hasSelection = meshSelection !== null && selectionHasComponents(meshSelection)
      }

      if (hasSelection) {
        get().deselectAllInMode()
      } else {
        get().selectAllInMode()
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
            const { objectTextures, pixelDocuments } = deps.purgeTextureResourcesForObjects(
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
            } as unknown as Partial<S>
          })
          deps.clearTextureLoadGeneration(obj.id)
          deps.reconcileBlobUrls()
        } else {
          set((s) => ({
            objects: s.objects.map((o) =>
              o.id === obj.id
                ? {
                    ...updated,
                    sketchSource: undefined,
                    vectorSource: undefined,
                    primitiveSource: undefined,
                  }
                : o
            ),
            meshSelection: null,
          }) as unknown as Partial<S>)
        }
        get().commitHistory('Delete faces')
        return
      }

      if (selectionObjectIds.length === 0) return

      const ids = new Set(selectionObjectIds)
      set((s) => {
        const { objectTextures, pixelDocuments } = deps.purgeTextureResourcesForObjects(
          s.objects,
          ids,
          s.objectTextures,
          s.pixelDocuments
        )
        for (const id of ids) {
          deps.clearTextureLoadGeneration(id)
          invalidateFaceGroupCache(id)
        }
        return {
          objects: s.objects.filter((o) => !ids.has(o.id)),
          selectedObjectId: null,
          selectionObjectIds: [],
          meshSelection: null,
          objectTextures,
          pixelDocuments,
        } as unknown as Partial<S>
      })
      deps.reconcileBlobUrls()
      get().commitHistory('Delete selection')
    },

    setMeshHover: (hit) => {
      if (meshHoverEquals(get().meshHover, hit)) return
      set({ meshHover: hit } as unknown as Partial<S>)
    },

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
      }) as unknown as Partial<S>)
    },

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
              sketchSource: undefined,
              vectorSource: undefined,
              primitiveSource: undefined,
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
        }) as unknown as Partial<S>)
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
      }) as unknown as Partial<S>)
      get().commitHistory('Nudge selection')
    },

    setSelectionSmoothShading: (smooth) => {
      const { selectionObjectIds, selectedObjectId, meshSelection, objects } = get()
      const ids = [
        ...new Set([
          ...(selectionObjectIds.length > 0
            ? selectionObjectIds
            : selectedObjectId
              ? [selectedObjectId]
              : []),
          ...(meshSelection?.objectId ? [meshSelection.objectId] : []),
        ]),
      ]
      if (ids.length === 0) return

      const idSet = new Set(ids)
      const targets = ids
        .map((id) => objects.find((o) => o.id === id))
        .filter((o): o is SceneObject => o != null)
      if (targets.length === 0) return
      if (targets.every((o) => o.smoothShading === smooth)) return

      set((s) => ({
        objects: s.objects.map((o) =>
          idSet.has(o.id) ? { ...o, smoothShading: smooth } : o
        ),
      }) as unknown as Partial<S>)
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
  }
}
