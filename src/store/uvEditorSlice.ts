import type { FloatingPanelState } from '../components/FloatingPanel'
import type { UvSnapMode } from '../uv/uvSnap'
import { unwrapSelectedFaces, type UvUnwrapMethod } from '../uv/uvUnwrap'
import { expandFacesToPlanarRegions } from '../mesh/faceGroups'
import { ensureObjectUVs, assignUvMappingForMode, resolveUvMappingMode, setUvPoints, type UvMappingMode } from '../uv/uvObject'
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
import { collectUvIndicesForFaces } from '../uv/uvObject'
import type { Uv2 } from '../uv/uvTypes'
import { cloneUv2 } from '../uv/uvTypes'
import { setObjectMaterialMode } from '../material/materialEditorSlice'
import { importImageAsNewDocument } from '../pixel/pixelEditorSlice'
import { releaseTextureUrl } from '../rendering/textureCache'
import { resolveEffectiveMaterial } from '../material/materials'
import type { SceneObject } from '../mesh/HalfEdgeMesh'
import type { MeshComponentSelection } from '../mesh/meshSelection'
import type { SelectionMode } from './selectionSlice'
import type { ActiveTool, ToolCategory } from './toolActivationSlice'
import type { ViewType } from '../scene/viewTypes'
import type { ViewMoveBasis } from '../utils/viewNavigation'
import { viewScreenAxes } from '../mesh/selectionPlaneTransform'

export type UvEditorMode = 'points' | 'faces'

export interface UvTextureInfo {
  url: string
  name: string
  width: number
  height: number
}

export interface UvEditorLayoutState {
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
  uvEditorViewAll: boolean
  uvEditorAutoFit: boolean
  uvEditorSticky: boolean
  objectTextures: Record<string, UvTextureInfo>
}

export interface UvEditorLayoutActions {
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
}

export type UvEditorSlice = UvEditorLayoutState & UvEditorLayoutActions

export const uvEditorInitialState: UvEditorLayoutState = {
  uvEditorOpen: false,
  uvEditorPanel: { x: 80, y: 80, width: 680, height: 620, minimized: false },
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
  uvEditorSticky: true,
  objectTextures: {},
}

export interface UvEditorSliceDeps {
  reconcileBlobUrls: () => void
  bumpTextureLoadGeneration: (objectId: string) => number
  currentTextureLoadGeneration: (objectId: string) => number | undefined
}

type UvStore = UvEditorLayoutState & {
  objects: SceneObject[]
  selectedObjectId: string | null
  selectionObjectIds: string[]
  meshSelection: MeshComponentSelection | null
  selectionMode: SelectionMode
  activeTool: ActiveTool
  toolCategory: ToolCategory
  pixelDocuments: Record<string, import('../pixel/pixelTypes').PixelDocument>
  pixelEditorDocId: string | null
  pixelTextureRevision: number
  updateObject: (id: string, updates: Partial<SceneObject>) => void
  commitHistory: (label?: string) => boolean
  activeView: ViewType
  viewMoveBasis: ViewMoveBasis | null
}

