import type { ObjectTransform, SceneObject } from '../mesh/HalfEdgeMesh'
import { cloneTransform, ensureTransform, selectionWorldCenter } from '../mesh/objectTransform'
import {
  applyObjectTransformModal,
  type ObjectTransformModalOp,
} from '../mesh/objectTransformModal'
import type { Vec3 } from '../utils/math'
import { categoryForActiveTool, type ToolRingEntry } from '../tools/toolRingConfig'
import {
  meshSelectionWorldCenter,
  selectionHasComponents,
  type MeshComponentSelection,
} from '../mesh/meshSelection'
import {
  applyMeshModalOp,
  cloneSceneObject,
  modalValueFromMouseDelta,
  modalValueFromWheel,
  type MeshModalOpKind,
} from '../mesh/meshOps'
import { clearStrokeDraftState, type DrawInputMode } from './strokeSlice'
import { clearVectorDraftState } from './vectorToolsSlice'
import type { SelectionMode } from './selectionSlice'

export type ToolCategory =
  | 'draw'
  | 'create'
  | 'vector'
  | 'sculpt'
  | 'select'
  | 'transform'
  | 'mesh'
  | 'boolean'

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

export interface ObjectTransformModalState {
  op: ObjectTransformModalOp
  objectIds: string[]
  baseTransforms: Record<string, ObjectTransform>
  pivotWorld: Vec3
  value: number
  startClientX: number
  startClientY: number
}

export interface ToolActivationLayoutState {
  activeTool: ActiveTool
  toolCategory: ToolCategory
  meshModal: MeshModalState | null
  objectTransformModal: ObjectTransformModalState | null
}

export interface ToolActivationLayoutActions {
  setActiveTool: (tool: ActiveTool) => void
  activateToolRingEntry: (category: ToolCategory, entry: ToolRingEntry) => boolean
  activateSelectTool: () => void
  setToolCategory: (cat: ToolCategory) => void
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
}

export type ToolActivationSlice = ToolActivationLayoutState & ToolActivationLayoutActions

export const toolActivationInitialState: ToolActivationLayoutState = {
  activeTool: 'draw',
  toolCategory: 'draw',
  meshModal: null,
  objectTransformModal: null,
}

type ToolStore = ToolActivationLayoutState & {
  drawInputMode: DrawInputMode
  selectionObjectIds: string[]
  selectedObjectId: string | null
  selectionMode: SelectionMode
  meshSelection: MeshComponentSelection | null
  objects: SceneObject[]
  showExportDialog: boolean
  penCancelPath: () => void
  polyDrawCancel: () => void
  clearPolyDrawHover: () => void
  knifeCancel: () => void
  loopCutCancel: () => void
  setSelectionMode: (mode: SelectionMode) => void
  setActivePrimitiveKind: (kind: import('./vectorToolsSlice').PrimitiveKind | null) => void
  setActiveShapeKind: (kind: import('../vector/types').ShapeKind) => void
  setPolyDrawMode: (mode: import('./cadMeshToolsSlice').PolyDrawMode) => void
  setDrawInputMode: (mode: DrawInputMode) => void
  simplifySelected: () => void
  subdivideSelected: () => void
  flipSelectedNormals: () => void
  toggleSubDSelected: () => void
  setSelectionSmoothShading: (smooth: boolean) => void
  toggleUvEditor: () => void
  toggleTopologyLock: () => void
  copySelection: () => void
  pasteClipboard: () => void
  deleteSelection: () => void
  updateObject: (id: string, updates: Partial<SceneObject>) => void
  captureUndoPoint: (label?: string) => void
  replaceHistoryHead: (label?: string) => void
  pauseHistory: () => void
  undo: () => void
  resumeHistory: () => void
}