export function createUvEditorSlice<T extends UvEditorLayoutState>(
  set: (partial: Partial<T> | ((state: T) => Partial<T>)) => void,
  get: () => T & UvEditorLayoutActions,
  deps: UvEditorSliceDeps
): UvEditorLayoutActions {
  const store = () => get() as T & UvEditorLayoutActions & UvStore
  const setPartial = (partial: object | ((state: T) => object)) => {
    if (typeof partial === 'function') {
      set((state) => partial(state) as Partial<T>)
    } else {
      set(partial as unknown as Partial<T>)
    }
  }

  return {
    setUvEditorOpen: (open) => {
      if (!open) {
        setPartial({ uvEditorOpen: false })
        return
      }
      const state = store()
      const objectId = state.selectedObjectId ?? state.selectionObjectIds[0]
      if (objectId) {
        const obj = state.objects.find((o) => o.id === objectId)
        if (obj) store().updateObject(objectId, ensureObjectUVs(obj))
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
      setPartial({
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
      const { uvEditorOpen, uvEditorPanel, selectedObjectId, selectionObjectIds } = store()
      if (!uvEditorOpen && !selectedObjectId && selectionObjectIds.length === 0) return
      if (uvEditorOpen && uvEditorPanel.minimized) {
        setPartial({
          uvEditorPanel: { ...uvEditorPanel, minimized: false },
          uvEditorMode: 'faces',
          selectionMode: 'face',
          activeTool: 'select-face',
          toolCategory: 'select',
        })
        return
      }
      if (!uvEditorOpen) {
        store().setUvEditorOpen(true)
        return
      }
      setPartial({ uvEditorOpen: false })
    },
    setUvEditorPanel: (panel) => setPartial({ uvEditorPanel: panel }),
    setUvEditorGridDivisions: (n) => setPartial({ uvEditorGridDivisions: Math.max(1, n) }),
    setUvEditorSnap: (on) => setPartial({ uvEditorSnap: on }),
    setUvEditorSnapMode: (mode) => setPartial({ uvEditorSnapMode: mode }),
    setUvEditorSmartUvAngle: (deg) =>
      setPartial({ uvEditorSmartUvAngle: Math.max(1, Math.min(180, Math.round(deg))) }),
    setUvEditorMode: (mode) => setPartial({ uvEditorMode: mode }),
    setUvEditorSelectedPoints: (indices) => setPartial({ uvEditorSelectedPoints: indices }),
    setUvEditorSelectedFaces: (indices) => setPartial({ uvEditorSelectedFaces: indices }),

    selectUvFaces: (objectId, faceIndices) => {
      const state = store()
      const obj = state.objects.find((o) => o.id === objectId)
      const expanded =
        state.uvEditorSticky && obj
          ? expandFacesToPlanarRegions(obj, faceIndices)
          : faceIndices
      setPartial({
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
      setPartial({ uvEditorZoom: zoom, uvEditorPanX: panX, uvEditorPanY: panY }),
    setUvEditorShowGrid: (on) => setPartial({ uvEditorShowGrid: on }),
    setUvEditorTilePreview: (on) => setPartial({ uvEditorTilePreview: on }),
    setUvEditorViewAll: (on) => setPartial({ uvEditorViewAll: on }),
    setUvEditorAutoFit: (on) => setPartial({ uvEditorAutoFit: on }),
    setUvEditorSticky: (on) => setPartial({ uvEditorSticky: on }),

    setObjectUvMappingMode: (objectId, mode) => {
      const { objects, updateObject } = store()
      const obj = objects.find((o) => o.id === objectId)
      if (!obj || resolveUvMappingMode(obj) === mode) return
      const mapped = assignUvMappingForMode(obj, mode, mode === 'perFace')
      updateObject(objectId, {
        uvs: mapped.uvs,
        faceUvIndices: mapped.faceUvIndices,
        uvMappingMode: mode,
      })
      store().commitHistory('UV mapping mode')
    },

    loadObjectTexture: async (objectId, file) => {
      const generation = deps.bumpTextureLoadGeneration(objectId)
      const url = URL.createObjectURL(file)
      try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const el = new Image()
          el.onload = () => resolve(el)
          el.onerror = () => reject(new Error('Failed to load image'))
          el.src = url
        })

        if (deps.currentTextureLoadGeneration(objectId) !== generation) {
          URL.revokeObjectURL(url)
          return
        }

        const { objects, updateObject } = store()
        const obj = objects.find((o) => o.id === objectId)
        if (!obj) {
          URL.revokeObjectURL(url)
          return
        }

        const withUvs = ensureObjectUVs(obj)
        const hadUvs = Boolean(obj.uvs?.length)

        const { docs, docId } = await importImageAsNewDocument(store().pixelDocuments, file)
        updateObject(objectId, {
          ...setObjectMaterialMode(withUvs, 'texture', docId),
          uvs: withUvs.uvs,
          faceUvIndices: withUvs.faceUvIndices,
        })

        URL.revokeObjectURL(url)
        releaseTextureUrl(url)

        setPartial((s) => {
          const st = s as unknown as UvStore
          return {
            pixelDocuments: docs,
            pixelEditorDocId: docId,
            objectTextures: {
              ...st.objectTextures,
              [docId]: {
                url: '',
                name: file.name,
                width: img.naturalWidth,
                height: img.naturalHeight,
              },
            },
            pixelTextureRevision: st.pixelTextureRevision + 1,
          }
        })
        deps.reconcileBlobUrls()
        if (!hadUvs) store().commitHistory('Import texture')
      } catch {
        URL.revokeObjectURL(url)
        releaseTextureUrl(url)
      }
    },

    assignObjectTextureDocument: (objectId, docId, options) => {
      const state = store()
      const obj = state.objects.find((o) => o.id === objectId)
      if (!obj) return
      const doc = state.pixelDocuments[docId]
      if (!doc) return

      const mat = resolveEffectiveMaterial(obj)
      if (mat.mode === 'texture' && (mat.textureId ?? obj.id) === docId) return

      const withUvs = ensureObjectUVs(obj)
      store().updateObject(objectId, {
        ...setObjectMaterialMode(withUvs, 'texture', docId),
        uvs: withUvs.uvs,
        faceUvIndices: withUvs.faceUvIndices,
      })

      const meta = state.objectTextures[docId]
      setPartial((s) => {
        const st = s as unknown as UvStore
        return {
          pixelEditorDocId: docId,
          pixelTextureRevision: st.pixelTextureRevision + 1,
          ...(meta
            ? {}
            : {
                objectTextures: {
                  ...st.objectTextures,
                  [docId]: {
                    url: '',
                    name: doc.layers[0]?.name ?? 'Texture',
                    width: doc.width,
                    height: doc.height,
                  },
                },
              }),
        }
      })
      if (!options?.skipHistory) store().commitHistory('Assign texture')
    },

    getFaceUVs: (objectId, faceIndex) => {
      const obj = store().objects.find((o) => o.id === objectId)
      if (!obj) return []
      const ensured = ensureObjectUVs(obj)
      const idx = ensured.faceUvIndices[faceIndex] ?? []
      return idx.map((i) => cloneUv2(ensured.uvs[i]))
    },

    setObjectUvPoint: (objectId, uvIndex, u, v, saveHistory = false) => {
      store().setObjectUvPoints(objectId, [{ uvIndex, u, v }], saveHistory)
    },

    setObjectUvPoints: (objectId, updates, saveHistory = false) => {
      if (updates.length === 0) return
      const { objects } = store()
      const obj = objects.find((o) => o.id === objectId)
      if (!obj) return
      const base = obj.uvs?.length ? obj : ensureObjectUVs(obj)
      const updated = setUvPoints(base, updates)
      setPartial((s) => {
        const st = s as unknown as UvStore
        return {
          objects: st.objects.map((o) => (o.id === objectId ? updated : o)),
        }
      })
      if (saveHistory) store().commitHistory('Edit UV')
    },

    transformSelectedUvIslands: (op) => {
      const {
        objects,
        selectedObjectId,
        meshSelection,
        uvEditorSelectedPoints,
        uvEditorSelectedFaces,
      } = store()
      const objectId = selectedObjectId ?? meshSelection?.objectId
      if (!objectId) return
      const obj = objects.find((o) => o.id === objectId)
      if (!obj) return

      if (op === 'autoUv') {
        store().unwrapSelectedUvFaces('auto')
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

      setPartial((s) => {
        const st = s as unknown as UvStore
        return {
          objects: st.objects.map((o) =>
            o.id === objectId ? { ...ensureObjectUVs(o), uvs, faceUvIndices: ensured.faceUvIndices } : o
          ),
        }
      })
      store().commitHistory('Transform UV')
    },

    unwrapSelectedUvFaces: (method) => {
      const {
        objects,
        selectedObjectId,
        meshSelection,
        uvEditorSelectedFaces,
        uvEditorSmartUvAngle,
        uvEditorSticky,
        activeView,
        viewMoveBasis,
      } = store()
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

      if (faceIndices.length > 0 && uvEditorSticky) {
        faceIndices = expandFacesToPlanarRegions(obj, faceIndices)
      }

      const fullMesh = faceIndices.length >= obj.faces.length
      const ensured = ensureObjectUVs(obj)
      const viewAxes = method === 'view' ? viewScreenAxes(activeView, viewMoveBasis) : null
      const { uvs, faceUvIndices, uvAutoPacked } = unwrapSelectedFaces(
        ensured as import('../uv/uvObject').SceneObjectWithUVs,
        faceIndices,
        method,
        {
          angleLimitDeg: uvEditorSmartUvAngle,
          repackAll: true,
          markPacked: fullMesh,
          projectionAxes: viewAxes ? { right: viewAxes.right, up: viewAxes.up } : undefined,
          projectionView: method === 'view' ? activeView : undefined,
        }
      )
      setPartial((s) => {
        const st = s as unknown as UvStore
        return {
          objects: st.objects.map((o) =>
            o.id === objectId
              ? { ...o, uvs, faceUvIndices, uvAutoPacked: uvAutoPacked ?? fullMesh }
              : o
          ),
          uvEditorSelectedFaces: faceIndices,
          uvEditorSelectedPoints: [],
          uvEditorViewAll: false,
          uvEditorMode: 'faces',
        }
      })
      store().commitHistory('Unwrap UV')
    },
  }
}