export function createToolActivationSlice<T extends ToolActivationLayoutState>(
  set: (partial: Partial<T> | ((state: T) => Partial<T>)) => void,
  get: () => T & ToolActivationLayoutActions
): ToolActivationLayoutActions {
  const store = () => get() as T & ToolActivationLayoutActions & ToolStore
  const setPartial = (partial: object | ((state: T) => object)) => {
    if (typeof partial === 'function') {
      set((state) => partial(state) as Partial<T>)
    } else {
      set(partial as unknown as Partial<T>)
    }
  }

  return {
    setActiveTool: (tool) => {
      const drawInputMode: DrawInputMode =
        tool === 'vector-pen' ? 'vector-pen' : tool === 'draw' ? 'regular' : store().drawInputMode
      if (tool !== 'vector-pen' && tool !== 'draw') {
        store().penCancelPath()
      }
      if (tool !== 'poly-draw') {
        store().polyDrawCancel()
        store().clearPolyDrawHover()
      }
      if (tool !== 'knife') {
        store().knifeCancel()
      }
      if (tool !== 'loop-cut') {
        store().loopCutCancel()
      }
      const toolCategory = categoryForActiveTool(tool, store().toolCategory)
      setPartial({ activeTool: tool, drawInputMode, toolCategory })
    },

    activateToolRingEntry: (category, entry) => {
      const state = store()
      const hasObjectSelection =
        state.selectionObjectIds.length > 0 || !!state.selectedObjectId

      const activateMeshEditTool = (tool: 'knife' | 'loop-cut') => {
        if (!hasObjectSelection) return false
        store().penCancelPath()
        store().polyDrawCancel()
        store().clearPolyDrawHover()
        if (tool !== 'knife') store().knifeCancel()
        if (tool !== 'loop-cut') store().loopCutCancel()
        setPartial({
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
            store().setSelectionMode(entry.selectionMode)
            if (entry.tool.startsWith('select-')) return true
          }
          store().setActiveTool(entry.tool)
          setPartial({ toolCategory: categoryForActiveTool(entry.tool, category) })
          return true
        }
        case 'primitive': {
          store().setActivePrimitiveKind(entry.primitive)
          setPartial({ toolCategory: category })
          return true
        }
        case 'shape': {
          store().setActiveShapeKind(entry.shape)
          setPartial({ toolCategory: 'vector' })
          return true
        }
        case 'polyMode': {
          store().penCancelPath()
          store().setPolyDrawMode(entry.mode)
          setPartial({ toolCategory: 'draw' })
          return true
        }
        case 'stroke': {
          store().penCancelPath()
          setPartial({
            strokeMode: entry.mode,
            drawInputMode: 'regular',
            activeTool: 'draw',
            toolCategory: 'draw',
            ...clearVectorDraftState(),
            ...clearStrokeDraftState(),
          })
          return true
        }
        case 'drawInput': {
          store().setDrawInputMode(entry.mode)
          setPartial({ toolCategory: entry.mode === 'vector-pen' ? 'vector' : 'draw' })
          return true
        }
        case 'action': {
          switch (entry.id) {
            case 'extrude': {
              store().penCancelPath()
              setPartial({
                sketchExtrudeMode: true,
                drawInputMode: 'regular',
                activeTool: 'draw',
                toolCategory: 'draw',
                ...clearVectorDraftState(),
            ...clearStrokeDraftState(),
              })
              return true
            }
            case 'select-tool':
              store().activateSelectTool()
              return true
            case 'simplify':
              store().simplifySelected()
              return true
            case 'subdivide':
              store().subdivideSelected()
              return true
            case 'flip-normals':
              store().flipSelectedNormals()
              return true
            case 'subd':
              store().toggleSubDSelected()
              return true
            case 'shade-smooth':
              store().setSelectionSmoothShading(true)
              return true
            case 'shade-flat':
              store().setSelectionSmoothShading(false)
              return true
            case 'uv-editor':
              store().toggleUvEditor()
              return true
            case 'topology-lock':
              store().toggleTopologyLock()
              return true
            case 'export':
              setPartial({ showExportDialog: true })
              return true
            case 'import':
              setPartial({ showExportDialog: true })
              return true
            case 'copy':
              store().copySelection()
              return true
            case 'paste':
              store().pasteClipboard()
              return true
            case 'delete':
              store().deleteSelection()
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
      const { selectionMode } = store()
      const toolByMode: Record<SelectionMode, ActiveTool> = {
        object: 'select-object',
        vertex: 'select-vertex',
        edge: 'select-edge',
        face: 'select-face',
      }
      store().penCancelPath()
      store().polyDrawCancel()
      store().knifeCancel()
      store().loopCutCancel()
      setPartial({ activeTool: toolByMode[selectionMode], toolCategory: 'select' })
    },
    setToolCategory: (cat) => setPartial({ toolCategory: cat }),

    applyMeshModalPreview: () => {
      const modal = store().meshModal
      if (!modal) return

      const result = applyMeshModalOp(
        modal.baseObject,
        modal.selection,
        modal.selectionMode,
        modal.op,
        modal.value,
        modal.pivotWorld
      )

      store().updateObject(modal.objectId, {
        positions: result.positions,
        faces: result.faces,
        faceColors: result.faceColors,
      })
    },

    beginMeshModal: (op, clientX, clientY) => {
      const { meshSelection, objects, selectionMode } = store()
      if (!meshSelection || !selectionHasComponents(meshSelection)) return
      if (store().meshModal) store().cancelMeshModal()
      if (store().objectTransformModal) store().cancelObjectTransformModal()

      const obj = objects.find((o) => o.id === meshSelection.objectId)
      if (!obj || obj.topologyLocked) return

      store().captureUndoPoint('Mesh edit')
      const pivotWorld = meshSelectionWorldCenter(obj, meshSelection)

      setPartial({
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
      store().applyMeshModalPreview()
    },

    updateMeshModalFromPointer: (clientX, clientY) => {
      const modal = store().meshModal
      if (!modal) return

      const value = modalValueFromMouseDelta(
        modal.op,
        clientX - modal.startClientX,
        modal.startClientY - clientY
      )

      setPartial({ meshModal: { ...modal, value } })
      store().applyMeshModalPreview()
    },

    adjustMeshModalWheel: (deltaY) => {
      const modal = store().meshModal
      if (!modal) return

      const value = modalValueFromWheel(modal.op, modal.value, deltaY)
      setPartial({ meshModal: { ...modal, value } })
      store().applyMeshModalPreview()
    },

    confirmMeshModal: () => {
      store().replaceHistoryHead('Mesh edit')
      setPartial({ meshModal: null })
    },

    cancelMeshModal: () => {
      if (!store().meshModal) return
      store().pauseHistory()
      store().undo()
      store().resumeHistory()
      setPartial({ meshModal: null })
    },

    applyObjectTransformModalPreview: () => {
      const modal = store().objectTransformModal
      if (!modal) return

      setPartial((s) => {
        const st = s as unknown as ToolStore
        return {
          objects: st.objects.map((o) => {
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
        }
      })
    },

    beginObjectTransformModal: (op, clientX, clientY) => {
      const { selectionObjectIds, selectionMode, objects } = store()
      if (selectionMode !== 'object' || selectionObjectIds.length === 0) return
      if (store().objectTransformModal) store().cancelObjectTransformModal()
      if (store().meshModal) store().cancelMeshModal()

      const baseTransforms: Record<string, ObjectTransform> = {}
      for (const id of selectionObjectIds) {
        const obj = objects.find((o) => o.id === id)
        if (!obj) continue
        baseTransforms[id] = cloneTransform(ensureTransform(obj))
      }
      if (Object.keys(baseTransforms).length === 0) return

      store().captureUndoPoint('Transform')
      setPartial({
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
      store().applyObjectTransformModalPreview()
    },

    updateObjectTransformModalFromPointer: (clientX, clientY) => {
      const modal = store().objectTransformModal
      if (!modal) return

      const value = modalValueFromMouseDelta(
        modal.op,
        clientX - modal.startClientX,
        modal.startClientY - clientY
      )

      setPartial({ objectTransformModal: { ...modal, value } })
      store().applyObjectTransformModalPreview()
    },

    adjustObjectTransformModalWheel: (deltaY) => {
      const modal = store().objectTransformModal
      if (!modal) return

      const value = modalValueFromWheel(modal.op, modal.value, deltaY)
      setPartial({ objectTransformModal: { ...modal, value } })
      store().applyObjectTransformModalPreview()
    },

    confirmObjectTransformModal: () => {
      store().replaceHistoryHead('Transform')
      setPartial({ objectTransformModal: null })
    },

    cancelObjectTransformModal: () => {
      if (!store().objectTransformModal) return
      store().pauseHistory()
      store().undo()
      store().resumeHistory()
      setPartial({ objectTransformModal: null })
    },

  }
}
